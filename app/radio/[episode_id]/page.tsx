import type { Metadata } from 'next'
import { promises as fs } from 'fs'
import path from 'path'
import { Suspense } from 'react'
import { RadioPageInner } from '../page'

type Episode = {
  episode_id: string
  profile: string
  title: string
  generated_at?: string | null
  program_description?: string
  featured_game?: {
    title?: string
    image_rel?: string
    hero_rel?: string
    screenshot_rels?: string[]
  } | null
}

async function loadEpisodes(): Promise<Episode[]> {
  const p = path.join(process.cwd(), 'public', 'data', 'episodes.json')
  try {
    const text = await fs.readFile(p, 'utf-8')
    const j = JSON.parse(text)
    return (j.episodes || []) as Episode[]
  } catch {
    return []
  }
}

export const dynamicParams = false

export async function generateStaticParams() {
  const all = await loadEpisodes()
  // indie / ai 両プロファイル対応
  return all.map((e) => ({ episode_id: e.episode_id }))
}

export async function generateMetadata(
  { params }: { params: { episode_id: string } }
): Promise<Metadata> {
  const all = await loadEpisodes()
  const ep = all.find((e) => e.episode_id === params.episode_id)
  if (!ep) {
    return { title: '旅の道ラジオ' }
  }
  const fullTitle = `${ep.title} — 旅の道ラジオ`
  const rawDesc = ep.program_description || ''
  const description = rawDesc.length > 0
    ? (rawDesc.length > 200 ? rawDesc.slice(0, 200) + '…' : rawDesc)
    : 'ずんだもん × めたん × つむぎが届ける、ゲーム & テックニュース雑談ラジオ。'
  // 1200x630 landscape OG (build_og_image.py) を最優先。Steam capsule 等の
  // 縦長ソースを直接 OG にすると X/Twitter で小さく潰れるため、export 時に
  // 横長カード化したものを使う。fallback は従来通り featured_game の rel。
  const fg = ep.featured_game
  const img =
    `/images/og/${ep.episode_id}.jpg` ||
    fg?.image_rel ||
    fg?.hero_rel ||
    (fg?.screenshot_rels && fg.screenshot_rels[0]) ||
    '/og-image.png'
  const url = `/radio/${ep.episode_id}`
  return {
    title: fullTitle,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'article',
      url,
      siteName: '旅の道ラジオ',
      title: fullTitle,
      description,
      images: [{ url: img, alt: ep.title }],
      locale: 'ja_JP',
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description,
      images: [img],
    },
  }
}

export default function EpisodePage({ params }: { params: { episode_id: string } }) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-900" />}>
      <RadioPageInner initialEpisode={params.episode_id} />
    </Suspense>
  )
}
