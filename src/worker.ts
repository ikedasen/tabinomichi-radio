interface Env {
  ASSETS: Fetcher
  VIEWS_KV: KVNamespace
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
}

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)

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
        const raw = await env.VIEWS_KV.get(key)
        const count = raw ? parseInt(raw, 10) || 0 : 0
        return jsonRes({ count })
      }

      if (req.method === 'POST') {
        const raw = await env.VIEWS_KV.get(key)
        const current = raw ? parseInt(raw, 10) || 0 : 0
        const next = current + 1
        await env.VIEWS_KV.put(key, String(next))
        return jsonRes({ count: next })
      }

      return new Response('method not allowed', { status: 405 })
    }

    // Fall through to static assets
    return env.ASSETS.fetch(req)
  },
}
