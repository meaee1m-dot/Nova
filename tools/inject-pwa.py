#!/usr/bin/env python3
# Inject the PWA manifest <link> + pwa.js <script> into every site/*.html page.
import glob, os, re, sys

HEAD_TAG = (
    '<link rel="manifest" href="manifest.webmanifest">'
    '<meta name="apple-mobile-web-app-capable" content="yes">'
    '<meta name="apple-mobile-web-app-title" content="NOVA TV">'
    '<meta name="mobile-web-app-capable" content="yes">'
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">'
    '<link rel="apple-touch-icon" href="assets/img/novatv/fav_180.png">'
)
BODY_TAG = '<script src="assets/js/pwa.js" defer></script>'

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'site')
files = sorted(glob.glob(os.path.join(root, '*.html')))
changed = 0
for f in files:
    html = open(f, encoding='utf-8').read()
    orig = html
    if 'manifest.webmanifest' not in html and '</head>' in html:
        html = html.replace('</head>', HEAD_TAG + '</head>', 1)
    if 'assets/js/pwa.js' not in html and '</body>' in html:
        html = html.replace('</body>', BODY_TAG + '</body>', 1)
    if html != orig:
        open(f, 'w', encoding='utf-8').write(html)
        changed += 1
        print('updated', os.path.basename(f))
print('done:', changed, 'of', len(files), 'files updated')
