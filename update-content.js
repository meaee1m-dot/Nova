'use strict';
/* ============================================================
   NOVA TV — content updater
   ------------------------------------------------------------
   Pulls the LATEST catalog from the Oscar TV API (movies, series,
   anime, channels) using the signed X-Iron-* headers (iron.js) and
   rewrites the compact JSON snapshots the static site ships with:

     site/data/oscar_movies.json     { total, generated, items:[…] }
     site/data/oscar_series.json     { total, generated, items:[…] }
     site/data/oscar_anime.json      { total, generated, items:[…] }
     site/data/oscar_channels.json   { total, generated, items:[…] }
     site/data/oscar_home.json       { movies, series, anime, top, generated }

   Run:  node update-content.js            (full refresh)
         node update-content.js --limit 200  (quick partial refresh)
         node update-content.js --only movies,series

   Zero dependencies (Node 18+ global fetch is NOT used — we use https
   directly so it works on older runtimes and honours the UA/headers).
   ============================================================ */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const iron = require('./iron.js');
const netfetch = require('./netfetch.js');

const BASE = (process.env.OSCAR_BASE || 'https://ostvapp.cam').replace(/\/+$/, '');
const DATA = path.join(__dirname, 'site', 'data');
const UA = 'Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36';
const PAGE = 100; // items per page
const CONCURRENCY = 5;

const argv = process.argv.slice(2);
function argVal(name, def) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
}
const LIMIT = parseInt(argVal('--limit', '0'), 10) || 0; // 0 = all
const ONLY = (argVal('--only', '') || '').split(',').map((s) => s.trim()).filter(Boolean);

/* ---------------------------------------------------------- http */
function getJSON(pathname, params) {
  const u = new URL(BASE + pathname);
  if (params) Object.keys(params).forEach((k) => u.searchParams.set(k, params[k]));
  const headers = Object.assign(
    {
      'User-Agent': UA,
      Accept: 'application/json',
      'Accept-Language': 'ar,en;q=0.8',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: BASE + '/',
      Origin: BASE,
    },
    iron.ironHeaders(u.pathname)
  );
  return netfetch.request(u.href, { headers: headers, timeout: 25000 }).then((r) => {
    const body = r.body.toString('utf8');
    if (r.status >= 400) throw new Error('HTTP ' + r.status + ' ' + pathname + ' :: ' + body.slice(0, 120));
    try {
      return JSON.parse(body);
    } catch (e) {
      throw new Error('bad JSON from ' + pathname + ' :: ' + body.slice(0, 120));
    }
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
async function withRetry(fn, tries) {
  tries = tries || 4;
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await sleep(400 * (i + 1));
    }
  }
  throw last;
}

/* run an array of async tasks with bounded concurrency, preserving order */
async function pool(items, worker, conc) {
  const out = new Array(items.length);
  let idx = 0;
  async function runner() {
    while (idx < items.length) {
      const i = idx++;
      out[i] = await worker(items[i], i);
    }
  }
  const n = Math.min(conc || CONCURRENCY, items.length) || 1;
  await Promise.all(Array.from({ length: n }, runner));
  return out;
}

/* ---------------------------------------------------------- mapping */
function genreNames(g) {
  if (Array.isArray(g)) return g.map((x) => (x && x.name) || x).filter(Boolean);
  if (typeof g === 'string' && g) return g.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}
function mapItem(kind, it) {
  const o = {
    id: it.id,
    t: it.title_ar || it.title_en || '',
    te: it.title_en || '',
    p: it.poster || '',
    b: it.banner || '',
    y: it.release_year || '',
    r: it.rating != null ? it.rating : '',
    rc: it.rating_count != null ? it.rating_count : '',
    c: it.country || '',
    rt: it.runtime != null ? it.runtime : '',
    g: genreNames(it.genres),
    ct: it.content_type || '',
    ar: it.age_rating || '',
    v: it.views_count != null ? it.views_count : '',
    f: it.is_featured ? 1 : 0,
    tg: it.tagline || '',
  };
  if (kind === 'anime') {
    o.tj = it.title_jp || '';
    o.ec = it.episode_count || it.episodes_count || '';
  }
  if (kind === 'series') o.ec = it.episode_count || '';
  return o;
}
function mapChannel(it) {
  return {
    id: it.id,
    t: it.name || '',
    p: it.logo || '',
    cv: it.cover || '',
    c: it.country || '',
    cn: it.country_name || '',
    fl: it.flag_emoji || '',
    cat: it.category || '',
    catl: it.category_label || '',
    sc: it.streams_count != null ? it.streams_count : '',
    fr: it.frequency || '',
  };
}

/* ---------------------------------------------------------- fetch all */
async function fetchAll(kind, endpoint) {
  // first page tells us the total
  const first = await withRetry(() => getJSON(endpoint, { limit: PAGE, page: 1 }));
  const firstData = Array.isArray(first.data) ? first.data : (first.data && first.data.items) || [];
  const total = (first.pagination && first.pagination.total) || first.total || firstData.length;
  let pages = Math.ceil(total / PAGE) || 1;
  if (LIMIT) pages = Math.min(pages, Math.ceil(LIMIT / PAGE));
  const pageNums = [];
  for (let p = 2; p <= pages; p++) pageNums.push(p);
  const rest = await pool(pageNums, async (p) => {
    try {
      const j = await withRetry(() => getJSON(endpoint, { limit: PAGE, page: p }), 3);
      return Array.isArray(j.data) ? j.data : (j.data && j.data.items) || [];
    } catch (e) {
      console.warn('  ! page ' + p + ' failed: ' + e.message);
      return [];
    }
  });
  let items = firstData.concat.apply(firstData, rest);
  if (LIMIT) items = items.slice(0, LIMIT);
  const mapper = kind === 'channels' ? mapChannel : mapItem.bind(null, kind);
  return { total: total, items: items.map(mapper).filter((x) => x && x.id != null) };
}

function writeJSON(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj));
  const kb = (fs.statSync(file).size / 1024).toFixed(0);
  console.log('  -> ' + path.relative(__dirname, file) + '  (' + kb + ' KB, ' + (obj.items ? obj.items.length + ' items' : 'home') + ')');
}

