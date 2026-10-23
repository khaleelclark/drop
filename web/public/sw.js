// Only the application shell is cached. Private API responses and transfers never enter this cache.
const CACHE = 'household-shell-v13';
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(['/', '/icon.svg', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('household-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || /^\/api(?:\/|$)/.test(url.pathname)) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/').then(response => response || Response.error())));
  } else if (url.pathname.startsWith('/assets/') || ['/icon.svg', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest'].includes(url.pathname)) {
    event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy)); }
      return response;
    })));
  }
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const itemId = event.notification.data && event.notification.data.itemId;
  if (typeof itemId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(itemId)) return;
  const target = new URL('/?item=' + encodeURIComponent(itemId), self.location.origin);
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async windows => {
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin && new URL(client.url).pathname === '/');
    if (existing) { await existing.focus(); existing.postMessage({type:'zing-arrival',itemId}); }
    else await self.clients.openWindow(target.href);
  }));
});
