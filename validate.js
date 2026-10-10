#!/usr/bin/env node
/* ============================================================
   NOVA TV — validate.js
   ------------------------------------------------------------
   فحص سلامة الموقع: HTML/CSS/JS/JSON + التأكد من أن كل المراجع
   الداخلية (css/js/img/روابط) موجودة فعلاً.
   الاستخدام: node validate.js
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const SITE = path.join(__dirname, 'site');
let errors = 0;
let warnings = 0;
const ok = (m) => console.log('  \u2713 ' + m);
const err = (m) => { errors++; console.log('  \u2717 ' + m); };
const warn = (m) => { warnings++; console.log('  ! ' + m); };

function walk(dir, out) {
  out = out || [];
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    const s = fs.statSync(p);
    if (s.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(SITE);
const rel = (f) => path.relative(SITE, f).replace(/\\/g, '/');
const exists = (p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } };

/* ---- 1) JSON validity ---- */
console.log('\n[1] JSON files');
for (const f of files.filter((f) => f.endsWith('.json'))) {
  try {
    JSON.parse(fs.readFileSync(f, 'utf8'));
    ok(rel(f));
  } catch (e) {
    err(rel(f) + ' -> ' + e.message);
  }
}

/* ---- 2) HTML references ---- */
console.log('\n[2] HTML internal references');
const htmlFiles = files.filter((f) => f.endsWith('.html'));
for (const f of htmlFiles) {
  const html = fs.readFileSync(f, 'utf8');
  const refs = [];
  const re = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) refs.push(m[1]);
  for (const r of refs) {
    if (/^(https?:|data:|mailto:|tel:|#|javascript:|\/\/)/i.test(r)) continue;
    const clean = r.split('?')[0].split('#')[0];
    if (!clean || clean === '/' || clean.endsWith('/')) continue;
    const target = path.join(SITE, clean.replace(/^\//, ''));
    if (!exists(target)) err(rel(f) + ' -> missing: ' + r);
  }
}
ok('checked ' + htmlFiles.length + ' HTML files');

/* ---- 3) CSS basic sanity ---- */
console.log('\n[3] CSS files');
for (const f of files.filter((f) => f.endsWith('.css'))) {
  const css = fs.readFileSync(f, 'utf8');
  const open = (css.match(/\{/g) || []).length;
  const close = (css.match(/\}/g) || []).length;
  if (open !== close) err(rel(f) + ' -> unbalanced braces {' + open + '} ' + close);
  else ok(rel(f) + ' (' + open + ' rules)');
}

/* ---- 4) JS syntax ---- */
console.log('\n[4] JS files');
const cp = require('child_process');
for (const f of files.filter((f) => /\.(m?js)$/.test(f))) {
  try {
    cp.execSync('node -c "' + f + '"', { stdio: 'pipe' });
    ok(rel(f));
  } catch (e) {
    err(rel(f) + ' -> syntax error');
  }
}

/* ---- 5) required data files ---- */
console.log('\n[5] required data snapshots');
const required = [
  'data/oscar_movies.json', 'data/oscar_series.json', 'data/oscar_anime.json',
  'data/oscar_channels.json', 'data/oscar_home.json', 'data/matches.json',
  'data/match_details.json', 'data/btolat.json',
];
for (const r of required) {
  if (exists(path.join(SITE, r))) ok(r);
  else err('MISSING ' + r);
}

console.log('\n============================================');
console.log('errors: ' + errors + '  |  warnings: ' + warnings);
console.log('============================================\n');
process.exit(errors ? 1 : 0);
