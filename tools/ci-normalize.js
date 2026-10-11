'use strict';
/* ============================================================
   NOVA TV — tools/ci-normalize.js
   ------------------------------------------------------------
   Used by the GitHub Actions auto-updater. The updater scripts
   always rewrite the JSON snapshots with a fresh `generated`
   timestamp, which would otherwise create a commit every run
   even when nothing actually changed.

   This script compares each site/data/*.json against HEAD while
   IGNORING the `generated` field. Files whose only change is the
   timestamp are reverted (git checkout). If any file has a real
   change it exits 0 (=> commit), otherwise exits 1 (=> skip).
   ============================================================ */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'site', 'data');

function strip(obj) {
  if (Array.isArray(obj)) return obj.map(strip);
  if (obj && typeof obj === 'object') {
    const o = {};
    for (const k of Object.keys(obj)) {
      if (k === 'generated') continue;
      o[k] = strip(obj[k]);
    }
    return o;
  }
  return obj;
}

let files = [];
try { files = fs.readdirSync(DATA).filter((f) => f.endsWith('.json')); } catch (e) { files = []; }

let changed = 0;
for (const f of files) {
  const p = path.join(DATA, f);
  let head = null;
  try {
    head = execSync('git show HEAD:site/data/' + f, { maxBuffer: 1 << 28, cwd: ROOT }).toString('utf8');
  } catch (e) { head = null; }
  let work = '';
  try { work = fs.readFileSync(p, 'utf8'); } catch (e) { continue; }

  let same = false;
  try {
    same =
      head != null &&
      JSON.stringify(strip(JSON.parse(head))) === JSON.stringify(strip(JSON.parse(work)));
  } catch (e) { same = false; }

  if (same) {
    try { execSync('git checkout -- "site/data/' + f + '"', { cwd: ROOT }); } catch (e) {}
  } else {
    changed++;
    console.log('changed: site/data/' + f);
  }
}
console.log('meaningful changes: ' + changed);
process.exit(changed > 0 ? 0 : 1);
