/* ============================================================
   NOVA TV — runtime configuration
   ------------------------------------------------------------
   NOVATV_API: the base URL of the NOVA TV backend that resolves
   and proxies the Oscar TV streams, btolat match videos, and images.

   • If the backend serves this site (recommended), leave it as ''
     so the API is called on the SAME origin (e.g. /api/oscar/...).
   • If you host this static site separately (Netlify, GitHub
     Pages, cPanel, ...), set the full backend URL, e.g.:
         window.NOVATV_API = 'https://api.your-domain.com';

   NOVATV_NO_PROXY: set to true ONLY when you host the site with
   NO backend at all (pure static hosting). Streams will then be
   requested directly from the CDN (may be blocked by CORS).
   ============================================================ */
window.NOVATV_API = window.NOVATV_API || '';

/* GitHub Pages build: point to the live NOVA TV backend */
window.NOVATV_API = "https://reasons-harvard-images-member.trycloudflare.com";
