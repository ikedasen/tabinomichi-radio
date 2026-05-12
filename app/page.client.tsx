'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import LoadingSpinner from './components/LoadingSpinner'

type FeaturedGame = {
  title?: string
  developers?: string[]
  release_date?: string
  price?: string
  short_description?: string
  image_rel?: string
  hero_rel?: string
  app_id?: number
} | null

type Episode = {
  episode_id: string
  profile: string
  title: string
  generated_at: string | null
  duration_sec: number | null
  audio_url: string
  meta_url: string
  script_url: string
  audio_size_mb?: number
  featured_game: FeaturedGame
  program_description: string
}

const formatDate = (iso: string | null) => {
  if (!iso) return ''
  try { return new Date(iso).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' }) }
  catch { return iso }
}

const dateKey = (iso: string | null): string => {
  if (!iso) return 'unknown'
  try {
    const d = new Date(iso)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  } catch { return iso.slice(0, 10) }
}

const shortenDesc = (text: string, target = 100): string => {
  if (!text) return ''
  if (text.length <= target + 30) return text
  const window = text.slice(0, target + 80)
  const punct = ['。', '！', '!', '？', '?']
  let bestIdx = -1
  for (let i = target - 60; i < window.length; i++) {
    if (punct.includes(window[i])) { bestIdx = i + 1; if (i + 1 >= target - 20) break }
  }
  if (bestIdx > 0) return text.slice(0, bestIdx)
  return text.slice(0, target) + '…'
}

const MaskIcon = ({ src, className = '', style = {} }: { src: string; className?: string; style?: React.CSSProperties }) => (
  <span aria-hidden className={`inline-block bg-current ${className}`} style={{
    WebkitMaskImage: `url(${src})`, maskImage: `url(${src})`,
    WebkitMaskSize: 'contain', maskSize: 'contain',
    WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat',
    WebkitMaskPosition: 'center', maskPosition: 'center',
    ...style,
  }} />
)

export default function PageClient() {
  const [episodes, setEpisodes] = useState<Episode[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch('/data/episodes.json', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : { episodes: [] })
      .then((d) => {
        if (cancelled) return
        const all: Episode[] = d.episodes || []
        setEpisodes(all.filter((e) => e.profile === 'indie'))
      })
      .catch(() => { if (!cancelled) setEpisodes([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const groupedByDate = (() => {
    const groups: Record<string, Episode[]> = {}
    for (const ep of episodes) {
      const key = dateKey(ep.generated_at)
      if (!groups[key]) groups[key] = []
      groups[key].push(ep)
    }
    return Object.entries(groups)
      .map(([key, eps]) => ({ key, episodes: eps }))
      .sort((a, b) => b.key.localeCompare(a.key))
  })()

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-950 via-orange-900 to-amber-950 text-zinc-100">
      <header className="sticky top-0 z-40 bg-gradient-to-b from-amber-950 to-amber-950/0 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-3 md:px-4 py-4 md:py-5 flex items-center justify-between gap-3">
          <h1 className="text-2xl md:text-3xl font-bold text-white inline-flex items-baseline gap-2.5 tracking-tight">
            <MaskIcon src="/icons/radio.svg" className="w-5 h-5 md:w-6 md:h-6 text-amber-300 -translate-y-0.5 md:-translate-y-1" />
            Tabinomichi Radio
          </h1>
          <a
            href="https://tabinomichi.jp/"
            className="text-xs md:text-sm text-amber-200/80 hover:text-amber-100 tracking-widest border-b border-amber-200/30 hover:border-amber-100 transition-colors pb-px"
          >
            ← TABINOMICHI
          </a>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-8">
        {loading && (
          <div className="text-center py-16">
            <LoadingSpinner className="h-8 w-8 text-amber-300 mx-auto mb-3" />
            <p className="text-sm text-amber-100/70">エピソードを読み込み中…</p>
          </div>
        )}

        {!loading && episodes.length === 0 && (
          <div className="text-center py-16 text-amber-100/70 text-sm">
            まだラジオ番組が生成されていません。
          </div>
        )}

        {!loading && episodes.length > 0 && (
          <div className="space-y-10">
            {groupedByDate.map(({ key, episodes: dayEpisodes }) => {
              const firstIso = dayEpisodes[0]?.generated_at
              return (
                <section key={key}>
                  <div className="flex items-center justify-between gap-3 mb-4 border-b border-amber-200/20 pb-2">
                    <h2 className="text-lg md:text-xl font-bold text-amber-100 tracking-wide">
                      {firstIso ? formatDate(firstIso) : key}
                    </h2>
                    <Link
                      href={`/radio?date=${key}&queue=1`}
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full
                                 bg-amber-500/15 hover:bg-amber-400/25 ring-1 ring-amber-300/30
                                 text-xs md:text-sm font-medium text-amber-100 transition-colors"
                      title="この日付の番組を上から順に連続再生"
                    >
                      <span aria-hidden className="text-base leading-none -translate-y-px">▶</span>
                      この日を連続再生
                    </Link>
                  </div>

                  <div className="space-y-4">
                    {dayEpisodes.map((ep) => {
                      const game = ep.featured_game
                      const bg = game?.hero_rel || game?.image_rel || null
                      const shortDesc = shortenDesc(ep.program_description || '', 100)
                      return (
                        <Link
                          key={ep.episode_id}
                          href={`/radio?episode=${ep.episode_id}`}
                          className="group block rounded-2xl overflow-hidden ring-1 ring-white/10
                                     bg-black/30 backdrop-blur-sm shadow-lg hover:shadow-2xl transition-all duration-300 hover:-translate-y-0.5 hover:ring-white/20"
                        >
                          <div className="md:grid md:grid-cols-[240px_1fr]">
                            {/* aspect は Steam header 比率 (460:215 ≒ 2.14) で全機種統一。
                                portrait の VNDB cover も object-cover で水平スライス化される */}
                            <div className="relative aspect-[460/215] bg-zinc-900 overflow-hidden">
                              {bg ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={bg}
                                  alt={ep.title}
                                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }}
                                />
                              ) : (
                                <div className="w-full h-full bg-gradient-to-br from-orange-700 to-amber-900 flex items-center justify-center text-5xl">📻</div>
                              )}
                              <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent pointer-events-none" />
                            </div>

                            <div className="p-5 md:p-6 flex flex-col min-w-0">
                              <h3 className="text-lg md:text-xl font-bold text-white leading-snug mb-2 line-clamp-2">
                                {ep.title}
                              </h3>
                              <div className="flex items-center justify-between gap-3 mb-2">
                                <div className="text-sm text-amber-300 font-medium truncate">
                                  {game?.title || ''}
                                </div>
                                <div className="shrink-0 inline-flex items-center gap-1.5 text-xs md:text-sm font-medium text-amber-200 group-hover:text-amber-100 transition-colors">
                                  <MaskIcon src="/icons/radio.svg" className="w-4 h-4 -translate-y-0.5" />
                                  ラジオで聞く
                                </div>
                              </div>
                              {shortDesc ? (
                                <p className="text-sm text-zinc-200/80 leading-relaxed line-clamp-3">{shortDesc}</p>
                              ) : null}
                            </div>
                          </div>
                        </Link>
                      )
                    })}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
