# NOVA TV — دليل التشغيل والنشر (Deployment Guide)

منصة **NOVA TV** = واجهة ثابتة (HTML/CSS/JS) + خادم Node.js بدون أي مكتبات خارجية (zero-dependency) يعمل كـ CORS proxy للبث.

---

## 1) التشغيل محلياً / على السيرفر

```bash
cd novatv
node server.js
# ثم افتح: http://localhost:3000
```

- المنفذ الافتراضي: **3000** (يمكن تغييره عبر متغيّر البيئة `PORT`).
- جذر الملفات الثابتة: `site/`
- لا يحتاج أي `npm install` — الكود يعتمد فقط على وحدات Node المدمجة.

```bash
PORT=8080 node server.js   # تشغيل على منفذ مخصص
```

---

## 2) بنية المشروع

```
novatv/
├── server.js              # الخادم + كل مسارات /api (proxy + بيانات)
├── iron.js                # توليد توقيع X-Iron-* لمصدر بيانات Oscar TV
├── update-content.js      # سكريبت تحديث المحتوى (أفلام/مسلسلات/أنمي/قنوات)
├── update-matches.js      # سكريبت تحديث المباريات + التفاصيل
├── update-btolat.js       # سكريبت تحديث ملخصات/أهداف btolat
├── package.json
├── README.md              # دليل شامل
├── DEPLOY.md              # هذا الملف
├── .github/
│   └── workflows/
│       └── update-content.yml  # تحديث تلقائي كل 6 ساعات
└── site/                  # الواجهة الثابتة (تُقدَّم كما هي)
    ├── *.html             # 18 صفحة (رئيسية، أفلام، مسلسلات، أنمي، مباريات، قنوات، ملخص...)
    ├── assets/
    │   ├── css/           # oscar.css + app.css + navfix.css
    │   ├── js/            # app.js + app.min.js + hls.min.js + config.js
    │   └── img/
    └── data/              # لقطات JSON (تعمل بدون إنترنت/بدون API)
        ├── oscar_movies.json     (4179 فيلم)
        ├── oscar_series.json     (1553 مسلسل)
        ├── oscar_anime.json      (513 أنمي)
        ├── oscar_channels.json   (378 قناة)
        ├── oscar_home.json       (الصفحة الرئيسية)
        ├── matches.json          (جدول المباريات)
        ├── match_details.json    (تفاصيل + سيرفرات القنوات)
        └── btolat.json           (ملخصات وأهداف)
```

---

## 3) إعداد الواجهة (config.js)

ملف `site/assets/js/config.js` يحتوي على مفتاحين:

| المتغيّر | الوصف |
|---|---|
| `window.NOVATV_API` | عنوان الـ backend. اتركه `''` إذا كان الـ backend يقدّم الموقع من نفس الأصل (الوضع الافتراضي). ضعه مثل `https://api.your-domain.com` إذا كانت الواجهة على نطاق والـ backend على نطاق آخر. |
| `window.NOVATV_NO_PROXY` | اجعله `true` **فقط** عند استضافة الواجهة استضافة ثابتة بالكامل (مثل GitHub Pages) بدون أي backend. حينها سيتم استدعاء الروابط مباشرة (وقد تفشل بسبب CORS). |

> ⚠️ **مهم:** الخطأ الأصلي "القنوات تعذر تشغيلها" كان سببه أن الواجهة كانت تستدعي روابط البث مباشرة متجاوزةً الـ proxy. تم إصلاحه: الآن كل روابط HLS تمر إجبارياً عبر `/api/hls` طالما لم يُفعَّل `NOVATV_NO_PROXY`.

---

## 4) مسارات الـ API

| المسار | الوظيفة |
|---|---|
| `GET /api/health` | فحص الحالة |
| `GET /api/hls?url=&ua=&ref=` | بروكسي HLS (يعيد كتابة الـ m3u8 + يدعم Range/206) |
| `GET /api/video?url=&ua=&ref=` | بروكسي فيديو مباشر |
| `GET /api/img?url=` | بروكسي صور |
| `GET /api/oscar/matches?date=YYYY-MM-DD` | جدول المباريات |
| `GET /api/oscar/match?id=` | تفاصيل مباراة |
| `GET /api/oscar/channel?id=` | سيرفرات قناة |
| `GET /api/oscar/movie?id=` / `series` / `anime` | تفاصيل عمل + سيرفرات المشاهدة |
| `GET /api/oscar/episodes?id=` / `episode` | حلقات |
| `GET /api/btolat/videos?cat=10\|15` | ملخصات/أهداف |
| `GET /api/btolat/video?id=` | تشغيل ملخص (يعيد `hls` + `qualities[]` بالجودات المتاحة 720p/360p/240p) |
| `GET /api/btolat/img?url=` | صور btolat |

---

## 5) ملاحظات تشغيلية

