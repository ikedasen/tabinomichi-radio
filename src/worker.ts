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
    // バッチ取得 (トップページで N 並列 fetch しないため)
    if (url.pathname === '/api/views' && req.method === 'GET') {
      const cache = caches.default
      // キャッシュキー = リクエスト URL。同一 id セットは 1 つのキャッシュを共有。
      // ここで返れば KV read は発生しない (= 課金されない) のが肝。
      const cached = await cache.match(req)
      if (cached) return cached

      const idsParam = url.searchParams.get('ids')
      if (!idsParam) return jsonRes({ counts: {} })
      const ids = idsParam
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && /^[A-Za-z0-9_-]{1,64}$/.test(s))
        .slice(0, 200)
      const results = await Promise.all(
        ids.map(async (id) => {
          const v = await env.VIEWS_KV.get(`ep:${id}`, { cacheTtl: VIEWS_CACHE_TTL })
          return [id, v ? parseInt(v, 10) || 0 : 0] as const
        }),
      )
      const counts: Record<string, number> = {}
      for (const [id, n] of results) counts[id] = n
      const res = jsonRes({ counts }, 200, VIEWS_CACHE_TTL)
      // レスポンスをエッジキャッシュへ (本流をブロックしない)
      ctx.waitUntil(cache.put(req, res.clone()))
      return res
    }

    // /api/views/<episode_id>
    //   GET  -> { count: N }
    //   POST -> increments by 1, returns { count: N+1 }
    if (url.pathname.startsWith('/api/views/')) {
      const id = url.pathname.slice('/api/views/'.length).trim()
      if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
        return jsonRes({ error: 'invalid id' }, 400)
      }
      const key = `ep:${id}`

      if (req.method === 'GET') {
        const cache = caches.default
        const cached = await cache.match(req)
        if (cached) return cached
        const raw = await env.VIEWS_KV.get(key, { cacheTtl: VIEWS_CACHE_TTL })
        const count = raw ? parseInt(raw, 10) || 0 : 0
        const res = jsonRes({ count }, 200, VIEWS_CACHE_TTL)
        ctx.waitUntil(cache.put(req, res.clone()))
        return res
      }

      if (req.method === 'POST') {
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
