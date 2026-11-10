// Minimal service worker: makes the site installable. It does not cache anything,
// so every visit always loads the latest deployment.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
