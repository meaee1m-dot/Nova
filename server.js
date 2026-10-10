/* ============================================================
   NOVA TV — backend (zero-dependency Node.js)
   ------------------------------------------------------------
   Serves the static site (site/) AND the API the frontend needs:

     • /api/hls   CORS proxy for HLS playlists + segments (m3u8 rewriting)
     • /api/video CORS proxy for progressive video (Range pass-through)
     • /api/img   image proxy (same-origin, bypasses hotlink/CORS)
     • /api/btolat/videos | /api/btolat/video | /api/btolat/img
                  match summaries & goals (btolat.com)
     • /api/oscar/channel   live channel streams (from bundled snapshot)
     • /api/oscar/matches   fixture list (snapshot + live refresh)
     • /api/oscar/match     full match details (snapshot + live refresh)
     • /api/oscar/movie | /api/oscar/series-detail | /api/oscar/anime-detail
     • /api/oscar/episodes | /api/oscar/episode
     • /api/oscar/anime-episodes | /api/oscar/anime-episode

   The Oscar TV live API (ostvapp.cam) is protected by a native anti-tamper
   scheme: every /api/* request must carry signed X-Iron-* headers (see
   iron.js). With those headers the API returns the REAL multi-quality
   servers (movie / series / anime / episode / channel / match) — the exact
   same CDN links the official app plays. Two extra things are needed:

     • the API answers cloud/datacenter IPs with an empty payload, so set
       OSCAR_PROXY=http://host:port (or leave unset to auto-detect a local
       Psiphon tunnel on 127.0.0.1:18080). Running from a normal residential
       IP needs no proxy.
     • the CDN only serves media to User-Agent "TDMuaHLS99" — the proxies
       below already send it.

   Endpoints fall back to the bundled JSON snapshots in site/data/ only for
   catalog metadata (never for fake servers).

   Run:  node server.js        (PORT env optional, default 3000)
   ============================================================ */
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { URL } = require('url');
const iron = require('./iron.js');

/* ---------------------------------------------------------- config */
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = path.join(__dirname, 'site');
const DATA = path.join(ROOT, 'data');

const DEFAULT_UA = 'TDMuaHLS99';
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/* Live Oscar TV API base (best effort — geo-blocked on many hosts). */
const OSCAR_BASE = (process.env.OSCAR_BASE || 'https://ostvapp.cam').replace(/\/+$/, '');
const OSCAR_IMG = 'https://admin.dramaramadan.net';

const FETCH_TIMEOUT = 20000;

/* ---------------------------------------------------------- content refresh
   Keeps the static JSON snapshots (movies / series / anime / channels / home,
   fixtures, highlights) fresh. Two ways to trigger it:
     \u2022 automatically, in-process, every AUTO_REFRESH_HOURS hours (default 6;
       set AUTO_REFRESH_HOURS=0 to disable), and
     \u2022 on demand, via GET /api/refresh?token=REFRESH_TOKEN (only enabled when
       REFRESH_TOKEN is set, so it can be wired to an external cron).
   The updaters are run as child processes and never block request handling. */
const AUTO_REFRESH_HOURS = parseFloat(process.env.AUTO_REFRESH_HOURS || '6');
const REFRESH_TOKEN = process.env.REFRESH_TOKEN || '';
let REFRESHING = false;
function runRefresh(reason) {
  if (REFRESHING) { log('refresh: already running, skipping (' + reason + ')'); return false; }
  REFRESHING = true;
  log('refresh: start (' + reason + ')');
  let spawn;
  try { spawn = require('child_process').spawn; } catch (e) { REFRESHING = false; return false; }
  const jobs = [
    ['update-content.js', []],
    ['update-matches.js', ['--days', '3']],
    ['update-btolat.js', []],
  ];
  let i = 0;
  const next = () => {
    if (i >= jobs.length) { REFRESHING = false; log('refresh: done (' + reason + ')'); return; }
    const job = jobs[i++];
    const full = path.join(__dirname, job[0]);
    if (!fs.existsSync(full)) { next(); return; }
    let child;
    try {
      child = spawn(process.execPath, [full].concat(job[1]), { cwd: __dirname, env: process.env });
    } catch (e) { log('refresh: spawn failed ' + job[0] + ': ' + e.message); next(); return; }
    let tail = '';
    const onData = (d) => { tail = (tail + d).slice(-400); };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('close', (code) => { log('refresh: ' + job[0] + ' exited ' + code + (code ? ' :: ' + tail.trim() : '')); next(); });
    child.on('error', (e) => { log('refresh: ' + job[0] + ' error ' + e.message); next(); });
  };
  next();
  return true;
}

/* ---------------------------------------------------------- outbound proxy
   The Oscar API answers cloud/datacenter IPs with an empty `data:[]` payload
   (the real servers are only returned to "clean" residential IPs). When a
   proxy is available every /api/* call is tunnelled through it. Configure it
   explicitly with OSCAR_PROXY=http://host:port, or leave unset and the server
   auto-detects a local Psiphon tunnel on 127.0.0.1:18080. The CDN itself is
   NOT proxied (it only needs the TDMuaHLS99 User-Agent). */
let OSCAR_PROXY = process.env.OSCAR_PROXY || '';
if (!OSCAR_PROXY) {
  (function probeLocalProxy() {
    let net;
    try { net = require('net'); } catch (e) { return; }
    const s = net.connect(18080, '127.0.0.1');
    s.on('connect', () => {
      OSCAR_PROXY = 'http://127.0.0.1:18080';
      log('oscar: local proxy detected ->', OSCAR_PROXY);
      s.destroy();
    });
    s.on('error', () => {});
    s.setTimeout(2000, () => s.destroy());
  })();
}

