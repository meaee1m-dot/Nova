'use strict';
/* ============================================================
   NOVA TV — matches snapshot updater
   ------------------------------------------------------------
   Pulls the LATEST fixtures + per-match details from the Oscar TV
   API (signed X-Iron-* headers via iron.js) and rewrites the two
   compact snapshots the static site falls back to when the live
   API is unreachable:

     site/data/matches.json        { generated, days:{ "YYYY-MM-DD": { leagues:[…] } } }
     site/data/match_details.json  { generated, details:{ "<id>": { … } } }

   Run:  node update-matches.js                 (today ±window)
         node update-matches.js --days 7        (window = 7 days back / 7 forward)
         node update-matches.js --from 2026-10-01 --to 2026-10-10
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
const CONCURRENCY = 5;

const argv = process.argv.slice(2);
function argVal(name, def) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
}
const WINDOW = parseInt(argVal('--days', '3'), 10) || 3;

function ymd(d) {
  return d.toISOString().slice(0, 10);
}
const today = new Date();
const fromArg = argVal('--from', '');
const toArg = argVal('--to', '');
const from = fromArg ? new Date(fromArg + 'T00:00:00Z') : new Date(today.getTime() - WINDOW * 86400000);
const to = toArg ? new Date(toArg + 'T00:00:00Z') : new Date(today.getTime() + WINDOW * 86400000);

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
  tries = tries || 3;
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

function writeJSON(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj));
  const kb = (fs.statSync(file).size / 1024).toFixed(0);
  console.log('  -> ' + path.relative(__dirname, file) + '  (' + kb + ' KB)');
}

/* ---------------------------------------------------------- main */
(async () => {
  const t0 = Date.now();
  console.log('NOVA TV matches update  @  ' + new Date().toISOString());
  console.log('source: ' + BASE + '   window: ' + ymd(from) + ' → ' + ymd(to));

  const days = [];
  for (let d = new Date(from); d <= to; d = new Date(d.getTime() + 86400000)) days.push(ymd(d));

  const results = await pool(days, async (date) => {
    try {
      const j = await withRetry(() => getJSON('/api/matches/', { date: date }));
      const leagues = (j.data && j.data.leagues) || [];
      return { date: date, leagues: leagues };
    } catch (e) {
      console.warn('  ! ' + date + ' failed: ' + e.message);
      return { date: date, leagues: [] };
    }
  });

  const outDays = {};
  const ids = [];
  results.forEach((r) => {
    if (!r.leagues.length) return;
    outDays[r.date] = { leagues: r.leagues };
    r.leagues.forEach((l) => (l.matches || []).forEach((m) => { if (m && m.id != null) ids.push(m.id); }));
  });

  if (Object.keys(outDays).length) {
    writeJSON(path.join(DATA, 'matches.json'), { generated: Math.floor(Date.now() / 1000), days: outDays });
    console.log('  days: ' + Object.keys(outDays).length + '   matches: ' + ids.length);
  } else {
    console.warn('  ! skip site/data/matches.json: no fixtures fetched (keeping previous data)');
  }

  // per-match details
  const details = {};
  await pool(ids, async (id) => {
    try {
      const j = await withRetry(() => getJSON('/api/matches/show.php', { id: String(id) }), 2);
      const d = j.data || j;
      if (d && d.id != null) details[String(id)] = d;
    } catch (e) {
      /* skip individual failures */
    }
  });
  if (Object.keys(details).length) {
    writeJSON(path.join(DATA, 'match_details.json'), { generated: Math.floor(Date.now() / 1000), details: details });
    console.log('  details: ' + Object.keys(details).length);
  } else {
    console.warn('  ! skip site/data/match_details.json: no details fetched (keeping previous data)');
  }
  console.log('done in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
})().catch((e) => {
  console.error('UPDATE FAILED:', e && e.stack ? e.stack : e);
  process.exit(1);
});
