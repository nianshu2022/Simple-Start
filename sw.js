const CACHE_NAME = 'simple-tab-v7';
const APP_SHELL_CACHE = [
    './',
    './index.html',
    './css/style.css',
    './css/weather.css',
    './js/main.js',
    './js/data.js',
    './js/weather.js',
    './js/weather-animation.js',
    './img/icon-512.png',
    './manifest.webmanifest'
];

const STATIC_CACHE_ALLOWLIST = [
    '/index.html',
    '/css/style.css',
    '/css/weather.css',
    '/js/main.js',
    '/js/data.js',
    '/js/weather.js',
    '/js/weather-animation.js',
    '/manifest.webmanifest',
    '/img/icon-512.png'
];

const API_CACHE_ALLOWLIST = [
    '/api/weather'
];

function swLog(level, message, extra) {
    const logger = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    if (typeof extra === 'undefined') {
        logger(`[SW] ${message}`);
    } else {
        logger(`[SW] ${message}`, extra);
    }
}

function isSameOrigin(url) {
    return url.origin === self.location.origin;
}

function isStaticAsset(url) {
    return /\.(css|js|png|jpg|jpeg|svg|ico|webp|woff2?)($|\?)/i.test(url.pathname);
}

function isAllowedPath(pathname, allowlist) {
    return allowlist.some((allowed) => pathname === allowed || pathname.startsWith(`${allowed}/`));
}

function shouldCacheStaticRequest(url) {
    return isAllowedPath(url.pathname, STATIC_CACHE_ALLOWLIST);
}

function shouldCacheApiRequest(url) {
    return isAllowedPath(url.pathname, API_CACHE_ALLOWLIST);
}

function shouldHandleRequest(request) {
    if (request.method !== 'GET') return false;
    const url = new URL(request.url);
    if (!isSameOrigin(url)) return false;
    return true;
}

async function matchStaticCache(request) {
    // 静态资源允许忽略查询参数（例如 ?v=3），提升离线命中率
    const direct = await caches.match(request);
    if (direct) return direct;
    return caches.match(request, { ignoreSearch: true });
}

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_CACHE))
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys.map((key) => (key !== CACHE_NAME ? caches.delete(key) : Promise.resolve()))
            )
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    if (!shouldHandleRequest(event.request)) return;

    const url = new URL(event.request.url);

    // 导航请求：Network First，离线回退 index
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', responseClone));
                    return response;
                })
                .catch(async (error) => {
                    swLog('warn', '导航请求网络失败，尝试回退缓存 index.html', { path: url.pathname, error: String(error?.message || error) });
                    const cached = await caches.match('./index.html');
                    if (!cached) {
                        swLog('error', '导航回退失败：未命中 index.html 缓存', { path: url.pathname });
                    }
                    return cached || Response.error();
                })
        );
        return;
    }

    // 同源静态资源：Stale-While-Revalidate（仅白名单资源进入缓存）
    if (isStaticAsset(url)) {
        event.respondWith(
            matchStaticCache(event.request).then((cached) => {
                const networkFetch = fetch(event.request)
                    .then((response) => {
                        if (!response || !response.ok) return response;
                        if (!shouldCacheStaticRequest(url)) {
                            swLog('warn', '静态资源不在缓存白名单，跳过写入', { path: url.pathname });
                            return response;
                        }
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                        return response;
                    })
                    .catch((error) => {
                        swLog('warn', '静态资源网络失败，回退缓存', { path: url.pathname, error: String(error?.message || error) });
                        return cached;
                    });

                if (!cached) {
                    swLog('warn', '静态资源未命中缓存，等待网络返回', { path: url.pathname });
                }
                return cached || networkFetch;
            })
        );
        return;
    }

    // API 请求：网络优先，失败时回退缓存（仅白名单 API 写入缓存）
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    if (response && response.ok) {
                        if (shouldCacheApiRequest(url)) {
                            const clone = response.clone();
                            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                        } else {
                            swLog('warn', 'API 不在缓存白名单，跳过写入', { path: url.pathname });
                        }
                    }
                    return response;
                })
                .catch(async (error) => {
                    swLog('warn', 'API 网络失败，尝试回退缓存', { path: url.pathname, error: String(error?.message || error) });
                    const fallback = await caches.match(event.request);
                    if (!fallback) {
                        swLog('error', 'API 回退失败：缓存未命中', { path: url.pathname });
                    }
                    return fallback;
                })
        );
        return;
    }

    // 其他同源 GET 请求：优先网络，失败回退缓存
    event.respondWith(
        fetch(event.request)
            .then((response) => response)
            .catch(async (error) => {
                swLog('warn', '同源请求网络失败，尝试回退缓存', { path: url.pathname, error: String(error?.message || error) });
                const fallback = await caches.match(event.request);
                if (!fallback) {
                    swLog('error', '同源请求回退失败：缓存未命中', { path: url.pathname });
                }
                return fallback;
            })
    );
});
