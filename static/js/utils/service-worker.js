// Service Worker for Azure OpenAI o1 Chat Application
// Provides offline support and caching for the application

const CACHE_NAME = 'azure-openai-chat-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/static/index.html',
  '/static/css/tailwind.compiled.css',
  '/static/js/init.js',
  '/static/js/chat.js',
  '/static/js/config.js',
  '/static/js/models.js',
  '/static/js/session.js',
  '/static/js/streaming.js',
  '/static/js/fileManager.js',
  '/static/js/ui/displayManager.js',
  '/static/js/ui/markdownParser.js',
  '/static/js/ui/notificationManager.js',
  '/static/js/ui/statsDisplay.js',
  '/static/js/ui/tabManager.js',
  '/static/js/ui/themeSwitcher.js',
  '/static/js/utils/helpers.js',
  '/static/lib/markdown-it.min.js',
  '/static/lib/purify.min.js',
  '/static/lib/prism.min.js',
  '/static/lib/prism.min.css',
  '/static/fonts/inter/inter-400.woff2',
  '/static/fonts/inter/inter-500.woff2',
  '/static/fonts/inter/inter-600.woff2',
  '/static/fonts/inter/inter-700.woff2',
  '/static/fonts/jetbrains-mono/jetbrains-mono-400.woff2',
  '/static/fonts/jetbrains-mono/jetbrains-mono-500.woff2',
  '/static/img/favicon.ico'
];

// Install event - cache assets
self.addEventListener('install', event => {
  console.log('[Service Worker] Installing...');
  
  // Skip waiting to ensure the new service worker activates immediately
  self.skipWaiting();
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[Service Worker] Caching app shell and content');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .catch(error => {
        console.error('[Service Worker] Cache install error:', error);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  console.log('[Service Worker] Activating...');
  
  // Claim clients to ensure the service worker controls all clients immediately
  event.waitUntil(self.clients.claim());
  
  // Clean up old caches
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] Removing old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', event => {
  // Skip cross-origin requests
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }
  
  // Skip API requests
  if (event.request.url.includes('/api/')) {
    return;
  }
  
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Return cached response if found
        if (response) {
          return response;
        }
        
        // Otherwise fetch from network
        return fetch(event.request)
          .then(networkResponse => {
            // Don't cache non-successful responses
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
              return networkResponse;
            }
            
            // Clone the response to cache it and return it
            const responseToCache = networkResponse.clone();
            
            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(event.request, responseToCache);
              });
              
            return networkResponse;
          })
          .catch(error => {
            console.error('[Service Worker] Fetch error:', error);
            
            // For HTML requests, return the offline page
            if (event.request.headers.get('accept').includes('text/html')) {
              return caches.match('/static/index.html');
            }
            
            return new Response('Network error', {
              status: 408,
              headers: { 'Content-Type': 'text/plain' }
            });
          });
      })
  );
});

// Handle messages from the client
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
