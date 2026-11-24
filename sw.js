const CACHE = 'netops-pwa-v1';
const SHELL = [
  './', './index.html', './styles.css', './app.js',
  './manifest.webmanifest', './icon.svg', './reference_library.json'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;

  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(event.request).then(hit => hit || fetch(event.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
        return res;
      }).catch(() => caches.match('./index.html')))
    );
    return;
  }

  if (url.hostname.endsWith('workers.dev')) {
    event.respondWith(
      fetch(event.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
        return res;
      }).catch(() => caches.match(event.request))
    );
  }
});