/* ---------------------------------------------------------- tiny utils */
function log() {
  const a = Array.prototype.slice.call(arguments);
  a.unshift(new Date().toISOString());
  console.log.apply(console, a);
}
function send(res, status, body, headers) {
  const h = Object.assign(
    {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Cache-Control': 'no-store',
    },
    headers || {}
  );
  // Compress JSON / text API responses when the client supports it.
  const req = res._req;
  const ctype = String(h['Content-Type'] || '');
  const isText = /json|text|javascript|xml|svg/.test(ctype);
  if (req && isText && body != null && !h['Content-Encoding']) {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    if (buf.length >= 512) {
      const enc = pickEncoding(req);
      if (enc) {
        const comp = compressBody(buf, enc);
        if (comp && comp.length < buf.length) {
          h['Content-Encoding'] = enc === 'br' ? 'br' : 'gzip';
          h['Content-Length'] = comp.length;
          h['Vary'] = 'Accept-Encoding';
          res.writeHead(status, h);
          return res.end(comp);
        }
      }
    }
  }
  res.writeHead(status, h);
  res.end(body);
}
function sendJSON(res, obj, status) {
  send(res, status || 200, JSON.stringify(obj), {
    'Content-Type': 'application/json; charset=utf-8',
  });
}
function ok(res, data) {
  sendJSON(res, { status: 'success', data: data });
}
function fail(res, message, status) {
  sendJSON(res, { status: 'error', message: message || 'error' }, status || 502);
}
function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
}
function readJSONCached(file) {
  // simple in-memory cache keyed by mtime
  try {
    const st = fs.statSync(file);
    const key = file + ':' + st.mtimeMs;
    if (readJSONCached._c && readJSONCached._c.key === key) return readJSONCached._c.val;
    const val = readJSON(file);
    readJSONCached._c = { key: key, val: val };
    return val;
  } catch (e) {
    return null;
  }
}

/* ---------------------------------------------------------- http fetch */
/* Follows redirects, decompresses gzip/deflate/br, honours Range,
   returns { status, headers, body(Buffer), finalUrl }. */
function fetchUrl(targetUrl, opts) {
  opts = opts || {};
  const maxRedirects = opts.maxRedirects == null ? 6 : opts.maxRedirects;
  const headers = Object.assign(
    {
      'User-Agent': opts.ua || DEFAULT_UA,
      Accept: '*/*',
      'Accept-Language': 'ar,en;q=0.8',
    },
    opts.headers || {}
  );
  if (opts.ref) headers.Referer = opts.ref;
  if (opts.origin) headers.Origin = opts.origin;

  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(targetUrl);
    } catch (e) {
      return reject(new Error('bad url'));
    }
    const onResponse = (r) => {
      const status = r.statusCode || 0;
      if (status >= 300 && status < 400 && r.headers.location && maxRedirects > 0) {
        r.resume();
        let next = r.headers.location;
        try {
          next = new URL(next, targetUrl).href;
        } catch (e) {}
        return resolve(
          fetchUrl(next, Object.assign({}, opts, { maxRedirects: maxRedirects - 1 }))
        );
      }
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => {
        let buf = Buffer.concat(chunks);
        const enc = String(r.headers['content-encoding'] || '').toLowerCase();
        try {
          if (enc === 'gzip') buf = zlib.gunzipSync(buf);
          else if (enc === 'deflate') buf = zlib.inflateSync(buf);
          else if (enc === 'br') buf = zlib.brotliDecompressSync(buf);
        } catch (e) {}
        resolve({ status: status, headers: r.headers, body: buf, finalUrl: targetUrl });
      });
    };

    /* ---- routed through an HTTP proxy (CONNECT tunnel for https) ---- */
    if (opts.proxy) {
      let p;
      try {
        p = new URL(opts.proxy);
      } catch (e) {
        return reject(new Error('bad proxy'));
      }
      const pport = p.port || (p.protocol === 'https:' ? 443 : 80);
      if (u.protocol === 'https:') {
        const cr = http.request({
          host: p.hostname,
          port: pport,
          method: 'CONNECT',
          path: u.hostname + ':' + (u.port || 443),
          headers: { Host: u.hostname + ':' + (u.port || 443) },
        });
        cr.setTimeout(opts.timeout || FETCH_TIMEOUT, () => cr.destroy(new Error('timeout')));
        cr.on('connect', (cres, socket) => {
          if (cres.statusCode !== 200) return reject(new Error('proxy CONNECT ' + cres.statusCode));
          const req = https.request(
            {
              socket: socket,
              servername: u.hostname,
              host: u.hostname,
              path: u.pathname + u.search,
              method: opts.method || 'GET',
              headers: headers,
            },
            (r) => {
              if (process.env.OSCAR_DEBUG)
                log('proxy inner resp', r.statusCode, 'clen=', r.headers['content-length'], 'host=', u.hostname);
              onResponse(r);
            }
          );
          req.setTimeout(opts.timeout || FETCH_TIMEOUT, () => req.destroy(new Error('timeout')));
          req.on('error', reject);
          if (opts.body) req.write(opts.body);
          req.end();
        });
        cr.on('error', reject);
        cr.end();
      } else {
        const req = http.request(
          {
            host: p.hostname,
            port: pport,
            path: u.href,
            method: opts.method || 'GET',
            headers: headers,
          },
          onResponse
        );
        req.setTimeout(opts.timeout || FETCH_TIMEOUT, () => req.destroy(new Error('timeout')));
        req.on('error', reject);
        if (opts.body) req.write(opts.body);
        req.end();
      }
      return;
    }

    /* ---- direct ---- */
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'http:' ? 80 : 443),
        path: u.pathname + u.search,
        method: opts.method || 'GET',
        headers: headers,
      },
      onResponse
    );
    req.setTimeout(opts.timeout || FETCH_TIMEOUT, () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/* ---------------------------------------------------------- HLS proxy */
function isPlaylist(headers, body) {
  const ct = String((headers && headers['content-type']) || '').toLowerCase();
  if (ct.indexOf('mpegurl') >= 0) return true;
  const head = body.slice(0, 16).toString('utf8');
  return head.indexOf('#EXTM3U') === 0;
}
function proxify(uri, ua, ref) {
  return (
    '/api/hls?url=' +
    encodeURIComponent(uri) +
    (ua ? '&ua=' + encodeURIComponent(ua) : '') +
    (ref ? '&ref=' + encodeURIComponent(ref) : '')
  );
}
/* Rewrite every URI inside an m3u8 so it flows back through this proxy.
   IMPORTANT: signed CDNs (e.g. btolat/vibedailyhighlights) put a `?token=...`
   on the master playlist; the relative variant/segment URIs must inherit that
   query string or the CDN answers 400 Bad Request. `new URL(rel, base)` drops
   the base query, so we merge it back in whenever the resolved URL has none. */
function rewritePlaylist(text, baseUrl, ua, ref) {
  let base = null;
  try { base = new URL(baseUrl); } catch (e) { base = null; }
  const resolveAbs = (uri) => {
    let abs;
    try {
      abs = new URL(uri, baseUrl);
    } catch (e) {
      return uri;
    }
    // carry the base query string (token) onto relative URIs that lack their own
    if (base && !abs.search && base.search) abs.search = base.search;
    return abs.href;
  };
  const lines = text.split(/\r?\n/);
  const out = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.charAt(0) === '#') {
      // rewrite URI="..." attributes on tag lines
      if (/URI="/.test(line)) {
        return line.replace(/URI="([^"]+)"/g, (m, uri) => {
          return 'URI="' + proxify(resolveAbs(uri), ua, ref) + '"';
        });
      }
      return line;
    }
    // a bare URI line (variant playlist or media segment)
    return proxify(resolveAbs(trimmed), ua, ref);
  });
  return out.join('\n');
}

