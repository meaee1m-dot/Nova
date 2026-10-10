/* ============================================================
   NOVA TV — Oscar TV frontend (vanilla JS, RTL)
   ------------------------------------------------------------
   ALL content comes from the Oscar TV API (ostvapp.cam) via the
   NOVA TV backend proxies (/api/oscar/*, /api/hls, /api/video,
   /api/img). Catalogs are served as compact JSON from ./data.
   No third-party sources. No ads.
   ============================================================ */
(function () {
  'use strict';

  /* ---------------------------------------------------------- config */
  var API = (window.NOVATV_API || '').replace(/\/+$/, '');
  var IMG_BASE = 'https://admin.dramaramadan.net';
  var DEFAULT_UA = 'TDMuaHLS99';
  var PER_PAGE = 30;
  var WATCHED_KEY = 'novatv_watched_v2';

  /* ---------------------------------------------------------- helpers */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function qs(o) {
    return Object.keys(o).filter(function (k) { return o[k] !== null && o[k] !== undefined && o[k] !== ''; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(o[k]); }).join('&');
  }
  function num(n) { if (n == null || n === '') return ''; var x = Number(n); return isNaN(x) ? '' : x.toLocaleString('ar-EG'); }
  function img(p) { if (!p) return 'assets/img/placeholder.svg'; p = String(p); return /^https?:\/\//.test(p) ? p : IMG_BASE + p; }
  function api(path, params) { return fetch(API + path + (params ? ('?' + qs(params)) : '')).then(function (r) { return r.json(); }); }
  /* رسالة خطأ واضحة ومفيدة عند فشل تحميل المحتوى */
  function loadFailHTML(title) {
    var hint;
    if (location.protocol === 'file:') {
      hint = 'أنت تفتح الموقع كملف محلي (file://)، والمتصفح يمنع تحميل ملفات البيانات data/*.json في هذه الحالة. ' +
             'ارفع الموقع على استضافة مثل GitHub Pages (أو شغّل سيرفر محلي) وسيعمل كل شيء.';
    } else {
      hint = 'تأكّد من رفع مجلد data/ مع الموقع، ومن اتصالك بالإنترنت، ثم أعد تحديث الصفحة (Ctrl+F5).';
    }
    return '<div class="empty"><i class="fas fa-triangle-exclamation"></i><p>' + title + '</p>' +
      '<p style="font-size:13px;opacity:.78;margin-top:10px;max-width:540px;margin-inline:auto;line-height:1.9">' + hint + '</p></div>';
  }
  function unwrap(j) { return (j && typeof j === 'object' && 'data' in j && j.status) ? j.data : j; }
  function uaOf(link) { if (!link) return DEFAULT_UA; var m = /[?&]ua=([^&]+)/.exec(link); return m ? decodeURIComponent(m[1]) : DEFAULT_UA; }
  function isHlsUrl(u) { u = u || ''; return /\.m3u8(\?|#|$)/i.test(u) || /m3u8/i.test(u) || /x=\/hls/i.test(u) || /\/hls\//i.test(u); }
  function fmtRuntime(min) { var m = Number(min); if (!m) return ''; var h = Math.floor(m / 60), r = m % 60; return (h ? h + ' س ' : '') + (r ? r + ' د' : '') || (m + ' د'); }
  function ratingStr(r) { var x = parseFloat(r); return x > 0 ? x.toFixed(1) : ''; }
  function genresOf(it) {
    var g = it && it.g;
    if (Array.isArray(g)) return g.map(function (x) { return x.name || x; }).filter(Boolean);
    if (typeof g === 'string' && g) return g.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    return [];
  }
  /* origin / production-country classification (for the عربي/أجنبي filter) */
  var ARAB_CC = { EG: 1, SA: 1, AE: 1, KW: 1, QA: 1, BH: 1, OM: 1, JO: 1, LB: 1, IQ: 1, SY: 1, MA: 1, DZ: 1, TN: 1, LY: 1, SD: 1, YE: 1, PS: 1, MR: 1 };
  function originOf(it) {
    var c = String((it && it.c) || '').toUpperCase();
    if (ARAB_CC[c]) return 'عربي';
    if (c === 'IN') return 'هندي';
    if (c === 'KR') return 'كوري';
    if (c === 'TR') return 'تركي';
    if (c === 'JP') return 'ياباني';
    if (c === 'CN' || c === 'HK' || c === 'TW') return 'صيني';
    return 'أجنبي';
  }
  function isDubbed(it) { var t = String((it && it.ct) || ''); return t.indexOf('مدبلج') >= 0; }
  function isSubtitled(it) { var t = String((it && it.ct) || ''); return t.indexOf('مترجم') >= 0 || t === 'original'; }
  /* Arabic country names (for auto-generated synopses when the live source is offline) */
  var COUNTRY_AR = { US: 'أمريكا', GB: 'بريطانيا', FR: 'فرنسا', KR: 'كوريا الجنوبية', JP: 'اليابان', IN: 'الهند', TR: 'تركيا', CN: 'الصين', HK: 'هونج كونج', TW: 'تايوان', EG: 'مصر', SA: 'السعودية', AE: 'الإمارات', KW: 'الكويت', QA: 'قطر', BH: 'البحرين', OM: 'عُمان', JO: 'الأردن', LB: 'لبنان', IQ: 'العراق', SY: 'سوريا', MA: 'المغرب', DZ: 'الجزائر', TN: 'تونس', LY: 'ليبيا', SD: 'السودان', YE: 'اليمن', PS: 'فلسطين', MR: 'موريتانيا', ES: 'إسبانيا', IT: 'إيطاليا', DE: 'ألمانيا', RU: 'روسيا', CA: 'كندا', AU: 'أستراليا', MX: 'المكسيك', BR: 'البرازيل', SE: 'السويد', DK: 'الدنمارك', NO: 'النرويج', NL: 'هولندا', BE: 'بلجيكا', TH: 'تايلاند', PH: 'الفلبين', ID: 'إندونيسيا', PK: 'باكستان', IR: 'إيران', AR: 'الأرجنتين' };
  function countryName(cc) { return COUNTRY_AR[String(cc || '').toUpperCase()] || ''; }
  /* Build a readable Arabic synopsis. Uses the real synopsis when present,
     otherwise composes one from the available metadata so the description
     block is never empty (the live Oscar API is geo-blocked for some hosts). */
  function buildStory(it, kind) {
    if (!it) return '';
    var raw = it.story || it.story_en || '';
    if (raw && /[\u0600-\u06FF]/.test(raw)) return raw;      /* genuine Arabic synopsis */
    var title = it.t || it.te || it.title_ar || it.title_en || '';
    var year = it.y || it.release_year || '';
    var label = KIND_LABEL[kind] || 'عمل';
    var g = genresOf(it).slice(0, 3);
    var cn = countryName(it.c || it.country);
    var parts = [label + ' «' + title + '»' + (year ? ' (' + year + ')' : '')];
    if (cn) parts.push('من إنتاج ' + cn);
    if (g.length) parts.push('يجمع بين ' + g.join(' و'));
    var s = parts.join('، ') + '.';
    var q = isDubbed(it) ? 'مدبلجاً بالعربية' : (isSubtitled(it) ? 'مترجماً' : 'بجودة عالية');
    s += ' يمكنك مشاهدة ' + title + ' أونلاين ' + q + ' على NOVA TV، مع إمكانية المشاهدة المباشرة دون تسجيل ودون إعلانات مزعجة.';
    return s;
  }
  function qualRank(q) {
    q = String(q || '').toLowerCase();
    if (q.indexOf('1080') >= 0) return 4;
    if (q.indexOf('720') >= 0) return 3;
    if (q.indexOf('480') >= 0) return 2;
    if (q.indexOf('360') >= 0 || q.indexOf('144') >= 0 || q.indexOf('240') >= 0) return 1;
    return 0;
  }
  function statusLabel(s) {
    s = String(s || '').toLowerCase();
    return { released: 'مكتمل', ongoing: 'مستمر', ended: 'منتهي', upcoming: 'قادم', airing: 'يُعرض الآن' }[s] || s;
  }

  /* ---------------------------------------------------------- watched */
  function getWatched() { try { return JSON.parse(localStorage.getItem(WATCHED_KEY) || '[]'); } catch (e) { return []; } }
  function isWatched(id) { return getWatched().some(function (w) { return String(w.id) === String(id); }); }
  function markWatched(item) {
    try {
      var arr = getWatched().filter(function (w) { return String(w.id) !== String(item.id); });
      arr.unshift({ id: item.id, t: item.t, p: item.p, y: item.y, kind: item.kind, ts: Date.now() });
      localStorage.setItem(WATCHED_KEY, JSON.stringify(arr.slice(0, 120)));
    } catch (e) { }
  }

  /* ---------------------------------------------------------- anti-ad */
  function antiAd() {
    try { window.open = function () { return null; }; } catch (e) { }
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[target="_blank"]') : null;
      if (!a) return;
      var href = a.getAttribute('href') || '';
      /* Keep the new-tab behaviour for our own pages (e.g. match details);
         only neutralise targets on external / ad links. */
      if (/^https?:\/\//i.test(href) || href.indexOf('//') === 0) a.removeAttribute('target');
    }, true);
  }

  /* ---------------------------------------------------------- catalog */
  var _cache = {};
  function loadCatalog(kind) {
    if (_cache[kind]) return Promise.resolve(_cache[kind]);
    return fetch('data/oscar_' + kind + '.json', { cache: 'force-cache' })
      .then(function (r) { return r.json(); })
      .then(function (j) { _cache[kind] = (j && j.items) || []; return _cache[kind]; });
  }
  /* lightweight homepage feed (much smaller than the full catalogs) */
  function loadHome() {
    if (_cache.__home) return Promise.resolve(_cache.__home);
    return fetch('data/oscar_home.json', { cache: 'force-cache' })
      .then(function (r) { return r.json(); })
      .then(function (j) { _cache.__home = j || {}; return _cache.__home; });
  }

  /* ---------------------------------------------------------- cards */
  var KIND_LABEL = { movies: 'فيلم', series: 'مسلسل', anime: 'أنمي' };
  function cardHTML(item, kind) {
    var id = item.id;
    var title = item.t || item.te || '';
    var poster = img(item.p);
    var rate = ratingStr(item.r);
    var year = item.y || '';
    var ct = item.ct || '';
    var g = genresOf(item);
    var genre = g[0] || '';
    var sub = [];
    if (year) sub.push('<span>' + esc(year) + '</span>');
    if (genre) sub.push('<span>' + esc(genre) + '</span>');
    return '<a class="card reveal" href="detail.html?kind=' + esc(kind) + '&id=' + esc(id) + '">' +
      '<div class="card-poster">' +
        '<img src="' + esc(poster) + '" alt="' + esc(title) + '" loading="lazy" decoding="async" onerror="this.onerror=null;this.src=\'assets/img/placeholder.svg\'">' +
        '<div class="card-top"><span class="badge badge-red">' + (KIND_LABEL[kind] || '') + '</span>' +
          (ct ? '<span class="badge badge-dark">' + esc(ct) + '</span>' : '') + '</div>' +
        (rate ? '<span class="card-rate"><i class="fas fa-star"></i> ' + rate + '</span>' : '') +
        '<span class="card-play"><i class="fas fa-play"></i></span>' +
      '</div>' +
      '<div class="card-body">' +
        '<div class="card-title">' + esc(title) + '</div>' +
        '<div class="card-sub">' + (sub.length ? sub.join('<span class="sep"></span>') : '<span>' + esc(item.te || '') + '</span>') + '</div>' +
      '</div>' +
    '</a>';
  }
  function gridHTML(items, kind) { return items.map(function (it) { return cardHTML(it, kind); }).join(''); }

  function pagerHTML(page, pages) {
    if (pages <= 1) return '';
    var out = '';
    function add(p, label, cls, dis) {
      out += '<button class="page-btn ' + (cls || '') + '" ' + (dis ? 'disabled' : '') + ' data-page="' + p + '">' + label + '</button>';
    }
    add(page - 1, '<i class="fas fa-chevron-right"></i>', '', page <= 1);
    var win = 2, start = Math.max(1, page - win), end = Math.min(pages, page + win);
    if (start > 1) { add(1, '1'); if (start > 2) out += '<span class="page-btn" disabled>…</span>'; }
    for (var p = start; p <= end; p++) add(p, String(p), p === page ? 'active' : '');
    if (end < pages) { if (end < pages - 1) out += '<span class="page-btn" disabled>…</span>'; add(pages, String(pages)); }
    add(page + 1, '<i class="fas fa-chevron-left"></i>', '', page >= pages);
    return out;
  }

  /* ---------------------------------------------------------- chrome */
  function navHTML() {
    return '<nav class="site-nav" id="siteNav" aria-label="القائمة الرئيسية">' +
      '<a href="index.html" class="nav-brand" aria-label="NOVA TV">' +
        '<img src="assets/img/novatv/wordmark.svg" alt="NOVA TV" class="nav-wordmark"></a>' +
      '<div class="nav-links">' +
        '<a href="index.html">الرئيسية</a>' +
        '<a href="movies.html">الأفلام</a>' +
        '<a href="series.html">المسلسلات</a>' +
        '<a href="anime.html">الأنمي</a>' +
        '<a href="matches.html">المباريات</a>' +
        '<a href="summaries.html">الملخص وأهداف</a>' +
        '<a href="channels.html">قنوات مباشرة</a>' +
        '<div class="nav-search"><input type="text" id="navSearch" placeholder="ابحث عن فيلم أو مسلسل..." aria-label="بحث"><i class="fas fa-magnifying-glass"></i></div>' +
      '</div>' +
      '<button class="nav-toggle" id="navToggle" aria-label="القائمة" aria-controls="mobileMenu" aria-expanded="false"><span></span><span></span><span></span></button>' +
    '</nav>' +
    '<div class="mobile-menu" id="mobileMenu">' +
      '<a href="index.html">الرئيسية</a>' +
      '<a href="movies.html">الأفلام</a>' +
      '<a href="series.html">المسلسلات</a>' +
      '<a href="anime.html">الأنمي</a>' +
      '<a href="matches.html">المباريات</a>' +
        '<a href="summaries.html">الملخص وأهداف</a>' +
      '<a href="channels.html">قنوات البث المباشر</a>' +
      '<a href="watched.html" class="mm-cta">تم مشاهدته</a>' +
    '</div>';
  }
  function footerHTML() {
    return '<footer class="site-footer">' +
      '<div class="footer-links">' +
        '<div class="footer-col"><h4>الأقسام</h4>' +
          '<a href="movies.html">كل الأفلام</a>' +
          '<a href="series.html">كل المسلسلات</a>' +
          '<a href="anime.html">الأنمي</a>' +
          '<a href="matches.html">مباريات اليوم</a>' +
          '<a href="summaries.html">ملخص وأهداف المباريات</a>' +
          '<a href="channels.html">القنوات المباشرة</a>' +
        '</div>' +
        '<div class="footer-col"><h4>روابط سريعة</h4>' +
          '<a href="index.html">الرئيسية</a>' +
          '<a href="movies.html?sort=rate">الأعلى تقييماً</a>' +
          '<a href="matches.html?day=today">جدول مباريات اليوم</a>' +
          '<a href="watched.html">تم مشاهدته</a>' +
          '<a href="search.html">البحث</a>' +
        '</div>' +
        '<div class="footer-col"><h4>الموقع</h4>' +
          '<a href="about.html">من نحن</a>' +
          '<a href="privacy.html">سياسة الخصوصية</a>' +
          '<a href="terms.html">شروط الاستخدام</a>' +
          '<a href="dmca.html">DMCA</a>' +
          '<a href="disclaimer.html">إخلاء المسؤولية</a>' +
          '<a href="contact.html">اتصل بنا</a>' +
        '</div>' +
        '<div class="footer-col footer-about"><h4>عن NOVA TV</h4>' +
          '<p>NOVA TV منصّتك العربية الأولى للمشاهدة والتحميل المجاني — أفلام ومسلسلات وأنمي ومباريات كورة القدم ببثّ مباشر وقنوات فضائية، بجودات تصل إلى 1080p Full HD، مع ملخصات وأهداف المباريات لحظة بلحظة، وبدون إعلانات مزعجة وبدون تسجيل.</p>' +
        '</div>' +
      '</div>' +
      '<div class="footer-copy">&copy; 2026 NOVA TV &mdash; جميع الحقوق محفوظة &middot; صُنع بحبّ لعشّاق الأفلام والرياضة</div>' +
    '</footer>';
  }
  function renderChrome() {
    $$('.site-nav, .mobile-menu, .header, .site-footer, .footer').forEach(function (el) { el.remove(); });
    var navWrap = document.createElement('div');
    navWrap.innerHTML = navHTML();
    while (navWrap.firstChild) document.body.insertBefore(navWrap.firstChild, document.body.firstChild);
    var footWrap = document.createElement('div');
    footWrap.innerHTML = footerHTML();
    while (footWrap.firstChild) document.body.appendChild(footWrap.firstChild);
    var here = (location.pathname.split('/').pop() || 'index.html');
    $$('.nav-links a, .mobile-menu a').forEach(function (a) { if (a.getAttribute('href') === here) a.classList.add('active'); });
    initHeader();
    initPosterBg();
  }
  function initHeader() {
    var t = $('#navToggle'), m = $('#mobileMenu');
    if (t && m) t.addEventListener('click', function () { m.classList.toggle('open'); t.setAttribute('aria-expanded', m.classList.contains('open')); });
    var s = $('#navSearch');
    if (s) s.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { var q = s.value.trim(); if (q) location.href = 'search.html?q=' + encodeURIComponent(q); }
    });
    window.addEventListener('scroll', function () {
      var n = $('#siteNav'); if (n) n.classList.toggle('scrolled', window.scrollY > 30);
    });
  }
  function initPosterBg() {
    var bg = $('#posterBg'); if (!bg || bg.dataset.done) return;
    bg.dataset.done = '1';
    loadHome().then(function (feed) {
      var items = (feed.movies || []).concat(feed.series || []);
      var picks = [];
      for (var i = 0; i < 8 && items.length; i++) {
        var it = items[Math.floor(Math.random() * items.length)];
        if (it && it.p) picks.push('<img src="' + esc(img(it.p)) + '" alt="" loading="lazy" decoding="async">');
      }
      bg.innerHTML = picks.join('');
    }).catch(function () { });
  }
  function initReveal() {
    var els = $$('.reveal:not(.in)');
    if (!('IntersectionObserver' in window)) { els.forEach(function (e) { e.classList.add('in'); }); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { rootMargin: '80px' });
    els.forEach(function (e) { io.observe(e); });
  }

  /* ---------------------------------------------------------- player */
  /* hls.js is ~400KB and only needed when a stream actually plays, so we
     load it on demand instead of on every page load (big speed win). */
  var _hlsLoading = false, _hlsQueue = [];
  function ensureHls(cb) {
    if (window.Hls) { cb(); return; }
    _hlsQueue.push(cb);
    if (_hlsLoading) return;
    _hlsLoading = true;
    var s = document.createElement('script');
    s.src = 'assets/js/hls.min.js';
    s.onload = function () { var q = _hlsQueue; _hlsQueue = []; q.forEach(function (f) { try { f(); } catch (e) { } }); };
    s.onerror = function () { _hlsLoading = false; var q = _hlsQueue; _hlsQueue = []; q.forEach(function (f) { try { f(); } catch (e) { } }); };
    document.head.appendChild(s);
  }
  function proxied(url, isHls, ua, ref) {
    /* The NOVA TV backend proxies the streams. When the backend serves this
       site it lives on the SAME origin, so API === '' and we use the relative
       /api/hls path. Set window.NOVATV_NO_PROXY = true ONLY when hosting the
       site purely statically (e.g. GitHub Pages) with no backend at all. */
    if (window.NOVATV_NO_PROXY) return url;
    return API + (isHls ? '/api/hls' : '/api/video') + '?' + qs({ url: url, ua: ua || DEFAULT_UA, ref: ref || '' });
  }
  function preconnectHost(url) {
    try {
      var o = new URL(url, location.href).origin;
      if (!o || o === location.origin) return;
      if (document.querySelector('link[rel="preconnect"][href="' + o + '"]')) return;
      var l = document.createElement('link');
      l.rel = 'preconnect'; l.href = o; l.crossOrigin = 'anonymous';
      document.head.appendChild(l);
      var d = document.createElement('link');
      d.rel = 'dns-prefetch'; d.href = o;
      document.head.appendChild(d);
    } catch (e) { }
  }
  function playStream(frame, url, isHls, ua, title, ref, onFatal) {
    if (!frame || !url) { if (onFatal) onFatal(); return; }
    preconnectHost(url);
    if (isHls && !window.Hls) { ensureHls(function () { playStream(frame, url, isHls, ua, title, ref, onFatal); }); return; }
    if (frame._hls) { try { frame._hls.destroy(); } catch (e) { } frame._hls = null; }
    if (frame._watchdog) { clearTimeout(frame._watchdog); frame._watchdog = null; }
    frame.innerHTML = '';
    var v = document.createElement('video');
    v.controls = true; v.autoplay = true; v.playsInline = true; v.setAttribute('playsinline', '');
    v.setAttribute('controlsList', 'nodownload');
    frame.appendChild(v);
    var src = proxied(url, isHls, ua, ref);
    var failed = false;
    function fail() { if (failed) return; failed = true; if (frame._watchdog) { clearTimeout(frame._watchdog); frame._watchdog = null; } if (onFatal) onFatal(); }
    if (isHls && window.Hls && window.Hls.isSupported()) {
      /* lean buffer + short timeouts => channels start noticeably faster */
      var h = new window.Hls({
        maxBufferLength: 10, maxMaxBufferLength: 30, liveDurationInfinity: true,
        manifestLoadingMaxRetry: 1, levelLoadingMaxRetry: 1, fragLoadingMaxRetry: 2,
        manifestLoadingTimeOut: 12000, levelLoadingTimeOut: 12000, fragLoadingTimeOut: 20000,
        startLevel: -1, lowLatencyMode: false
      });
      var started = false;
      frame._watchdog = setTimeout(function () { if (!started) { try { h.destroy(); } catch (e) { } fail(); } }, 16000);
      h.loadSource(src); h.attachMedia(v);
      h.on(window.Hls.Events.MANIFEST_PARSED, function () { started = true; if (frame._watchdog) { clearTimeout(frame._watchdog); frame._watchdog = null; } v.play().catch(function () { }); });
      h.on(window.Hls.Events.ERROR, function (e, data) {
        if (!data || !data.fatal) return;
        if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) { try { h.startLoad(); return; } catch (x) { } }
        if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) { try { h.recoverMediaError(); return; } catch (x) { } }
        fail();
      });
      frame._hls = h;
    } else {
      v.src = src;
      v.addEventListener('error', fail);
      v.play().catch(function () { });
    }
  }
  function playerNote(icon, text) {
    return '<div class="player-note"><i class="fas ' + icon + '"></i><span>' + esc(text) + '</span></div>';
  }

  /* ---------------------------------------------------------- home */
  function rowHTML(row) {
    return '<section class="content-section" style="padding:26px 0"' + (row.id ? ' id="' + row.id + '"' : '') + '>' +
      '<div class="section-head">' +
        '<h2 class="section-title" style="font-size:1.35rem;margin:0">' + esc(row.title) + '</h2>' +
        (row.head || '') +
        '<a class="see-all" href="' + row.link + '">عرض الكل <i class="fas fa-chevron-left"></i></a>' +
      '</div>' +
      '<div class="grid"' + (row.gridId ? ' id="' + row.gridId + '"' : '') + '>' + gridHTML(row.items, row.kind) + '</div>' +
    '</section>';
  }
  var ORIGIN_FILTERS = ['الكل', 'عربي', 'أجنبي', 'هندي', 'كوري', 'تركي', 'ياباني', 'صيني', 'مدبلج', 'مترجم'];
  function originMatch(it, label) {
    if (label === 'الكل' || !label) return true;
    if (label === 'مدبلج') return isDubbed(it);
    if (label === 'مترجم') return isSubtitled(it);
    return originOf(it) === label;
  }
  function initHome() {
    /* NOVA TV homepage is a static professional landing page — no dynamic rows. */
    var root = $('#homeRoot');
    if (!root) return;
  }

  /* featured rows shown on the browse pages (movies / series / anime) */
  function initPageFeatured(kind) {
    /* Round 3: the "أحدث الأفلام" / "الأعلى تقييماً" rows were removed per request.
       Browse pages now show only the filtered grid with origin-based categories. */
    return;
  }

  /* ---------------------------------------------------------- list */
  function initList(kind) {
    var grid = $('#listGrid'); if (!grid) return;
    loadCatalog(kind).then(function (all) {
      var filterEl = $('#filterSelect'), pagerEl = $('#pagination'), sortEl = $('#sortSelect'), searchEl = $('#listSearch');
      var state = { page: 1, filter: '', sort: 'new', q: '' };

      function renderFilter() {
        if (!filterEl) return;
        var originOpts = ORIGIN_FILTERS.filter(function (o) { return o !== 'الكل'; })
          .map(function (o) { return '<option value="origin:' + esc(o) + '">' + esc(o) + '</option>'; }).join('');
        filterEl.innerHTML = '<option value="">كل الأقسام</option>' +
          '<optgroup label="النوع">' + originOpts + '</optgroup>';
        filterEl.value = state.filter || '';
      }
      function filtered() {
        var arr = all;
        var f = state.filter || '';
        if (f.indexOf('origin:') === 0) { var ov = f.slice(7); arr = arr.filter(function (it) { return originMatch(it, ov); }); }
        if (state.q) { var q = state.q.toLowerCase(); arr = arr.filter(function (it) { return ((it.t || '') + ' ' + (it.te || '')).toLowerCase().indexOf(q) >= 0; }); }
        arr = arr.slice();
        if (state.sort === 'new') arr.sort(function (a, b) { return (b.y || 0) - (a.y || 0); });
        else if (state.sort === 'old') arr.sort(function (a, b) { return (a.y || 0) - (b.y || 0); });
        else if (state.sort === 'rate') arr.sort(function (a, b) { return (parseFloat(b.r) || 0) - (parseFloat(a.r) || 0); });
        return arr;
      }
      function render() {
        var arr = filtered();
        var pages = Math.max(1, Math.ceil(arr.length / PER_PAGE));
        if (state.page > pages) state.page = pages;
        var slice = arr.slice((state.page - 1) * PER_PAGE, state.page * PER_PAGE);
        grid.innerHTML = slice.length ? gridHTML(slice, kind) : '<div class="empty"><i class="fas fa-film"></i><p>لا توجد نتائج مطابقة</p></div>';
        if (pagerEl) {
          pagerEl.innerHTML = pagerHTML(state.page, pages);
          $$('.page-btn[data-page]', pagerEl).forEach(function (b) {
            b.addEventListener('click', function () { state.page = +b.dataset.page; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
          });
        }
        initReveal();
      }
      if (sortEl) sortEl.addEventListener('change', function () { state.sort = sortEl.value; state.page = 1; render(); });
      if (filterEl) filterEl.addEventListener('change', function () { state.filter = filterEl.value; state.page = 1; render(); });
      if (searchEl) { var t; searchEl.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { state.q = searchEl.value.trim(); state.page = 1; render(); }, 250); }); }
      var p = new URLSearchParams(location.search);
      if (p.get('genre')) state.filter = 'genre:' + p.get('genre');
      if (p.get('origin')) state.filter = 'origin:' + p.get('origin');
      if (p.get('sort')) { state.sort = p.get('sort'); if (sortEl) sortEl.value = state.sort; }
      renderFilter();
      render();
    }).catch(function () { grid.innerHTML = loadFailHTML('تعذّر تحميل المحتوى'); });
  }

  /* ---------------------------------------------------------- channels */
  function channelCard(c) {
    var name = c.t || '';
    var cat = c.catl || c.cat || '';
    var flag = c.fl || '';
    var initials = (name || '?').trim().slice(0, 2);
    return '<div class="channel-card reveal" data-id="' + esc(c.id) + '">' +
      '<div class="ch-logo"><span class="ch-fallback">' + esc(initials) + '</span>' +
        '<img src="' + esc(img(c.p)) + '" alt="' + esc(name) + '" loading="lazy" onerror="this.style.display=\'none\'">' +
        '<span class="ch-live"><i class="fas fa-circle"></i></span></div>' +
      '<div class="ch-body"><div class="ch-name">' + esc(name) + '</div>' +
        '<div class="ch-meta">' + (cat ? '<span class="ch-cat">' + esc(cat) + '</span>' : '') + (flag ? '<span>' + esc(flag) + '</span>' : '') + '</div></div>' +
    '</div>';
  }
  function openChannel(id) {
    var frame = $('#channelPlayerFrame'), titleEl = $('#channelPlayerTitle'), listEl = $('#channelServers');
    if (!frame) return;
    if (listEl) listEl.innerHTML = '';
    frame.innerHTML = playerNote('fa-spinner fa-spin', 'جارٍ تحميل البث…');
    api('/api/oscar/channel', { id: id }).then(function (j) {
      var d = unwrap(j);
      var streams = ((d && d.streams) || []).slice().sort(function (a, b) { return qualRank(b.quality) - qualRank(a.quality); });
      if (!streams.length) { frame.innerHTML = playerNote('fa-triangle-exclamation', 'لا يوجد بث متاح لهذه القناة حالياً'); return; }
      /* warm up the connection to the CDN so the first segment arrives faster */
      streams.slice(0, 3).forEach(function (s) { preconnectHost(s.stream_url); });
      if (titleEl) titleEl.innerHTML = '<i class="fas fa-tv"></i> ' + esc(d.name || '');
      function attempt(i) {
        if (i >= streams.length) { frame.innerHTML = playerNote('fa-triangle-exclamation', 'تعذّر تشغيل هذه القناة — جرّب قناة أخرى'); return; }
        var s = streams[i];
        frame.innerHTML = playerNote('fa-spinner fa-spin', 'جارٍ تشغيل ' + esc(s.quality || 'البث') + '…');
        playStream(frame, s.stream_url, true, uaOf(s.deep_link), d.name, '', function () { attempt(i + 1); });
        if (listEl) {
          listEl.innerHTML = '<div class="ch-servers-title"><i class="fas fa-server"></i> سيرفرات القناة</div><div class="qual-row">' +
            streams.map(function (x, k) {
              return '<button class="qual-btn ch-q' + (k === i ? ' active' : '') + '" data-i="' + k + '"><i class="fas fa-play"></i> ' + esc(x.quality || ('سيرفر ' + (k + 1))) + '</button>';
            }).join('') + '</div>';
          $$('.ch-q', listEl).forEach(function (b) {
            b.addEventListener('click', function () { attempt(+b.dataset.i); });
          });
        }
      }
      attempt(0);
      var wrap = $('#channelPlayer'); if (wrap) wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }).catch(function () { frame.innerHTML = playerNote('fa-triangle-exclamation', 'تعذّر تشغيل القناة'); });
  }
  function initChannels() {
    var grid = $('#channelGrid'); if (!grid) return;
    loadCatalog('channels').then(function (all) {
      var filterEl = $('#channelFilter'), pagerEl = $('#channelPagination'), searchEl = $('#channelSearch');
      var PER = 40;
      var cc = {};
      all.forEach(function (c) { var k = c.catl || c.cat || 'أخرى'; cc[k] = (cc[k] || 0) + 1; });
      var cats = Object.keys(cc).sort(function (a, b) { return cc[b] - cc[a]; });
      var state = { page: 1, cat: '', q: '' };
      function renderFilter() {
        if (!filterEl) return;
        filterEl.innerHTML = '<option value="">كل الأقسام</option>' +
          cats.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
        filterEl.value = state.cat || '';
      }
      function filtered() {
        var arr = all;
        if (state.cat) arr = arr.filter(function (c) { return (c.catl || c.cat || 'أخرى') === state.cat; });
        if (state.q) { var q = state.q.toLowerCase(); arr = arr.filter(function (c) { return (c.t || '').toLowerCase().indexOf(q) >= 0; }); }
        return arr;
      }
      function render() {
        var arr = filtered();
        var pages = Math.max(1, Math.ceil(arr.length / PER));
        if (state.page > pages) state.page = pages;
        var slice = arr.slice((state.page - 1) * PER, state.page * PER);
        grid.innerHTML = slice.length ? slice.map(channelCard).join('') : '<div class="empty"><i class="fas fa-tv"></i><p>لا توجد قنوات مطابقة</p></div>';
        if (pagerEl) {
          pagerEl.innerHTML = pagerHTML(state.page, pages);
          $$('.page-btn[data-page]', pagerEl).forEach(function (b) {
            b.addEventListener('click', function () { state.page = +b.dataset.page; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
          });
        }
        $$('.channel-card', grid).forEach(function (card) {
          card.addEventListener('click', function () { openChannel(card.dataset.id); });
        });
        initReveal();
      }
      if (searchEl) { var t; searchEl.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { state.q = searchEl.value.trim(); state.page = 1; render(); }, 250); }); }
      if (filterEl) filterEl.addEventListener('change', function () { state.cat = filterEl.value; state.page = 1; render(); });
      var p = new URLSearchParams(location.search);
      if (p.get('cat')) state.cat = p.get('cat');
      renderFilter();
      render();
      if (p.get('open')) setTimeout(function () { openChannel(p.get('open')); }, 350);
    }).catch(function () { grid.innerHTML = '<div class="empty"><i class="fas fa-triangle-exclamation"></i><p>تعذّر تحميل القنوات</p></div>'; });
  }

  /* ---------------------------------------------------------- matches */
  function matchCardHTML(m) {
    var ht = m.home_team || {}, at = m.away_team || {};
    var live = String(m.status || '').toUpperCase();
    var isLive = live === 'LIVE' || live === '1H' || live === '2H' || live === 'HT' || live === 'ET' || live === 'P';
    var done = live === 'FT' || live === 'AET' || live === 'PEN';
    var score = (m.home_goals != null && m.away_goals != null && (isLive || done))
      ? '<div class="mc-score">' + m.home_goals + ' - ' + m.away_goals + '</div>'
      : '<div class="mc-score vs">VS</div>';
    var statusTxt = isLive ? '<span class="mc-status live"><span class="live-dot"></span> مباشر ' + (m.elapsed ? m.elapsed + "'" : '') + '</span>'
      : done ? '<span class="mc-status done">انتهت</span>'
        : '<span class="mc-status">' + esc(m.match_time || '') + '</span>';
    var chans = (m.channels || []).slice(0, 4).map(function (c) {
      return '<span class="mc-chan"><i class="fas fa-tv"></i> ' + esc(c.channel_name || '') + '</span>';
    }).join('');
    return '<a class="match-card' + (isLive ? ' is-live' : '') + '" href="match-detail.html?id=' + esc(m.id) + '">' +
      '<div class="mc-head"><span>' + statusTxt + '</span><span class="mc-round">' + (m.round ? 'الجولة ' + esc(m.round) : '') + '</span></div>' +
      '<div class="mc-body">' +
        '<div class="team"><img src="' + esc(ht.logo || '') + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'"><span>' + esc(ht.name || '') + '</span></div>' +
        score +
        '<div class="team"><img src="' + esc(at.logo || '') + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'"><span>' + esc(at.name || '') + '</span></div>' +
      '</div>' +
      (chans ? '<div class="mc-chans">' + chans + '</div>' : '') +
    '</a>';
  }
  function dayKey(offset) {
    var d = new Date(); d.setDate(d.getDate() + offset);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  /* Static matches snapshot (built by backend/build_matches_snapshot.py).
     Lets the matches page + homepage tab work on STATIC hosting with no backend. */
  var _matchesSnap = null;
  function loadMatchesSnapshot() {
    if (_matchesSnap) return Promise.resolve(_matchesSnap);
    return fetch('data/matches.json', { cache: 'force-cache' })
      .then(function (r) { return r.json(); })
      .then(function (j) { _matchesSnap = j || {}; return _matchesSnap; });
  }
  function snapshotLeaguesFor(key) {
    return loadMatchesSnapshot().then(function (s) {
      return (s && s.days && s.days[key] && s.days[key].leagues) || [];
    });
  }
  /* Full per-match details (channels + streams, events, lineups, stats)
     bundled by backend/build_matches_snapshot.py so the match page works
     on STATIC hosting with no backend. */
  var _matchDetailsSnap = null;
  function loadMatchDetailsSnapshot() {
    if (_matchDetailsSnap) return Promise.resolve(_matchDetailsSnap);
    return fetch('data/match_details.json', { cache: 'force-cache' })
      .then(function (r) { return r.json(); })
      .then(function (j) { _matchDetailsSnap = (j && j.details) || {}; return _matchDetailsSnap; });
  }
  function snapshotMatchDetail(id) {
    return loadMatchDetailsSnapshot().then(function (d) {
      var m = d && d[String(id)];
      if (m && m.id) return m;
      /* last resort: the light list entry (no streams) so the page still renders */
      return loadMatchesSnapshot().then(function (s) {
        var found = null, days = (s && s.days) || {};
        Object.keys(days).forEach(function (k) {
          ((days[k] && days[k].leagues) || []).forEach(function (l) {
            (l.matches || []).forEach(function (mm) {
              if (String(mm.id) === String(id)) {
                found = mm;
                found.league_name = found.league_name || l.league_name;
                found.league_logo = found.league_logo || l.league_logo;
              }
            });
          });
        });
        return found;
      });
    });
  }
  function initMatches() {
    var root = $('#matchesRoot'); if (!root) return;
    var tabsEl = $('#matchDayTabs');
    var days = [{ k: 'yesterday', o: -1, label: 'الأمس' }, { k: 'today', o: 0, label: 'اليوم' }, { k: 'tomorrow', o: 1, label: 'الغد' }];
    var cur = 'today';
    var reqId = 0;
    function renderTabs() {
      if (!tabsEl) return;
      tabsEl.innerHTML = days.map(function (d) {
        return '<button class="tab' + (d.k === cur ? ' active' : '') + '" data-k="' + d.k + '">' + d.label + '</button>';
      }).join('');
      $$('.tab', tabsEl).forEach(function (b) { b.addEventListener('click', function () { cur = b.dataset.k; renderTabs(); load(); }); });
    }
    function paint(leagues) {
      var total = (leagues || []).reduce(function (s, l) { return s + ((l.matches || []).length); }, 0);
      if (!total) return false;
      root.innerHTML = leagues.map(function (l) {
        if (!l.matches || !l.matches.length) return '';
        return '<div class="league-block">' +
          '<div class="league-head">' + (l.league_logo ? '<img src="' + esc(l.league_logo) + '" alt="" onerror="this.style.display=\'none\'">' : '') +
            '<h2>' + esc(l.league_name || '') + '</h2><span class="league-count">' + l.matches.length + ' مباراة</span></div>' +
          '<div class="match-grid">' + l.matches.map(matchCardHTML).join('') + '</div>' +
        '</div>';
      }).join('');
      initReveal();
      return true;
    }
    function load(silent) {
      var my = ++reqId;
      var day = days.filter(function (d) { return d.k === cur; })[0] || days[1];
      var key = dayKey(day.o);
      if (!silent) root.innerHTML = '<div class="empty"><i class="fas fa-spinner fa-spin"></i><p>جارٍ تحميل المباريات…</p></div>';
      /* 1) instant paint from the bundled static snapshot (works with no backend) */
      snapshotLeaguesFor(key).then(function (leagues) {
        if (my !== reqId) return;
        if (paint(leagues)) { refresh(my, key, false); return; }
        refresh(my, key, true);
      }).catch(function () { if (my === reqId) refresh(my, key, true); });
    }
    function refresh(my, key, showEmpty) {
      /* 2) silent live refresh when a backend is available */
      api('/api/oscar/matches', { date: key }).then(function (j) {
        if (my !== reqId) return;
        var d = unwrap(j);
        if (paint((d && d.leagues) || [])) return;
        if (showEmpty) root.innerHTML = '<div class="empty"><i class="fas fa-futbol"></i><p>لا توجد مباريات في هذا اليوم</p></div>';
      }).catch(function () {
        if (my !== reqId) return;
        /* no backend (static hosting): keep the snapshot; only show empty if it had nothing */
        if (showEmpty && !paint((_matchesSnap && _matchesSnap.days && _matchesSnap.days[key] && _matchesSnap.days[key].leagues) || [])) {
          root.innerHTML = '<div class="empty"><i class="fas fa-futbol"></i><p>لا توجد مباريات في هذا اليوم</p></div>';
        }
      });
    }
    var p = new URLSearchParams(location.search);
    if (p.get('day')) cur = p.get('day');
    renderTabs();
    load();
    setInterval(function () { if (!document.hidden) load(true); }, 30000);  // live auto-update
  }

  /* ---------------------------------------------------------- detail */
  function genrePills(d) {
    var g = genresOf(d);
    if (!g.length) return '';
    return '<div class="detail-genres">' + g.map(function (x) { return '<a class="chip" href="javascript:void(0)">' + esc(x) + '</a>'; }).join('') + '</div>';
  }
  function metaPills(d, kind) {
    var pills = [];
    var r = ratingStr(d.rating); if (r) pills.push('<span class="pill gold"><i class="fas fa-star"></i> ' + r + '</span>');
    var y = d.release_year || d.year; if (y) pills.push('<span class="pill">' + esc(y) + '</span>');
    if (d.runtime) pills.push('<span class="pill"><i class="fas fa-clock"></i> ' + esc(fmtRuntime(d.runtime)) + '</span>');
    if (d.content_type_label || d.content_type) pills.push('<span class="pill">' + esc(d.content_type_label || d.content_type) + '</span>');
    if (d.age_rating) pills.push('<span class="pill">' + esc(d.age_rating) + '</span>');
    if (d.country_name || d.country) pills.push('<span class="pill">' + esc(d.country_name || d.country) + '</span>');
    var ec = d.episode_count || d.episodes_count; if (ec) pills.push('<span class="pill">' + esc(ec) + ' حلقة</span>');
    if (d.status) pills.push('<span class="pill">' + esc(statusLabel(d.status)) + '</span>');
    return pills.join('');
  }
  function actorsHTML(actors) {
    if (!actors || !actors.length) return '';
    return '<div class="cast-grid">' + actors.map(function (a) {
      return '<div class="cast-card">' +
        '<div class="cast-photo"><img src="' + esc(img(a.photo)) + '" alt="' + esc(a.name) + '" loading="lazy" onerror="this.style.display=\'none\'"></div>' +
        '<div class="cast-name">' + esc(a.name) + '</div>' +
        (a.role_name ? '<div class="cast-role">' + esc(a.role_name) + '</div>' : '') +
      '</div>';
    }).join('') + '</div>';
  }
  function serverBlockHTML(links, isDownload) {
    if (!links || !links.length) return '<div class="qual-loading">لا توجد سيرفرات متاحة حالياً.</div>';
    var groups = {}, order = [];
    links.forEach(function (l) { var k = l.server_name || 'سيرفر'; if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(l); });
    return order.map(function (name) {
      var arr = groups[name].slice().sort(function (a, b) { return qualRank(b.quality) - qualRank(a.quality); });
      var btns = arr.map(function (l) {
        var q = l.quality || (isDownload ? 'تحميل' : 'مشاهدة');
        var size = l.file_size ? ' · ' + l.file_size : '';
        var hls = (l.is_hls ? 1 : (isHlsUrl(l.url) ? 1 : 0));
        return '<button class="qual-btn' + (isDownload ? ' dl' : '') + '" data-url="' + esc(l.url) + '" data-ua="' + esc(uaOf(l.deep_link)) + '" data-hls="' + hls + '" data-quality="' + esc(l.quality || '') + '" data-title="' + esc(name) + '">' +
          '<i class="fas ' + (isDownload ? 'fa-download' : 'fa-play') + '"></i> ' + esc(q) + esc(size) + '</button>';
      }).join('');
      return '<div class="server-block"><h3><i class="fas fa-server"></i> ' + esc(name) + '</h3><div class="qual-row">' + btns + '</div></div>';
    }).join('');
  }
  /* floating quality selector over the player (visitor picks 1080p/720p/480p/360p…) */
  function showQualityMenu(frame, container, item, kind, curBtn) {
    if (!frame) return;
    var sb = curBtn && curBtn.closest ? curBtn.closest('.server-block') : null;
    var h = sb ? $('h3', sb) : null;
    var serverName = h ? h.textContent.replace(/^\s+/, '').trim() : '';
    var btns = $$('.qual-btn:not(.dl)', container);
    if (btns.length < 2) { var ex = $('.player-quality', frame); if (ex) ex.remove(); return; }
    var menu = $('.player-quality', frame);
    if (!menu) { menu = document.createElement('div'); menu.className = 'player-quality'; frame.appendChild(menu); }
    var curQ = curBtn ? (curBtn.dataset.quality || '') : '';
    var map = {}, order = [];
    btns.forEach(function (b) {
      var q = b.dataset.quality || 'تلقائي';
      if (!map[q]) { map[q] = []; order.push(q); }
      map[q].push(b);
    });
    order.sort(function (a, b) { return qualRank(b) - qualRank(a); });
    menu.innerHTML = '<button type="button" class="pq-toggle"><i class="fas fa-gauge-high"></i> الجودة: <b>' + esc(curQ || 'تلقائي') + '</b> <i class="fas fa-chevron-down"></i></button>' +
      '<div class="pq-list">' + order.map(function (q) {
        return '<button type="button" class="pq-opt' + (q === curQ ? ' active' : '') + '" data-q="' + esc(q) + '">' +
          '<span>' + esc(q) + '</span>' + (qualRank(q) >= 3 ? '<span class="pq-hd">HD</span>' : '') + '</button>';
      }).join('') + '</div>';
    $('.pq-toggle', menu).addEventListener('click', function (e) { e.stopPropagation(); menu.classList.toggle('open'); });
    $$('.pq-opt', menu).forEach(function (o) {
      o.addEventListener('click', function (e) {
        e.stopPropagation();
        var cands = map[o.dataset.q] || [];
        var target = cands.filter(function (b) {
          var s = b.closest ? b.closest('.server-block') : null;
          var hh = s ? $('h3', s) : null;
          return hh && hh.textContent.replace(/^\s+/, '').trim() === serverName;
        })[0] || cands[0];
        if (target) target.click();
        menu.classList.remove('open');
      });
    });
    if (!menu._wired) {
      menu._wired = true;
      document.addEventListener('click', function () { menu.classList.remove('open'); });
    }
  }
  function wireServers(container, frame, item, kind) {
    if (!container) return;
    $$('.qual-btn', container).forEach(function (b) {
      b.addEventListener('click', function () {
        var url = b.dataset.url, ua = b.dataset.ua, hls = b.dataset.hls === '1';
        $$('.qual-btn:not(.dl)', container).forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        var wrap = $('#playerWrap'); if (wrap) wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
        playStream(frame, url, hls, ua, b.dataset.title);
        markWatched({ id: item.id, t: item.t || item.title_ar, p: item.p || item.poster, y: item.y || item.release_year, kind: kind });
        showQualityMenu(frame, container, item, kind, b);
      });
    });
  }
  function renderMovieDetail(root, kind, d) {
    var title = d.title_ar || d.title_en || d.original_title || '';
    var poster = img(d.poster || d.p);
    var story = d.story || d.story_en || d.tagline || '';
    var html =
      '<div class="breadcrumb"><a href="index.html">الرئيسية</a><i class="fas fa-chevron-left"></i>' +
        '<a href="' + (kind === 'series' ? 'series.html' : 'movies.html') + '">' + (kind === 'series' ? 'المسلسلات' : 'الأفلام') + '</a>' +
        '<i class="fas fa-chevron-left"></i><span>' + esc(title) + '</span></div>' +
      '<div class="detail-hero">' +
        '<div class="detail-poster"><img src="' + esc(poster) + '" alt="' + esc(title) + '" onerror="this.onerror=null;this.src=\'assets/img/placeholder.svg\'"></div>' +
        '<div class="detail-info">' +
          '<h1>' + esc(title) + '</h1>' +
          '<div class="detail-meta">' + metaPills(d, kind) + '</div>' +
          genrePills(d) +
          '<div class="detail-desc">' + esc(story) + '</div>' +
          '<div class="detail-actions">' +
            (d.trailer_url ? '<a class="btn btn-secondary" href="' + esc(d.trailer_url) + '" target="_blank" rel="noopener"><i class="fas fa-clapperboard"></i> الإعلان</a>' : '') +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="section-head" style="margin-top:26px"><h2 class="section-title" style="font-size:1.2rem;margin:0"><i class="fas fa-play"></i> سيرفرات المشاهدة</h2></div>' +
      '<div id="watchBlock">' + serverBlockHTML(d.watch_links, false) + '</div>' +
      '<div class="player-wrap" id="playerWrap">' + playerNote('fa-circle-play', 'اختر سيرفراً للمشاهدة') + '</div>' +
      (d.actors && d.actors.length ? '<div class="section-head" style="margin-top:30px"><h2 class="section-title" style="font-size:1.2rem;margin:0"><i class="fas fa-users"></i> الممثلون</h2></div>' + actorsHTML(d.actors) : '');
    root.innerHTML = html;
    var frame = $('#playerWrap');
    wireServers($('#watchBlock'), frame, d, kind);
    initReveal();
  }
  function renderSeriesDetail(root, kind, d) {
    var title = d.title_ar || d.title_en || d.title_jp || '';
    var poster = img(d.poster || d.p);
    var story = d.story || d.tagline || '';
    var seasons = d.seasons || [];
    var html =
      '<div class="breadcrumb"><a href="index.html">الرئيسية</a><i class="fas fa-chevron-left"></i>' +
        '<a href="' + (kind === 'anime' ? 'anime.html' : 'series.html') + '">' + (kind === 'anime' ? 'الأنمي' : 'المسلسلات') + '</a>' +
        '<i class="fas fa-chevron-left"></i><span>' + esc(title) + '</span></div>' +
      '<div class="detail-hero">' +
        '<div class="detail-poster"><img src="' + esc(poster) + '" alt="' + esc(title) + '" onerror="this.onerror=null;this.src=\'assets/img/placeholder.svg\'"></div>' +
        '<div class="detail-info">' +
          '<h1>' + esc(title) + '</h1>' +
          '<div class="detail-meta">' + metaPills(d, kind) + '</div>' +
          genrePills(d) +
          '<div class="detail-desc">' + esc(story) + '</div>' +
          (d.trailer_url ? '<div class="detail-actions"><a class="btn btn-secondary" href="' + esc(d.trailer_url) + '" target="_blank" rel="noopener"><i class="fas fa-clapperboard"></i> الإعلان</a></div>' : '') +
        '</div>' +
      '</div>' +
      '<div class="section-head" style="margin-top:26px"><h2 class="section-title" style="font-size:1.2rem;margin:0"><i class="fas fa-layer-group"></i> المواسم والحلقات</h2></div>' +
      '<div class="tabs" id="seasonTabs"></div>' +
      '<div class="ep-grid" id="epGrid"></div>' +
      '<div id="epWatchTop" style="margin-top:26px"></div>' +
      '<div class="player-wrap" id="playerWrap">' + playerNote('fa-circle-play', 'اختر حلقة للمشاهدة') + '</div>' +
      (d.actors && d.actors.length ? '<div class="section-head" style="margin-top:30px"><h2 class="section-title" style="font-size:1.2rem;margin:0"><i class="fas fa-users"></i> الممثلون</h2></div>' + actorsHTML(d.actors) : '');
    root.innerHTML = html;

    var frame = $('#playerWrap'), tabsEl = $('#seasonTabs'), epGrid = $('#epGrid'), epWatchTop = $('#epWatchTop');
    var curSeason = seasons[0];

    function renderSeasonTabs() {
      if (!seasons.length) {
        tabsEl.innerHTML = '';
        epGrid.innerHTML = '<div class="qual-loading">لا توجد مواسم متاحة.</div>';
        return;
      }
      tabsEl.innerHTML = seasons.map(function (s, i) {
        return '<button class="tab' + (s === curSeason ? ' active' : '') + '" data-i="' + i + '">الموسم ' + esc(s.season_number || (i + 1)) + '</button>';
      }).join('');
      $$('.tab', tabsEl).forEach(function (b) {
        b.addEventListener('click', function () { curSeason = seasons[+b.dataset.i]; renderSeasonTabs(); loadEpisodes(); });
      });
    }
    function loadEpisodes() {
      frame.innerHTML = playerNote('fa-circle-play', 'اختر حلقة للمشاهدة');
      if (!curSeason) return;
      epGrid.innerHTML = '<div class="qual-loading">جارٍ تحميل الحلقات…</div>';
      var path = kind === 'anime' ? '/api/oscar/anime-episodes' : '/api/oscar/episodes';
      api(path, { season_id: curSeason.id }).then(function (j) {
        var d2 = unwrap(j);
        var eps = Array.isArray(d2) ? d2 : (d2 && (d2.items || d2.episodes || d2.data)) || [];
        if (!eps.length) { epGrid.innerHTML = '<div class="qual-loading">لا توجد حلقات متاحة.</div>'; return; }
        eps.sort(function (a, b) { return (a.episode_number || 0) - (b.episode_number || 0); });
        epGrid.innerHTML = eps.map(function (e) {
          return '<button class="ep-btn" data-id="' + esc(e.id) + '" title="\u0627\u0636\u063a\u0637 \u0644\u0644\u062a\u0634\u063a\u064a\u0644"><i class="fas fa-play"></i> ' + esc(e.episode_number || '') + '</button>';
        }).join('');
        $$('.ep-btn', epGrid).forEach(function (b) {
          b.addEventListener('click', function () {
            $$('.ep-btn', epGrid).forEach(function (x) { x.classList.remove('active'); });
            b.classList.add('active');
            loadEpisode(b.dataset.id);
          });
        });
      }).catch(function () { epGrid.innerHTML = '<div class="qual-loading">تعذّر تحميل الحلقات.</div>'; });
    }
    function loadEpisode(epId) {
      epWatchTop.innerHTML = '<div class="qual-loading">جارٍ تحميل سيرفرات المشاهدة…</div>';
      var path = kind === 'anime' ? '/api/oscar/anime-episode' : '/api/oscar/episode';
      api(path, { id: epId }).then(function (j) {
        var e = unwrap(j);
        var epNo = e.episode_number ? ' — الحلقة ' + e.episode_number : '';
        var head = '<div class="section-head" style="margin-bottom:14px"><h2 class="section-title" style="font-size:1.1rem;margin:0"><i class="fas fa-play"></i> سيرفرات المشاهدة' + esc(epNo) + '</h2></div>';
        epWatchTop.innerHTML = head + '<div id="epWatch">' + serverBlockHTML(e.watch_links, false) + '</div>';
        wireServers($('#epWatch'), frame, { id: d.id, t: d.title_ar, p: d.poster, y: d.release_year, kind: kind }, kind);
        var first = $('#epWatch .qual-btn:not(.dl)');
        if (first) first.click();
      }).catch(function () {
        epWatchTop.innerHTML = '<div class="qual-loading">تعذّر تحميل سيرفرات التشغيل. تأكد من تشغيل الخادم (node server.js).</div>';
      });
    }
    renderSeasonTabs();
    loadEpisodes();
    initReveal();
  }
  function initDetail() {
    var root = $('#detailRoot'); if (!root) return;
    var p = new URLSearchParams(location.search);
    var kind = p.get('kind') || 'movies';
    var id = p.get('id');
    if (!id) { root.innerHTML = '<div class="empty"><i class="fas fa-triangle-exclamation"></i><p>\u0644\u0627 \u064a\u0648\u062c\u062f \u0645\u062d\u062a\u0648\u0649 \u0645\u062d\u062f\u062f</p></div>'; return; }
    root.innerHTML = '<div class="empty"><i class="fas fa-spinner fa-spin"></i><p>\u062c\u0627\u0631\u064d \u0627\u0644\u062a\u062d\u0645\u064a\u0644\u2026</p></div>';
    var map = { movies: '/api/oscar/movie', series: '/api/oscar/series-detail', anime: '/api/oscar/anime-detail' };
    function paint(d) {
      document.title = (d.title_ar || d.title_en || 'NOVA TV') + ' \u2014 NOVA TV';
      if (kind === 'movies') renderMovieDetail(root, kind, d);
      else renderSeriesDetail(root, kind, d);
    }
    function fail() { root.innerHTML = '<div class="empty"><i class="fas fa-triangle-exclamation"></i><p>\u062a\u0639\u0630\u0651\u0631 \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a</p></div>'; }
    api(map[kind] || map.movies, { id: id }).then(function (j) {
      var d = unwrap(j);
      if (!d || !d.id) throw new Error('empty');
      paint(d);
    }).catch(function () {
      /* static hosting / backend offline: build a page from the bundled catalog */
      snapshotDetail(kind, id).then(function (d) {
        if (!d || !d.id) { fail(); return; }
        paint(d);
      }).catch(fail);
    });
  }
  /* fallback detail object from the bundled catalog (no live servers) */
  function snapshotDetail(kind, id) {
    return loadCatalog(kind).then(function (all) {
      var it = null;
      for (var i = 0; i < all.length; i++) { if (String(all[i].id) === String(id)) { it = all[i]; break; } }
      if (!it) return null;
      return {
        id: it.id, title_ar: it.t, title_en: it.te, title_jp: it.tj,
        poster: it.p, backdrop: it.b, rating: it.r, release_year: it.y,
        country: it.c, g: it.g, content_type_label: KIND_LABEL[kind] || '',
        episode_count: it.ec || it.ecount || '',
        tagline: it.tg || '',
        story: buildStory(it, kind),
        watch_links: []
      };
    });
  }


  /* ---------------------------------------------------------- match detail */
  function emptyBox(icon, text) {
    return '<div class="empty"><i class="fas ' + icon + '"></i><p>' + esc(text) + '</p></div>';
  }
  function matchStatusLabel(m) {
    var s = String(m.status || '').toUpperCase();
    var map = {
      LIVE: 'مباشر الآن', '1H': 'الشوط الأول', HT: 'بين الشوطين', '2H': 'الشوط الثاني',
      ET: 'الوقت الإضافي', P: 'ركلات الترجيح', FT: 'انتهت', AET: 'انتهت (و.إ)',
      PEN: 'انتهت (ر.ت)', NS: 'لم تبدأ', PST: 'مؤجلة', CANC: 'ملغاة', SUSP: 'موقوفة', TBD: 'تُحدَّد لاحقاً'
    };
    return map[s] || (m.status || '');
  }
  function eventIcon(type, detail) {
    var t = String(type || '').toLowerCase(), d = String(detail || '');
    if (t.indexOf('goal') >= 0) return { i: 'fa-futbol', c: 'ev-goal' };
    if (t.indexOf('card') >= 0) return { i: 'fa-square', c: (d.indexOf('أحمر') >= 0 || d.toLowerCase().indexOf('red') >= 0) ? 'ev-red' : 'ev-yellow' };
    if (t.indexOf('subst') >= 0) return { i: 'fa-right-left', c: 'ev-sub' };
    if (t.indexOf('var') >= 0) return { i: 'fa-video', c: 'ev-var' };
    return { i: 'fa-circle-dot', c: 'ev-other' };
  }
  function matchEventsHTML(m) {
    var ev = (m.events || []).slice().sort(function (a, b) { return (a.time || 0) - (b.time || 0); });
    if (!ev.length) return emptyBox('fa-list', 'لا توجد أحداث متاحة لهذه المباراة');
    return '<div class="ev-list">' + ev.map(function (e) {
      var ic = eventIcon(e.type, e.detail);
      var side = e.team_side === 'away' ? 'away' : 'home';
      var min = (e.time != null) ? (e.time + (e.time_extra ? '+' + e.time_extra : '') + "'") : '';
      return '<div class="ev-row ' + side + '">' +
        '<div class="ev-min">' + esc(min) + '</div>' +
        '<div class="ev-icon ' + ic.c + '"><i class="fas ' + ic.i + '"></i></div>' +
        '<div class="ev-main"><div class="ev-player">' + esc(e.player || '') +
          (e.assist ? ' <span class="ev-assist">(صناعة: ' + esc(e.assist) + ')</span>' : '') + '</div>' +
          '<div class="ev-meta">' + esc(e.detail || e.type || '') + (e.team ? ' · ' + esc(e.team) : '') + '</div></div>' +
      '</div>';
    }).join('') + '</div>';
  }
  function matchStatsHTML(m) {
    var st = m.statistics || [];
    if (!st.length) return emptyBox('fa-chart-simple', 'لا توجد إحصائيات متاحة');
    return '<div class="st-list">' + st.map(function (s) {
      var hv = parseFloat(String(s.home_value).replace('%', '')) || 0;
      var av = parseFloat(String(s.away_value).replace('%', '')) || 0;
      var tot = hv + av || 1;
      var hp = Math.round(hv / tot * 100);
      return '<div class="st-row">' +
        '<div class="st-top"><span class="st-h">' + esc(s.home_value) + '</span>' +
          '<span class="st-name">' + esc(s.stat_name) + '</span>' +
          '<span class="st-a">' + esc(s.away_value) + '</span></div>' +
        '<div class="st-bar"><span class="st-fill home" style="width:' + hp + '%"></span>' +
          '<span class="st-fill away" style="width:' + (100 - hp) + '%"></span></div>' +
      '</div>';
    }).join('') + '</div>';
  }
  function lineupColHTML(team, players) {
    players = players || [];
    var starters = players.filter(function (p) { return !p.is_substitute; }).sort(function (a, b) { return (a.position_order || 0) - (b.position_order || 0); });
    var subs = players.filter(function (p) { return p.is_substitute; });
    function row(p) {
      return '<div class="lu-row">' +
        '<span class="lu-num">' + (p.player_number != null ? esc(p.player_number) : '') + '</span>' +
        '<img class="lu-photo" src="' + esc(p.photo || '') + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">' +
        '<span class="lu-name">' + esc(p.player_name || '') + '</span>' +
        (p.rating ? '<span class="lu-rate">' + esc(p.rating) + '</span>' : '') +
      '</div>';
    }
    if (!players.length) return '<div class="lu-col"><h4>' + esc((team && team.name) || '') + '</h4><div class="lu-empty">لا تتوفر التشكيلة</div></div>';
    return '<div class="lu-col"><h4>' + ((team && team.logo) ? '<img src="' + esc(team.logo) + '" alt="" onerror="this.style.display=\'none\'"> ' : '') + esc((team && team.name) || '') + '</h4>' +
      (starters.length ? '<div class="lu-group-title">التشكيلة الأساسية</div>' + starters.map(row).join('') : '') +
      (subs.length ? '<div class="lu-group-title">البدلاء</div>' + subs.map(row).join('') : '') +
    '</div>';
  }
  function matchLineupHTML(m) {
    var lu = m.lineups || {};
    if ((!lu.home || !lu.home.length) && (!lu.away || !lu.away.length)) return emptyBox('fa-users', 'لا تتوفر تشكيلة لهذه المباراة');
    return '<div class="lu-grid">' + lineupColHTML(m.home_team, lu.home) + lineupColHTML(m.away_team, lu.away) + '</div>';
  }
  function matchDetailsHTML(m) {
    var rows = [
      ['البطولة', m.league_name], ['الجولة', m.round ? ('الجولة ' + m.round) : ''], ['التاريخ', m.match_date],
      ['التوقيت', m.match_time], ['الملعب', m.venue], ['الحكم', m.referee],
      ['الحالة', matchStatusLabel(m)],
      ['النتيجة', (m.home_goals != null ? (m.home_goals + ' - ' + m.away_goals) : '')]
    ].filter(function (r) { return r[1]; });
    if (!rows.length) return emptyBox('fa-circle-info', 'لا توجد تفاصيل إضافية');
    return '<div class="dt-list">' + rows.map(function (r) {
      return '<div class="dt-row"><span class="dt-k">' + esc(r[0]) + '</span><span class="dt-v">' + esc(r[1]) + '</span></div>';
    }).join('') + '</div>';
  }
  function matchChannelsHTML(m) {
    var chans = m.channels || [];
    if (!chans.length) return '<div class="qual-loading">لا توجد قنوات ناقلة متاحة حالياً.</div>';
    return chans.map(function (c) {
      var streams = (c.streams || []).slice().sort(function (a, b) { return qualRank(b.quality) - qualRank(a.quality); });
      var opts = streams.map(function (s, i) {
        var q = s.quality || s.server_name || 'مشاهدة';
        var sub = (s.server_name && s.quality) ? s.server_name : '';
        return '<button class="srv-opt mstream' + (i === 0 ? ' srv-best' : '') + '" data-url="' + esc(s.stream_url) + '" data-ua="' + esc(uaOf(s.deep_link)) + '" data-name="' + esc(c.channel_name || '') + '">' +
          '<span class="srv-ic"><i class="fas fa-play"></i></span>' +
          '<span class="srv-txt"><span class="srv-q">' + esc(q) + '</span>' + (sub ? '<span class="srv-sub">' + esc(sub) + '</span>' : '') + '</span>' +
          (i === 0 ? '<span class="srv-tag">الأفضل</span>' : '') +
        '</button>';
      }).join('');
      return '<div class="server-block"><h3>' +
        (c.channel_logo ? '<img class="chan-logo" src="' + esc(c.channel_logo) + '" alt="" onerror="this.style.display=\'none\'">' : '<i class="fas fa-tv"></i> ') +
        esc(c.channel_name || '') + (c.commentator ? ' <span class="chan-comment">— ' + esc(c.commentator) + '</span>' : '') +
        '</h3><div class="srv-list">' + opts + '</div></div>';
    }).join('');
  }
  function renderMatchDetail(root, m) {
    var ht = m.home_team || {}, at = m.away_team || {};
    var s = String(m.status || '').toUpperCase();
    var isLive = ['LIVE', '1H', '2H', 'HT', 'ET', 'P'].indexOf(s) >= 0;
    var done = ['FT', 'AET', 'PEN'].indexOf(s) >= 0;
    var hasScore = (m.home_goals != null && m.away_goals != null && (isLive || done));
    var scoreTxt = hasScore ? (m.home_goals + ' - ' + m.away_goals) : 'VS';
    var statusTxt = isLive ? ('<span class="mdt-status live"><span class="live-dot"></span> ' + esc(matchStatusLabel(m)) + (m.elapsed ? " · " + m.elapsed + "'" : '') + '</span>')
      : '<span class="mdt-status' + (done ? ' done' : '') + '">' + esc(matchStatusLabel(m)) + (m.match_time ? ' · ' + esc(m.match_time) : '') + '</span>';
    var html =
      '<div class="mdt-backrow">' +
        '<button type="button" class="mdt-back" id="mdtBack"><i class="fas fa-arrow-right"></i> رجوع</button>' +
        '<a class="mdt-back-ghost" href="matches.html"><i class="fas fa-futbol"></i> كل المباريات</a>' +
      '</div>' +
      '<div class="mdt-hero">' +
        '<div class="mdt-league">' + (m.league_logo ? '<img src="' + esc(m.league_logo) + '" alt="" onerror="this.style.display=\'none\'">' : '') +
          '<span>' + esc(m.league_name || '') + '</span>' + (m.round ? '<span class="mdt-round">الجولة ' + esc(m.round) + '</span>' : '') + '</div>' +
        '<div class="mdt-score-row">' +
          '<div class="mdt-team"><img src="' + esc(ht.logo || '') + '" alt="" onerror="this.style.visibility=\'hidden\'"><span>' + esc(ht.name || '') + '</span></div>' +
          '<div class="mdt-score"><div class="mdt-score-num' + (isLive ? ' live' : '') + '">' + esc(scoreTxt) + '</div>' + statusTxt + '</div>' +
          '<div class="mdt-team"><img src="' + esc(at.logo || '') + '" alt="" onerror="this.style.visibility=\'hidden\'"><span>' + esc(at.name || '') + '</span></div>' +
        '</div>' +
        '<div class="mdt-meta">' +
          (m.match_date ? '<span><i class="fas fa-calendar"></i> ' + esc(m.match_date) + '</span>' : '') +
          (m.venue ? '<span><i class="fas fa-location-dot"></i> ' + esc(m.venue) + '</span>' : '') +
          (m.referee ? '<span><i class="fas fa-user-tie"></i> ' + esc(m.referee) + '</span>' : '') +
        '</div>' +
      '</div>' +
      '<div class="section-head" style="margin-top:26px"><h2 class="section-title" style="font-size:1.2rem;margin:0"><i class="fas fa-tv"></i> القنوات الناقلة والبث المباشر</h2></div>' +
      '<div id="matchChannels">' + matchChannelsHTML(m) + '</div>' +
      '<div class="player-wrap" id="matchPlayer">' + playerNote('fa-circle-play', 'اختر قناة لمشاهدة البث المباشر') + '</div>' +
      '<div class="mdt-tabs" id="mdTabs">' +
        '<button class="mdt-tab active" data-t="events"><i class="fas fa-list-ul"></i> الأحداث</button>' +
        '<button class="mdt-tab" data-t="stats"><i class="fas fa-chart-simple"></i> الإحصائيات</button>' +
        '<button class="mdt-tab" data-t="lineup"><i class="fas fa-users"></i> التشكيلة</button>' +
        '<button class="mdt-tab" data-t="details"><i class="fas fa-circle-info"></i> التفاصيل</button>' +
      '</div>' +
      '<div class="mdt-panels">' +
        '<div class="mdt-panel active" data-p="events">' + matchEventsHTML(m) + '</div>' +
        '<div class="mdt-panel" data-p="stats">' + matchStatsHTML(m) + '</div>' +
        '<div class="mdt-panel" data-p="lineup">' + matchLineupHTML(m) + '</div>' +
        '<div class="mdt-panel" data-p="details">' + matchDetailsHTML(m) + '</div>' +
      '</div>';
    root.innerHTML = html;

    var backBtn = $('#mdtBack');
    if (backBtn) backBtn.addEventListener('click', function () {
      if (window.history.length > 1) window.history.back(); else location.href = 'matches.html';
    });

    var frame = $('#matchPlayer');
    $$('#matchChannels .mstream').forEach(function (b) {
      b.addEventListener('click', function () {
        $$('#matchChannels .mstream').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        playStream(frame, b.dataset.url, true, b.dataset.ua, b.dataset.name);
        var wrap = $('#matchPlayer'); if (wrap) wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });
    $$('.mdt-tab').forEach(function (t) {
      t.addEventListener('click', function () {
        $$('.mdt-tab').forEach(function (x) { x.classList.toggle('active', x === t); });
        $$('.mdt-panel').forEach(function (p) { p.classList.toggle('active', p.dataset.p === t.dataset.t); });
      });
    });
    initReveal();
  }
  function initMatchDetail() {
    var root = $('#matchDetail'); if (!root) return;
    var p = new URLSearchParams(location.search);
    var id = p.get('id');
    if (!id) { root.innerHTML = emptyBox('fa-triangle-exclamation', 'لا توجد مباراة محددة'); return; }
    root.innerHTML = '<div class="empty"><i class="fas fa-spinner fa-spin"></i><p>جارٍ التحميل…</p></div>';
    function liveUpdate(m) {
      // refresh score/status + events/stats live without touching the player or tabs
      var s = String(m.status || '').toUpperCase();
      var isLive = ['LIVE', '1H', '2H', 'HT', 'ET', 'P'].indexOf(s) >= 0;
      var done = ['FT', 'AET', 'PEN'].indexOf(s) >= 0;
      var num = $('.mdt-score-num');
      if (num) num.textContent = (m.home_goals != null && m.away_goals != null && (isLive || done)) ? (m.home_goals + ' - ' + m.away_goals) : 'VS';
      var st = $('.mdt-status');
      if (st) st.textContent = matchStatusLabel(m) + (isLive && m.elapsed ? " · " + m.elapsed + "'" : (m.match_time ? ' · ' + m.match_time : ''));
      var ev = $('.mdt-panel[data-p="events"]'); if (ev) ev.innerHTML = matchEventsHTML(m);
      var stt = $('.mdt-panel[data-p="stats"]'); if (stt) stt.innerHTML = matchStatsHTML(m);
    }
    function poll() {
      if (document.hidden) return;
      api('/api/oscar/match', { id: id }).then(function (j) {
        var m = unwrap(j); if (m && m.id) liveUpdate(m);
      }).catch(function () { });
    }
    function paint(m) {
      document.title = ((m.home_team && m.home_team.name) || '') + ' × ' + ((m.away_team && m.away_team.name) || '') + ' — NOVA TV';
      renderMatchDetail(root, m);
    }
    api('/api/oscar/match', { id: id }).then(function (j) {
      var m = unwrap(j);
      if (!m || !m.id) throw new Error('empty');
      paint(m);
      setInterval(poll, 25000);  // live auto-update for matches
    }).catch(function () {
      /* static hosting / backend offline: use the bundled snapshot */
      snapshotMatchDetail(id).then(function (m) {
        if (!m || !m.id) { root.innerHTML = loadFailHTML('تعذّر تحميل بيانات المباراة'); return; }
        paint(m);
      }).catch(function () { root.innerHTML = loadFailHTML('تعذّر تحميل بيانات المباراة'); });
    });
  }

  /* ---------------------------------------------------------- summaries (btolat) */
  function btolatThumb(u) {
    if (!u) return 'assets/img/placeholder.svg';
    return window.NOVATV_NO_PROXY ? u : (API + '/api/btolat/img?url=' + encodeURIComponent(u));
  }
  function initSummaries() {
    var root = $('#summariesRoot'); if (!root) return;
    var tabsEl = $('#sumTabs');
    var tabs = [{ t: 10, label: 'الأهداف والملخصات', icon: 'fa-futbol' },
                { t: 15, label: 'أحدث الفيديوهات', icon: 'fa-clapperboard' }];
    var cur = 10, snap = null, reqId = 0;
    var modal = document.createElement('div');
    modal.className = 'btolat-modal';
    modal.innerHTML = '<div class="btolat-modal-box"><button class="btolat-close" aria-label="إغلاق"><i class="fas fa-xmark"></i></button>' +
      '<div class="btolat-player" id="btolatPlayer"></div>' +
      '<div class="btolat-quals" id="btolatQuals" style="display:none"></div>' +
      '<h3 class="btolat-modal-title" id="btolatTitle"></h3></div>';
    document.body.appendChild(modal);
    var playerEl = $('.btolat-player', modal);
    function closeModal() {
      modal.classList.remove('show');
      if (playerEl._hls) { try { playerEl._hls.destroy(); } catch (e) { } playerEl._hls = null; }
      playerEl.innerHTML = '';
    }
    modal.addEventListener('click', function (e) { if (e.target === modal || (e.target.closest && e.target.closest('.btolat-close'))) closeModal(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

    function renderTabs() {
      if (!tabsEl) return;
      tabsEl.innerHTML = tabs.map(function (x) {
        return '<button class="tab' + (x.t === cur ? ' active' : '') + '" data-t="' + x.t + '"><i class="fas ' + x.icon + '"></i> ' + x.label + '</button>';
      }).join('');
      $$('.tab', tabsEl).forEach(function (b) { b.addEventListener('click', function () { cur = +b.dataset.t; renderTabs(); load(); }); });
    }
    function cardHTML(v) {
      return '<a class="btolat-card reveal" href="javascript:void(0)" data-id="' + esc(v.id) + '" data-title="' + esc(v.title) + '">' +
        '<div class="btolat-thumb"><img src="' + esc(btolatThumb(v.thumb)) + '" alt="' + esc(v.title) + '" loading="lazy" onerror="this.style.display=\'none\'">' +
          '<span class="btolat-play"><i class="fas fa-play"></i></span>' +
          (v.league ? '<span class="btolat-league">' + esc(v.league) + '</span>' : '') + '</div>' +
        '<div class="btolat-body"><div class="btolat-title">' + esc(v.title) + '</div>' +
          (v.date ? '<div class="btolat-date"><i class="fas fa-clock"></i> ' + esc(v.date) + '</div>' : '') + '</div>' +
      '</a>';
    }
    function paint(items) {
      if (!items || !items.length) return false;
      root.innerHTML = '<div class="btolat-grid">' + items.map(cardHTML).join('') + '</div>';
      $$('.btolat-card', root).forEach(function (c) {
        c.addEventListener('click', function () { openVideo(c.dataset.id, c.dataset.title); });
      });
      initReveal();
      return true;
    }
    function loadSnapshot() {
      if (snap) return Promise.resolve(snap);
      return fetch('data/btolat.json', { cache: 'force-cache' })
        .then(function (r) { return r.json(); })
        .then(function (j) { snap = j || {}; return snap; });
    }
    /* instant paint from the static snapshot, then a silent live refresh */
    function load() {
      var my = ++reqId;
      root.innerHTML = '<div class="empty"><i class="fas fa-spinner fa-spin"></i><p>جارٍ تحميل الفيديوهات…</p></div>';
      loadSnapshot().then(function (s) {
        if (my !== reqId) return;
        var items = (s && s[String(cur)]) || [];
        if (paint(items)) refresh(my); else refresh(my, true);
      }).catch(function () { if (my === reqId) refresh(my, true); });
    }
    function refresh(my, showError) {
      api('/api/btolat/videos', { type: cur }).then(function (j) {
        if (my !== reqId) return;
        var items = unwrap(j) || [];
        if (paint(items)) return;
        if (showError) root.innerHTML = '<div class="empty"><i class="fas fa-film"></i><p>لا توجد فيديوهات حالياً</p></div>';
      }).catch(function () {
        if (my === reqId && showError) root.innerHTML = '<div class="empty"><i class="fas fa-triangle-exclamation"></i><p>تعذّر تحميل الفيديوهات</p></div>';
      });
    }
    function openVideo(id, title) {
      modal.classList.add('show');
      $('#btolatTitle', modal).textContent = title || '';
      var qualsEl = $('#btolatQuals', modal);
      if (qualsEl) { qualsEl.innerHTML = ''; qualsEl.style.display = 'none'; }
      playerEl.innerHTML = playerNote('fa-spinner fa-spin', 'جارٍ تجهيز الفيديو…');
      api('/api/btolat/video', { id: id }).then(function (j) {
        var v = unwrap(j);
        if (v && v.youtube) {
          /* current btolat format: a YouTube embed */
          playerEl.innerHTML = '<iframe class="btolat-embed" src="https://www.youtube.com/embed/' + esc(v.youtube) + '?autoplay=1&rel=0&modestbranding=1&playsinline=1" title="' + esc(v.title || title || '') + '" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>';
          return;
        }
        if (!v || !v.hls) { playerEl.innerHTML = playerNote('fa-triangle-exclamation', 'تعذّر تشغيل هذا الفيديو'); return; }
        var ref = '';
        try { ref = v.embed ? (new URL(v.embed)).origin + '/' : ''; } catch (e) { }
        var quals = (v.qualities && v.qualities.length) ? v.qualities : [];
        if (quals.length && qualsEl) {
          /* auto (ABR) first, then the concrete quality variants (720p/360p/240p…) */
          var opts = [{ quality: 'تلقائي', url: v.hls }].concat(quals);
          qualsEl.style.display = '';
          qualsEl.innerHTML = '<span class="bq-label"><i class="fas fa-gauge-high"></i> الجودات المتاحة</span>' +
            '<div class="qual-row">' + opts.map(function (x, i) {
              return '<button type="button" class="qual-btn' + (i === 0 ? ' active' : '') + '" data-url="' + esc(x.url) + '" data-quality="' + esc(x.quality) + '">' +
                '<i class="fas fa-play"></i> ' + esc(x.quality) + '</button>';
            }).join('') + '</div>';
          $$('.qual-btn', qualsEl).forEach(function (b) {
            b.addEventListener('click', function () {
              $$('.qual-btn', qualsEl).forEach(function (x) { x.classList.remove('active'); });
              b.classList.add('active');
              playStream(playerEl, b.dataset.url, true, '', v.title || title, ref);
            });
          });
          playStream(playerEl, v.hls, true, '', v.title || title, ref);
        } else {
          playStream(playerEl, v.hls, true, '', v.title || title, ref);
        }
      }).catch(function () { playerEl.innerHTML = playerNote('fa-triangle-exclamation', 'تعذّر تشغيل هذا الفيديو'); });
    }
    renderTabs();
    load();
  }

  /* ---------------------------------------------------------- showcase (legendary carousel) */
  function initShowcase() {
    var tabsEl = $('#showcaseTabs'), stageEl = $('#showcaseStage'),
      capEl = $('#showcaseCaption'), marqEl = $('#showcaseMarquee');
    if (!stageEl) return;

    var CAP = 14;
    var pools = { all: [], movies: [], series: [], anime: [], matches: [], channels: [] };
    var cur = 'all', items = [], marqueeBuilt = false;
    var els = [], n = 0;
    var pos = 0, lastTs = 0, raf = null, hoverSlow = 1, activeIdx = -1, progressEl = null;
    var seeking = false, seekFrom = 0, seekTarget = 0, seekT = 0, seekDur = 0.6;
    var running = false;
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function normMovie(it, kind) {
      return { id: it.id, kind: kind, title: it.t || it.te || '', poster: img(it.p),
        rate: ratingStr(it.r), year: it.y || '', meta: it.ct || '', badge: KIND_LABEL[kind] || '',
        href: 'detail.html?kind=' + kind + '&id=' + it.id };
    }
    function normChannel(c) {
      return { id: c.id, kind: 'channels', title: c.t || '', poster: img(c.cv || c.p),
        rate: '', year: '', meta: c.catl || c.cat || '', badge: '\u0642\u0646\u0627\u0629 \u0645\u0628\u0627\u0634\u0631\u0629', live: true,
        href: 'channels.html?open=' + c.id };
    }
    function normMatch(m) {
      var ht = m.home_team || {}, at = m.away_team || {};
      return { id: m.id, kind: 'matches', title: (ht.name || '') + ' \u00d7 ' + (at.name || ''),
        poster: ht.logo || at.logo || '', rate: '', year: '',
        meta: m.league_name || m.match_time || '', badge: '\u0645\u0628\u0627\u0631\u0627\u0629',
        href: 'match-detail.html?id=' + m.id };
    }
    function byRate(a, b) { return (parseFloat(b.r) || 0) - (parseFloat(a.r) || 0); }
    function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

    function build(feed, channels, matches) {
      pools.movies = (feed.movies || []).slice().sort(byRate).slice(0, CAP).map(function (x) { return normMovie(x, 'movies'); });
      pools.series = (feed.series || []).slice().sort(byRate).slice(0, CAP).map(function (x) { return normMovie(x, 'series'); });
      pools.anime = (feed.anime || []).slice().sort(byRate).slice(0, CAP).map(function (x) { return normMovie(x, 'anime'); });
      pools.channels = (channels || []).slice(0, CAP).map(normChannel);
      pools.matches = (matches || []).slice(0, CAP).map(normMatch);
      var mix = [], src = [pools.movies, pools.series, pools.anime, pools.matches, pools.channels];
      var maxLen = Math.max.apply(null, src.map(function (x) { return x.length; }).concat([0]));
      for (var i = 0; i < maxLen && mix.length < CAP; i++) {
        for (var s = 0; s < src.length && mix.length < CAP; s++) { if (src[s][i]) mix.push(src[s][i]); }
      }
      pools.all = mix;
    }

    var TAB_DEF = [
      { k: 'all', label: '\u0627\u0644\u0643\u0644', icon: 'fa-fire' },
      { k: 'movies', label: '\u0623\u0641\u0644\u0627\u0645', icon: 'fa-film' },
      { k: 'series', label: '\u0645\u0633\u0644\u0633\u0644\u0627\u062a', icon: 'fa-tv' },
      { k: 'anime', label: '\u0623\u0646\u0645\u064a', icon: 'fa-dragon' },
      { k: 'matches', label: '\u0645\u0628\u0627\u0631\u064a\u0627\u062a', icon: 'fa-futbol' },
      { k: 'channels', label: '\u0642\u0646\u0648\u0627\u062a', icon: 'fa-satellite-dish' }
    ];
    function renderTabs() {
      if (!tabsEl) return;
      tabsEl.innerHTML = TAB_DEF.filter(function (t) { return t.k === 'all' || pools[t.k].length; })
        .map(function (t) {
          return '<button class="showcase-tab' + (t.k === cur ? ' active' : '') + '" data-k="' + t.k + '"><i class="fas ' + t.icon + '"></i> ' + t.label + '</button>';
        }).join('');
      $$('.showcase-tab', tabsEl).forEach(function (b) { b.addEventListener('click', function () { setTab(b.dataset.k); }); });
    }
    function cardInner(it) {
      var badge = it.badge ? '<span class="cf-badge' + (it.live ? ' live' : '') + '">' + (it.live ? '<i class="fas fa-circle"></i>' : '') + esc(it.badge) + '</span>' : '';
      var rate = it.rate ? '<span class="cf-rate"><i class="fas fa-star"></i> ' + esc(it.rate) + '</span>' : '';
      var meta = [];
      if (it.year) meta.push('<span>' + esc(it.year) + '</span>');
      if (it.meta) meta.push('<span>' + esc(it.meta) + '</span>');
      return '<img src="' + esc(it.poster) + '" alt="' + esc(it.title) + '" loading="lazy" decoding="async" onerror="this.onerror=null;this.src=\'assets/img/placeholder.svg\'">' +
        '<span class="cf-shade"></span>' + badge + rate +
        '<span class="cf-play"><i class="fas fa-play"></i></span>' +
        '<div class="cf-body"><div class="cf-title">' + esc(it.title) + '</div>' +
        (meta.length ? '<div class="cf-meta">' + meta.join('') + '</div>' : '') + '</div>';
    }

    function wrapOff(off) {
      off = off % n;
      if (off > n / 2) off -= n;
      if (off < -n / 2) off += n;
      return off;
    }

    function renderStage() {
      n = items.length;
      stageEl.innerHTML = items.map(function (it, i) {
        return '<a class="cf-item' + (it.kind === 'channels' ? ' cf-chan' : '') + '" data-i="' + i + '" href="' + esc(it.href) + '">' + cardInner(it) + '</a>';
      }).join('') +
        '<button class="cf-nav cf-prev" aria-label="\u0627\u0644\u0633\u0627\u0628\u0642"><i class="fas fa-chevron-right"></i></button>' +
        '<button class="cf-nav cf-next" aria-label="\u0627\u0644\u062a\u0627\u0644\u064a"><i class="fas fa-chevron-left"></i></button>';
      els = $$('.cf-item', stageEl);
      els.forEach(function (el) {
        el.addEventListener('click', function (e) {
          var i = +el.dataset.i;
          var front = ((Math.round(pos) % n) + n) % n;
          if (i !== front) { e.preventDefault(); seekTo(i); }
        });
      });
      var pv = $('.cf-prev', stageEl), nx = $('.cf-next', stageEl);
      if (pv) pv.addEventListener('click', prev);
      if (nx) nx.addEventListener('click', next);
    }

    function layout() {
      if (!n) return;
      var w = window.innerWidth;
      var step = w <= 420 ? 92 : w <= 640 ? 118 : w <= 900 ? 152 : 198;
      var fadeEnd = Math.max(2.6, n / 2 - 0.35);
      for (var i = 0; i < n; i++) {
        var el = els[i]; if (!el) continue;
        var off = wrapOff(i - pos);
        var a = Math.abs(off);
        var x = off * step;
        var scale = Math.max(0.5, 1.14 - a * 0.16);
        var rotY = Math.max(-34, Math.min(34, -off * 34));
        var z = -Math.min(a, 4) * 130;
        var op = a >= fadeEnd ? 0 : Math.max(0.06, 1 - (a / fadeEnd) * 0.94);
        el.style.transform = 'translateX(' + x.toFixed(2) + 'px) translateZ(' + z.toFixed(1) + 'px) rotateY(' + rotY.toFixed(2) + 'deg) scale(' + scale.toFixed(3) + ')';
        el.style.opacity = op;
        el.style.zIndex = String(100 - Math.round(a * 8));
        el.style.pointerEvents = a > 3 ? 'none' : 'auto';
        el.classList.toggle('is-active', a < 0.5);
      }
    }

    function updateCaption() {
      if (!capEl || !n) return;
      var idx = ((Math.round(pos) % n) + n) % n;
      if (idx === activeIdx) return;
      activeIdx = idx;
      var it = items[idx]; if (!it) { capEl.innerHTML = ''; return; }
      var pills = [];
      if (it.rate) pills.push('<span class="sc-pill gold"><i class="fas fa-star"></i> ' + esc(it.rate) + '</span>');
      if (it.year) pills.push('<span class="sc-pill">' + esc(it.year) + '</span>');
      if (it.meta) pills.push('<span class="sc-pill">' + esc(it.meta) + '</span>');
      if (it.badge) pills.push('<span class="sc-pill">' + esc(it.badge) + '</span>');
      var cta = it.kind === 'channels' ? '\u0634\u0627\u0647\u062f \u0627\u0644\u0642\u0646\u0627\u0629' : it.kind === 'matches' ? '\u062a\u0641\u0627\u0635\u064a\u0644 \u0627\u0644\u0645\u0628\u0627\u0631\u0627\u0629' : '\u0634\u0627\u0647\u062f \u0627\u0644\u0622\u0646';
      var eyebrow = it.live
        ? '<span class="sc-eyebrow live"><i class="fas fa-circle"></i> \u064a\u064f\u0628\u064e\u062b\u0651 \u0627\u0644\u0622\u0646</span>'
        : '<span class="sc-eyebrow"><i class="fas fa-bolt"></i> \u0627\u0644\u0623\u0643\u062b\u0631 \u0631\u0648\u0627\u062c\u064b\u0627 \u0627\u0644\u0622\u0646</span>';
      capEl.innerHTML = eyebrow +
        '<h3 class="sc-title">' + esc(it.title) + '</h3>' +
        (pills.length ? '<div class="sc-meta">' + pills.join('') + '</div>' : '') +
        '<a class="sc-cta" href="' + esc(it.href) + '"><i class="fas fa-play"></i> ' + cta + '</a>' +
        '<div class="sc-progress"><i></i></div>' +
        '<div class="sc-dots">' + items.map(function (x, i) { return '<button class="sc-dot' + (i === idx ? ' active' : '') + '" data-i="' + i + '" aria-label="' + (i + 1) + '"></button>'; }).join('') + '</div>';
      progressEl = $('.sc-progress > i', capEl);
      $$('.sc-dot', capEl).forEach(function (b) { b.addEventListener('click', function () { seekTo(+b.dataset.i); }); });
    }

    function seekTo(i) {
      if (!n) return;
      var off = wrapOff(i - pos);
      seekFrom = pos; seekTarget = pos + off; seekT = 0; seeking = true;
    }
    function frontIdx() { return ((Math.round(pos) % n) + n) % n; }
    function next() { seekTo(frontIdx() + 1); }
    function prev() { seekTo(frontIdx() - 1); }

    function frame(ts) {
      raf = requestAnimationFrame(frame);
      if (!lastTs) lastTs = ts;
      var dt = Math.min(0.05, (ts - lastTs) / 1000);
      lastTs = ts;
      if (seeking) {
        seekT += dt;
        var t = Math.min(1, seekT / seekDur);
        var e = 1 - Math.pow(1 - t, 3);
        pos = seekFrom + (seekTarget - seekFrom) * e;
        if (t >= 1) { seeking = false; pos = seekTarget; }
      } else if (!reduced && running) {
        pos += 0.18 * hoverSlow * dt;
      }
      layout(); updateCaption();
      if (progressEl) { var frac = pos - Math.floor(pos); progressEl.style.transform = 'scaleX(' + frac.toFixed(3) + ')'; }
    }
    function startLoop() { if (raf) return; lastTs = 0; raf = requestAnimationFrame(frame); }

    function setTab(k) {
      if (!pools[k] || !pools[k].length) return;
      cur = k; items = pools[k].slice();
      if (items.length < 10) { var base = items.slice(); while (items.length < 10) items = items.concat(base); }
      pos = 0; seeking = false; activeIdx = -1;
      renderTabs(); renderStage(); layout(); updateCaption(); startLoop();
    }

    function buildMarquee(channels, feed) {
      if (marqueeBuilt || !marqEl) return; marqueeBuilt = true;
      var pool = [];
      (channels || []).slice(0, 18).forEach(function (c) { pool.push({ img: img(c.p), label: c.t, chan: true, href: 'channels.html?open=' + c.id }); });
      (feed.movies || []).slice(0, 10).forEach(function (x) { pool.push({ img: img(x.p), label: x.t || x.te, href: 'detail.html?kind=movies&id=' + x.id }); });
      (feed.series || []).slice(0, 8).forEach(function (x) { pool.push({ img: img(x.p), label: x.t || x.te, href: 'detail.html?kind=series&id=' + x.id }); });
      (feed.anime || []).slice(0, 8).forEach(function (x) { pool.push({ img: img(x.p), label: x.t || x.te, href: 'detail.html?kind=anime&id=' + x.id }); });
      pool = shuffle(pool);
      var half = pool.map(function (p) {
        return '<a class="mq-card' + (p.chan ? ' mq-chan' : '') + '" href="' + esc(p.href) + '"><img src="' + esc(p.img) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'"><span class="mq-label">' + esc(p.label) + '</span></a>';
      }).join('');
      marqEl.innerHTML = '<div class="mq-track">' + half + half + '</div>';
    }

    /* only animate while the stage is on screen (saves CPU, keeps it smooth) */
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (ents) {
        ents.forEach(function (en) { running = en.isIntersecting; });
      }, { threshold: 0.04 });
      io.observe(stageEl);
    } else { running = true; }

    /* hover gently slows the belt instead of stopping it */
    stageEl.addEventListener('mouseenter', function () { hoverSlow = 0.16; });
    stageEl.addEventListener('mouseleave', function () { hoverSlow = 1; });

    /* swipe */
    var sx = 0, sy = 0;
    stageEl.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    stageEl.addEventListener('touchend', function (e) {
      var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { if (dx < 0) next(); else prev(); }
    }, { passive: true });

    document.addEventListener('keydown', function (e) {
      if (!isInView(stageEl)) return;
      if (e.key === 'ArrowLeft') next(); else if (e.key === 'ArrowRight') prev();
    });
    function isInView(el) { var r = el.getBoundingClientRect(); return r.top < window.innerHeight && r.bottom > 0; }
    var rt;
    window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(layout, 140); });

    Promise.all([
      loadHome().catch(function () { return {}; }),
      loadCatalog('channels').catch(function () { return []; })
    ]).then(function (res) {
      var feed = res[0] || {}, channels = res[1] || [];
      build(feed, channels, []);
      if (!pools.all.length) { stageEl.innerHTML = '<div class="showcase-loading">\u062a\u0639\u0630\u0651\u0631 \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u0645\u062d\u062a\u0648\u0649 \u062d\u0627\u0644\u064a\u0627\u064b</div>'; return; }
      renderTabs(); setTab('all');
      buildMarquee(channels, feed);
      function applyMatches(leagues) {
        var ms = [];
        (leagues || []).forEach(function (l) { (l.matches || []).forEach(function (m) { m.league_name = l.league_name; ms.push(m); }); });
        if (ms.length) { pools.matches = ms.slice(0, CAP).map(normMatch); renderTabs(); if (cur === 'matches') setTab('matches'); return true; }
        return false;
      }
      api('/api/oscar/matches', { date: dayKey(0) }).then(function (j) {
        var d = unwrap(j);
        if (!applyMatches((d && d.leagues) || [])) snapshotLeaguesFor(dayKey(0)).then(applyMatches).catch(function () { });
      }).catch(function () {
        /* no backend (static hosting): use the bundled matches snapshot */
        snapshotLeaguesFor(dayKey(0)).then(applyMatches).catch(function () { });
      });
    }).catch(function () { stageEl.innerHTML = '<div class="showcase-loading">\u062a\u0639\u0630\u0651\u0631 \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u0645\u062d\u062a\u0648\u0649 \u062d\u0627\u0644\u064a\u0627\u064b</div>'; });
  }

  /* ---------------------------------------------------------- search */
  function initSearch() {
    var root = $('#searchRoot'); if (!root) return;
    var input = $('#searchInput');
    var p = new URLSearchParams(location.search);
    var q = p.get('q') || '';
    if (input) input.value = q;
    function run(query) {
      query = (query || '').trim();
      if (!query) { root.innerHTML = '<div class="empty"><i class="fas fa-magnifying-glass"></i><p>اكتب كلمة للبحث في الأفلام والمسلسلات والأنمي</p></div>'; return; }
      root.innerHTML = '<div class="empty"><i class="fas fa-spinner fa-spin"></i><p>جارٍ البحث…</p></div>';
      Promise.all([loadCatalog('movies'), loadCatalog('series'), loadCatalog('anime')]).then(function (res) {
        var ql = query.toLowerCase();
        var out = [];
        [['movies', res[0]], ['series', res[1]], ['anime', res[2]]].forEach(function (pair) {
          pair[1].forEach(function (it) {
            if (((it.t || '') + ' ' + (it.te || '') + ' ' + (it.tj || '')).toLowerCase().indexOf(ql) >= 0) out.push({ it: it, kind: pair[0] });
          });
        });
        if (!out.length) { root.innerHTML = '<div class="empty"><i class="fas fa-film"></i><p>لا توجد نتائج لـ «' + esc(query) + '»</p></div>'; return; }
        root.innerHTML = '<div class="grid">' +
          out.slice(0, 120).map(function (o) { return cardHTML(o.it, o.kind); }).join('') + '</div>';
        initReveal();
      });
    }
    if (input) {
      var t;
      input.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { run(input.value); }, 250); });
    }
    run(q);
  }

  /* ---------------------------------------------------------- watched */
  function initWatched() {
    var root = $('#watchedRoot'); if (!root) return;
    var arr = getWatched();
    if (!arr.length) { root.innerHTML = '<div class="empty"><i class="fas fa-clock-rotate-left"></i><p>لم تشاهد أي محتوى بعد</p></div>'; return; }
    root.innerHTML = '<div class="grid">' +
      arr.map(function (w) { return cardHTML({ id: w.id, t: w.t, p: w.p, y: w.y }, w.kind || 'movies'); }).join('') + '</div>';
    initReveal();
  }

  /* ---------------------------------------------------------- toast */
  var _toastEl;
  function toast(msg) {
    if (!_toastEl) { _toastEl = document.createElement('div'); _toastEl.className = 'toast'; document.body.appendChild(_toastEl); }
    _toastEl.innerHTML = '<i class="fas fa-circle-info"></i> ' + esc(msg);
    _toastEl.classList.add('show');
    clearTimeout(_toastEl._t);
    _toastEl._t = setTimeout(function () { _toastEl.classList.remove('show'); }, 2600);
  }

  /* ---------------------------------------------------------- boot */
  document.addEventListener('DOMContentLoaded', function () {
    antiAd();
    renderChrome();
    initReveal();
    var page = document.body.dataset.page;
    if (page === 'home') { initHome(); initShowcase(); }
    else if (page === 'movies') { initPageFeatured('movies'); initList('movies'); }
    else if (page === 'series') { initPageFeatured('series'); initList('series'); }
    else if (page === 'anime') { initPageFeatured('anime'); initList('anime'); }
    else if (page === 'channels') initChannels();
    else if (page === 'matches') initMatches();
    else if (page === 'summaries') initSummaries();
    else if (page === 'match') initMatchDetail();
    else if (page === 'detail') initDetail();
    else if (page === 'search') initSearch();
    else if (page === 'watched') initWatched();
  });
})();
