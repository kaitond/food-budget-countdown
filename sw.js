/* 食費カウントダウン — オフライン用 Service Worker */
const VERSION = 'v4';
const CACHE = 'foodbudget-' + VERSION;
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './supabase.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
];

/* 1つでも取得に失敗すると addAll は全部を破棄してしまうため、1件ずつ入れる */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(ASSETS.map(a => c.add(a).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* HTML と JS は「通信優先・失敗したらキャッシュ」＝更新が即反映され、圏外でも動く
   画像やmanifestは「キャッシュ優先」＝表示が速い */
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;

  const fresh = req.mode === 'navigate' || /\.(html|js)$/.test(url.pathname) || url.pathname.endsWith('/');

  if (fresh) {
    e.respondWith(
      fetch(req).then(res => {
        if (res && res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(req, cp)); }
        return res;
      }).catch(() => caches.match(req).then(hit => {
        if (hit) return hit;
        // ページ遷移のときだけ index.html で代替する。
        // JS の代わりに HTML を返すと構文エラーになり、アプリ全体が止まるため。
        if (req.mode === 'navigate') return caches.match('./index.html');
        return new Response('', { status: 504, statusText: 'offline' });
      }))
    );
    return;
  }
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res && res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(req, cp)); }
      return res;
    }))
  );
});
