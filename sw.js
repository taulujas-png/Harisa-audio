const CACHE = 'harisa-audio-v2';
const BASE = '/Harisa-audio/';
const ASSETS = [BASE, BASE + 'index.html', BASE + 'manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Аудио стримы не кешируем
  if (e.request.url.includes('googlevideo') || e.request.url.includes('piped')) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
