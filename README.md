# NOVA TV 🎬

منصّة **NOVA TV** للبث العربي: أفلام، مسلسلات، أنمي، مباريات، وقنوات مباشرة — بواجهة عربية حديثة (RTL) تعمل على الجوال والحاسوب.

الموقع مبني من جزأين:

| الجزء | الوصف |
|---|---|
| **الواجهة** (`site/`) | صفحات HTML/CSS/JS ثابتة، سريعة، تعمل بدون أي مكتبات خارجية. |
| **الخادم** (`server.js`) | خادم Node.js **بدون أي اعتماديات خارجية (zero-dependency)** يعمل كـ CORS proxy للبث والصور، ويقدّم الواجهة أيضاً. |

> ⚠️ **مهم جداً:** روابط البث (HLS) لا يمكن تشغيلها مباشرة من المتصفح بسبب سياسة CORS على سيرفرات الفيديو. لذلك **الخادم (`server.js`) ضروري** لتشغيل الفيديو. لا يمكن نشر الموقع كملفات ثابتة فقط (GitHub Pages) وتشغيل الأفلام فيه بدون خادم.

---

## 1) التشغيل محلياً

```bash
# 1. فكّ الضغط عن المشروع
unzip novatv.zip && cd novatv

# 2. شغّل الخادم (لا يحتاج npm install إطلاقاً)
node server.js

# 3. افتح المتصفح على
http://localhost:3000
```

- المنفذ الافتراضي **3000**، ويمكن تغييره: `PORT=8080 node server.js`.
- لا يحتاج أي `npm install` — الكود يعتمد على وحدات Node المدمجة فقط.
- يتطلّب **Node.js 18 أو أحدث**.

---

## 2) بنية المشروع

```
novatv/
├── server.js                 # الخادم + كل مسارات /api (proxy + بيانات)
├── iron.js                   # توليد توقيع X-Iron-* لمصدر بيانات Oscar TV
├── update-content.js         # سكربت تحديث المحتوى (أفلام/مسلسلات/أنمي/قنوات)
├── update-matches.js         # سكريبت تحديث المباريات + التفاصيل (لقطة احتياطية)
├── update-btolat.js          # سكريبت تحديث ملخصات/أهداف btolat (لقطة احتياطية)
├── optimize.js               # أداة تسريع الأصول (تصغير HTML/CSS/JS + prezip)
├── benchmark.js              # قياس أداء السيرفر (زمن/حجم/ترميز/ETag)
├── validate.js               # فحص سلامة الملفات والمراجع الداخلية
├── package.json
├── README.md                 # هذا الملف
├── DEPLOY.md                 # دليل نشر مفصّل
├── .github/
│   └── workflows/
│       └── update-content.yml  # تحديث تلقائي للمحتوى كل 6 ساعات
└── site/                     # الواجهة الثابتة
    ├── *.html                # 17 صفحة (رئيسية، أفلام، مسلسلات، أنمي، مباريات، قنوات، تفاصيل، بحث...)
    ├── assets/
    │   ├── css/              # oscar.css + app.css + navfix.css
    │   ├── js/               # app.js + config.js + hls.min.js
    │   └── img/
    └── data/                 # لقطات JSON (تعمل حتى لو تعطّل الـ API)
        ├── oscar_movies.json
        ├── oscar_series.json
        ├── oscar_anime.json
        ├── oscar_channels.json
        ├── oscar_home.json
        ├── matches.json
        ├── match_details.json
        └── btolat.json
```

---

## 3) رفع الموقع على GitHub

### الطريقة الأولى: من جهازك (Git)

```bash
# ادخل مجلد المشروع
cd novatv

# 1. تهيئة مستودع Git
git init
git branch -M main

# 2. أضف كل الملفات واعمل أول commit
git add .
git commit -m "Initial commit — NOVA TV"

# 3. أنشئ مستودعاً فارغاً على github.com باسم novatv (بدون README)
#    ثم اربطه:
git remote add origin https://github.com/<USERNAME>/novatv.git

# 4. ارفع الكود
git push -u origin main
```

### الطريقة الثانية: من واجهة GitHub (بدون أوامر)