- **Oscar API** (`ostvapp.cam`) محجوب جغرافياً/بـ IP من بعض الاستضافات (يعيد 403). الخادم يتعامل مع ذلك بالرجوع تلقائياً إلى لقطات `site/data/*.json`، لذا الموقع يظل يعمل. عند تشغيله على سيرفر غير محجوب، ستُجلب السيرفرات الحقيقية تلقائياً (بفضل `normalizeLinks()`).
- **HLS playlists متنكّرة** كملفات `.css` (مثل `1430.css?x=/hls/`) — الخادم يكتشفها ويعيد كتابتها بشكل صحيح.
- **جودات الملخصات والأهداف (btolat)**: يُحلّل الخادم قائمة `master.m3u8` ويعيد الجودات المتاحة (`720p`/`360p`/`240p`) داخل حقل `qualities`، وتظهر كأزرار جودة أسفل المشغّل (مع خيار «تلقائي»). بروكسي الـ HLS يحافظ على باراميتر `?token=` عند إعادة كتابة روابط الجودات/المقاطع الموقّعة.
- **قائمة الموبايل**: تُحقن ديناميكياً عبر `app.js` (زر `nav-toggle` + `mobile-menu`) وتُنسّق عبر `navfix.css`. تعمل فقط عند عرض < 820px.
- **المباريات** تفتح في **تبويب جديد** (`target="_blank"`).

---

## 6) الرفع على GitHub + التحديث التلقائي

> 📘 الدليل الكامل والخطوات التفصيلية في ملف **`README.md`** (الأقسام 3 و4 و5). هذا ملخّص سريع:

### أ) رفع المشروع على GitHub

```bash
cd novatv
git init && git branch -M main
git add .
git commit -m "Initial commit — NOVA TV"
git remote add origin https://github.com/<USERNAME>/novatv.git
git push -u origin main
```

> تأكّد أن مجلد `.github/workflows/` مرفوع (وإلا لن يعمل التحديث التلقائي). لو كان مخفياً: `git add -f .github`.

### ب) النشر (Deployment)

| الخيار | الفيديو | الخطوات |
|---|---|---|
| **SnapDeploy** (موصى به، مجاني **بدون كارت**) | ✅ يعمل | Deploy from GitHub → اختر `Nova` → يقرأ الـ `Dockerfile` تلقائيًا |
| **Back4App Containers** (بدون كارت) | ✅ يعمل | Build → Containers → Deploy from GitHub → يبني من الـ `Dockerfile` |
| **Render** (750 ساعة/شهر) | ✅ يعمل | New → Blueprint → اختر `Nova` (يقرأ `render.yaml`) |
| **GitHub Pages** | ❌ (بدون خادم) | Settings → Pages، ثم اضبط `NOVATV_API` في `config.js` على رابط خادمك |

### ج) التحديث التلقائي للمحتوى

- الملف: `.github/workflows/update-content.yml` — يعمل كل **6 ساعات** (`cron: '0 */6 * * *'`) + تشغيل يدوي.
- السكريبتات: `node update-content.js` (الأفلام/المسلسلات/الأنمي/القنوات) + `node update-matches.js` (المباريات) + `node update-btolat.js` (الملخصات/الأهداف) — تكتب كلها في `site/data/*.json`، ثم commit + push تلقائياً.
- على SnapDeploy/Back4App/Render سيُعاد النشر تلقائياً بالبيانات الجديدة.
- تشغيل يدوي: **Actions → Update content (auto) → Run workflow**.
- تشغيل محلي: `node update-content.js` (أو `--limit 200` / `--only movies,series`)، `node update-matches.js --days 3`، `node update-btolat.js`.

> ⚙️ **مطلوب مرة واحدة:** Settings → Actions → General → **Workflow permissions = Read and write permissions** ليتمكن الـ Action من الـ push.

---

## 7) الأداء والتسريع ⚡

الخادم يضغط كل الأصول النصّية تلقائياً (Brotli/Gzip) ويدعم ETag/304 والتخزين المؤقت الذكي — بدون أي مكتبات.

```bash
node benchmark.js          # قياس الأداء (زمن/حجم/ترميز/ETag/304)
node optimize.js --report  # تقرير التسريع بدون تعديل
node optimize.js           # تصغير ملفات HTML
node optimize.js --all     # تصغير HTML + CSS + JS
node optimize.js --prezip  # توليد نسخ .br/.gz لمضيفين ثابتين
node validate.js           # فحص السلامة (يجب 0 أخطاء)
```

| الأصل | بدون ضغط | Brotli | التوفير |
|---|---|---|---|
| index.html | 15.7 KB | 2.9 KB | -81% |
| app.min.css | 41.6 KB | 6.8 KB | -84% |
| app.min.js | 59.4 KB | 15.1 KB | -75% |
| hls.min.js | 414 KB | 101 KB | -76% |
| oscar_movies.json | 1429 KB | 313 KB | -78% |

> شغّل `node optimize.js` ثم `node validate.js` قبل كل رفع.

---

© 2026 NOVA TV
