const CACHE_NAME = 'simple-tab-v3';
const ASSETS = [
    './',
    './index.html',
    './css/style.css',
    './js/main.js',
    './js/data.js',
    './img/icon-512.png'
];

// Install Event - Skip waiting to activate immediately
self.addEventListener('install', (e) => {
    self.skipWaiting();
    e.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[Service Worker] Caching all: app shell and content');
                return cache.addAll(ASSETS);
            })
    );
});

// Fetch Event - Network first, fall back to cache
self.addEventListener('fetch', (e) => {
    e.respondWith(
        fetch(e.request)
            .then(response => {
                // Clone the response and update cache
                const responseClone = response.clone();
                caches.open(CACHE_NAME).then(cache => {
                    cache.put(e.request, responseClone);
                });
                return response;
            })
            .catch(() => {
                // If network fails, serve from cache
                return caches.match(e.request);
            })
    );
});

// Activate Event - Clean up old caches and claim clients
self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then(keyList => {
            return Promise.all(keyList.map(key => {
                if (key !== CACHE_NAME) {
                    return caches.delete(key);
                }
            }));
        }).then(() => {
            return self.clients.claim();
        })
    );
});
