'use strict';

// Change the version when the offline player files change.
const SHELL_PREFIX = 'subtok-shell-';
const SHELL_CACHE = SHELL_PREFIX + '1';
const SHELL = [
  '/index.html', '/app.css', '/app.js', '/share-link.js', '/cover.png', '/geist.woff2',
  '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache =>
    cache.addAll(SHELL.map(path => new Request(path, { cache: 'reload' })))));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(SHELL_PREFIX) && name !== SHELL_CACHE)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const { origin, pathname } = new URL(request.url);
  if (request.method !== 'GET' || origin !== self.location.origin) return;
  const navigation = request.mode === 'navigate';
  if (navigation ? !['/', '/index.html'].includes(pathname) : !SHELL.includes(pathname)) return;
  event.respondWith(networkOrShell(request, navigation ? '/index.html' : pathname));
});

async function networkOrShell(request, path) {
  let response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    response = await fetch(request, { signal: controller.signal });
    if (response.status < 500) return response;
  } catch { /* Use the installed player when the network fails. */ }
  finally { clearTimeout(timeout); }
  const cache = await caches.open(SHELL_CACHE);
  return await cache.match(path) || response || Response.error();
}
