/* ============================================================
   NOVA TV — service worker
   ------------------------------------------------------------
   • Navigation (HTML pages)  -> network-first (always fresh), cache fallback.
   • Static assets (css/js/img) -> stale-while-revalidate (instant + fresh).
   • /api/* and /data/*.json   -> NEVER cached (live content must stay fresh).
   Cross-origin (CDN, fonts, images) is left untouched.
   ============================================================ */
'use strict';

const CACHE = 'novatv-v3';
const SHELL = [
  './',
  './index.html',
  './assets/css/oscar.min.css',
  './assets/css/app.min.css',
  './assets/css/home.min.css',
  './assets/css/navfix.css',
  './assets/js/config.js',
  './assets/js/app.min.js',
  './assets/js/hls.min.js',
  './assets/img/novatv/fav.png',
  './assets/img/placeholder.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isFreshOnly(url) {
  return url.pathname.indexOf('/api/') === 0 || url.pathname.indexOf('/data/') >= 0;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;      // leave CDN / fonts alone
  if (isFreshOnly(url)) return;                          // live data: network only

  // HTML navigations -> network-first
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').indexOf('text/html') >= 0) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }

  // Static assets -> stale-while-revalidate
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => hit);
      return hit || net;
    })
  );
});
