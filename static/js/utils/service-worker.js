// Service Worker for Azure OpenAI o1 Chat Application
// Caching functionality disabled to prevent stale content issues

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

// Install event - no caching
self.addEventListener('install', event => {
  console.log('[Service Worker] Installing...');
  
  // Skip waiting to ensure the new service worker activates immediately
  self.skipWaiting();
  
  // No caching operations
});

// Activate event - clean up any existing caches
self.addEventListener('activate', event => {
  console.log('[Service Worker] Activating...');
  
  // Claim clients to ensure the service worker controls all clients immediately
  event.waitUntil(self.clients.claim());
  
  // Clean up all caches
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          console.log('[Service Worker] Removing cache:', cacheName);
          return caches.delete(cacheName);
        })
      );
    })
  );
});

// Fetch event - no interception, let browser handle normally
// self.addEventListener('fetch', event => {
//   // All requests go directly to the network
// });

// Handle messages from the client
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