async function handleHls(req, res, q) {
  const url = q.get('url');
  if (!url) return fail(res, 'missing url', 400);
  const ua = q.get('ua') || DEFAULT_UA;
  const ref = q.get('ref') || '';
  const range = req.headers['range'];
  const hdrs = {};
  if (range) hdrs.Range = range;
  let r;
  try {
    r = await fetchUrl(url, { ua: ua, ref: ref, headers: hdrs, timeout: FETCH_TIMEOUT });
  } catch (e) {
    return fail(res, 'upstream error: ' + e.message, 502);
  }
  if (r.status >= 400) return fail(res, 'upstream ' + r.status, r.status);

  if (isPlaylist(r.headers, r.body)) {
    const text = rewritePlaylist(r.body.toString('utf8'), r.finalUrl || url, ua, ref);
    return send(res, 200, text, {
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Cache-Control': 'no-store',
    });
  }
  // binary segment (or key) — pass through, preserving Range/206
  const outHeaders = {
    'Content-Type': r.headers['content-type'] || 'application/octet-stream',
    'Cache-Control': 'public, max-age=30',
  };
  if (r.headers['content-range']) outHeaders['Content-Range'] = r.headers['content-range'];
  if (r.headers['accept-ranges']) outHeaders['Accept-Ranges'] = r.headers['accept-ranges'];
  if (r.headers['content-length']) outHeaders['Content-Length'] = r.headers['content-length'];
  return send(res, r.status === 206 ? 206 : 200, r.body, outHeaders);
}

/* ---------------------------------------------------------- video proxy */
/* Some Oscar CDNs (e.g. newcdn.seriesmp4.com) do not serve the file directly:
   they return a tiny anti-hotlink HTML page whose hidden <iframe> points at the
   real media file (usually a Yandex.Disk direct link, which IS CORS-enabled).
   Detect that and hand the client the real URL. */
