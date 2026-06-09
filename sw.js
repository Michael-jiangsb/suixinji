/**
 * 随心记 - Service Worker
 * PWA 离线缓存 + 更新策略：Cache First, Network Update
 */
const CACHE_NAME = 'suixinji-v4';
const TESSERACT_CACHE = 'tesseract-data-v2';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/db.js',
  '/js/app.js',
  '/manifest.json'
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
  // 跳过非 GET 请求
  if (event.request.method !== 'GET') return;
  // 跳过 chrome-extension 和 Tesseract CDN
  const url = new URL(event.request.url);
  if (url.protocol === 'chrome-extension:') return;

  // 对于 Tesseract 语言包 CDN（unpkg.com），使用缓存优先以加速二次加载
  if (url.hostname === 'unpkg.com' && url.pathname.includes('tesseract')) {
    event.respondWith(tesseractCacheFirst(event.request));
    return;
  }

  // 本地资源：缓存优先
  event.respondWith(cacheFirst(event.request));
});

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
