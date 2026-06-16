// Generate public/data/views.json: a static snapshot of play counts.
//
// Why: the home page used to call /api/views on every visit, which (combined
// with a render loop) hammered KV and produced a 746M-read billing blowup.
// Instead we snapshot counts ONCE at build/deploy time into a static file the
// home page can read for free. The live /api/views endpoint is then only used
// by individual episode pages (one cheap read/write per real play).
//
// Run manually:  node scripts/gen-views.mjs
// Or via build:  npm run build  (this runs as the "prebuild" step)
//
// It is intentionally non-fatal: on any error it leaves the existing
// views.json untouched and exits 0, so a transient network issue never breaks
// the site build.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const episodesPath = join(root, 'public', 'data', 'episodes.json')
const outPath = join(root, 'public', 'data', 'views.json')
const SITE = process.env.SITE_ORIGIN || 'https://news.tabinomichi.jp'

async function main() {
  if (!existsSync(episodesPath)) {
    console.warn('[gen-views] episodes.json not found, skipping')
    return
  }
  const data = JSON.parse(readFileSync(episodesPath, 'utf8'))
  const eps = Array.isArray(data) ? data : data.episodes || []
  const ids = [...new Set(eps.map((e) => e && e.episode_id).filter(Boolean))]
  if (ids.length === 0) {
    console.warn('[gen-views] no episode ids, skipping')
    return
  }

  const counts = {}
  // Worker caps ids at 200 per request; chunk to stay under it.
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    const url = `${SITE}/api/views?ids=${chunk.join(',')}`
    const r = await fetch(url, { headers: { 'cache-control': 'no-cache' } })
    if (!r.ok) throw new Error(`fetch ${url} -> ${r.status}`)
    const j = await r.json()
    Object.assign(counts, (j && j.counts) || {})
  }

  writeFileSync(
    outPath,
    JSON.stringify({ counts, generated_at: new Date().toISOString() }) + '\n',
  )
  console.log(`[gen-views] wrote views.json with ${Object.keys(counts).length} counts`)
}

main().catch((err) => {
  // Non-fatal: keep any existing views.json, never break the build.
  console.warn(`[gen-views] failed (${err.message}); keeping existing views.json`)
  process.exitCode = 0
})
