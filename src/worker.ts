interface Env {
  ASSETS: Fetcher
  VIEWS_KV: KVNamespace
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
}

// View 取得 GET をエッジキャッシュする秒数。
// 同じ URL に来る bot / リロードはこのキャッシュから返り、KV を一切叩かない。
// (請求爆発の真因 = 1 期間で 746M KV read。下記キャッシュでこれをほぼゼロ化する)
const VIEWS_CACHE_TTL = 60

// 2026-07-12 billing-hardening review:
//   - キャッシュキーを「正規化した URL」にする (旧実装は生 URL がキーだったので、
//     ids の順序替え/重複/ジャンク param 付与で 100% キャッシュ回避 → 1 リクエスト
//     最大 200 KV read の増幅が可能だった)
//   - episode_id を episodes.json 由来の allowlist で検証 (実在しない key への
//     KV read/write も課金されるため、存在しない id は KV に触れず即返す)
//   - POST は same-origin ヘッダゲート + edge-cache による per-IP/ep スロットル
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const ALLOWLIST_TTL_MS = 5 * 60_000
const POST_THROTTLE_SECONDS = 60

// isolate 単位の allowlist memo。ASSETS fetch は課金対象外のサブリクエスト。
let allowlistCache: { ids: Set<string>; expires: number } | null = null

async function getAllowlist(env: Env, origin: string): Promise<Set<string> | null> {
  const now = Date.now()
  if (allowlistCache && allowlistCache.expires > now) return allowlistCache.ids
  try {
    const res = await env.ASSETS.fetch(new Request(`${origin}/data/episodes.json`))
    if (!res.ok) return allowlistCache ? allowlistCache.ids : null
    const data = (await res.json()) as { episodes?: Array<{ episode_id?: string }> }
    const ids = new Set<string>()
    for (const e of data.episodes ?? []) {
      if (e && typeof e.episode_id === 'string') ids.add(e.episode_id)
    }
    if (ids.size === 0) return allowlistCache ? allowlistCache.ids : null
    allowlistCache = { ids, expires: now + ALLOWLIST_TTL_MS }
    return ids
  } catch {
    // episodes.json が読めない間は直近の allowlist で継続 (無ければ検証スキップ =
    // 旧挙動へフォールバック。可用性 > 完全性)
    return allowlistCache ? allowlistCache.ids : null
  }
}

