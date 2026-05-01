const CACHE = 'harisa-audio-v5';
const BASE = '/Harisa-audio/';
const ASSETS = [BASE, BASE + 'index.html', BASE + 'manifest.json'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener('activate', e => {
  self.clients.claim();
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  // Аудио стримы и API Piped не кешируем
  if (url.includes('googlevideo') || url.includes('piped') || url.includes('api')) {
    return;
  }
  
  // Network first (fall back to cache) для основных файлов, чтобы всегда была свежая версия
  e.respondWith(
    fetch(e.request)
      .then(res => {
        // Клонируем ответ и обновляем кэш
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
