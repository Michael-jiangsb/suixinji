/**
 * 随心记 - Service Worker
 * PWA 离线缓存 + 更新策略：Cache First, Network Update
 * 特别处理：jsDelivr CDN 在国内不稳定，自动重定向到 gcore 镜像
 */
const CACHE_NAME = 'suixinji-v5';
const TESSERACT_CACHE = 'tesseract-data-v3';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/db.js',
  '/js/app.js',
  '/manifest.json'
];

// jsDelivr CDN 镜像映射（国内优先）
const JSDELIVR_MIRRORS = [
  'https://gcore.jsdelivr.net',
  'https://fastly.jsdelivr.net',
];

// 安装：预缓存核心文件
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Pre-caching app shell');
      return cache.addAll(PRECACHE_URLS);
    }).then(() => {
      return self.skipWaiting();
    })
  );
});

// 激活：清理旧缓存
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== TESSERACT_CACHE)
          .map((name) => caches.delete(name))
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// 请求拦截：缓存优先 + 网络更新
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.protocol === 'chrome-extension:') return;

  // jsDelivr 主站 → 自动重定向到 gcore 镜像（国内加速）
  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(jsdelivrMirrorFetch(event.request, url));
    return;
  }

  // Tesseract 语言包 CDN（unpkg/gcore/fastly）→ 缓存优先
  if ((url.hostname === 'unpkg.com' && url.pathname.includes('tesseract')) ||
      (url.hostname.includes('jsdelivr.net') && url.pathname.includes('tesseract'))) {
    event.respondWith(tesseractCacheFirst(event.request));
    return;
  }

  event.respondWith(cacheFirst(event.request));
});

/**
 * jsDelivr 镜像回退：拦截 cdn.jsdelivr.net 请求，依次尝试 gcore → fastly 镜像
 * 首次成功后缓存，后续秒开
 */
async function jsdelivrMirrorFetch(originalRequest, originalUrl) {
  const cached = await caches.match(originalRequest, { cacheName: TESSERACT_CACHE });
  if (cached) {
    console.log('[SW] jsDelivr cache hit:', originalUrl.href);
    return cached;
  }

  const pathWithQuery = originalUrl.pathname + originalUrl.search;
  for (const mirror of JSDELIVR_MIRRORS) {
    try {
      const mirrorUrl = mirror + pathWithQuery;
      console.log('[SW] Trying mirror:', mirrorUrl);
      const response = await fetch(mirrorUrl, { signal: AbortSignal.timeout(30000) });
      if (response.ok) {
        const cache = await caches.open(TESSERACT_CACHE);
        cache.put(originalRequest, response.clone());
        console.log('[SW] Mirror success, cached');
        return response;
      }
    } catch (e) {
      console.warn('[SW] Mirror failed:', mirror, e.message);
    }
  }
  return new Response('CDN unavailable', { status: 503 });
}

// Tesseract 语言包专用缓存策略（长期缓存，因为这些文件不会变）
async function tesseractCacheFirst(request) {
  const cached = await caches.match(request, { cacheName: TESSERACT_CACHE });
  if (cached) {
    console.log('[SW] Tesseract cache hit:', request.url);
    return cached;
  }
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(TESSERACT_CACHE);
      cache.put(request, response.clone());
      console.log('[SW] Tesseract cached:', request.url);
    }
    return response;
  } catch (e) {
    console.warn('[SW] Tesseract fetch failed:', e);
    return new Response('Network error', { status: 503 });
  }
}

// 缓存优先策略
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    // 后台更新
    fetch(request).then((response) => {
      if (response.ok) {
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, response);
        });
      }
    }).catch(() => {});
    return cached;
  }
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (e) {
    // 离线时返回一个友好的离线页面
    if (request.destination === 'document') {
      return caches.match('/index.html');
    }
    return new Response('Offline', { status: 503 });
  }
}
