// 旅の道ラジオ Service Worker
// シェル (HTML/CSS/JS) は network-first で常に最新を取りに行く。
// 画像・アイコンは cache-first (?v=<mtime> で URL が変わる前提)、
// 立ち絵 (/characters/ = バージョン無し URL) は stale-while-revalidate。
// MP3 は intercept しない。

const CACHE_VERSION = 'v13-2026-07-12-swr-prune'
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

// put + 同一 pathname の旧 ?v= バリアントを掃除する。
// 旧実装は put しっぱなしで、日々増える ?v= 付き画像 / meta.json / 過去デプロイの
// _next チャンクが quota を食い潰し続けていた (2026-07-12 review)。
// put の失敗 (QuotaExceededError 等) も握りつぶして本流を守る。
function putAndPrune(cacheName, req, res) {
  return caches.open(cacheName).then((c) =>
    c.put(req, res).then(() => {
      const reqUrl = new URL(req.url)
      if (!reqUrl.search) return
      return c.keys().then((keys) => {
        const stale = keys.filter((k) => {
          if (k.url === req.url) return false
          try {
            const u = new URL(k.url)
            return u.origin === reqUrl.origin && u.pathname === reqUrl.pathname
          } catch { return false }
        })
        return Promise.all(stale.map((k) => c.delete(k)))
      })
    })
  ).catch(() => {})
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // 音声ファイルは SW で intercept しない (Range リクエストをブラウザに直接処理させる)
  // SW のキャッシュ経由だと部分取得が効かず、audio.currentTime によるシークが先頭に戻ってしまう
  const isMedia = /\.(mp3|wav|m4a|ogg)$/i.test(url.pathname)
  if (isMedia) return  // ブラウザ標準の挙動に任せる

  // 立ち絵は URL にバージョンが無い (?v= 無し) ので cache-first だと PSD 再 export が
  // 既存訪問者に永遠に届かない事故がある (v12 期間に実発生)。
  // stale-while-revalidate: キャッシュを即返しつつ裏で更新 → 次の訪問で新絵になる。
  if (url.pathname.startsWith('/characters/')) {
    event.respondWith(
      caches.match(req).then((hit) => {
        const refresh = fetch(req).then((res) => {
          if (res.ok) putAndPrune(ASSET_CACHE, req, res.clone())
          return res
        }).catch(() => hit)
        return hit || refresh
      })
    )
    return
  }

  // 静的アセット (画像 / フォント / SVG / アイコン) は cache-first
  // (?v=<mtime> で URL が変わるので stale の心配は無い)
  const isAsset = /\.(png|jpg|jpeg|webp|svg|woff2?)$/i.test(url.pathname)
    || url.pathname.startsWith('/images/')
    || url.pathname.startsWith('/icons/')

  if (isAsset) {
    event.respondWith(
      caches.match(req).then((hit) => {
        if (hit) return hit
        return fetch(req).then((res) => {
          if (res.ok) putAndPrune(ASSET_CACHE, req, res.clone())
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
        if (res.ok) putAndPrune(SHELL_CACHE, req, res.clone())
        return res
      })
      .catch(() =>
        caches.match(req).then((hit) => {
          if (hit) return hit
          // トップ HTML へのフォールバックはページ遷移のみ。JSON/API に HTML を
          // 返すと呼び出し側の r.json() が謎の SyntaxError で死ぬ (2026-07-12 review)。
          if (req.mode === 'navigate') return caches.match('/')
          return new Response('offline', { status: 503, statusText: 'offline' })
        })
      )
  )
})
