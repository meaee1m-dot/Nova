'use strict';
/* ============================================================
   NOVA TV — prefetch_watch.js
   ------------------------------------------------------------
   Builds site/data/watch_cache.json by asking the LOCAL NOVA TV
   server (which already handles the Oscar proxy + throttling +
   retries) for the real multi-quality watch links of the most
   browsed content.

   The cache lets the deployed server keep serving the watch
   servers even when the Oscar API is unreachable from the host
   (datacenter IPs are blocked). CDN media tokens are long-lived,
   so cached links stay valid for a long time.

   Usage:  node prefetch_watch.js [--movies N] [--series N] [--anime N] [--channels N]
   ============================================================ */
const fs = require('fs');
const path = require('path');
const http = require('http');

const BASE = process.env.NOVATV_LOCAL || 'http://127.0.0.1:3000';
const OUT = path.join(__dirname, 'site', 'data', 'watch_cache.json');
const THROTTLE = parseInt(process.env.PREFETCH_MS || '1200', 10);

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? parseInt(process.argv[i + 1], 10) : def;
}
const LIMITS = {
  movies: arg('movies', 200),
  series: arg('series', 40),
  anime: arg('anime', 40),
  channels: arg('channels', 200),
};

function get(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 40000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { resolve(null); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let cache = {};
try { cache = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { cache = {}; }
let saved = 0;
function save() { fs.writeFileSync(OUT, JSON.stringify(cache)); saved++; }

function has(pathKey) {
  const v = cache[pathKey];
  if (!v || !v.data) return false;
  const d = v.data;
  if (Array.isArray(d)) return d.length > 0;
  if (d.watch_links && d.watch_links.length) return true;
  if (d.streams && d.streams.length) return true;
  if (d.seasons && d.seasons.length) return true;
  return false;
}
async function fetchInto(pathKey) {
  if (has(pathKey)) return true;
  const j = await get(BASE + pathKey);
  await sleep(THROTTLE);
  if (j && j.status === 'success' && j.data && !(Array.isArray(j.data) && j.data.length === 0)) {
    cache[pathKey] = j;
    save();
    return true;
  }
  return false;
}

function readJSON(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } }

(async () => {
  const home = readJSON(path.join(__dirname, 'site', 'data', 'oscar_home.json')) || {};
  const channelsRaw = readJSON(path.join(__dirname, 'site', 'data', 'oscar_channels.json')) || [];
  const channels = Array.isArray(channelsRaw) ? channelsRaw : channelsRaw.items || channelsRaw.data || [];

  const movieIds = [...new Set([...(home.movies || []), ...(home.top || [])].map((m) => m.id))].slice(0, LIMITS.movies);
  const seriesIds = [...new Set((home.series || []).map((m) => m.id))].slice(0, LIMITS.series);
  const animeIds = [...new Set((home.anime || []).map((m) => m.id))].slice(0, LIMITS.anime);
  const channelIds = (Array.isArray(channels) ? channels : []).map((c) => c.id).slice(0, LIMITS.channels);

  console.log(`prefetch: movies=${movieIds.length} series=${seriesIds.length} anime=${animeIds.length} channels=${channelIds.length}`);

  /* ---- movies ---- */
  for (const id of movieIds) await fetchInto('/api/oscar/movie?id=' + id);
  console.log('movies done');

  /* ---- channels ---- */
  for (const id of channelIds) await fetchInto('/api/oscar/channel?id=' + id);
  console.log('channels done');

  /* ---- series (+ episodes) ---- */
  for (const id of seriesIds) {
    const ok = await fetchInto('/api/oscar/series-detail?id=' + id);
    const det = cache['/api/oscar/series-detail?id=' + id];
    const seasons = (det && det.data && det.data.seasons) || [];
    for (const s of seasons) {
      const sKey = '/api/oscar/episodes?season_id=' + s.id;
      await fetchInto(sKey);
      const eps = (cache[sKey] && cache[sKey].data) || [];
      for (const ep of (Array.isArray(eps) ? eps : [])) {
        await fetchInto('/api/oscar/episode?id=' + ep.id);
      }
    }
  }
  console.log('series done');

  /* ---- anime (+ episodes) ---- */
  for (const id of animeIds) {
    await fetchInto('/api/oscar/anime-detail?id=' + id);
    const det = cache['/api/oscar/anime-detail?id=' + id];
    const seasons = (det && det.data && det.data.seasons) || [];
    for (const s of seasons) {
      const sKey = '/api/oscar/anime-episodes?season_id=' + s.id;
      await fetchInto(sKey);
      const eps = (cache[sKey] && cache[sKey].data) || [];
      for (const ep of (Array.isArray(eps) ? eps : [])) {
        await fetchInto('/api/oscar/anime-episode?id=' + ep.id);
      }
    }
  }
  console.log('anime done');

  const keys = Object.keys(cache).length;
  console.log(`DONE: ${keys} cached responses, ${saved} saves -> ${OUT}`);
})();