1. ادخل [github.com/new](https://github.com/new) وأنشئ مستودعاً باسم `novatv`.
2. اضغط **uploading an existing file**.
3. اسحب **كل محتويات** مجلد المشروع (بما فيها مجلد `.github` — مهم للتحديث التلقائي).
4. اكتب رسالة الـ commit واضغط **Commit changes**.

> 💡 **ملاحظة:** تأكّد أن مجلد `.github/workflows/` مرفوع فعلاً، وإلا لن يعمل التحديث التلقائي. إذا كان مخفياً في نظامك، استخدم `git add -f .github`.

---

## 4) النشر على الإنترنت (Deployment)

### ✅ الخيار الموصى به: SnapDeploy (مجاني تمامًا — **بدون كارت بنكي** — يعمل الفيديو)

[SnapDeploy](https://snapdeploy.dev/register) منصة حاويات (Docker) على AWS Fargate، والخطة المجانية **بدون كارت** وبتقرأ الـ `Dockerfile` الجاهز عندنا تلقائيًا.

1. أنشئ حسابًا على [snapdeploy.dev](https://snapdeploy.dev/register) (بإيميل أو GitHub — **بدون كارت**).
2. **Deploy from GitHub** → اختر المستودع `meaee1m-dot/Nova` والفرع `main`.
3. SnapDeploy هياخد الـ `Dockerfile` تلقائيًا (مش محتاج إعداد).
4. (اختياري) Environment Variables: `CONTENT_REFRESH_MINUTES=60`, `LIVE_REFRESH_MINUTES=2`, `OSCAR_NO_PSIPHON=0`.
5. **Deploy** → بعد كام دقيقة هتحصل على رابط مثل `https://novatv.containers.snapdeploy.app`.

- الخطة المجانية: 4 حاويات · 100 ساعة/شهر · 512MB/0.25vCPU · **بدون كارت**.
- الحاوية بتنام بعد 15 دقيقة من غير زوار وتصحى في ~60 ثانية.

### بدائل بدون كارت: Back4App Containers

[Back4App](https://www.back4app.com) → **Build → Containers → Deploy from GitHub** → اختر `Nova` (يبني من الـ `Dockerfile`). الخطة المجانية: 256MB · 0.25 CPU · 100GB · **بدون كارت** (بتقف بعد 60 دقيقة لكل نشر).

### بديل: Render (750 ساعة/شهر)

[Render](https://render.com) → **New → Blueprint** → اختر `Nova` (يقرأ `render.yaml`) → **Apply**. أو **New → Web Service** → Build: `npm install` · Start: `node server.js`. (قد يطلب تحقق بكارت في بعض الدول.)

### الخيار الثابت: GitHub Pages (بدون فيديو)

GitHub Pages يستضيف الواجهة فقط **بدون خادم**، لذا ستظهر الأفلام لكن **لن تعمل روابط البث** (CORS). يُستخدم فقط إذا كان لديك خادم منفصل للـ API:

1. ارفع المشروع على GitHub (القسم 3).
2. **Settings → Pages → Source: Deploy from a branch → main / (root أو /site)**.
3. عدّل `site/assets/js/config.js` واجعل:
   ```js
   window.NOVATV_API = 'https://novatv.containers.snapdeploy.app';
   ```
   (ضع رابط خادمك الذي نشرته على SnapDeploy).

> 🎯 **الخلاصة:** للفيديو الكامل استخدم **SnapDeploy** (خادم Node، بدون كارت). GitHub Pages يكفي للواجهة فقط.

---

## 5) التحديث التلقائي للمحتوى 🤖

المشروع يحتوي على **GitHub Actions** يعمل تلقائياً كل **6 ساعات**، يسحب أحدث الأفلام والمسلسلات والأنمي والقنوات من مصدر البيانات، ويحدّث لقطات المباريات وملخصات btolat أيضاً، ثم يحدّث ملفات `site/data/*.json` ويعمل `commit` و`push` تلقائياً.

### الملف المسؤول

`.github/workflows/update-content.yml`

```yaml
on:
  schedule:
    - cron: '0 */6 * * *'   # كل 6 ساعات
  workflow_dispatch: {}       # تشغيل يدوي من تبويب Actions
```

### كيف يعمل؟

1. GitHub يشغّل السكريبتات `node update-content.js` ثم `node update-matches.js` ثم `node update-btolat.js` تلقائياً.
2. السكربت يجلب أحدث البيانات ويكتبها في `site/data/oscar_*.json`.
3. إذا تغيّر شيء، يعمل الـ workflow `commit` + `push`.
4. إذا كان موقعك على **SnapDeploy/Back4App/Render** مربوطاً بـ GitHub، فسيُعاد النشر تلقائياً بالبيانات الجديدة. ✅

### تشغيل التحديث يدوياً

من صفحة المستودع على GitHub: **Actions → Update content (auto) → Run workflow**.

### تشغيل التحديث على جهازك

```bash
node update-content.js                 # تحديث كامل
node update-content.js --limit 200     # تحديث سريع (200 عنصر لكل نوع)
node update-content.js --only movies,series   # نوع أو نوعان فقط
node update-matches.js --days 3        # تحديث لقطة المباريات (±3 أيام)
node update-btolat.js                  # تحديث ملخصات/أهداف btolat
```

### تعديل موعد التحديث

افتح `.github/workflows/update-content.yml` وعدّل سطر `cron`. الصيغة `دقيقة ساعة يوم شهر يوم-الأسبوع` (بتوقيت UTC). أمثلة:

| كل ساعة | كل 3 ساعات | مرتان يومياً (6ص و6م) | كل يوم |
|---|---|---|---|
| `0 * * * *` | `0 */3 * * *` | `0 6,18 * * *` | `0 3 * * *` |

---

## 6) الأداء والتسريع ⚡

الخادم مبني ليكون سريعاً جداً بدون أي مكتبات خارجية، ويشمل:

**١) ضغط Brotli/Gzip تلقائي** — كل ملف نصّي (HTML/CSS/JS/JSON) يُضغط عند الإرسال حسب ما يدعمه المتصفح. مثال حقيقي:

| الأصل | بدون ضغط | Brotli | التوفير |
|---|---|---|---|
| index.html | 15.7 KB | 2.9 KB | **-81%** |
| app.min.css | 41.6 KB | 6.8 KB | -84% |
| app.min.js | 59.4 KB | 15.1 KB | -75% |
| hls.min.js | 414 KB | 101 KB | -76% |
| oscar_movies.json | 1429 KB | 313 KB | -78% |

**٢) ETag + 304** — المتصفح يعيد استخدام النسخة المخزّنة بدل تنزيلها من جديد (استجابة 304 بدون جسم).

**٣) تخزين مؤقت ذكي (Cache-Control)**:
- الأصول المُرقّمة `?v=123` → `immutable` لمدة سنة كاملة.
- CSS/JS → يوم واحد.
- الصور/الخطوط → أسبوع/سنة.
- HTML → `no-cache` (يتحدّث فوراً).
- ملفات JSON → 10 دقائق.

**٤) ضغط الكتل في الذاكرة** — النسخ المضغوطة تُحفظ مؤقتاً (cache) لتفادي إعادة الضغط في كل طلب.

### أوامر التسريع والقياس

```bash
node benchmark.js                 # قياس الأداء (زمن/حجم/ترميز/ETag/304)
node benchmark.js https://your-site   # قياس موقع منشور

node optimize.js --report         # تقرير فقط (بدون تعديل)
node optimize.js                  # تصغير كل ملفات HTML
node optimize.js --all            # تصغير HTML + CSS + JS
node optimize.js --prezip         # توليد نسخ .br/.gz (لمضيفين ثابتين)

node validate.js                  # فحص سلامة الملفات والمراجع (يجب أن يكون 0 أخطاء)
```

> نصيحة: شغّل `node optimize.js` ثم `node validate.js` قبل كل رفع للتأكد من السلامة.

---

## 7) مسارات الـ API

| المسار | الوظيفة |
|---|---|
| `GET /api/health` | فحص حالة الخادم |
| `GET /api/hls?url=&ua=&ref=` | بروكسي HLS (يعيد كتابة m3u8 ويدعم Range/206) |
| `GET /api/video?url=&ua=&ref=` | بروكسي فيديو مباشر |
| `GET /api/img?url=` | بروكسي صور |
| `GET /api/oscar/movie?id=` | تفاصيل فيلم + سيرفرات المشاهدة (بجودات متعددة) |
| `GET /api/oscar/series-detail?id=` | تفاصيل مسلسل + المواسم |
| `GET /api/oscar/anime-detail?id=` | تفاصيل أنمي + المواسم |
| `GET /api/oscar/episodes?season_id=` | حلقات موسم (مسلسل) |
| `GET /api/oscar/anime-episodes?season_id=` | حلقات موسم (أنمي) |
| `GET /api/oscar/episode?id=` | تفاصيل حلقة + سيرفراتها |
| `GET /api/oscar/channel?id=` | سيرفرات قناة مباشرة |
| `GET /api/oscar/matches?date=YYYY-MM-DD` | جدول المباريات |
| `GET /api/oscar/match?id=` | تفاصيل مباراة + قنواتها |

---

## 8) حلّ المشاكل الشائعة

| المشكلة | الحل |
|---|---|
| الفيديو لا يعمل | تأكّد أنك فتحت الموقع عبر **الخادم** (`node server.js`) وليس كملف ثابت. البث يحتاج الـ proxy. |
| «القنوات تعذّر تشغيلها» | تأكّد أن `config.js` لا يحتوي على `NOVATV_NO_PROXY = true`. |
| المنفذ 3000 مشغول | شغّل على منفذ آخر: `PORT=8080 node server.js`. |
| التحديث التلقائي لا يعمل | تأكّد أن مجلد `.github/workflows/` مرفوع، وأن **Settings → Actions → Workflow permissions = Read and write**. |
| بيانات قديمة تظهر | امسح الكاش أو أعد تشغيل الخادم؛ ملفات `site/data/*.json` تُقرأ عند الطلب. |

---

## 9) الترخيص

هذا المشروع لأغراض تعليمية/شخصية. المحتوى والروابط مملوكة لأصحابها.

© 2026 NOVA TV