function extractMediaFromHtml(html) {
  if (!html) return '';
  const m = /<iframe[^>]+src=["']([^"']+)["']/i.exec(html);
  let src = m ? m[1] : '';
  if (!src) {
    const m2 = /(https?:\/\/[^\s"'<>]+\.(?:mp4|m3u8|mkv|webm)(?:\?[^\s"'<>]*)?)/i.exec(html);
    src = m2 ? m2[1] : '';
  }
  return src ? src.replace(/&amp;/g, '&') : '';
}

async function handleVideo(req, res, q) {
  const url = q.get('url');
  if (!url) return fail(res, 'missing url', 400);
  const ua = q.get('ua') || DEFAULT_UA;
  const ref = q.get('ref') || '';
  const hdrs = {};
  if (req.headers['range']) hdrs.Range = req.headers['range'];
  let r;
  try {
    r = await fetchUrl(url, { ua: ua, ref: ref, headers: hdrs, timeout: FETCH_TIMEOUT });
  } catch (e) {
    return fail(res, 'upstream error: ' + e.message, 502);
  }
  let ct = String(r.headers['content-type'] || '').toLowerCase();
  /* The anti-hotlink wrappers reject ranged requests (416) and answer HTML.
     Re-ask without Range to obtain the wrapper page, then unwrap it. */
  if ((r.status >= 400 || ct.indexOf('text/html') >= 0) && hdrs.Range) {
    try {
      const r2 = await fetchUrl(url, { ua: ua, ref: ref, headers: {}, timeout: FETCH_TIMEOUT });
      if (r2.status < 400) {
        r = r2;
        ct = String(r2.headers['content-type'] || '').toLowerCase();
      }
    } catch (e) {}
  }
  /* anti-hotlink HTML wrapper → resolve the real (CORS-enabled) media URL */
  if (ct.indexOf('text/html') >= 0) {
    const real = extractMediaFromHtml(r.body.toString('utf8'));
    if (real && real !== url) {
      /* hand the client a redirect to the real media URL (Yandex etc. send
         Access-Control-Allow-Origin: *), so playback stays off our bandwidth */
      return send(res, 302, '', { Location: real, 'Cache-Control': 'no-store' });
    }
    return fail(res, 'no playable media in upstream response', 502);
  }
  if (r.status >= 400) return fail(res, 'upstream ' + r.status, r.status);
  const outHeaders = {
    'Content-Type': r.headers['content-type'] || 'video/mp4',
    'Cache-Control': 'public, max-age=60',
  };
  if (r.headers['content-range']) outHeaders['Content-Range'] = r.headers['content-range'];
  if (r.headers['accept-ranges']) outHeaders['Accept-Ranges'] = r.headers['accept-ranges'];
  if (r.headers['content-length']) outHeaders['Content-Length'] = r.headers['content-length'];
  return send(res, r.status === 206 ? 206 : 200, r.body, outHeaders);
}

/* ---------------------------------------------------------- image proxy */
async function handleImg(req, res, q) {
  const url = q.get('url');
  if (!url) return fail(res, 'missing url', 400);
  let r;
  try {
    r = await fetchUrl(url, { ua: BROWSER_UA, ref: new URL(url).origin + '/', timeout: 15000 });
  } catch (e) {
    return fail(res, 'upstream error: ' + e.message, 502);
  }
  if (r.status >= 400) return fail(res, 'upstream ' + r.status, r.status);
  return send(res, 200, r.body, {
    'Content-Type': r.headers['content-type'] || 'image/jpeg',
    'Cache-Control': 'public, max-age=86400',
  });
}

/* ---------------------------------------------------------- btolat */
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
    const clean = (s) =>
      String(s || '')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .trim();
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

async function handleBtolatVideos(req, res, q) {
  const type = String(q.get('type') || '10');
  const snap = readJSONCached(path.join(DATA, 'btolat.json')) || {};
  const snapshot = snap[type] || snap['10'] || [];
  try {
    const r = await fetchUrl('https://www.btolat.com/videos', { ua: BROWSER_UA, timeout: 15000 });
    const live = parseBtolatList(r.body.toString('utf8'));
    if (live.length) {
      if (type === '15') return ok(res, live);
      // type 10 = goals & summaries: keep goal/summary videos
      const filtered = live.filter((v) => /(هدف|ملخص|اهداف|أهداف|هدفين|ركلة)/.test(v.title));
      return ok(res, filtered.length ? filtered : live);
    }
  } catch (e) {
    log('[btolat] live listing failed, using snapshot:', e.message);
  }
  return ok(res, snapshot);
}

/* Fetch a master m3u8 and return its quality variants as [{quality, url}].
   Handles both master playlists (#EXT-X-STREAM-INF) and, when the source is a
   single media playlist, an empty array (frontend falls back to ABR playback). */
async function hlsVariants(masterUrl, ref) {
  const out = [];
  let r;
  try {
    r = await fetchUrl(masterUrl, { ua: DEFAULT_UA, ref: ref || '', timeout: 15000 });
  } catch (e) {
    return out;
  }
  if (r.status >= 400) return out;
  const txt = r.body.toString('utf8');
  if (txt.indexOf('#EXTM3U') !== 0) return out;
  const lines = txt.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const info = lines[i].match(/#EXT-X-STREAM-INF:(.*)$/i);
    if (!info) continue;
    const attrs = info[1];
    const res = attrs.match(/RESOLUTION=(\d+)x(\d+)/i);
    const bw = attrs.match(/BANDWIDTH=(\d+)/i);
    const next = (lines[i + 1] || '').trim();
    if (!next || next.charAt(0) === '#') continue;
    let abs;
    try { abs = new URL(next, masterUrl); } catch (e) { continue; }
    if (!abs.search && masterUrl.indexOf('?') >= 0) {
      try { abs.search = new URL(masterUrl).search; } catch (e) { }
    }
    const h = res ? parseInt(res[2], 10) : 0;
    let quality;
    if (h >= 2160) quality = '4K';
    else if (h >= 1080) quality = '1080p';
    else if (h >= 720) quality = '720p';
    else if (h >= 480) quality = '480p';
    else if (h >= 360) quality = '360p';
    else if (h >= 240) quality = '240p';
    else if (h) quality = h + 'p';
    else if (bw) quality = Math.round(parseInt(bw[1], 10) / 1024) + 'K';
    else quality = 'auto';
    out.push({ quality: quality, url: abs.href, height: h });
  }
  out.sort((a, b) => (b.height || 0) - (a.height || 0));
  return out;
}

async function handleBtolatVideo(req, res, q) {
  const id = q.get('id');
  if (!id) return fail(res, 'missing id', 400);
  const page = 'https://www.btolat.com/video/' + encodeURIComponent(id);
  let embed = '';
  let youtube = '';
  let title = '';
  try {
    const r = await fetchUrl(page, { ua: BROWSER_UA, timeout: 15000 });
    const html = r.body.toString('utf8');
    title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
    // current btolat format: a YouTube embed (no server-side HLS extraction needed)
    const yt = html.match(/(?:youtube\.com\/embed\/|youtu\.be\/|youtube\.com\/watch\?v=)([A-Za-z0-9_-]{6,})/);
    if (yt) youtube = yt[1];
    if (!youtube) {
      const m = html.match(/https:\/\/nvtboo\.vortexvisionworks\.com\/embed\/[A-Za-z0-9_-]+/);
      if (m) embed = m[0];
      if (!embed) {
        const any = html.match(/<iframe[^>]+src=["']([^"']+embed[^"']+)["']/i);
        if (any) embed = new URL(any[1], page).href;
      }
    }
  } catch (e) {
    return fail(res, 'could not load video page: ' + e.message, 502);
  }
  if (youtube) {
    return ok(res, { id: id, youtube: youtube, embed: 'https://www.youtube.com/embed/' + youtube, title: title });
  }
  if (!embed) return fail(res, 'no embed found', 404);

  let hls = '';
  try {
    const r2 = await fetchUrl(embed, { ua: BROWSER_UA, ref: page, timeout: 15000 });
    const html = r2.body.toString('utf8');
    // prefer the absolute / protocol-relative source
    const all = [];
    const re = /hls:\s*'([^']+)'/g;
    let m;
    while ((m = re.exec(html))) all.push(m[1]);
    const abs = all.find((u) => /^\/\/|^https?:/.test(u));
    hls = abs || all[0] || '';
    if (hls && hls.indexOf('//') === 0) hls = 'https:' + hls;
    else if (hls && hls.indexOf('/') === 0) hls = 'https://aaa.vibedailyhighlights.com' + hls;
    else if (hls && !/^https?:/.test(hls))
      hls = 'https://aaa.vibedailyhighlights.com/' + hls.replace(/^\/+/, '');
    title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || title;
  } catch (e) {
    return fail(res, 'could not load embed: ' + e.message, 502);
  }
  if (!hls) return fail(res, 'no stream found', 404);
  let embedOrigin = embed;
  try { embedOrigin = new URL(embed).origin + '/'; } catch (e) { }
  const qualities = await hlsVariants(hls, embedOrigin);
  return ok(res, { id: id, hls: hls, embed: embed, title: title, qualities: qualities });
}

/* ---------------------------------------------------------- oscar */
function buildStory(it, kind) {
  if (!it) return '';
  const raw = it.story || it.story_en || '';
  if (raw && /[\u0600-\u06FF]/.test(raw)) return raw;
  const title = it.t || it.te || it.title_ar || it.title_en || '';
  const year = it.y || it.release_year || '';
  const label = { movies: 'فيلم', series: 'مسلسل', anime: 'أنمي' }[kind] || 'عمل';
  let g = it.g || [];
  if (typeof g === 'string') g = g.split(',').map((s) => s.trim());
  g = (g || []).map((x) => (x && x.name) || x).filter(Boolean).slice(0, 3);
  const COUNTRY = {
    US: 'أمريكا', GB: 'بريطانيا', FR: 'فرنسا', KR: 'كوريا الجنوبية', JP: 'اليابان',
    IN: 'الهند', TR: 'تركيا', CN: 'الصين', EG: 'مصر', SA: 'السعودية', AE: 'الإمارات',
    QA: 'قطر', KW: 'الكويت', MA: 'المغرب', DZ: 'الجزائر', TN: 'تونس', ES: 'إسبانيا',
    IT: 'إيطاليا', DE: 'ألمانيا', RU: 'روسيا', CA: 'كندا', AU: 'أستراليا',
  };
  const cn = COUNTRY[String(it.c || it.country || '').toUpperCase()] || '';
  const parts = [label + ' «' + title + '»' + (year ? ' (' + year + ')' : '')];
  if (cn) parts.push('من إنتاج ' + cn);
  if (g.length) parts.push('يجمع بين ' + g.join(' و'));
  let s = parts.join('، ') + '.';
  const ct = String(it.ct || '');
  const q =
    ct.indexOf('مدبلج') >= 0
      ? 'مدبلجاً بالعربية'
      : ct.indexOf('مترجم') >= 0 || ct === 'original'
      ? 'مترجماً'
      : 'بجودة عالية';
  s +=
    ' يمكنك مشاهدة ' + title + ' أونلاين ' + q +
    ' على NOVA TV، مع إمكانية المشاهدة المباشرة دون تسجيل ودون إعلانات مزعجة.';
  return s;
}

function snapshotItem(kind, id) {
  const file = path.join(DATA, 'oscar_' + kind + '.json');
  const j = readJSONCached(file);
  const items = (j && j.items) || [];
  for (let i = 0; i < items.length; i++) {
    if (String(items[i].id) === String(id)) return items[i];
  }
  return null;
}
function detailFromItem(it, kind) {
  return {
    id: it.id,
    title_ar: it.t || '',
    title_en: it.te || '',
    title_jp: it.tj || '',
    poster: it.p || '',
    backdrop: it.b || '',
    rating: it.r || '',
    release_year: it.y || '',
    country: it.c || '',
    country_name: '',
    g: it.g || [],
    content_type_label: { movies: 'فيلم', series: 'مسلسل', anime: 'أنمي' }[kind] || '',
    content_type: it.ct || '',
    episode_count: it.ec || it.ecount || '',
    status: it.st || '',
    tagline: it.tg || '',
    story: buildStory(it, kind),
    watch_links: [],
    download_links: [],
    seasons: [],
    actors: [],
  };
}

/* Try the live Oscar API; return null on any failure.

   The Oscar API is protected by a native anti-tamper scheme: every /api/*
   request must carry the four X-Iron-* headers produced by the app's
   libiron_fingerprint.so. iron.js reimplements that signer. The signed
   message is the request PATH only (query string excluded). */
const _oscarCache = new Map();
/* A blocked / rate-limited response is `{"status":"success","data":[]}` — an
   empty array where the caller expects a list/object. Detect it so we can
   retry. */
function _oscarEmpty(j) {
  return !j || (j.status && Array.isArray(j.data) && j.data.length === 0);
}
async function _oscarAttempt(u, headers, proxy) {
  try {
    const r = await fetchUrl(u.href, {
      ua: BROWSER_UA,
      ref: OSCAR_BASE + '/',
      origin: OSCAR_BASE,
      headers: headers,
      timeout: 15000,
      proxy: proxy || undefined,
    });
    if (r.status >= 400) return null;
    return JSON.parse(r.body.toString('utf8'));
  } catch (e) {
    return null;
  }
}
/* Serialise every Oscar call and keep >= OSCAR_MIN_INTERVAL ms between them —
   the API answers with an empty payload if it is hit too fast. */
let _oscarChain = Promise.resolve();
let _oscarLast = 0;
const OSCAR_MIN_INTERVAL = parseInt(process.env.OSCAR_MIN_INTERVAL || '1100', 10);
function _oscarThrottle() {
  const run = _oscarChain.then(
    () =>
      new Promise((resolve) => {
        const wait = OSCAR_MIN_INTERVAL - (Date.now() - _oscarLast);
        setTimeout(resolve, wait > 0 ? wait : 0);
      })
  );
  _oscarChain = run.then(() => {
    _oscarLast = Date.now();
  });
  return run;
}
const _sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function oscarLive(pathname, params, ttlMs) {
  const u = new URL(OSCAR_BASE + pathname);
  if (params) Object.keys(params).forEach((k) => u.searchParams.set(k, params[k]));
  const key = u.pathname + '?' + u.searchParams.toString();
  const ttl = ttlMs == null ? 60000 : ttlMs;
  const hit = _oscarCache.get(key);
  if (hit && Date.now() - hit.t < ttl) return hit.v;
  const headers = Object.assign(
    { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    iron.ironHeaders(u.pathname)
  );
  /* Prefer the proxy when configured (a datacenter IP always gets an empty
     payload). Otherwise go direct. Retry a couple of times with backoff, since
     the API also returns empty when it is momentarily rate-limited. */
  const primary = OSCAR_PROXY || null;
  const transports = primary ? [primary] : [null];
  if (!primary && OSCAR_PROXY) transports.push(OSCAR_PROXY);
  let j = null;
  for (let i = 0; i < 3; i++) {
    const proxy = transports[Math.min(i, transports.length - 1)];
    await _oscarThrottle();
    j = await _oscarAttempt(u, headers, proxy);
    if (process.env.OSCAR_DEBUG)
      log('oscar try', i, u.pathname + u.search, 'proxy=', proxy || 'direct', 'empty=', _oscarEmpty(j));
    if (!_oscarEmpty(j)) break;
    await _sleep(1500 * (i + 1));
  }
  if (_oscarCache.size > 800) _oscarCache.clear();
  _oscarCache.set(key, { t: Date.now(), v: j });
  return j;
}
function liveData(j) {
  if (!j) return null;
  if (j && typeof j === 'object' && 'data' in j && j.status) return j.data;
  return j;
}

/* ---- channels: build a streams map from match_details.json ---- */
let _chanMap = null;
function channelMap() {
  if (_chanMap) return _chanMap;
  const md = readJSONCached(path.join(DATA, 'match_details.json')) || {};
  const details = md.details || {};
  const map = {};
  Object.keys(details).forEach((mid) => {
    const m = details[mid];
    (m.channels || []).forEach((ch) => {
      const key = String(ch.channel_id || ch.id);
      if (!map[key]) {
        map[key] = {
          id: ch.channel_id || ch.id,
          name: ch.channel_name || '',
          logo: ch.channel_logo || '',
          streams: [],
        };
      }
      (ch.streams || []).forEach((s) => {
        if (!s.stream_url) return;
        if (
          !map[key].streams.some(function (x) {
            return x.stream_url === s.stream_url;
          })
        ) {
          map[key].streams.push({
            id: s.id,
            server_name: s.server_name || '',
            stream_url: s.stream_url,
            quality: s.quality || '',
            stream_type: s.stream_type || 'hls',
            deep_link: s.deep_link || '',
          });
        }
      });
    });
  });
  _chanMap = map;
  return map;
}

async function handleOscarChannel(req, res, q) {
  const id = q.get('id');
  if (!id) return fail(res, 'missing id', 400);
  const live = liveData(await oscarLive('/api/channels/show.php', { id: id }));
  if (live && live.streams && live.streams.length) return ok(res, live);
  const map = channelMap();
  const ch = map[String(id)];
  if (!ch || !ch.streams.length) {
    return ok(res, { id: id, name: (ch && ch.name) || '', streams: [] });
  }
  return ok(res, ch);
}

async function handleOscarMatches(req, res, q) {
  const date = q.get('date');
  const live = liveData(await oscarLive('/api/matches/', date ? { date: date } : null));
  if (live && live.leagues && live.leagues.length) return ok(res, live);
  const snap = readJSONCached(path.join(DATA, 'matches.json')) || {};
  const days = snap.days || {};
  const day = (date && days[date]) || {};
  return ok(res, { date: date || '', leagues: day.leagues || [] });
}

async function handleOscarMatch(req, res, q) {
  const id = q.get('id');
  if (!id) return fail(res, 'missing id', 400);
  const live = liveData(await oscarLive('/api/matches/show.php', { id: id }));
  if (live && live.id) return ok(res, live);
  const md = readJSONCached(path.join(DATA, 'match_details.json')) || {};
  const details = md.details || {};
  const m = details[String(id)];
  if (m && m.id) return ok(res, m);
  return ok(res, null);
}

/* Normalise the many possible shapes of watch/download link arrays coming from
   the live Oscar API into the exact shape the frontend expects
   ({server_name, quality, url, deep_link, file_size, is_hls}). */
function normalizeLinks(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  arr.forEach((l) => {
    if (!l || typeof l !== 'object') return;
    const url = l.url || l.stream_url || l.link || l.src || l.file || l.play_url || '';
    if (!url) return;
    const isHls =
      l.is_hls != null
        ? l.is_hls
        : l.hls != null
        ? l.hls
        : /\.m3u8|x=\/hls|\/hls\//i.test(url)
        ? 1
        : 0;
    out.push({
      id: l.id != null ? l.id : undefined,
      server_name: l.server_name || l.server || l.name || l.title || 'سيرفر',
      quality: l.quality || l.q || l.resolution || '',
      url: url,
      deep_link: l.deep_link || l.deeplink || l.deepLink || '',
      file_size: l.file_size || l.size || '',
      is_hls: isHls ? 1 : 0,
      is_abr: l.is_abr != null ? (l.is_abr ? 1 : 0) : 0,
      order_index: l.order_index != null ? l.order_index : 0,
    });
  });
  return out;
}

/* The frontend reads genres from `d.g` (array of names). The Oscar API returns
   them as `genres` — an array of {id,name,slug} for movies/series, or a
   comma-separated string for anime. Normalise both into `g`, and pass the real
   watch/download servers straight through so movie/series/anime pages render
   the exact same multi-quality servers as the Oscar TV app. */
function shapeDetail(d, kind) {
  if (!d || typeof d !== 'object') return d;
  if (!d.g) {
    const g = d.genres != null ? d.genres : d.genre_list;
    if (Array.isArray(g)) d.g = g.map((x) => (x && x.name) || x).filter(Boolean);
    else if (typeof g === 'string' && g) d.g = g.split(',').map((s) => s.trim()).filter(Boolean);
    else d.g = [];
  }
  if (!d.story && !d.tagline) d.story = buildStory(d, kind);
  d.watch_links = normalizeLinks(d.watch_links);
  d.download_links = normalizeLinks(d.download_links);
  if (d.seasons && !Array.isArray(d.seasons)) d.seasons = [];
  return d;
}
function shapeEpisode(e) {
  if (!e || typeof e !== 'object') return e;
  e.watch_links = normalizeLinks(e.watch_links);
  e.download_links = normalizeLinks(e.download_links);
  return e;
}

async function handleOscarDetail(req, res, q, kind) {
  const id = q.get('id');
  if (!id) return fail(res, 'missing id', 400);
  const paths = {
    movies: '/api/movies/show.php',
    series: '/api/series/show.php',
    anime: '/api/anime/show.php',
  };
  const live = liveData(await oscarLive(paths[kind], { id: id }));
  if (live && live.id) {
    return ok(res, shapeDetail(live, kind));
  }
  /* offline fallback: bundled catalog metadata (no fake servers — the real
     multi-quality servers come from the live API above) */
  const it = snapshotItem(kind, id);
  if (!it) return ok(res, null);
  const d = shapeDetail(detailFromItem(it, kind), kind);
  return ok(res, d);
}

async function handleOscarEpisodes(req, res, q, isAnime) {
  const seasonId = q.get('season_id');
  const base = isAnime ? '/api/anime/episodes/' : '/api/episodes/';
  const live = liveData(await oscarLive(base, seasonId ? { season_id: seasonId } : null));
  if (live) {
    const arr = Array.isArray(live) ? live : live.items || live.episodes || live.data || [];
    if (arr && arr.length) return ok(res, arr);
  }
  return ok(res, []);
}

async function handleOscarEpisode(req, res, q, isAnime) {
  const id = q.get('id');
  if (!id) return fail(res, 'missing id', 400);
  const base = isAnime ? '/api/anime/episodes/show.php' : '/api/episodes/show.php';
  const live = liveData(await oscarLive(base, { id: id }));
  if (live && live.id) {
    return ok(res, shapeEpisode(live));
  }
  return ok(res, { id: id, watch_links: [], download_links: [] });
}

/* ---------------------------------------------------------- static files */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.txt': 'text/plain; charset=utf-8',
};
/* ------------------------------------------- compression + caching */
const COMPRESSIBLE = new Set([
  '.html', '.htm', '.css', '.js', '.mjs', '.json', '.svg',
  '.txt', '.xml', '.webmanifest', '.map',
]);
const COMPRESS_CACHE = new Map(); // "file:enc:mtime" -> Buffer
const COMPRESS_CACHE_MAX = 96;

function pickEncoding(req) {
  const ae = (req && req.headers['accept-encoding']) || '';
  if (/\bbr\b/.test(ae)) return 'br';
  if (/\bgzip\b/.test(ae)) return 'gz';
  return null;
}
function compressBody(buf, encoding) {
  try {
    if (encoding === 'br') {
      // Brotli quality 11 is very slow on anything but small files (it can take
      // seconds on the multi-hundred-KB JSON snapshots). Step down to quality 6
      // above 64 KB: ~10-50x faster with only ~10% larger output.
      const q = buf.length > 64 * 1024 ? 6 : 11;
      return zlib.brotliCompressSync(buf, {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: q,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
        },
      });
    }
    if (encoding === 'gz') return zlib.gzipSync(buf, { level: 6 });
  } catch (e) {
    /* ignore */
  }
  return null;
}
function getCompressed(filePath, st, encoding) {
  const key = filePath + ':' + encoding + ':' + st.mtimeMs;
  if (COMPRESS_CACHE.has(key)) return COMPRESS_CACHE.get(key);
  let out = null;
  try {
    out = compressBody(fs.readFileSync(filePath), encoding);
  } catch (e) {
    out = null;
  }
  if (out) {
    if (COMPRESS_CACHE.size >= COMPRESS_CACHE_MAX) {
      COMPRESS_CACHE.delete(COMPRESS_CACHE.keys().next().value);
    }
    COMPRESS_CACHE.set(key, out);
  }
  return out;
}
function cacheControlFor(ext, versioned) {
  if (ext === '.html' || ext === '.htm') return 'no-cache';
  if (versioned) return 'public, max-age=31536000, immutable';
  if (ext === '.css' || ext === '.js' || ext === '.mjs') return 'public, max-age=86400';
  if (ext === '.woff' || ext === '.woff2' || ext === '.ttf')
    return 'public, max-age=31536000, immutable';
  if (/^\.(png|jpe?g|webp|gif|svg|ico|avif)$/.test(ext))
    return 'public, max-age=604800';
  if (ext === '.json') return 'public, max-age=600';
  return 'public, max-age=3600';
}

