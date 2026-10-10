# 🚀 طريقة رفع NOVA TV على GitHub — دليل خطوة بخطوة

> هذا الدليل يشرح بالتفصيل كيف ترفع المشروع كاملاً على GitHub، وكيف تشغّله،
> وكيف يعمل التحديث التلقائي للمحتوى كل 6 ساعات.

---

## 📦 محتويات الحزمة

بعد فك ضغط `novatv-latest.zip` ستحصل على مجلد `novatv/` يحتوي:

```
novatv/
├── server.js               ← الخادم (proxy للفيديو + كل مسارات /api)
├── iron.js                 ← توقيع طلبات مصدر البيانات (Oscar TV)
├── update-content.js       ← سحب الأفلام/المسلسلات/الأنمي/القنوات
├── update-matches.js       ← سحب المباريات + التفاصيل
├── update-btolat.js        ← سحب ملخصات/أهداف btolat
├── optimize.js             ← تسريع الأصول (تصغير + ضغط)
├── benchmark.js            ← قياس الأداء
├── validate.js             ← فحص السلامة
├── package.json
├── README.md               ← الدليل الكامل
├── DEPLOY.md               ← دليل النشر
├── .gitignore
├── .github/workflows/update-content.yml   ← التحديث التلقائي كل 6 ساعات
└── site/                   ← الواجهة (17 صفحة + assets + data)
```

**المتطلبات:** Node.js 18 أو أحدث. لا يحتاج `npm install` إطلاقاً (صفر مكتبات).

---

## ✅ الطريقة الأولى: الرفع من جهازك (Git) — مُوصى بها

### الخطوة 1 — جهّز المشروع محلياً

```bash
# فك الضغط
unzip novatv-latest.zip
cd novatv
```

### الخطوة 2 — أنشئ مستودعاً فارغاً على GitHub

1. افتح [github.com/new](https://github.com/new)
2. اكتب الاسم: `novatv`
3. اختر **Private** أو **Public**
4. **لا تضف** README ولا .gitignore ولا License (اتركها فارغة)
5. اضغط **Create repository**

### الخطوة 3 — اربط وارفع الكود

انسخ أوامر الـ URL من الصفحة التي ظهرت (استبدل `<USERNAME>` باسمك):

```bash
git init
git branch -M main
git add .
git commit -m "Initial commit — NOVA TV"
git remote add origin https://github.com/<USERNAME>/novatv.git
git push -u origin main
```

> 💡 إذا رفض GitHub رفع مجلد `.github` (لأنه مخفي)، نفّذ:
> `git add -f .github` ثم `git commit -m "add workflow"` ثم `git push`.

### الخطوة 4 — فعّل صلاحية الـ Action (مرة واحدة فقط)

1. في المستودع: **Settings → Actions → General**
2. انزل إلى **Workflow permissions**
3. اختر **Read and write permissions**
4. اضغط **Save**

هذا يسمح للـ Action بعمل `push` للبيانات المحدّثة تلقائياً.

---

## 🌐 الطريقة الثانية: الرفع من واجهة GitHub (بدون أوامر)

1. افتح المستودع الفارغ على GitHub
2. اضغط **uploading an existing file** (أو Add file → Upload files)
3. اسحب **محتويات** مجلد `novatv/` (وليس المجلد نفسه) إلى الصفحة
   - ⚠️ مهم: ارفع محتوى المجلد مباشرة حتى يكون `server.js` في جذر المستودع
   - لرفع مجلد `.github` المخفي، استخدم Git (الطريقة الأولى) لأن الواجهة قد لا ترفعه
4. اكتب رسالة commit: `Initial commit — NOVA TV`
5. اضغط **Commit changes**

---

## 🎬 تشغيل الموقع

### محلياً (للتجربة)

```bash
cd novatv
node server.js
# ثم افتح: http://localhost:3000
```

### على الإنترنت (مستضاف) — لأن الفيديو يحتاج خادماً

| الخيار | الفيديو | الخطوات |
|---|---|---|
| **Render** (مجاني، مُوصى) | ✅ | New → Web Service → اختر المستودع → Build: `npm install` → Start: `node server.js` |
| **Railway** | ✅ | New Project → Deploy from GitHub repo |
| **GitHub Pages** | ❌ بدون خادم | Settings → Pages، ثم اضبط `NOVATV_API` في `site/assets/js/config.js` على رابط خادمك |

> ⚠️ GitHub Pages لا يشغّل Node، لذا لن يعمل البث المباشر (HLS) عبره وحده.
> استخدم Render أو Railway للحصول على البث الكامل.

---

## 🤖 التحديث التلقائي للمحتوى

- **الملف المسؤول:** `.github/workflows/update-content.yml`
- **الموعد:** كل **6 ساعات** تلقائياً (`cron: '0 */6 * * *'`)
- **ماذا يفعل؟** يشغّل السكربتات الثلاثة ثم يعمل commit + push للبيانات الجديدة:

```bash
node update-content.js          # الأفلام/المسلسلات/الأنمي/القنوات
node update-matches.js --days 3 # المباريات + التفاصيل
node update-btolat.js           # ملخصات/أهداف btolat
```

- **تشغيل يدوي فوري:** Actions → **Update content (auto)** → **Run workflow**
- **على Render/Railway:** يُعاد النشر تلقائياً بالبيانات الجديدة بعد كل push.

### تشغيل التحديث على جهازك

```bash
node update-content.js               # تحديث كامل
node update-content.js --limit 200   # تحديث سريع جزئي
node update-content.js --only movies,series
node update-matches.js --days 7
node update-btolat.js
```

---

## ⚡ نصائح الأداء قبل الرفع

```bash
node optimize.js          # تصغير ملفات HTML
node validate.js          # فحص السلامة (يجب أن يظهر 0 أخطاء)
node benchmark.js         # قياس السرعة (اختياري)
```

الخادم يضغط كل الأصول تلقائياً (Brotli/Gzip) ويدعم ETag/304 — لا تحتاج أي إعداد.

---

## 🧩 أوامر npm الجاهزة

```bash
npm start              # تشغيل الخادم
npm run update:all     # تحديث كل المحتوى
npm run optimize       # تسريع الأصول
npm run benchmark      # قياس الأداء
npm run validate       # فحص السلامة
```

---

## 🛠️ حلّ المشاكل الشائعة

| المشكلة | الحل |
|---|---|
| الفيديو لا يعمل | تأكد أنك تشغّل `node server.js` (ليس GitHub Pages فقط) |
| الـ Action لا يرفع البيانات | فعّل **Read and write permissions** (الخطوة 4) |
| مجلد `.github` لم يُرفع | `git add -f .github` |
| خطأ 403 من مصدر البيانات | طبيعي على بعض الاستضافات؛ الموقع يرجع تلقائياً للقطات JSON |
| المنفذ مشغول | `PORT=8080 node server.js` |

---

© 2026 NOVA TV — بالتوفيق! 🎬
