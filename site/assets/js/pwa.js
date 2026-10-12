/* ============================================================
   NOVA TV — PWA bootstrap
   ------------------------------------------------------------
   Registers the service worker (offline shell + fast assets) and
   shows a small floating "تثبيت التطبيق" button when the browser
   offers the install prompt, so NOVA TV can be installed like a
   native app on Android / desktop.
   ============================================================ */
(function () {
  'use strict';

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }

  var deferred = null;

  function ensureButton() {
    var btn = document.getElementById('novaInstallBtn');
    if (btn) return btn;
    btn = document.createElement('button');
    btn.id = 'novaInstallBtn';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'تثبيت تطبيق NOVA TV');
    btn.innerHTML = '<i class="fas fa-download"></i> تثبيت التطبيق';
    btn.style.cssText =
      'position:fixed;inset-inline-start:16px;bottom:16px;z-index:99999;display:none;' +
      'align-items:center;gap:8px;padding:11px 18px;border:0;border-radius:999px;cursor:pointer;' +
      'font-family:inherit;font-size:14px;font-weight:800;color:#fff;' +
      'background:linear-gradient(135deg,#e50914,#ff3b3b);box-shadow:0 10px 30px rgba(229,9,20,.45)';
    btn.onclick = function () {
      if (!deferred) return;
      deferred.prompt();
      deferred.userChoice.then(function () {
        deferred = null;
        btn.style.display = 'none';
      });
    };
    document.body.appendChild(btn);
    return btn;
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferred = e;
    var btn = ensureButton();
    btn.style.display = 'inline-flex';
  });

  window.addEventListener('appinstalled', function () {
    var btn = document.getElementById('novaInstallBtn');
    if (btn) btn.style.display = 'none';
    deferred = null;
  });
})();
