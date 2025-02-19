// service-worker.js
const CACHE_NAME = 'o1-chat-cache-v1';
const URLS_TO_CACHE = [
  '/',
  '/static/index.html',
  '/static/variables.css',
  '/static/base.css',
  '/static/components.css',
  '/static/media.css',
  '/static/fonts.css',
  '/static/chat.js',
  '/static/lib/markdown-it.min.js',
  '/static/lib/prism.min.js',
  '/static/lib/marked.min.js',
  '/static/lib/prism.min.css',
  // Add font files here
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(URLS_TO_CACHE))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});