function serveStatic(req, res, pathname) {
  const qIndex = pathname.indexOf('?');
  const versioned = qIndex !== -1 && /(^|&)v=/.test(pathname.slice(qIndex + 1));
  let rel = decodeURIComponent(pathname.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.normalize(path.join(ROOT, rel));
  if (filePath.indexOf(ROOT) !== 0) return send(res, 403, 'Forbidden');
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      // SPA-ish: fall back to index.html for extension-less paths
      if (!path.extname(filePath)) return serveStatic(req, res, '/index.html');
      return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    const ext = path.extname(filePath).toLowerCase();
    const etag = 'W/"' + st.size.toString(16) + '-' + st.mtimeMs.toString(16) + '"';
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': cacheControlFor(ext, versioned),
      ETag: etag,
      Vary: 'Accept-Encoding',
    };
    // Conditional request -> 304 (no body)
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      return res.end();
    }
    // Pre-compressed / on-the-fly compression for text assets
    const enc = COMPRESSIBLE.has(ext) ? pickEncoding(req) : null;
    if (enc) {
      const comp = getCompressed(filePath, st, enc);
      if (comp && comp.length < st.size) {
        headers['Content-Encoding'] = enc === 'br' ? 'br' : 'gzip';
        headers['Content-Length'] = comp.length;
        res.writeHead(200, headers);
        if (req.method === 'HEAD') return res.end();
        return res.end(comp);
      }
    }
    headers['Content-Length'] = st.size;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
}

