'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import LoadingSpinner from './components/LoadingSpinner'
import SharePopover from './components/SharePopover'

type FeaturedGame = {
  title?: string
  developers?: string[]
  release_date?: string
  price?: string
  short_description?: string
  image_rel?: string
  hero_rel?: string
  app_id?: number
  genres?: string[]
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
  summary_short?: string
}

const formatDate = (iso: string | null) => {
  if (!iso) return ''
  try { return new Date(iso).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' }) }
  catch { return iso }
}

// 日付グループキーは ISO 文字列の日付部 (= pipeline が出す JST の暦日) をそのまま使う。
// 旧実装は new Date() 経由で「閲覧者のローカル TZ の暦日」を返しており、海外閲覧時に
// 「この日を連続再生」の ?date= (JST 前提で slice 比較) と食い違ってキューが崩れていた。
const dateKey = (iso: string | null): string => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return 'unknown'
  return iso.slice(0, 10)
}

// グループ見出しは key (JST 暦日) から直接整形する。formatDate (ローカル TZ) を使うと
// key と見出しの日付がずれる閲覧環境がある。
const formatDateKeyHeading = (key: string): string => {
  const m = key.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return key
  return `${m[1]}年${parseInt(m[2], 10)}月${parseInt(m[3], 10)}日`
}

const shortenDesc = (text: string, target = 150): string => {
  if (!text) return ''
  if (text.length <= target) return text
  const window = text.slice(0, target)
  const sentenceEnd = ['。', '！', '!', '？', '?']
  const softEnd = ['、', '・']
  // 1. target 以内で最後の文末記号を探す (target * 0.6 以降に限定して短すぎ防止)
  for (let i = window.length - 1; i >= Math.floor(target * 0.6); i--) {
    if (sentenceEnd.includes(window[i])) return window.slice(0, i + 1)
  }
  // 2. 文末がなければ読点で切って … をつける
  for (let i = window.length - 1; i >= Math.floor(target * 0.6); i--) {
    if (softEnd.includes(window[i])) return window.slice(0, i + 1) + '…'
  }
  // 3. それも無ければ単純 truncate
  return window.slice(0, target - 1) + '…'
}

