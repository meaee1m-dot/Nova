'use strict';
/* ============================================================
   NOVA TV — btolat snapshot updater
   ------------------------------------------------------------
   Scrapes the latest football video listing from btolat.com and
   rewrites the compact snapshot the static site falls back to
   when the live scrape is unavailable:

     site/data/btolat.json  { generated, "10":[…], "15":[…] }

     • "15" = all latest videos (goals + summaries + highlights)
     • "10" = goals & summaries only (filtered by title keywords)

   Run:  node update-btolat.js
   ============================================================ */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const DATA = path.join(__dirname, 'site', 'data');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const LIST_URL = 'https://www.btolat.com/videos';

function fetchUrl(url, opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const headers = {
      'User-Agent': opts.ua || UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ar,en;q=0.8',
    };
    if (opts.ref) headers.Referer = opts.ref;
    const req = lib.request(
      { protocol: u.protocol, hostname: u.hostname, port: u.port || (u.protocol === 'http:' ? 80 : 443), path: u.pathname + u.search, method: 'GET', headers: headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
      }
    );
    req.setTimeout(opts.timeout || 20000, () => req.destroy(new Error('timeout ' + url)));
    req.on('error', reject);
    req.end();
  });
}

function clean(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function parseBtolatList(html) {
  const items = [];
  const re = /<div class="card[^"]*video"[^>]*data-val="(\d+)"[^>]*>([\s\S]*?)<\/div>/g;
  let m;
  while ((m = re.exec(html))) {
    const id = m[1];
    const block = m[2];
    const thumb = (block.match(/data-src="([^"]+)"/) || [])[1] || '';
    const title = (block.match(/<h3>([\s\S]*?)<\/h3>/) || [])[1] || '';
    const leagueHref = (block.match(/class="category"[^>]*href="([^"]+)"/) || [])[1] || '';
    const leagueName = (block.match(/class="category"[^>]*>([\s\S]*?)<\/a>/) || [])[1] || '';
    items.push({
      id: id,
      url: 'https://www.btolat.com/video/' + id,
      thumb: thumb,
      title: clean(title),
      league: clean(leagueName),
      league_url: leagueHref ? new URL(leagueHref, 'https://www.btolat.com').href : '',
      date: '',
    });
  }
  return items;
}

function writeJSON(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj));
  const kb = (fs.statSync(file).size / 1024).toFixed(0);
  console.log('  -> ' + path.relative(__dirname, file) + '  (' + kb + ' KB)');
}

(async () => {
  console.log('NOVA TV btolat update  @  ' + new Date().toISOString());
  const r = await fetchUrl(LIST_URL, { ua: UA, timeout: 20000 });
  if (r.status >= 400) throw new Error('HTTP ' + r.status + ' from ' + LIST_URL);
  const live = parseBtolatList(r.body.toString('utf8'));
  if (!live.length) throw new Error('no videos parsed from ' + LIST_URL);

  const goals = live.filter((v) => /(هدف|ملخص|اهداف|أهداف|هدفين|ركلة)/.test(v.title));

  const out = {
    generated: Math.floor(Date.now() / 1000),
    '10': (goals.length ? goals : live).slice(0, 30),
    '15': live.slice(0, 30),
  };
  writeJSON(path.join(DATA, 'btolat.json'), out);
  console.log('  parsed: ' + live.length + '   goals/summaries: ' + goals.length);
  console.log('done');
})().catch((e) => {
  console.error('UPDATE FAILED:', e && e.stack ? e.stack : e);
  process.exit(1);
});