/* ---------------------------------------------------------- router */
const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const pathname = parsed.pathname;
  const q = parsed.searchParams;
  res._req = req;

  if (req.method === 'OPTIONS') return send(res, 204, '');
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');

  try {
    if (pathname === '/api/hls') return await handleHls(req, res, q);
    if (pathname === '/api/video') return await handleVideo(req, res, q);
    if (pathname === '/api/img') return await handleImg(req, res, q);
    if (pathname === '/api/btolat/videos') return await handleBtolatVideos(req, res, q);
    if (pathname === '/api/btolat/video') return await handleBtolatVideo(req, res, q);
    if (pathname === '/api/btolat/img') return await handleImg(req, res, q);
    if (pathname === '/api/oscar/channel') return await handleOscarChannel(req, res, q);
    if (pathname === '/api/oscar/matches') return await handleOscarMatches(req, res, q);
    if (pathname === '/api/oscar/match') return await handleOscarMatch(req, res, q);
    if (pathname === '/api/oscar/movie') return await handleOscarDetail(req, res, q, 'movies');
    if (pathname === '/api/oscar/series-detail')
      return await handleOscarDetail(req, res, q, 'series');
    if (pathname === '/api/oscar/anime-detail')
      return await handleOscarDetail(req, res, q, 'anime');
    if (pathname === '/api/oscar/episodes') return await handleOscarEpisodes(req, res, q, false);
    if (pathname === '/api/oscar/episode') return await handleOscarEpisode(req, res, q, false);
    if (pathname === '/api/oscar/anime-episodes')
      return await handleOscarEpisodes(req, res, q, true);
    if (pathname === '/api/oscar/anime-episode')
      return await handleOscarEpisode(req, res, q, true);
    if (pathname === '/api/health')
      return sendJSON(res, { status: 'ok', time: Date.now() });
    if (pathname === '/api/refresh') {
      const tok = q.get('token') || req.headers['x-refresh-token'] || '';
      if (!REFRESH_TOKEN) return fail(res, 'refresh endpoint disabled', 403);
      if (tok !== REFRESH_TOKEN) return fail(res, 'forbidden', 403);
      const started = runRefresh('http');
      return sendJSON(res, { status: started ? 'started' : 'busy' });
    }
    if (pathname.indexOf('/api/') === 0) return fail(res, 'unknown endpoint', 404);

    return serveStatic(req, res, req.url);
  } catch (e) {
    log('ERROR', pathname, e && e.stack ? e.stack : e);
    return fail(res, 'server error', 500);
  }
});

server.listen(PORT, HOST, () => {
  log('NOVA TV backend listening on http://' + HOST + ':' + PORT);
  log('static root:', ROOT);
  log('oscar base :', OSCAR_BASE);
  if (AUTO_REFRESH_HOURS > 0) {
    log('auto-refresh: every ' + AUTO_REFRESH_HOURS + 'h (set AUTO_REFRESH_HOURS=0 to disable)');
    setTimeout(() => runRefresh('boot'), 90 * 1000);
    setInterval(() => runRefresh('schedule'), AUTO_REFRESH_HOURS * 3600 * 1000);
  } else {
    log('auto-refresh: disabled');
  }
});