function jsonRes(body: unknown, status = 200, cacheSeconds = 0): Response {
  const headers: Record<string, string> = { ...JSON_HEADERS }
  // GET は s-maxage でエッジキャッシュ許可、書き込み系は no-store
  headers['cache-control'] =
    cacheSeconds > 0
      ? `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}`
      : 'no-store'
  return new Response(JSON.stringify(body), { status, headers })
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url)

    // /api/views?ids=id1,id2,id3
    //   GET  -> { counts: { id1: N, id2: M, ... } }
    // バッチ取得 (トップページで N 並列 fetch しないため。現在の正規クライアントは
    // build 時の scripts/gen-views.mjs のみ)
    if (url.pathname === '/api/views' && req.method === 'GET') {
      const idsParam = url.searchParams.get('ids')
      if (!idsParam) return jsonRes({ counts: {} })

      // 正規化: trim → 形式検証 → dedupe → sort → cap。
      // これをキャッシュキーにするので、順序替え/重複/ジャンク param では
      // キャッシュを回避できない。
      const ids = [...new Set(
        idsParam.split(',').map((s) => s.trim()).filter((s) => ID_RE.test(s)),
      )].sort().slice(0, 200)
      if (ids.length === 0) return jsonRes({ counts: {} })

      const cache = caches.default
      const canonical = new Request(`${url.origin}/api/views?ids=${ids.join(',')}`)
      const cached = await cache.match(canonical)
      if (cached) return cached

      // 実在 ep のみ KV に問い合わせる (存在しない id は 0 固定で KV 非接触)
      const allowlist = await getAllowlist(env, url.origin)
      const known = allowlist ? ids.filter((id) => allowlist.has(id)) : ids

      const results = await Promise.all(
        known.map(async (id) => {
          const v = await env.VIEWS_KV.get(`ep:${id}`, { cacheTtl: VIEWS_CACHE_TTL })
          return [id, v ? parseInt(v, 10) || 0 : 0] as const
        }),
      )
      const counts: Record<string, number> = {}
      for (const id of ids) counts[id] = 0
      for (const [id, n] of results) counts[id] = n
      const res = jsonRes({ counts }, 200, VIEWS_CACHE_TTL)
      // レスポンスをエッジキャッシュへ (本流をブロックしない)
      ctx.waitUntil(cache.put(canonical, res.clone()))
      return res
    }

    // /api/views/<episode_id>
    //   GET  -> { count: N }
    //   POST -> increments by 1, returns { count: N+1 }
    if (url.pathname.startsWith('/api/views/')) {
      const id = url.pathname.slice('/api/views/'.length).trim()
      if (!id || !ID_RE.test(id)) {
        return jsonRes({ error: 'invalid id' }, 400)
      }
      const key = `ep:${id}`

      if (req.method === 'GET') {
        const cache = caches.default
        // キャッシュキーはクエリを落とした正規 URL (?junk= でのキャッシュ回避防止)
        const canonical = new Request(`${url.origin}${url.pathname}`)
        const cached = await cache.match(canonical)
        if (cached) return cached
        const allowlist = await getAllowlist(env, url.origin)
        if (allowlist && !allowlist.has(id)) {
          // 未知 id は KV 非接触で 0 を返し、それ自体もキャッシュする
          const res = jsonRes({ count: 0 }, 200, VIEWS_CACHE_TTL)
          ctx.waitUntil(cache.put(canonical, res.clone()))
          return res
        }
        const raw = await env.VIEWS_KV.get(key, { cacheTtl: VIEWS_CACHE_TTL })
        const count = raw ? parseInt(raw, 10) || 0 : 0
        const res = jsonRes({ count }, 200, VIEWS_CACHE_TTL)
        ctx.waitUntil(cache.put(canonical, res.clone()))
        return res
      }

      if (req.method === 'POST') {
        // ゲート 1: ブラウザ発のクロスオリジン POST を拒否 (drive-by カウント水増し
        // 防止)。ヘッダ非送信のクライアント (curl 等) は通るが、ゲート 2/3 が受ける。
        const sfs = req.headers.get('sec-fetch-site')
        const origin = req.headers.get('origin')
        if ((sfs && sfs !== 'same-origin') || (origin && origin !== url.origin)) {
          return jsonRes({ error: 'forbidden' }, 403)
        }

        // ゲート 2: 実在 ep のみ (存在しない key の生成 = KV write 課金 を遮断)
        const allowlist = await getAllowlist(env, url.origin)
        if (allowlist && !allowlist.has(id)) {
          return jsonRes({ error: 'unknown id' }, 404)
        }

        // ゲート 3: per-IP × per-ep スロットル。edge cache をロックとして使い、
        // 同一 IP から同一 ep への増分は 60 秒に 1 回まで (KV write は $5/M で
        // read の 10 倍。正規クライアントは localStorage で 24h dedup 済みなので
        // 正常系ではここに複数回来ない)。colo 単位だが防御として十分。
        const ip = req.headers.get('cf-connecting-ip') || 'unknown'
        const cache = caches.default
        const lockUrl = `${url.origin}/__throttle/views/${encodeURIComponent(ip)}/${id}`
        const lockReq = new Request(lockUrl)
        const locked = await cache.match(lockReq)
        if (locked) {
          return jsonRes({ error: 'too many requests' }, 429)
        }
        ctx.waitUntil(cache.put(
          lockReq,
          new Response('1', {
            headers: { 'cache-control': `public, s-maxage=${POST_THROTTLE_SECONDS}` },
          }),
        ))

        const raw = await env.VIEWS_KV.get(key)
        const current = raw ? parseInt(raw, 10) || 0 : 0
        const next = current + 1
        await env.VIEWS_KV.put(key, String(next))
        return jsonRes({ count: next }, 200, 0)
      }

      return new Response('method not allowed', { status: 405 })
    }

    // Fall through to static assets
    return env.ASSETS.fetch(req)
  },
}
