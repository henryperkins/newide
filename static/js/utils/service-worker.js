// Service Worker for Azure OpenAI o1 Chat Application
// DISABLED to prevent caching interference

// const CACHE_NAME = 'azure-openai-chat-v1';
// const ASSETS_TO_CACHE = [];

// self.addEventListener('install', () => {
//   console.log('[Service Worker] Installing...');
//   self.skipWaiting();
// });
// 
// self.addEventListener('activate', event => {
//   console.log('[Service Worker] Activating...');
//   event.waitUntil(self.clients.claim());
//   event.waitUntil(
//     caches.keys().then(cacheNames => Promise.all(
//       cacheNames.map(cacheName => caches.delete(cacheName))
//     ))
//   );
// });
// 
// // self.addEventListener('fetch', event => {
// //   // pass-through
// // });
// 
// self.addEventListener('message', event => {
//   if (event.data && event.data.type === 'SKIP_WAITING') {
//     self.skipWaiting();
//   }
// });

// This service worker is intentionally empty to prevent caching issues
// To completely disable, unregister any existing service worker in your browser:
// 1. Open Dev Tools → Application → Service Workers
// 2. Click "Unregister" for any service workers on this site
// 3. Reload the page
