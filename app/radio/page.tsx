'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'

type SpeechSegment = {
  index: number
  type: 'speech'
  speaker: 'zunda' | 'metan'
  text: string
  tone?: string
  news_index?: number | null
  start_sec: number
  end_sec: number
}

type MusicSegment = {
  index: number
  type: 'music'
  intro_speaker: 'zunda' | 'metan'
  intro_text: string
  tone?: string
  news_index?: number | null
  featured?: { file: string; duration_sec: number } | null
  start_sec: number
  end_sec: number
}

type IntroOutroSegment = {
  index: number
  type: 'intro' | 'outro'
  text: string
  start_sec: number
  end_sec: number
}

type Segment = SpeechSegment | MusicSegment | IntroOutroSegment

type NewsCover = {
  news_index: number
  og_image: string | null
  title: string
  source: string
  url: string
}

type FeaturedGame = {
  app_id: number
  title: string
  developers?: string[]
  publishers?: string[]
  genres?: string[]
  release_date?: string
  price?: string
  short_description?: string
  image_rel?: string
  hero_rel?: string
}

type ProgramMeta = {
  profile: 'ai' | 'indie'
  episode_id: string
  title: string
  generated_at: string | null
  audio_url: string | null
  audio_meta: {
    audio_path: string
    duration_sec: number
    segments: Segment[]
    title: string
  } | null
  script_segments: any[]
  news_covers: NewsCover[]
  program_background: string | null
  featured_game: FeaturedGame | null
  program_description: string
}

const PROFILES: Array<{ key: 'ai' | 'indie'; label: string; emoji?: string; icon?: string }> = [
  { key: 'ai', label: 'AI', icon: '/icons/ai-chip.png' },
  { key: 'indie', label: 'インディー', icon: '/icons/game.svg' },
]

function fmt(sec: number) {
  if (!isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

// 静的な波形バー (装飾)
const WAVEFORM_BARS = Array.from({ length: 72 }, (_, i) => {
  const v = Math.sin(i * 0.7) * 0.35 + Math.cos(i * 1.3) * 0.25 + Math.sin(i * 0.31) * 0.15
  return Math.max(0.18, Math.min(1.0, 0.5 + v))
})

export default function RadioPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-amber-950" />}>
      <RadioPageInner />
    </Suspense>
  )
}