function HomeViewCount({ count }: { count: number | undefined }) {
  if (count === undefined) return null
  return (
    <div className="absolute top-2 right-2 inline-flex items-center gap-1 text-[11px] text-white bg-black/55 px-2 py-0.5 rounded-full tabular-nums backdrop-blur-sm">
      <svg viewBox="0 0 16 16" width="9" height="9" fill="currentColor" aria-hidden>
        <path d="M3 2v12l10-6z" />
      </svg>
      <span>{count.toLocaleString()}</span>
    </div>
  )
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

// 'all' は「まとめ」タブ = プロフィール横断で全エピソードを日付順に並べる仮想タブ。
// episodes.json 側に profile:'all' のレコードがあるわけではない (フィルタしないだけ)。
type Profile = 'all' | 'indie' | 'ai' | 'zatsugaku'

const PROFILE_KEYS = ['all', 'indie', 'ai', 'zatsugaku'] as const

// URL の ?profile= を Profile に正規化する。未知の値・未指定は 'all' (既定 = まとめ)。
const parseProfile = (raw: string | null | undefined): Profile =>
  (PROFILE_KEYS as readonly string[]).includes(raw ?? '') ? (raw as Profile) : 'all'

// タブごとのホーム URL。既定タブ (all) だけクエリなし。
const profileHref = (p: Profile): string => (p === 'all' ? '/' : `/?profile=${p}`)

// カード上のジャンルラベル。まとめタブでは全プロフィールが日付順に混ざるので、
// タイトルだけだと何の回か分からない。タイトルの上に必ず出す。
const PROFILE_BADGES: Record<string, { label: string; className: string }> = {
  indie:     { label: 'ゲーム',         className: 'bg-[#66c0f4]/20 text-[#9fd4f7] ring-[#66c0f4]/40' },
  ai:        { label: 'テックニュース', className: 'bg-amber-400/20 text-amber-200 ring-amber-400/40' },
  zatsugaku: { label: '雑学',           className: 'bg-rose-400/20 text-rose-200 ring-rose-400/40' },
}

function ProfileBadge({ profile, className = '' }: { profile: string; className?: string }) {
  const b = PROFILE_BADGES[profile]
  if (!b) return null
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ring-1 ${b.className} ${className}`}>
      {b.label}
    </span>
  )
}

export default function PageClient() {
  const searchParamsForProfile = useSearchParams()
  const initialProfile: Profile = parseProfile(searchParamsForProfile?.get('profile'))
  const [profile, setProfile] = useState<Profile>(initialProfile)
  // 戻る/進むで URL が変わった時、profile state を URL と同期させる
  useEffect(() => {
    const fromUrl: Profile = parseProfile(searchParamsForProfile?.get('profile'))
    setProfile((prev) => (prev === fromUrl ? prev : fromUrl))
  }, [searchParamsForProfile])
  const [allEpisodes, setAllEpisodes] = useState<Episode[]>([])
  const [loading, setLoading] = useState(true)
  const [viewCounts, setViewCounts] = useState<Record<string, number>>({})

  useEffect(() => {
    let cancelled = false
    fetch('/data/episodes.json', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : { episodes: [] })
      .then((d) => {
        if (cancelled) return
        setAllEpisodes(d.episodes || [])
      })
      .catch(() => { if (!cancelled) setAllEpisodes([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // まとめタブは絞り込まない。episodes.json は全プロフィール混在で、
  // 表示側が日付グループ化するので、そのまま渡せば新しい順に並ぶ。
  const episodes = profile === 'all'
    ? allEpisodes
    : allEpisodes.filter((e) => e.profile === profile)

  // 再生数は静的スナップショット /data/views.json から読む (デプロイ時に生成)。
  // トップページは実行時に /api/views を一切叩かない -> KV read 課金事故を
  // 構造的にゼロにする。個別エピソードページだけが /api/views/<id> を
  // 実プレイ時に 1 read / 1 write 使う (安価・ガード済み)。
  useEffect(() => {
    let cancelled = false
    fetch('/data/views.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return
        if (d && d.counts && typeof d.counts === 'object') setViewCounts(d.counts)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const searchParams = useSearchParams()
  const filterGenre = searchParams?.get('genre') || null

  // タブ切替時に URL を ?profile=ai / 削除で更新 (戻る/共有で復元できるように)
  // Next.js router.replace を使うことで useSearchParams() も同期させる
  // (window.history.replaceState だけだと React state が更新されず、戻ったときに
  //  initial profile に戻ってしまう問題があったため)
  const router = useRouter()
  const pathname = usePathname() || '/'
  const handleProfileChange = (next: Profile) => {
    setProfile(next)
    const params = new URLSearchParams()
    if (next !== 'all') params.set('profile', next)
    // ジャンルフィルタは解除 (タブ切替時は別カテゴリへ移るため)
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  const filteredEpisodes = filterGenre
    ? episodes.filter((ep) => (ep.featured_game?.genres || []).includes(filterGenre))
    : episodes

  // ページネーション: 初期 20 件、「もっと見る」で +20 ずつ
  const PAGE_SIZE = 20
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE)
  // フィルタ切替時は表示件数リセット
  useEffect(() => { setDisplayCount(PAGE_SIZE) }, [filterGenre])

  const visibleEpisodes = filteredEpisodes.slice(0, displayCount)
  const hasMore = filteredEpisodes.length > displayCount

  const groupedByDate = (() => {
    const groups: Record<string, Episode[]> = {}
    for (const ep of visibleEpisodes) {
      const key = dateKey(ep.generated_at)
      if (!groups[key]) groups[key] = []
      groups[key].push(ep)
    }
    return Object.entries(groups)
      .map(([key, eps]) => ({ key, episodes: eps }))
      .sort((a, b) => b.key.localeCompare(a.key))
  })()

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1b2838] via-[#1b2838] to-[#171a21] text-zinc-100">
      <header className="sticky top-0 z-40 bg-gradient-to-b from-[#171a21] to-[#171a21]/0 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-3 md:px-4 py-2 md:py-5 flex items-center justify-between gap-2 md:gap-3">
          {/* min-w-0 + truncate: 端末のフォント設定が大きくてもタイトル側が縮み、
              右のシェアボタンが画面外に押し出されないようにする */}
          <h1 className="min-w-0 text-base md:text-3xl font-bold text-white inline-flex items-center gap-1.5 md:gap-2.5 tracking-tight">
            <MaskIcon src="/icons/radio.svg" className="shrink-0 w-4 h-4 md:w-6 md:h-6 text-[#66c0f4]" />
            <span className="truncate">Tabinomichi Radio</span>
          </h1>
          <div className="shrink-0 flex items-center gap-2">
            <a
              href="https://tabinomichi.jp/"
              className="hidden sm:inline-block text-xs md:text-sm text-[#c7d5e0]/80 hover:text-[#c7d5e0] tracking-widest border-b border-[#c7d5e0]/30 hover:border-[#c7d5e0] transition-colors pb-px whitespace-nowrap"
            >
              ← TABINOMICHI
            </a>
            {/* 狭い画面では文字を落として矢印だけ残す (タップ先は同じ) */}
            <a
              href="https://tabinomichi.jp/"
              aria-label="TABINOMICHI へ戻る"
              className="sm:hidden text-base text-[#c7d5e0]/80 hover:text-[#c7d5e0] px-1"
            >
              ←
            </a>
            <SharePopover variant="amber" />
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* プロファイル切替タブ */}
        {/* タブは 4 つ。狭い画面やフォント拡大時に折り返さないよう、
            whitespace-nowrap + 横スクロール (はみ出したらスワイプ) にする */}
        <div className="mb-6 flex items-center gap-1 md:gap-2 border-b border-[#c7d5e0]/15 overflow-x-auto no-scrollbar -mx-4 px-4">
          {([
            { key: 'all',       label: 'まとめ' },
            { key: 'indie',     label: 'ゲーム' },
            { key: 'ai',        label: 'テックニュース' },
            { key: 'zatsugaku', label: '雑学' },
          ] as { key: Profile; label: string }[]).map((tab) => {
            const active = profile === tab.key
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => handleProfileChange(tab.key)}
                className={
                  'relative shrink-0 whitespace-nowrap px-2.5 md:px-4 py-2.5 text-[13px] md:text-base font-medium transition-colors ' +
                  (active
                    ? 'text-[#c7d5e0]'
                    : 'text-[#c7d5e0]/50 hover:text-[#c7d5e0]/80')
                }
              >
                {tab.label}
                {active && (
                  <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-[#66c0f4]" />
                )}
              </button>
            )
          })}
        </div>

        {filterGenre && (
          <div className="mb-6 flex items-center gap-2 text-sm">
            <span className="text-[#c7d5e0]/80">ジャンルで絞り込み中:</span>
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#66c0f4]/20 ring-1 ring-[#66c0f4]/40 text-[#c7d5e0]">
              {filterGenre}
              <Link href={profileHref(profile)} className="text-[#c7d5e0]/70 hover:text-white" aria-label="フィルタ解除">×</Link>
            </span>
          </div>
        )}

        {loading && (
          <div className="text-center py-16">
            <LoadingSpinner className="h-8 w-8 text-[#66c0f4] mx-auto mb-3" />
            <p className="text-sm text-[#c7d5e0]/70">エピソードを読み込み中…</p>
          </div>
        )}

        {!loading && episodes.length === 0 && (
          <div className="text-center py-16 text-[#c7d5e0]/70 text-sm">
            まだラジオ番組が生成されていません。
          </div>
        )}

        {!loading && episodes.length > 0 && filteredEpisodes.length === 0 && (
          <div className="text-center py-16 text-[#c7d5e0]/70 text-sm">
            「{filterGenre}」に該当するエピソードはまだ無いっす。
            <div className="mt-3">
              <Link href="/" className="text-[#c7d5e0] hover:text-white underline">← 全エピソードを表示</Link>
            </div>
          </div>
        )}

        {!loading && filteredEpisodes.length > 0 && (
          <div className="space-y-10">
            {groupedByDate.map(({ key, episodes: dayEpisodes }, groupIdx) => {
              return (
                <section key={key}>
                  <div className="flex items-center justify-between gap-3 mb-4 border-b border-[#c7d5e0]/20 pb-2">
                    <h2 className="text-lg md:text-xl font-bold text-[#c7d5e0] tracking-wide">
                      {formatDateKeyHeading(key)}
                    </h2>
                    <Link
                      href={`/radio?date=${key}&queue=1`}
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full
                                 bg-[#66c0f4]/15 hover:bg-[#66c0f4]/25 ring-1 ring-[#66c0f4]/30
                                 text-xs md:text-sm font-medium text-[#c7d5e0] transition-colors"
                      title="この日付の番組を上から順に連続再生"
                    >
                      <span aria-hidden className="text-base leading-none -translate-y-px">▶</span>
                      この日を連続再生
                    </Link>
                  </div>

                  <div className="space-y-4">
                    {dayEpisodes.map((ep, epIdx) => {
                      const game = ep.featured_game
                      // 初回描画で 20 カード ×~180KB の画像を全部 eager ロードすると
                      // ホームの初回転送が ~3.5MB になる。最初の視界に入る分だけ eager。
                      const imgLoading: 'eager' | 'lazy' = groupIdx === 0 && epIdx < 3 ? 'eager' : 'lazy'
                      // image_rel を優先 (個別ページ左ジャケットと同じ優先順)。
                      // hero_rel が *_bg.jpg (Steam Library 背景 = 空) のケースで
                      // home サムネだけ空表示になる事故を防ぐ
                      const bg = game?.image_rel || game?.hero_rel || null
                      const shortDesc = (ep.summary_short && ep.summary_short.trim())
                        ? ep.summary_short.trim()
                        : shortenDesc(ep.program_description || '', 150)
                      return (
                        <Link
                          key={ep.episode_id}
                          href={`/radio/${ep.episode_id}`}
                          className="group block rounded-2xl overflow-hidden ring-1 ring-white/10
                                     bg-black/40 shadow-lg hover:shadow-2xl transition-shadow duration-200 hover:ring-white/20"
                        >
                          {/* Mobile: Huxe 風縦カード (画像 16:9 + blur パネル 140px) */}
                          <div className="md:hidden">
                            <div className="relative w-full bg-zinc-900 overflow-hidden aspect-[16/9]">
                              {bg ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={bg}
                                  alt={ep.title}
                                  loading={imgLoading}
                                  className="absolute inset-0 w-full h-full object-cover"
                                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }}
                                />
                              ) : (
                                <div className="absolute inset-0 w-full h-full bg-gradient-to-br from-[#2a475e] to-[#1b2838] flex items-center justify-center text-5xl">📻</div>
                              )}
                              <HomeViewCount count={viewCounts[ep.episode_id]} />
                            </div>

                            <div className="relative h-[164px] overflow-hidden border-t border-white/15">
                              {bg ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={bg}
                                  aria-hidden
                                  loading={imgLoading}
                                  className="absolute inset-0 w-full h-full object-cover scale-110 blur-xl"
                                />
                              ) : (
                                <div className="absolute inset-0 bg-gradient-to-br from-[#1b2838] to-[#171a21]" />
                              )}
                              <div className="absolute inset-0 bg-zinc-900/45" />
                              <div className="relative z-10 h-full px-4 py-3 flex flex-col">
                                <div className="mb-1.5">
                                  <ProfileBadge profile={ep.profile} className="text-[10px]" />
                                </div>
                                <h3 className="font-bold text-base text-white leading-snug line-clamp-2 mb-1.5">
                                  {ep.title}
                                </h3>
                                {shortDesc ? (
                                  <p className="text-xs text-zinc-100/80 leading-relaxed line-clamp-2 mb-auto">{shortDesc}</p>
                                ) : <div className="mb-auto" />}
                                <div className="flex items-center justify-between gap-2 text-xs pt-1">
                                  <div className="text-[#66c0f4] font-medium truncate">
                                    {game?.title || ''}
                                  </div>
                                  <div className="shrink-0 text-[#c7d5e0]/80 tabular-nums">
                                    {ep.generated_at ? formatDate(ep.generated_at) : ''}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Desktop (md+): 横並び。
                              画像枠は 320x180 = 16:9 にする。カード画像 (tech_compose_hero /
                              zatsugaku_thumbnail が作る 1920x1080) と同じ比率なので、
                              object-cover でも左右が切れない。240px (=4:3) だと左右 12.5% ずつ
                              削られて、両端に立つずんだ/めたん/あんこもんが見切れていた。 */}
                          <div className="hidden md:grid md:grid-cols-[320px_1fr] md:min-h-[180px]">
                            {/* 画像枠は aspect で 16:9 に固定する。
                                grid のコンテナに height を付けても行の高さは中身 (右の本文) で
                                決まるため、h-full だと本文の行数によって画像の高さが変わり、
                                16:9 からずれて object-cover が左右を削っていた (実測 320x193.8)。
                                self-start で stretch を無効にしないと aspect が上書きされる。 */}
                            <div className="relative w-full bg-zinc-900 overflow-hidden md:aspect-[16/9] md:self-start">
                              {bg ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={bg}
                                  alt={ep.title}
                                  loading={imgLoading}
                                  className="absolute inset-0 w-full h-full object-cover"
                                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }}
                                />
                              ) : (
                                <div className="absolute inset-0 w-full h-full bg-gradient-to-br from-[#2a475e] to-[#1b2838] flex items-center justify-center text-5xl">📻</div>
                              )}
                              <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent pointer-events-none" />
                              <HomeViewCount count={viewCounts[ep.episode_id]} />
                            </div>

                            <div className="px-6 py-4 flex flex-col min-w-0">
                              <div className="mb-1.5">
                                <ProfileBadge profile={ep.profile} className="text-xs" />
                              </div>
                              <h3 className="text-xl font-bold text-white leading-snug mb-2 line-clamp-2">
                                {ep.title}
                              </h3>
                              <div className="flex items-center justify-between gap-3 mb-2">
                                <div className="text-sm text-[#66c0f4] font-medium truncate">
                                  {game?.title || ''}
                                </div>
                                <div className="shrink-0 inline-flex items-center gap-1.5 text-sm font-medium text-[#c7d5e0] group-hover:text-[#c7d5e0] transition-colors">
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
            {hasMore && (
              <div className="flex justify-center pt-4">
                <button
                  onClick={() => setDisplayCount((c) => c + PAGE_SIZE)}
                  className="px-6 py-2.5 rounded-full bg-[#66c0f4]/20 hover:bg-[#66c0f4]/30 ring-1 ring-[#66c0f4]/40 text-sm font-medium text-[#c7d5e0] transition-colors"
                >
                  もっと見る (残り {filteredEpisodes.length - displayCount} 件)
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
