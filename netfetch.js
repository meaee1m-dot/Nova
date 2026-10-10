'use strict';
/* ============================================================
   NOVA TV — netfetch.js
   ------------------------------------------------------------
   Proxy-aware HTTP(S) client (zero dependencies). Mirrors the
   tunnelling logic used by server.js so the update scripts can
   reach the Oscar API from datacenter IPs (Render / Railway /
   AWS …) through a residential proxy.

   The proxy is taken from opts.proxy, or the OSCAR_PROXY env var.
   For https targets it opens an HTTP CONNECT tunnel; for http
   targets it uses the proxy as a forward proxy.
   ============================================================ */
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const { URL } = require('url');

const TIMEOUT = 25000;

function request(targetUrl, opts) {
  opts = opts || {};
  const maxRedirects = opts.maxRedirects == null ? 6 : opts.maxRedirects;
  const headers = Object.assign(
    { 'User-Agent': opts.ua || 'NOVA-TV/1.0', Accept: '*/*' },
    opts.headers || {}
  );

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
        } catch (e) { /* keep raw */ }
        return resolve(request(next, Object.assign({}, opts, { maxRedirects: maxRedirects - 1 })));
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
        } catch (e) { /* leave as-is */ }
        resolve({ status: status, headers: r.headers, body: buf, finalUrl: targetUrl });
      });
    };

    const proxy = opts.proxy || process.env.OSCAR_PROXY || '';
    if (proxy) {
      let p;
      try {
        p = new URL(proxy);
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
        cr.setTimeout(opts.timeout || TIMEOUT, () => cr.destroy(new Error('timeout')));
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
            onResponse
          );
          req.setTimeout(opts.timeout || TIMEOUT, () => req.destroy(new Error('timeout')));
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
        req.setTimeout(opts.timeout || TIMEOUT, () => req.destroy(new Error('timeout')));
        req.on('error', reject);
        if (opts.body) req.write(opts.body);
        req.end();
      }
      return;
    }

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
    req.setTimeout(opts.timeout || TIMEOUT, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

module.exports = { request };