function RadioPageInner() {
  const searchParams = useSearchParams()
  const urlEpisode = searchParams?.get('episode') || null
  const urlDate = searchParams?.get('date') || null  // YYYY-MM-DD: この日付の連続再生キュー
  const urlQueue = searchParams?.get('queue') === '1'
  const profile: 'indie' = 'indie'  // 静的サイトでは indie 固定
  const setProfile = (_p: 'ai' | 'indie') => {}
  const [episodes, setEpisodes] = useState<Array<{ episode_id: string; title: string; generated_at: string | null }>>([])
  const [currentEpisode, setCurrentEpisode] = useState<string | null>(urlEpisode)
  const [queueIds, setQueueIds] = useState<string[]>([])  // 連続再生キュー (新しい順)

  // URL の episode パラメータが変わったら currentEpisode に反映
  useEffect(() => {
    setCurrentEpisode(urlEpisode)
  }, [urlEpisode])

  // 全エピソード読み込み (episodes.json 一発)
  const [allEpisodes, setAllEpisodes] = useState<any[]>([])
  useEffect(() => {
    fetch('/data/episodes.json', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : { episodes: [] })
      .then((d) => {
        const all = (d.episodes || []).filter((e: any) => e.profile === profile)
        setAllEpisodes(all)
        setEpisodes(all)
        if (urlQueue && urlDate) {
          const sameDay = all
            .filter((e: any) => (e.generated_at || '').slice(0, 10) === urlDate)
            .map((e: any) => e.episode_id)
          setQueueIds(sameDay)
          if (sameDay.length > 0 && !currentEpisode) setCurrentEpisode(sameDay[0])
        }
      })
      .catch(() => setEpisodes([]))
  }, [profile, urlQueue, urlDate])
  const [program, setProgram] = useState<ProgramMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  // 再生開始直後 3 秒は一時停止オーバーレイ非表示 (操作感のため)
  const [recentlyStarted, setRecentlyStarted] = useState(false)
  const [showSegments, setShowSegments] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  // 目パチ・口パク state
  const [zundaBlink, setZundaBlink] = useState(false)
  const [metanBlink, setMetanBlink] = useState(false)
  // 口パク phase: 0=closed, 1=mid, 2=open (3-state cycle 0→1→2→1→0→1→...)
  const [zundaMouth, setZundaMouth] = useState(0)
  const [metanMouth, setMetanMouth] = useState(0)

  // 目パチ: 3-6秒間隔でランダムに 150ms 目を閉じる
  useEffect(() => {
    let cancelled = false
    const scheduleZunda = () => {
      const delay = 3000 + Math.random() * 3500
      const id = setTimeout(() => {
        if (cancelled) return
        setZundaBlink(true)
        setTimeout(() => { if (!cancelled) setZundaBlink(false); scheduleZunda() }, 150)
      }, delay)
      return id
    }
    const scheduleMetan = () => {
      const delay = 2500 + Math.random() * 4000
      const id = setTimeout(() => {
        if (cancelled) return
        setMetanBlink(true)
        setTimeout(() => { if (!cancelled) setMetanBlink(false); scheduleMetan() }, 160)
      }, delay)
      return id
    }
    scheduleZunda()
    scheduleMetan()
    return () => { cancelled = true }
  }, [])

  // プログラム読み込み: episodes.json から該当エピソードを引いて + meta.json (segments) を fetch
  useEffect(() => {
    setLoading(true)
    setError(null)
    setProgram(null)
    if (!allEpisodes.length) return
    const target = currentEpisode
      ? allEpisodes.find((e: any) => e.episode_id === currentEpisode)
      : allEpisodes[0]
    if (!target) {
      setError('エピソードが見つかりません')
      setLoading(false)
      return
    }
    fetch(target.meta_url, { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : null)
      .then((meta: any) => {
        const program: ProgramMeta = {
          profile: 'indie',
          episode_id: target.episode_id,
          title: target.title,
          generated_at: target.generated_at,
          audio_url: target.audio_url,
          audio_meta: meta ? {
            audio_path: target.audio_url,
            duration_sec: meta.duration_sec || target.duration_sec || 0,
            segments: meta.segments || [],
            title: target.title,
          } : null,
          script_segments: [],
          news_covers: [],
          program_background: target.featured_game?.hero_rel || target.featured_game?.image_rel || null,
          featured_game: target.featured_game || null,
          program_description: target.program_description || '',
        }
        setProgram(program)
      })
      .catch((e) => setError(String(e?.message || e)))
      .finally(() => setLoading(false))
  }, [allEpisodes, currentEpisode])

  // 現在エピソードのリスト内位置
  const currentIndex = useMemo(() => {
    if (!program || !episodes.length) return -1
    const epId = program.episode_id
    if (!epId || epId === 'latest') return 0  // 最新 = episodes[0]
    return episodes.findIndex((e) => e.episode_id === epId)
  }, [program, episodes])
  const hasNewer = currentIndex > 0 || (currentIndex === 0 && currentEpisode !== null)
  const hasOlder = currentIndex >= 0 && currentIndex < episodes.length - 1

  const goOlder = () => {
    if (hasOlder) setCurrentEpisode(episodes[currentIndex + 1].episode_id)
  }
  const goNewer = () => {
    if (currentIndex > 0) setCurrentEpisode(episodes[currentIndex - 1].episode_id)
    else if (currentEpisode !== null) setCurrentEpisode(null)
  }

  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    const onTime = () => setCurrentTime(a.currentTime)
    const onLoaded = () => {
      setDuration(a.duration)
      // queue モード: 自動再生 (1件目含めすべて)
      if (queueIds.length > 0 && currentEpisode && queueIds.includes(currentEpisode)) {
        a.play().catch(() => {})
      }
    }
    const onPlay = () => {
      setIsPlaying(true)
      setRecentlyStarted(true)
      setTimeout(() => setRecentlyStarted(false), 3000)
    }
    const onPause = () => setIsPlaying(false)
    const onEnded = () => {
      // queue モード: 次のエピソードへ。最後なら / にリダイレクト
      if (queueIds.length > 0 && currentEpisode) {
        const idx = queueIds.indexOf(currentEpisode)
        if (idx >= 0 && idx < queueIds.length - 1) {
          setCurrentEpisode(queueIds[idx + 1])
        } else if (idx === queueIds.length - 1) {
          // 全エピソード再生完了 → トップへ
          window.location.href = '/'
        }
      }
    }
    a.addEventListener('timeupdate', onTime)
    a.addEventListener('loadedmetadata', onLoaded)
    a.addEventListener('play', onPlay)
    a.addEventListener('pause', onPause)
    a.addEventListener('ended', onEnded)
    return () => {
      a.removeEventListener('timeupdate', onTime)
      a.removeEventListener('loadedmetadata', onLoaded)
      a.removeEventListener('play', onPlay)
      a.removeEventListener('pause', onPause)
      a.removeEventListener('ended', onEnded)
    }
  }, [program, queueIds, currentEpisode])

  const audioUrl = (() => {
    const u = program?.audio_url
    if (!u) return null
    if (u.startsWith('/radio/')) return `/api${u}`
    return u
  })()

  const segments: Segment[] = program?.audio_meta?.segments || []
  const currentSegment = segments.find(
    (s) => currentTime >= s.start_sec && currentTime < s.end_sec
  )

  // 口パク: 4 種のランダムパターンをセグメントごとに選び、100ms フレームで cycle 回す
  // (他ゲームの kuti1-4 アルゴリズムを参考に、機械的な開閉でなく自然なリズム差を作る)
  // 0=closed, 1=mid, 2=open
  // intro セグメントの場合、ジングル単独部分 (前後) では口を閉じ、ナレーション部分だけパクパクする
  useEffect(() => {
    const isSpeech = currentSegment?.type === 'speech'
    const isIntroSeg = currentSegment?.type === 'intro'
    const speaker = isSpeech ? currentSegment.speaker : isIntroSeg ? 'metan' : null
    if (!isPlaying || !speaker) {
      setZundaMouth(0)
      setMetanMouth(0)
      return
    }
    const PATTERNS: number[][] = [
      [0, 2],            // 短: 閉→開
      [0, 1, 2],         // 中: 閉→中→開
      [0, 2, 1, 2],      // 長A: 閉→開→中→開
      [0, 1, 2, 1, 2],   // 長B: 閉→中→開→中→開
    ]
    const pattern = PATTERNS[Math.floor(Math.random() * PATTERNS.length)]
    let step = 0
    // intro セグメント中はナレーション窓 [0.6s, 2.4s] 内のみ口パク
    const introStartSec = isIntroSeg ? (currentSegment as any).start_sec ?? 0 : 0
    const NARR_WINDOW = [0.6, 2.4] as const
    const id = setInterval(() => {
      if (isIntroSeg) {
        const a = audioRef.current
        const tInSeg = a ? a.currentTime - introStartSec : 0
        if (tInSeg < NARR_WINDOW[0] || tInSeg > NARR_WINDOW[1]) {
          setMetanMouth(0)
          setZundaMouth(0)
          return
        }
      }
      const frame = pattern[step % pattern.length]
      step++
      if (speaker === 'zunda') {
        setZundaMouth(frame)
        setMetanMouth(0)
      } else if (speaker === 'metan') {
        setMetanMouth(frame)
        setZundaMouth(0)
      }
    }, 100)
    return () => clearInterval(id)
  }, [isPlaying, currentSegment])

  // タイトルをメインと副題に分割 ("メイン 〜副題〜" 形式)
  const [titleMain, titleSub] = useMemo(() => {
    const t = program?.title || ''
    const m = t.match(/^\s*(.+?)\s*[〜～]\s*(.+?)\s*[〜～]?\s*$/)
    if (m && m[1] && m[2]) return [m[1].trim(), m[2].trim()]
    return [t, '']
  }, [program?.title])

  // 現在再生中の news に対応するカバー画像
  const currentCover = useMemo(() => {
    if (!program?.news_covers || program.news_covers.length === 0) return null
    const ni = currentSegment && 'news_index' in currentSegment ? currentSegment.news_index : null
    if (ni) {
      const m = program.news_covers.find((c) => c.news_index === ni)
      if (m) return m
    }
    return program.news_covers[0] || null
  }, [program, currentSegment])

  const handleSeek = (sec: number) => {
    if (audioRef.current) audioRef.current.currentTime = Math.max(0, Math.min(duration, sec))
  }
  const handleSeekFraction = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const f = Math.max(0, Math.min(1, x / rect.width))
    handleSeek(f * duration)
  }
  const togglePlay = () => {
    const a = audioRef.current
    if (!a) return
    if (a.paused) a.play().catch(() => {})
    else a.pause()
  }

  const progressFrac = duration > 0 ? currentTime / duration : 0

  return (
    <main className="min-h-screen bg-gradient-to-br from-amber-950 via-orange-900 to-amber-950 text-zinc-100">
      {/* エピソードナビ (画面下部中央、左右配置) */}
      <div className="fixed left-1/2 -translate-x-1/2 bottom-4 md:bottom-6 z-50 flex items-center gap-3 md:gap-4 px-3 py-2 rounded-full bg-black/40 backdrop-blur-md ring-1 ring-white/10">
        <button
          onClick={goOlder}
          disabled={!hasOlder}
          className="px-3 py-1 text-2xl md:text-3xl font-light text-white/70 hover:text-white transition-colors disabled:opacity-25 disabled:cursor-not-allowed leading-none"
          title="前のエピソード (より古い)"
          aria-label="前のエピソード"
        >‹</button>
        <span className="text-[10px] md:text-xs text-zinc-300 tracking-widest select-none">EPISODE</span>
        <button
          onClick={goNewer}
          disabled={!hasNewer}
          className="px-3 py-1 text-2xl md:text-3xl font-light text-white/70 hover:text-white transition-colors disabled:opacity-25 disabled:cursor-not-allowed leading-none"
          title="次のエピソード (より新しい)"
          aria-label="次のエピソード"
        >›</button>
      </div>

      <div className="max-w-md md:max-w-5xl mx-auto px-4 pt-6 pb-10">
        {/* 上部バー */}
        <div className="flex items-center justify-between mb-5">
          <Link href="/" className="text-zinc-300 hover:text-white text-sm">← 戻る</Link>
          <div className="text-xs text-zinc-300 tracking-widest inline-flex items-baseline gap-1.5">
            <span
              aria-hidden
              className="inline-block w-4 h-4 bg-current"
              style={{
                WebkitMaskImage: "url(/icons/radio.svg)",
                maskImage: "url(/icons/radio.svg)",
                WebkitMaskSize: 'contain',
                maskSize: 'contain',
                WebkitMaskRepeat: 'no-repeat',
                maskRepeat: 'no-repeat',
                WebkitMaskPosition: 'center',
                maskPosition: 'center',
              }}
            />
            Tabinomichi Radio
          </div>
          <div className="w-12" />
        </div>

        {loading && (
          <div className="text-zinc-300 py-16 text-center text-sm">📻 番組を読み込み中...</div>
        )}

        {!loading && error && (
          <div className="bg-red-950/40 border border-red-700/50 rounded-2xl p-4 text-red-200 text-sm">
            読み込み失敗: {error}
            <div className="mt-2 text-zinc-400 text-xs">
              run_radio_test.cmd で台本生成 → radio_synthesize.py で音声合成してください。
            </div>
          </div>
        )}

        {!loading && !error && program && audioUrl && (
          <div className="md:grid md:grid-cols-[1fr_1fr] md:gap-6 md:items-start">
            <div className="min-w-0">
            {/* ジャケット (画像 + タイトル + ▶/字幕 全部オーバーレイ) */}
            <div
              className="relative aspect-square rounded-3xl overflow-hidden mb-4 ring-1 ring-white/10 shadow-[0_25px_60px_-20px_rgba(0,0,0,0.7)] bg-zinc-800 cursor-pointer select-none group"
              onClick={togglePlay}
              role="button"
              aria-label={isPlaying ? '一時停止' : '再生'}
            >
              {/* 背景画像: AI 番組は program_background、Indie は記事 og_image */}
              {(() => {
                const bgSrc = program.program_background || currentCover?.og_image || null
                if (!bgSrc) {
                  return (
                    <div className="w-full h-full bg-gradient-to-br from-orange-800 to-zinc-900 flex items-center justify-center text-7xl">
                      📻
                    </div>
                  )
                }
                return (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={bgSrc}
                    src={bgSrc}
                    alt=""
                    className="w-full h-full object-cover transition-opacity duration-500"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }}
                  />
                )
              })()}
              {/* ずんだ (左) + めたん (右) の立ち絵: tone 切替 + 目パチ + 口パク + intro マイク持ち */}
              {(() => {
                const VALID_TONES = ['normal','amaama','tsuntsun','sasayaki','sexy','hisohiso','namidame','kangae'] as const
                type Tone = typeof VALID_TONES[number]
                const segTone = (currentSegment && 'tone' in currentSegment ? currentSegment.tone : undefined) as Tone | undefined
                const tone: Tone = (segTone && (VALID_TONES as readonly string[]).includes(segTone) ? segTone : 'normal')
                const isIntro = !!(currentSegment && currentSegment.type === 'intro')
                const activeSpeaker = currentSegment && currentSegment.type === 'speech' ? currentSegment.speaker : null
                const zundaActive = activeSpeaker === 'zunda'
                const metanActive = activeSpeaker === 'metan'

                const zundaTone: Tone = zundaActive ? tone : 'normal'
                const metanTone: Tone = metanActive ? tone : 'normal'

                // mouth phase -> suffix: 0=base, 1=_talk (mid), 2=_talk2 (open)
                const mouthSuffix = (m: number) => m === 2 ? '_talk2' : m === 1 ? '_talk' : ''

                // ずんだ image state: 優先順 blink > mouth-phase > base
                const zundaSrc = zundaBlink
                  ? `/characters/zunda/${zundaTone}_blink.png`
                  : zundaActive
                  ? `/characters/zunda/${zundaTone}${mouthSuffix(zundaMouth)}.png`
                  : `/characters/zunda/${zundaTone}.png`

                // めたん image state (intro 時はマイク持ち専用ポーズ + 口パク)
                const metanSrc = isIntro
                  ? `/characters/metan/intro${mouthSuffix(metanMouth)}.png`
                  : metanBlink
                  ? `/characters/metan/${metanTone}_blink.png`
                  : metanActive
                  ? `/characters/metan/${metanTone}${mouthSuffix(metanMouth)}.png`
                  : `/characters/metan/${metanTone}.png`

                return (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={zundaSrc}
                      alt=""
                      className="absolute pointer-events-none drop-shadow-2xl"
                      style={{
                        left: '-24%',
                        bottom: '-32%',
                        height: '100%',
                        zIndex: zundaActive ? 5 : 4,
                        transform: 'scaleX(-1)',
                      }}
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                    />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={metanSrc}
                      alt=""
                      className="absolute pointer-events-none drop-shadow-2xl"
                      style={{
                        right: '-22%',
                        bottom: '-32%',
                        height: '100%',
                        zIndex: metanActive ? 5 : 4,
                      }}
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                    />
                  </>
                )
              })()}
              {/* 上端: グラデ + 番組タイトル */}
              <div className="absolute inset-x-0 top-0 pt-5 pb-6 px-5 bg-gradient-to-b from-black/80 via-black/50 to-transparent">
                <h1 className="text-xl font-bold leading-tight drop-shadow-2xl text-white">
                  {titleMain || '(無題)'}
                </h1>
                {titleSub && (
                  <p className="text-xs text-zinc-200/90 mt-1 drop-shadow leading-snug">
                    〜 {titleSub} 〜
                  </p>
                )}
              </div>

              {/* 再生中: 背景全体を薄暗化＆軽いぼかし (字幕を前に出す)
                  字幕セグメント切替時のチカチカ防止のため、isPlaying のみを条件にする */}
              <div className={[
                'absolute inset-0 bg-black/30 backdrop-blur-[1.5px] pointer-events-none transition-opacity duration-500',
                isPlaying ? 'opacity-100' : 'opacity-0',
              ].join(' ')} />

              {/* 字幕 (上詰め、キャラの頭より上の領域に配置)。テキスト自身に背景は付けず、全体オーバーレイに依存する */}
              <div className="absolute inset-x-0 top-0 pt-16 md:pt-20 flex justify-center px-5 pointer-events-none z-20">
                {currentSegment && currentSegment.type === 'speech' ? (
                  <p className={[
                    'text-center text-base md:text-lg leading-relaxed font-medium',
                    'px-4 py-4 max-w-[92%] max-h-[88%] overflow-hidden',
                    '[text-shadow:_0_0_6px_rgb(0_0_0_/_0.95),_0_2px_4px_rgb(0_0_0_/_0.9),_0_0_2px_rgb(0_0_0_/_1)]',
                    currentSegment.speaker === 'zunda' ? 'text-emerald-200' : 'text-zinc-50',
                  ].join(' ')}>
                    {currentSegment.text}
                  </p>
                ) : currentSegment && currentSegment.type === 'music' ? (
                  <p className="text-center text-base md:text-lg leading-relaxed text-amber-200 px-4 py-4 max-w-[92%] max-h-[88%] overflow-hidden [text-shadow:_0_0_6px_rgb(0_0_0_/_0.95),_0_2px_4px_rgb(0_0_0_/_0.9)]">
                    🎵 {currentSegment.intro_text}
                  </p>
                ) : null}
              </div>

              {/* 状態別オーバーレイ:
                  - 初回 (currentTime ≒ 0 かつ paused): クリーン表示、hover で ▶
                  - 一時停止中 (currentTime > 0 かつ paused): グレー常時 + ⏸
                  - 再生中: hover で ⏸ */}
              {!isPlaying && currentTime < 0.1 && (
                <div className="absolute left-3 bottom-3 pointer-events-none z-40">
                  <div className="w-12 h-12 rounded-full bg-black/65 ring-1 ring-white/25 flex items-center justify-center text-xl text-white shadow-lg">
                    ▶
                  </div>
                </div>
              )}

              {!isPlaying && currentTime >= 0.1 && (
                <div className="absolute inset-0 bg-black/45 backdrop-blur-[2px] flex items-center justify-center pointer-events-none transition-opacity z-40">
                  <div className="w-24 h-24 rounded-full bg-black/75 ring-1 ring-white/25 flex items-center justify-center text-5xl text-white shadow-2xl">
                    ▶
                  </div>
                </div>
              )}

              {isPlaying && !recentlyStarted && (
                <div className="absolute inset-0 bg-black/35 backdrop-blur-[1px] flex items-center justify-center pointer-events-none opacity-0 [@media(pointer:fine)]:group-hover:opacity-100 transition-opacity duration-200 z-40">
                  <div className="w-24 h-24 rounded-full bg-black/75 ring-1 ring-white/25 flex items-center justify-center text-5xl text-white shadow-2xl">
                    ⏸
                  </div>
                </div>
              )}

              {/* 下端: グラデ + 現ニュース or Featured ゲーム表示 */}
              {(() => {
                // Indie で featured_game ある時はゲーム名 + 開発元、それ以外は記事サムネのタイトル
                let displayTitle = ''
                let displaySource = ''
                if (profile === 'indie' && program.featured_game) {
                  displayTitle = program.featured_game.title
                  const devs = program.featured_game.developers || []
                  displaySource = devs.length > 0 ? devs.join(' / ') : 'Steam'
                } else if (currentCover) {
                  displayTitle = currentCover.title
                  displaySource = currentCover.source
                }
                if (!displayTitle) return null
                return (
                  <div className="absolute inset-x-0 bottom-0 pt-12 pb-4 pl-20 pr-5 bg-gradient-to-t from-black/85 via-black/60 to-transparent text-right z-10">
                    <div className="text-sm text-zinc-100 line-clamp-1 [text-shadow:_0_2px_6px_rgb(0_0_0_/_0.95),_0_0_3px_rgb(0_0_0_/_1)]">{displayTitle}</div>
                    <div className="text-[10px] text-zinc-300 mt-0.5 [text-shadow:_0_2px_4px_rgb(0_0_0_/_0.9)]">{displaySource}</div>
                  </div>
                )
              })()}
            </div>

            {/* 波形 (クリックでシーク) */}
            <div
              className="relative h-14 mb-2 cursor-pointer select-none"
              onClick={handleSeekFraction}
              title="クリックでシーク"
            >
              <div className="absolute inset-0 flex items-center gap-[3px]">
                {WAVEFORM_BARS.map((h, i) => {
                  const past = i / WAVEFORM_BARS.length <= progressFrac
                  return (
                    <div
                      key={i}
                      className={[
                        'flex-1 rounded-full transition-colors',
                        past ? 'bg-white' : 'bg-white/25',
                      ].join(' ')}
                      style={{ height: `${h * 100}%` }}
                    />
                  )
                })}
              </div>
            </div>
            <div className="flex justify-between text-xs text-zinc-400 mb-4 px-1">
              <span>{fmt(currentTime)}</span>
              <span>{fmt(duration)}</span>
            </div>

            {/* 折りたたみセグメント一覧 (細め・目立たないトーン) */}
            <div className="bg-black/15 rounded-xl overflow-hidden">
              <button
                onClick={() => setShowSegments((v) => !v)}
                className="w-full flex items-center justify-between px-3 py-1 text-[11px] text-zinc-400 hover:text-zinc-200 hover:bg-black/15 transition-colors"
              >
                <span>チャプター</span>
                <span className={`transition-transform text-xs ${showSegments ? 'rotate-180' : ''}`}>▾</span>
              </button>
              {showSegments && (
                <div className="px-2 pb-2 space-y-0.5 max-h-[55vh] overflow-y-auto">
                  {segments.map((seg) => {
                    const active = currentSegment?.index === seg.index
                    let speakerLabel = '🎵'
                    let text = ''
                    if (seg.type === 'music') {
                      speakerLabel = '🎵'
                      text = `[一曲どうぞ] ${seg.intro_text}`
                    } else if (seg.type === 'intro' || seg.type === 'outro') {
                      speakerLabel = '🎵'
                      text = seg.text
                    } else if (seg.type === 'speech') {
                      speakerLabel = seg.speaker === 'zunda' ? '🟢' : '🔴'
                      text = seg.text
                    }
                    return (
                      <button
                        key={seg.index}
                        onClick={() => handleSeek(seg.start_sec)}
                        className={[
                          'w-full text-left p-2 rounded-md flex gap-2 items-baseline transition-colors',
                          active
                            ? 'bg-white/15 ring-1 ring-white/30'
                            : 'hover:bg-white/5',
                        ].join(' ')}
                      >
                        <span className="text-[10px] text-zinc-400 font-mono shrink-0 w-10">{fmt(seg.start_sec)}</span>
                        <span className="shrink-0">{speakerLabel}</span>
                        <span className="text-xs text-zinc-200 line-clamp-2">{text}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* hidden audio */}
            <audio ref={audioRef} src={audioUrl} preload="metadata" hidden />
            </div>

            {/* 右カラム (デスクトップのみ): Steam 横長 header (or fallback) + ゲーム概要 */}
            {profile === 'indie' && program.featured_game && (program.featured_game.app_id || program.featured_game.image_rel) && (
              <aside className="hidden md:block sticky top-6 self-start space-y-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={
                    program.featured_game.image_rel
                      ? program.featured_game.image_rel
                      : program.featured_game.app_id
                      ? `/images/games/${program.featured_game.app_id}_header.jpg`
                      : ''
                  }
                  alt={program.featured_game.title}
                  className="w-full rounded-2xl ring-1 ring-white/10 shadow-2xl object-cover"
                  style={{ aspectRatio: '460 / 215' }}
                />
                <div className="bg-black/30 backdrop-blur-sm rounded-2xl p-5">
                  <h2 className="text-lg font-bold text-zinc-50 mb-2 leading-tight">
                    {program.featured_game.title}
                  </h2>
                  <div className="text-xs text-zinc-400 mb-3 flex flex-wrap gap-x-3 gap-y-1">
                    {program.featured_game.developers?.length ? (
                      <span>👤 {program.featured_game.developers.join(' / ')}</span>
                    ) : null}
                    <span className="inline-flex items-center gap-1">
                      <span
                        aria-hidden
                        className="inline-block w-3.5 h-3.5 bg-current -translate-y-px"
                        style={{
                          WebkitMaskImage: "url(/icons/calendar.svg)",
                          maskImage: "url(/icons/calendar.svg)",
                          WebkitMaskSize: 'contain',
                          maskSize: 'contain',
                          WebkitMaskRepeat: 'no-repeat',
                          maskRepeat: 'no-repeat',
                          WebkitMaskPosition: 'center',
                          maskPosition: 'center',
                        }}
                      />
                      リリース: {program.featured_game.release_date?.trim() || '未定'}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span
                        aria-hidden
                        className="inline-block w-3.5 h-3.5 bg-current -translate-y-px"
                        style={{
                          WebkitMaskImage: "url(/icons/bill.svg)",
                          maskImage: "url(/icons/bill.svg)",
                          WebkitMaskSize: 'contain',
                          maskSize: 'contain',
                          WebkitMaskRepeat: 'no-repeat',
                          maskRepeat: 'no-repeat',
                          WebkitMaskPosition: 'center',
                          maskPosition: 'center',
                        }}
                      />
                      {program.featured_game.price?.trim() || '価格未定'}
                    </span>
                  </div>
                  {program.featured_game.genres?.length ? (
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {program.featured_game.genres.map((g) => (
                        <span key={g} className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-zinc-200">
                          {g}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {(program.program_description || program.featured_game.short_description) ? (
                    <p className="text-sm text-zinc-200 leading-relaxed whitespace-pre-wrap">
                      {program.program_description || program.featured_game.short_description}
                    </p>
                  ) : null}
                  {program.featured_game.app_id ? (
                    <div className="flex justify-end mt-4">
                      <a
                        href={`https://store.steampowered.com/app/${program.featured_game.app_id}/`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-zinc-400 hover:text-zinc-100 border-b border-zinc-600 hover:border-zinc-100 transition-colors pb-px tracking-wide"
                      >
                        View on Steam
                      </a>
                    </div>
                  ) : null}
                </div>
              </aside>
            )}
          </div>
        )}

        {!loading && !error && program && !audioUrl && (
          <div className="bg-amber-950/40 border border-amber-700/40 rounded-2xl p-4 text-amber-200">
            台本はあるけど音声がまだ生成されていない。<code>radio_synthesize.py --all</code> を実行してください。
          </div>
        )}
      </div>
    </main>
  )
}
