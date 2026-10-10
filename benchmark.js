#!/usr/bin/env node
/* ============================================================
   NOVA TV — benchmark.js
   ------------------------------------------------------------
   يقيس أداء السيرفر: زمن الاستجابة، الحجم المُنقّل، الترميز
   (br/gzip)، ETag، وترويسة التخزين المؤقت لكل صفحة/أصل رئيسي.

   الاستخدام:
     node benchmark.js                       # على http://localhost:3000
     node benchmark.js http://localhost:3000
     node benchmark.js https://example.com
   ============================================================ */
'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/+$/, '');

const TARGETS = [
  '/',
  '/index.html',
  '/movies.html',
  '/series.html',
  '/anime.html',
  '/channels.html',
  '/matches.html',
  '/assets/css/app.min.css',
  '/assets/js/app.min.js',
  '/assets/js/hls.min.js',
  '/data/oscar_home.json',
  '/data/oscar_movies.json',
  '/api/health',
];

function kb(n) {
  return (n / 1024).toFixed(1) + ' KB';
}

function fetchOnce(url, opts) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const t0 = process.hrtime.bigint();
    const req = lib.request(
      u,
      {
        method: opts.method || 'GET',
        headers: Object.assign(
          { 'Accept-Encoding': 'br, gzip' },
          opts.headers || {}
        ),
      },
      (res) => {
        let bytes = 0;
        res.on('data', (c) => (bytes += c.length));
        res.on('end', () => {
          const ms = Number(process.hrtime.bigint() - t0) / 1e6;
          resolve({
            status: res.statusCode,
            ms: ms,
            bytes: bytes,
            encoding: res.headers['content-encoding'] || 'identity',
            etag: res.headers['etag'] || '-',
            cache: res.headers['cache-control'] || '-',
            headers: res.headers,
          });
        });
      }
    );
    req.on('error', (e) =>
      resolve({ status: 0, ms: 0, bytes: 0, encoding: '-', etag: '-', cache: '-', error: e.message })
    );
    req.end();
  });
}

async function main() {
  console.log('\n=== NOVA TV benchmark ===');
  console.log('base: ' + BASE);
  console.log(''.padEnd(96, '-'));
  console.log(
    'URL'.padEnd(34) +
      'status'.padStart(7) +
      'time'.padStart(10) +
      'size'.padStart(11) +
      'encoding'.padStart(10) +
      '  304?'.padStart(6)
  );
  console.log(''.padEnd(96, '-'));

  let totalBytes = 0;
  let totalMs = 0;
  let count = 0;

  for (const t of TARGETS) {
    const url = BASE + t;
    const r = await fetchOnce(url, {});
    totalBytes += r.bytes;
    totalMs += r.ms;
    count++;

    // اختبار الطلب الشرطي (304) باستخدام ETag
    let not304 = 'n/a';
    if (r.etag && r.etag !== '-') {
      const r2 = await fetchOnce(url, { headers: { 'If-None-Match': r.etag } });
      not304 = r2.status === 304 ? '304 ✓' : String(r2.status);
    }

    console.log(
      t.padEnd(34) +
        String(r.status).padStart(7) +
        (r.ms.toFixed(0) + 'ms').padStart(10) +
        kb(r.bytes).padStart(11) +
        r.encoding.padStart(10) +
        not304.padStart(6)
    );
  }

  console.log(''.padEnd(96, '-'));
  console.log(
    'TOTAL'.padEnd(34) +
      ''.padStart(7) +
      (totalMs.toFixed(0) + 'ms').padStart(10) +
      kb(totalBytes).padStart(11)
  );
  console.log('avg time: ' + (totalMs / count).toFixed(0) + 'ms  |  assets: ' + count);
  console.log('tip: قارن الحجم قبل/بعد تشغيل optimize.js لقياس التوفير.\n');
}

main();