/* Safety net for unattended / scheduled runs: never clobber good data with an
   empty (network failure) or suspiciously small (partial failure) result. */
function safeWriteJSON(file, obj) {
  const nextCount = obj.items ? obj.items.length : 0;
  if (obj.items && nextCount === 0) {
    console.warn('  ! skip ' + path.relative(__dirname, file) + ': empty result (keeping previous data)');
    return;
  }
  if (obj.items && !LIMIT) {
    let prevCount = 0;
    try { prevCount = (JSON.parse(fs.readFileSync(file, 'utf8')).items || []).length; } catch (e) { }
    if (prevCount > 0 && nextCount < prevCount * 0.5) {
      console.warn('  ! skip ' + path.relative(__dirname, file) + ': suspiciously small (' + nextCount + ' < 50% of ' + prevCount + ') \u2014 keeping previous data');
      return;
    }
  }
  writeJSON(file, obj);
}

/* ---------------------------------------------------------- main */
(async () => {
  const t0 = Date.now();
  console.log('NOVA TV content update  @  ' + new Date().toISOString());
  console.log('source: ' + BASE + (LIMIT ? '   (limit ' + LIMIT + ')' : ''));
  const want = (k) => !ONLY.length || ONLY.indexOf(k) >= 0;

  const cats = {};
  for (const [kind, endpoint] of [
    ['movies', '/api/movies/'],
    ['series', '/api/series/'],
    ['anime', '/api/anime/'],
    ['channels', '/api/channels/'],
  ]) {
    if (!want(kind)) continue;
    process.stdout.write('fetching ' + kind + ' … ');
    const res = await fetchAll(kind, endpoint);
    cats[kind] = res;
    console.log(res.items.length + ' / ' + res.total);
    safeWriteJSON(path.join(DATA, 'oscar_' + kind + '.json'), {
      total: res.total,
      generated: Date.now(),
      items: res.items,
    });
  }

  // home feed built from the freshest catalogs (newest first)
  if (want('home') && cats.movies && cats.series && cats.anime) {
    if (!cats.movies.items.length || !cats.series.items.length || !cats.anime.items.length) {
      console.warn('  ! skip site/data/oscar_home.json: catalogs incomplete (keeping previous data)');
    } else {
      const byRate = (a, b) => (Number(b.r) || 0) - (Number(a.r) || 0);
      const top = cats.movies.items
        .concat(cats.series.items, cats.anime.items)
        .slice()
        .sort(byRate)
        .slice(0, 60);
      writeJSON(path.join(DATA, 'oscar_home.json'), {
        movies: cats.movies.items.slice(0, 240),
        series: cats.series.items.slice(0, 40),
        anime: cats.anime.items.slice(0, 40),
        top: top,
        generated: Date.now(),
      });
    }
  }

  console.log('done in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
})().catch((e) => {
  console.error('UPDATE FAILED:', e && e.stack ? e.stack : e);
  process.exit(1);
});
