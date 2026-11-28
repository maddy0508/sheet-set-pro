/*
 * App shell cache so the application opens without a network, not just the data.
 *
 * Navigation is network first: a new deployment replaces the cached index.html as
 * soon as it loads, so a stale shell cannot pin an old bundle. Hashed assets are
 * cache first because their names change with their content. Nothing cross-origin
 * is touched, so database calls always go to the network and the store's outbox
 * decides what to do when they fail.
 *
 * Bump CACHE when changing caching behaviour: hashed assets left by an older
 * release are only evicted by the activate step, which keeps just this one cache.
 */
const CACHE = 'ssp-shell-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await Promise.allSettled(SHELL.map((path) => cache.add(new Request(path, { cache: 'reload' }))));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/rest/') || url.pathname.startsWith('/auth/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const shell = async () => (await cache.match('/index.html')) ?? (await cache.match('/'));
        try {
          const fresh = await fetch(request);
          // A proxy or load balancer answering 502/503 is not the application.
          if (!fresh.ok) return (await shell()) ?? fresh;
          await cache.put('/index.html', fresh.clone());
          return fresh;
        } catch {
          return (await shell()) ?? Response.error();
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const fresh = await fetch(request);
        if (fresh.ok) await cache.put(request, fresh.clone());
        return fresh;
      } catch {
        return Response.error();
      }
    })(),
  );
});
