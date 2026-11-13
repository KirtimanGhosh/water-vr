/* Service worker: offline support. Increase V on every update. */
const V = 'water-vr-v3';
const FILES = ['./', 'index.html', 'app.js', 'md2.js', 'md-worker.js', 'phase-eq.js', 'narration.js', 'manifest.webmanifest',
  'icon-192.png', 'icon-512.png', 'lib/three.min.js',
  ...['liq298', 'liq353', 'liq277', 'sc253', 'ice1h', 'ice3', 'ice6', 'ice7', 'vap373', 'scf', 'iceslab'].map((n) => 'data/st_' + n + '.json'),
  'data/rec_melt.json', 'data/rec_melt.bin', 'data/rec_evap.json', 'data/rec_evap.bin'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(V).then((c) => Promise.all(FILES.map((f) => c.add(f).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.includes('/api/')) return; // never cache APIs or other sites
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const cp = r.clone(); caches.open(V).then((c) => c.put(e.request, cp)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))));
});
