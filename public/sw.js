// 旅の道ラジオ Service Worker
// シェル (HTML/CSS/JS) は network-first で常に最新を取りに行く。
// 立ち絵 PNG・アイコン・MP3 は cache-first で一度落としたら永続的にローカル参照。

const CACHE_VERSION = 'v1-2026-05-11'
const SHELL_CACHE = `shell-${CACHE_VERSION}`
const ASSET_CACHE = `assets-${CACHE_VERSION}`

// インストール時にプリキャッシュする最低限 (シェル)
const PRECACHE_URLS = [
  '/',
  '/radio',
  '/manifest.json',
  '/favicon.ico',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/radio.svg',
  '/icons/game.svg',
  '/icons/calendar.svg',
  '/icons/bill.svg',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // 静的アセット (画像 / 音声 / フォント) は cache-first
  const isAsset = /\.(png|jpg|jpeg|webp|svg|mp3|wav|woff2?)$/i.test(url.pathname)
    || url.pathname.startsWith('/characters/')
    || url.pathname.startsWith('/audio/')
    || url.pathname.startsWith('/images/')
    || url.pathname.startsWith('/icons/')

  if (isAsset) {
    event.respondWith(
      caches.match(req).then((hit) => {
        if (hit) return hit
        return fetch(req).then((res) => {
          if (res.ok) {
            const clone = res.clone()
            caches.open(ASSET_CACHE).then((c) => c.put(req, clone))
          }
          return res
        })
      })
    )
    return
  }

  // HTML / JSON / その他は network-first (常に最新)、失敗時のみキャッシュ
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const clone = res.clone()
          caches.open(SHELL_CACHE).then((c) => c.put(req, clone))
        }
        return res
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('/')))
  )
})
