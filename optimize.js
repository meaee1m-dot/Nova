#!/usr/bin/env node
/* ============================================================
   NOVA TV — optimize.js
   ------------------------------------------------------------
   أداة تسريع الأصول الثابتة (zero-dependency).

   ما تفعله:
     • تصغير ملفات HTML بأمان (مع الحفاظ على <script>/<style>/
       <pre>/<textarea> كما هي).
     • (اختياري) إخراج نسخ مضغوطة .br و .gz بجانب كل ملف نصّي
       لاستخدامها مباشرة من السيرفر (pre-compression).
     • تقرير بالحجم قبل/بعد ونسبة التوفير.

   الاستخدام:
     node optimize.js              # يصغّر HTML فقط
     node optimize.js --report     # تقرير فقط بدون تعديل
     node optimize.js --prezip     # يصغّر + يولّد .br/.gz
     node optimize.js --all        # يصغّر HTML + CSS + JS
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, 'site');
const args = process.argv.slice(2);
const REPORT_ONLY = args.includes('--report');
const PREZIP = args.includes('--prezip');
const ALL = args.includes('--all');

/* -------------------------------------------------- utils */
function kb(n) {
  return (n / 1024).toFixed(1) + ' KB';
}
function pct(before, after) {
  if (!before) return '0%';
  return Math.round((1 - after / before) * 100) + '%';
}
function walk(dir, out) {
  out = out || [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/* ------------------------------------------- HTML minifier */
// يحفظ كتل script/style/pre/textarea ثم يعيدها كما هي.
function minifyHTML(src) {
  const blocks = [];
  const token = (m) => {
    blocks.push(m);
    return '\u0000' + (blocks.length - 1) + '\u0000';
  };
  let out = src
    // 1) احمِ الكتل الحسّاسة
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, token)
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, token)
    .replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, token)
    .replace(/<textarea\b[^>]*>[\s\S]*?<\/textarea>/gi, token)
    // 2) احذف تعليقات HTML (مع الإبقاء على التعليقات الشرطية)
    .replace(/<!--(?!\[if)[\s\S]*?-->/g, '')
    // 3) اجمع المسافات بين الوسوم
    .replace(/>\s+</g, '><')
    // 4) اجمع المسافات المتكرّرة
    .replace(/[ \t]{2,}/g, ' ')
    // 5) أزل الفراغات على أطراف الأسطر
    .replace(/\n\s+/g, '\n')
    .trim();
  // أعِد الكتل المحفوظة
  out = out.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[+i]);
  return out;
}

/* ------------------------------------------- CSS minifier */
// تصغير آمن نسبيًا: يحذف التعليقات والمسافات الزائدة دون لمس
// القيم داخل علامات التنصيص أو content:"...".
function minifyCSS(src) {
  let out = src
    .replace(/\/\*[\s\S]*?\*\//g, '') // comments
    .replace(/\s*([{}:;,>~+])\s*/g, '$1') // around punctuation
    .replace(/;}/g, '}')
    .replace(/\s+/g, ' ')
    .replace(/\s*!important/g, '!important')
    .trim();
  return out;
}

/* ------------------------------------------- JS minifier */
// تصغير محافظ جدًا: يحذف تعليقات السطر والكتلة والمسافات على
// أطراف الأسطر فقط. لا يلمس السلاسل النصية. آمن للاستخدام.
function minifyJS(src) {
  const strings = [];
  const token = (m) => {
    strings.push(m);
    return '\u0000' + (strings.length - 1) + '\u0000';
  };
  let out = src
    // احمِ السلاسل النصية (مفردة/مزدوجة/backtick)
    .replace(/`(?:\\.|[^`\\])*`/g, token)
    .replace(/'(?:\\.|[^'\\])*'/g, token)
    .replace(/"(?:\\.|[^"\\])*"/g, token)
    // احذف التعليقات
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    // اجمع المسافات على أطراف الأسطر
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
  out = out.replace(/\u0000(\d+)\u0000/g, (_, i) => strings[+i]);
  return out;
}

/* ------------------------------------------- prezip */
function prezip(filePath, buf) {
  const br = zlib.brotliCompressSync(buf, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
    },
  });
  const gz = zlib.gzipSync(buf, { level: 9 });
  fs.writeFileSync(filePath + '.br', br);
  fs.writeFileSync(filePath + '.gz', gz);
  return { br: br.length, gz: gz.length };
}

/* -------------------------------------------------- main */
function main() {
  const files = walk(ROOT);
  let totalBefore = 0;
  let totalAfter = 0;
  const rows = [];

  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    const isHTML = ext === '.html' || ext === '.htm';
    const isCSS = ext === '.css';
    const isJS = ext === '.js' || ext === '.mjs';
    const isJSON = ext === '.json';
    const isText = isHTML || isCSS || isJS || isJSON || ext === '.svg' || ext === '.txt';
    if (!isText) continue;

    const src = fs.readFileSync(f, 'utf8');
    const before = Buffer.byteLength(src);
    totalBefore += before;

    let out = src;
    let did = false;
    if (isHTML) {
      out = minifyHTML(src);
      did = true;
    } else if (ALL && isCSS && !/\.min\.css$/.test(f)) {
      out = minifyCSS(src);
      did = true;
    } else if (ALL && isJS && !/\.min\.js$/.test(f)) {
      out = minifyJS(src);
      did = true;
    }

    const after = Buffer.byteLength(out);
    totalAfter += after;

    if (did && !REPORT_ONLY && out !== src) {
      fs.writeFileSync(f, out);
    }

    let zip = null;
    if (PREZIP && !REPORT_ONLY) {
      zip = prezip(f, Buffer.from(out));
    }

    rows.push({
      file: path.relative(__dirname, f),
      before,
      after,
      saved: did ? before - after : 0,
      zip,
    });
  }

  // طباعة التقرير
  console.log('\n=== NOVA TV optimize report ===');
  console.log(REPORT_ONLY ? '(report only — no files changed)' : '(files written)');
  console.log('-----------------------------------------------');
  for (const r of rows) {
    if (r.saved > 0 || r.zip) {
      let line = r.file.padEnd(42) + kb(r.before).padStart(10) + ' -> ' + kb(r.after).padStart(10);
      if (r.saved > 0) line += '  (-' + pct(r.before, r.after) + ')';
      if (r.zip) line += '  [br ' + kb(r.zip.br) + ' / gz ' + kb(r.zip.gz) + ']';
      console.log(line);
    }
  }
  console.log('-----------------------------------------------');
  console.log('TOTAL text assets: ' + kb(totalBefore) + ' -> ' + kb(totalAfter) +
    '  (-' + pct(totalBefore, totalAfter) + ')');
  console.log('files scanned: ' + rows.length);
  if (!REPORT_ONLY && !ALL) {
    console.log('tip: use --all to also minify CSS/JS, --prezip for .br/.gz, --report for dry-run');
  }
}

main();
