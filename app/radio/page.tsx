'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import SharePopover from '../components/SharePopover'
import { VALID_TONES, NO_BLINK, type Tone } from './generated/valid-tones'

// ---------------------------------------------------------------------------
// 立ち絵 sprite の先読みと「decode 済みの src にしか差し替えない」ゲート。
//
// 口パクは 100ms ごとに <img src> を差し替えるが、差し替え先が renderer の
// memory cache に無いと Service Worker 経由で取り直しになり (実測 ~60ms/枚、
// Cache Storage ヒットでも)、その間 Chrome は前のコマを表示し続け、Safari は
// 空白になる → 立ち絵がチカチカする (2026-09-03 user 指摘、雑学回の shirake)。
//
// 対策は 2 段:
//   1. preloadSprite(): Image オブジェクトを Map に保持して decode まで済ませる。
//      参照を持ち続けるので memory cache から落ちず、以後の src 差し替えは SW を通らない。
//   2. useReadySrc(): 目的の src が decode 済みになるまで、直前に表示できていた src を
//      返し続ける。読み込み中に空白/別ポーズが挟まらない。
// ---------------------------------------------------------------------------
type SpriteEntry = { img: HTMLImageElement; ready: boolean; waiters: Array<() => void> }
const spriteCache = new Map<string, SpriteEntry>()

function preloadSprite(src: string): void {
  if (typeof window === 'undefined' || spriteCache.has(src)) return
  const img = new Image()
  const entry: SpriteEntry = { img, ready: false, waiters: [] }
  spriteCache.set(src, entry)
  const settle = () => {
    entry.ready = true
    const ws = entry.waiters.splice(0)
    ws.forEach((w) => w())
  }
  img.onload = () => {
    // decode() まで待つと、src 差し替え直後の描画で decode 待ちのコマ落ちも消える。
    const d = typeof img.decode === 'function' ? img.decode().catch(() => {}) : Promise.resolve()
    d.then(settle)
  }
  // 404 等でも settle する。止め置くと表示が永久に前のコマで固まるので、
  // <img> 側の onError (display:none) に任せる。
  img.onerror = settle
  img.src = src
}

function isSpriteReady(src: string): boolean {
  return spriteCache.get(src)?.ready ?? false
}

function onSpriteReady(src: string, cb: () => void): () => void {
  preloadSprite(src)
  const entry = spriteCache.get(src)
  if (!entry) return () => {}
  if (entry.ready) { cb(); return () => {} }
  entry.waiters.push(cb)
  return () => {
    const i = entry.waiters.indexOf(cb)
    if (i >= 0) entry.waiters.splice(i, 1)
  }
}

// 目的の src が decode 済みになるまで、直前に表示できていた src を返す。
function useReadySrc(desired: string): string {
  const [shown, setShown] = useState(desired)
  useEffect(() => {
    if (isSpriteReady(desired)) { setShown(desired); return }
    let alive = true
    const off = onSpriteReady(desired, () => { if (alive) setShown(desired) })
    return () => { alive = false; off() }
  }, [desired])
  return shown
}

// 元から目を閉じている表情ではまばたきさせない (詳細は描画側のコメント)。
const canBlinkTone = (speaker: string, t: string) => !NO_BLINK[speaker]?.includes(t)

// 1 tone ぶんのコマ (base / _talk / _talk2 / _blink) をまとめて先読み。
function preloadToneFrames(speaker: string, tone: string): void {
  const base = `/characters/${speaker}/${tone}`
  preloadSprite(`${base}.png`)
  preloadSprite(`${base}_talk.png`)
  preloadSprite(`${base}_talk2.png`)
  if (canBlinkTone(speaker, tone)) preloadSprite(`${base}_blink.png`)
}

// 現在位置から先読みするセグメント数 (≒ 30-40 秒ぶん)。
const SPRITE_LOOKAHEAD = 8

function SpriteImg({ src, style }: { src: string; style: React.CSSProperties }) {
  const shown = useReadySrc(src)
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={shown}
      alt=""
      className="absolute pointer-events-none drop-shadow-2xl"
      style={style}
      // 404 で hidden にした後、次に src が変わって load 成功した時に
      // 立ち絵が二度と戻らない事故 (1 枚読み込み失敗で以降全消失)
      // を防ぐため、onError で display:none、onLoad で復帰させる。
      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
      onLoad={(e) => { (e.currentTarget as HTMLImageElement).style.display = '' }}
    />
  )
}

type SpeechSegment = {
  index: number
  type: 'speech'
  speaker: 'zunda' | 'metan' | 'tsumugi' | 'ankomon'
  text: string
  tone?: string
  news_index?: number | null
  start_sec: number
  end_sec: number
}

type MusicSegment = {
  index: number
  type: 'music'
  intro_speaker: 'zunda' | 'metan' | 'tsumugi' | 'ankomon'
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
  header_url?: string
  screenshot_rels?: string[]
  // テック回専用: 言及された企業名 (tech_compose_hero.extract_mentioned_companies)。
  // 底パネルで developers の代わりに「OpenAI・xAI・Anthropic」のように表示する。
  companies?: string[]
}

// ホームのタブと同じ 3 プロフィール。zatsugaku を落とすと、雑学回を開いたときに
// indie にフォールバックして一覧から外れ「エピソードが見つかりません」になる。
type Profile = 'indie' | 'ai' | 'zatsugaku'
const VALID_PROFILES: readonly string[] = ['indie', 'ai', 'zatsugaku']

// タブ付きホームへの戻り先 (既定タブ = まとめ はクエリなし)
const homeHref = (p: Profile): string => `/?profile=${p}`

type ProgramMeta = {
  profile: Profile
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

// ViewCounter はモバイル用/デスクトップ用の 2 箇所に CSS 出し分けでマウントされる
// (両方常時 mount)。ガードを module レベルで共有しないと、1 閲覧で GET×2、
// 1 再生で POST×2 (= KV 課金 2 倍 + カウント二重計上) になる (2026-07-12 review H1)。
const viewCountFetches = new Map<string, Promise<number | null>>()
const viewIncremented = new Set<string>()

function ViewCounter({ episodeId, isPlaying }: { episodeId: string | null; isPlaying: boolean }) {
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    if (!episodeId) { setCount(null); return }
    setCount(null)
    let cancelled = false
    let p = viewCountFetches.get(episodeId)
    if (!p) {
      p = fetch(`/api/views/${episodeId}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => (d && typeof d.count === 'number' ? (d.count as number) : null))
        .catch(() => null)
      viewCountFetches.set(episodeId, p)
      // 同一 commit 内の二重 mount だけ相乗りさせ、後の再訪では取り直す
      p.finally(() => { setTimeout(() => viewCountFetches.delete(episodeId), 2000) })
    }
    p.then((n) => { if (!cancelled && n !== null) setCount(n) })
    return () => { cancelled = true }
  }, [episodeId])

  useEffect(() => {
    if (!episodeId || !isPlaying || viewIncremented.has(episodeId)) return
    viewIncremented.add(episodeId)
    try {
      const dedupKey = `viewed:${episodeId}`
      const last = typeof localStorage !== 'undefined' ? localStorage.getItem(dedupKey) : null
      const now = Date.now()
      if (last && now - parseInt(last, 10) < 24 * 3600 * 1000) return
      fetch(`/api/views/${episodeId}`, { method: 'POST', cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d && typeof d.count === 'number') setCount(d.count)
          try { localStorage.setItem(dedupKey, String(now)) } catch {}
        })
        .catch(() => {})
    } catch {}
  }, [episodeId, isPlaying])

  if (count === null) return null
  return (
    <span className="text-xs text-zinc-400 whitespace-nowrap shrink-0 tabular-nums">
      {count.toLocaleString()}回再生
    </span>
  )
}

function EpisodeShare({ title, gameTitle, episodeId }: { title?: string; gameTitle?: string; episodeId?: string | null }) {
  const [url, setUrl] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (typeof window === 'undefined') return
    setUrl(episodeId ? `${window.location.origin}/radio/${episodeId}` : window.location.href)
  }, [episodeId])
  const headline = (gameTitle && title) ? `${gameTitle} ${title}` : title
  return <SharePopover variant="zinc" title={headline} url={url} />
}

// 静的な波形バー (装飾)
const WAVEFORM_BARS = Array.from({ length: 72 }, (_, i) => {
  const v = Math.sin(i * 0.7) * 0.35 + Math.cos(i * 1.3) * 0.25 + Math.sin(i * 0.31) * 0.15
  return Math.max(0.18, Math.min(1.0, 0.5 + v))
})

/** ゲーム情報サイドバーの画像 (カバー + スクリーンショット を 30 秒ごとに切替) */
function GameImageRotator({ cover, screenshots, alt }: { cover: string; screenshots: string[]; alt: string }) {
  const images = [cover, ...screenshots.filter((s) => s && s !== cover)].filter(Boolean)
  const [idx, setIdx] = useState(0)
  useEffect(() => {
    if (images.length <= 1) return
    const id = setInterval(() => setIdx((i) => (i + 1) % images.length), 30000)
    return () => clearInterval(id)
  }, [images.length])
  if (images.length === 0) return null
  return (
    <div className="relative w-full rounded-2xl ring-1 ring-white/10 shadow-2xl overflow-hidden" style={{ aspectRatio: '460 / 215' }}>
      {images.map((src, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={src}
          src={src}
          alt={alt}
          className="absolute inset-0 w-full h-full object-cover transition-opacity duration-700"
          style={{ opacity: i === idx ? 1 : 0 }}
        />
      ))}
    </div>
  )
}

export default function RadioPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#171a21]" />}>
      <RadioPageInner />
    </Suspense>
  )
}

export function RadioPageInner({ initialEpisode }: { initialEpisode?: string } = {}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const urlEpisode = searchParams?.get('episode') || initialEpisode || null
  const urlDate = searchParams?.get('date') || null  // YYYY-MM-DD: この日付の連続再生キュー
  const urlQueue = searchParams?.get('queue') === '1'
  // 個別 episode URL (?episode=YYYYMMDD_HHMMSS or /radio/<id>) の profile を
  // 動的解決する。初期 fetch で all episodes を読んでから決定する。
  const [profile, setProfile] = useState<Profile>('indie')
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
        const raw: any[] = d.episodes || []
        // initialEpisode or URL ?episode= の profile を見て決定 (なければ indie)
        let resolvedProfile: Profile = profile
        if (urlEpisode) {
          const target = raw.find((e: any) => e.episode_id === urlEpisode)
          if (target && VALID_PROFILES.includes(target.profile)) {
            resolvedProfile = target.profile as Profile
          }
        }
        if (resolvedProfile !== profile) setProfile(resolvedProfile)
        const all = raw.filter((e: any) => e.profile === resolvedProfile)
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
      .catch(() => {
        // 一覧の取得失敗を握りつぶすと program effect が走らず「読み込み中...」の
        // まま永久スピナーになる (2026-07-12 review M2)。エラーを明示して止める。
        setAllEpisodes([])
        setEpisodes([])
        setError('エピソード一覧を読み込めませんでした。通信環境を確認して再読み込みしてください。')
        setLoading(false)
      })
  }, [urlEpisode, urlQueue, urlDate])
  const [program, setProgram] = useState<ProgramMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  // 再生開始直後 3 秒は一時停止オーバーレイ非表示 (操作感のため)
  const [recentlyStarted, setRecentlyStarted] = useState(false)
  // マウス等の精密ポインタかどうか (タッチデバイスでは ⏸ オーバーレイを完全に非表示)
  const [isFinePointer, setIsFinePointer] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(pointer: fine)')
    setIsFinePointer(mq.matches)
    const onChange = () => setIsFinePointer(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  const [showSegments, setShowSegments] = useState(false)
  // 倍速再生 (×1 / ×1.25 / ×1.5 / ×1.75 / ×2 から選択)。クリックで popup 開閉。
  const [playbackRate, setPlaybackRate] = useState(1)
  const [showSpeedMenu, setShowSpeedMenu] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  // 目パチ・口パク state
  const [zundaBlink, setZundaBlink] = useState(false)
  const [metanBlink, setMetanBlink] = useState(false)
  const [tsumugiBlink, setTsumugiBlink] = useState(false)
  const [ankomonBlink, setAnkomonBlink] = useState(false)
  // 口パク phase: 0=closed, 1=mid, 2=open (3-state cycle 0→1→2→1→0→1→...)
  const [zundaMouth, setZundaMouth] = useState(0)
  const [metanMouth, setMetanMouth] = useState(0)
  const [tsumugiMouth, setTsumugiMouth] = useState(0)
  const [ankomonMouth, setAnkomonMouth] = useState(0)

  // 各キャラの最後に active だった時の tone を覚えておくための ref。
  // 自分の次の発話まで前回の表情を保持するため (例: つむぎが kanashimi で
  // 話した直後にずんだのターンに切り替わっても、つむぎは kanashimi のまま
  // 待機させる)。normal で initial、speech segment 切替時に該当 speaker
  // の tone を update する。
  const lastZundaTone = useRef<Tone>('normal')
  const lastMetanTone = useRef<Tone>('normal')
  const lastTsumugiTone = useRef<Tone>('normal')
  const lastAnkomonTone = useRef<Tone>('normal')

  // 2026-05-19: Wake Lock API でスリープ抑制。
  // YouTube/Spotify Web Player と同様、再生中は画面/CPU sleep を防ぐ。
  // user 報告: 風呂場で再生中に時間経過で省電力モードに入って画面暗くなる事象、対策。
  // visibilitychange listener で tab 復帰時にも re-acquire (= Wake Lock は tab inactive で自動 release される仕様)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return
    let cancelled = false

    const acquireWakeLock = async () => {
      if (cancelled || !isPlaying) return
      try {
        // すでに取得済みなら何もしない (= 重複 release 防止)
        if (wakeLockRef.current && !wakeLockRef.current.released) return
        const sentinel = await (navigator as Navigator & { wakeLock: { request: (kind: 'screen') => Promise<WakeLockSentinel> } }).wakeLock.request('screen')
        if (cancelled) {
          sentinel.release().catch(() => {})
          return
        }
        wakeLockRef.current = sentinel
        sentinel.addEventListener('release', () => {
          // システム経由の release (= tab 切替等) の後 ref を null 化、再 acquire 用
          if (wakeLockRef.current === sentinel) wakeLockRef.current = null
        })
      } catch {
        // 失敗してもアプリの動作に影響なし (= スリープ抑制が効かないだけ)
      }
    }

    const releaseWakeLock = () => {
      const sentinel = wakeLockRef.current
      wakeLockRef.current = null
      if (sentinel && !sentinel.released) {
        sentinel.release().catch(() => {})
      }
    }

    if (isPlaying) {
      acquireWakeLock()
    } else {
      releaseWakeLock()
    }

    // tab 復帰時に再 acquire (= visibilitychange で自動 release される対策)
    const onVis = () => {
      if (document.visibilityState === 'visible' && isPlaying) {
        acquireWakeLock()
      }
    }
    document.addEventListener('visibilitychange', onVis)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVis)
      releaseWakeLock()
    }
  }, [isPlaying])

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
    const scheduleTsumugi = () => {
      const delay = 2700 + Math.random() * 3800
      const id = setTimeout(() => {
        if (cancelled) return
        setTsumugiBlink(true)
        setTimeout(() => { if (!cancelled) setTsumugiBlink(false); scheduleTsumugi() }, 160)
      }, delay)
      return id
    }
    const scheduleAnkomon = () => {
      const delay = 2600 + Math.random() * 4100
      const id = setTimeout(() => {
        if (cancelled) return
        setAnkomonBlink(true)
        setTimeout(() => { if (!cancelled) setAnkomonBlink(false); scheduleAnkomon() }, 160)
      }, delay)
      return id
    }
    scheduleZunda()
    scheduleMetan()
    scheduleTsumugi()
    scheduleAnkomon()
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
    // 高速ナビ (‹› 連打) で古い応答が後着すると別エピソードの meta を上書きする
    // race があった (2026-07-12 review M1)。cancelled flag で後着を破棄する。
    let cancelled = false
    fetch(target.meta_url, { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : null)
      .then((meta: any) => {
        if (cancelled) return
        const program: ProgramMeta = {
          profile: (VALID_PROFILES.includes(target.profile) ? target.profile : 'indie') as Profile,
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
          // 大画像 (個別ページ左ジャケット) は hero_rel 優先 → image_rel フォールバック。
          // hero が "_bg.jpg" (Steam Library 空背景) の場合は空表示防止のため image_rel に下げる。
          program_background: (() => {
            const h = target.featured_game?.hero_rel || ''
            const i = target.featured_game?.image_rel || ''
            if (h && !h.endsWith('_bg.jpg')) return h
            return i || h || null
          })(),
          featured_game: target.featured_game || null,
          program_description: target.program_description || '',
        }
        setProgram(program)
      })
      .catch((e) => { if (!cancelled) setError(String(e?.message || e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [allEpisodes, currentEpisode])

  // 現在エピソードのリスト内位置。program でなく currentEpisode (state) を参照することで
  // ナビ後の data refetch 中も index がブレない (両ボタンが一瞬 disabled になる事象を回避)
  const currentIndex = useMemo(() => {
    if (!episodes.length) return -1
    if (!currentEpisode) return 0  // 未指定 = 最新
    return episodes.findIndex((e) => e.episode_id === currentEpisode)
  }, [currentEpisode, episodes])
  const hasNewer = currentIndex > 0
  const hasOlder = currentIndex >= 0 && currentIndex < episodes.length - 1

  // ナビ後の auto-play フラグ。次の loadedmetadata で 1 度だけ play する
  const playOnNextLoadRef = useRef(false)
  // session refresh (muted play → pause) 中の onPlay/onPause を抑制するフラグ
  const sessionRefreshRef = useRef(false)

  // ナビ移動時は URL も同期 (リロード時に同じエピソードに戻れるように)
  const navigateTo = (epId: string, autoplay: boolean = true) => {
    if (autoplay) playOnNextLoadRef.current = true
    setCurrentEpisode(epId)
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `/radio/${epId}`)
    }
  }
  // 再生中ナビ → 移動先で自動再生 / 停止中ナビ → 停止のまま
  const goOlder = () => {
    if (hasOlder) navigateTo(episodes[currentIndex + 1].episode_id, isPlaying)
  }
  const goNewer = () => {
    if (hasNewer) navigateTo(episodes[currentIndex - 1].episode_id, isPlaying)
  }

  // 最新の goNewer/goOlder/hasNewer/hasOlder を ref で保持。
  // MediaSession actionHandler は mount 時に 1 度だけ登録し、内部で ref.current を読む。
  // 毎レンダリングで setActionHandler を呼ぶと iOS Safari で session が再初期化されて
  // ロック画面の再生枠の表示遅延 / 再生中ナビ時の dismissal が起きる。
  const navRefs = useRef({ goNewer, goOlder, hasNewer, hasOlder })
  navRefs.current = { goNewer, goOlder, hasNewer, hasOlder }

  // metadata は episode_id が変わった時だけ更新
  const currentEpisodeIdForMeta = program?.episode_id || null
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    if (!program) return
    const ms = (navigator as any).mediaSession
    const fg = program.featured_game
    const artUrl = (fg?.image_rel || fg?.hero_rel || '/og-image.png')
    // artist は常に「旅の道ラジオ」(日本語) に固定して widget の行高ばらつき防止。
    // ゲーム名 (ASCII or 混合) を artist に入れると Android/iOS の widget が
    // 行高を再計算してボタン位置がガタつく。title 側にゲーム名を含める。
    const showTitle = fg?.title
      ? `${fg.title} — ${program.title || ''}`
      : (program.title || '旅の道ラジオ')
    try {
      ms.metadata = new (window as any).MediaMetadata({
        title: showTitle,
        artist: '旅の道ラジオ',
        album: '旅の道ラジオ',
        // type/sizes は詐称しない (実体は webp/jpg 混在・サイズ非固定。誤った MIME 宣言で
        // 一部プラットフォームがデコードをスキップする)。省略時は UA が自動判定する。
        artwork: [{ src: artUrl }],
      })
    } catch {}
  }, [currentEpisodeIdForMeta])

  // actionHandler は mount 時に 1 度だけ登録 (ref 経由で current 値呼ぶ)
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    const ms = (navigator as any).mediaSession
    try {
      ms.setActionHandler('previoustrack', () => {
        const r = navRefs.current
        if (r.hasNewer) r.goNewer()
      })
      ms.setActionHandler('nexttrack', () => {
        const r = navRefs.current
        if (r.hasOlder) r.goOlder()
      })
      ms.setActionHandler('play', () => audioRef.current?.play().catch(() => {}))
      ms.setActionHandler('pause', () => audioRef.current?.pause())
      // setPositionState でシークバーを見せている以上、seekto が無いと
      // ロック画面のスクラブが「掴めるのに戻る」動作になる (2026-07-12 review)。
      ms.setActionHandler('seekto', (d: any) => {
        const a = audioRef.current
        if (a && d && typeof d.seekTime === 'number' && isFinite(d.seekTime)) {
          a.currentTime = d.seekTime
        }
      })
    } catch {}
  }, [])

  // playbackState を明示的に更新 (paused でも MediaSession を OS が dismiss しないように)
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    try {
      ;(navigator as any).mediaSession.playbackState = isPlaying ? 'playing' : 'paused'
    } catch {}
  }, [isPlaying])

  // setPositionState で「音声まだ生きてる」を OS に伝え続ける。
  // 特に paused 中の連続ナビで iOS が dismiss する事象の対策。
  // duration/currentTime が変わるたびに ping する。
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    const ms = (navigator as any).mediaSession
    if (typeof ms.setPositionState !== 'function') return
    if (!duration || !isFinite(duration)) return
    try {
      ms.setPositionState({
        duration,
        playbackRate,
        position: Math.min(currentTime, duration),
      })
    } catch {}
  }, [duration, currentTime, playbackRate])

  // speed menu の外クリックで閉じる (playbackRate 反映 effect は blobUrl
  // declare 後に置く必要があるので下方)
  useEffect(() => {
    if (!showSpeedMenu) return
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      if (t && t.closest('[data-speed-menu]')) return
      setShowSpeedMenu(false)
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [showSpeedMenu])

  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    const onTime = () => setCurrentTime(a.currentTime)
    const onLoaded = () => {
      setDuration(a.duration)
      // queue モード: 自動再生 (1件目含めすべて)
      if (queueIds.length > 0 && currentEpisode && queueIds.includes(currentEpisode)) {
        a.play().catch(() => {})
        return
      }
      // ナビ矢印 / MediaSession prev/next で移動した場合の自動再生
      if (playOnNextLoadRef.current) {
        playOnNextLoadRef.current = false
        a.play().catch(() => {})
        return
      }
      // 停止状態でナビ後の audio: そのままだと iOS/Android が「playback activity 無し」と
      // 判定して通知枠を dismiss する。muted で一瞬 play → 即 pause して session を refresh。
      if (a.paused) {
        const wasMuted = a.muted
        sessionRefreshRef.current = true
        a.muted = true
        a.play().then(() => {
          a.pause()
          a.muted = wasMuted
          sessionRefreshRef.current = false
        }).catch(() => {
          a.muted = wasMuted
          sessionRefreshRef.current = false
        })
      }
    }
    const onPlay = () => {
      if (sessionRefreshRef.current) return  // session refresh 中は UI 更新しない
      setIsPlaying(true)
      setRecentlyStarted(true)
      setTimeout(() => setRecentlyStarted(false), 3000)
    }
    const onPause = () => {
      if (sessionRefreshRef.current) return  // session refresh 中は UI 更新しない
      setIsPlaying(false)
    }
    const onEnded = () => {
      // queue モード: 次のエピソードへ。最後なら / にリダイレクト
      if (queueIds.length > 0 && currentEpisode) {
        const idx = queueIds.indexOf(currentEpisode)
        if (idx >= 0 && idx < queueIds.length - 1) {
          setCurrentEpisode(queueIds[idx + 1])
        } else if (idx === queueIds.length - 1) {
          // 全エピソード再生完了 → トップへ (内部遷移は router 経由が site 規約)
          router.push('/')
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

  // MP3 を Blob として一括ダウンロード → メモリから再生することで Range 非対応サーバ環境でも
  // シークが効くようにする (Cloudflare Workers Static Assets が Range を返さないため)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const prevBlobUrlRef = useRef<string | null>(null)
  useEffect(() => {
    if (!audioUrl) { setBlobUrl(null); return }
    // エピソード切替時は旧音声を即停止する。旧実装は新 blob の DL 完了まで旧 ep が
    // 鳴り続け、新 ep の字幕/立ち絵と食い違っていた (2026-07-12 review M4)。
    const a = audioRef.current
    if (a && !a.paused) a.pause()
    let canceled = false
    // ‹› 連打時に不要になった MP3 の全量 DL (5-10MB/本) を打ち切る
    const ac = new AbortController()
    fetch(audioUrl, { cache: 'force-cache', signal: ac.signal })
      .then((r) => r.ok ? r.blob() : Promise.reject(new Error(`status ${r.status}`)))
      .then((blob) => {
        if (canceled) return
        const newUrl = URL.createObjectURL(blob)
        // 古い blob URL は audio element が新 URL に切り替わるまで生かす。
        // 即時 revoke すると <audio> の src が指す Blob が invalid 化して
        // 再生が破綻 → MediaSession が落ちる原因になる。新 URL set 後に
        // 一拍置いてから revoke する。
        const oldUrl = prevBlobUrlRef.current
        prevBlobUrlRef.current = newUrl
        setBlobUrl(newUrl)
        if (oldUrl) setTimeout(() => URL.revokeObjectURL(oldUrl), 1500)
      })
      .catch((e) => {
        if (canceled || (e && e.name === 'AbortError')) return
        // フォールバック時も旧 blob を解放してから通常 URL へ
        const oldUrl = prevBlobUrlRef.current
        prevBlobUrlRef.current = null
        if (oldUrl) setTimeout(() => URL.revokeObjectURL(oldUrl), 1500)
        setBlobUrl(audioUrl)
      })
    return () => { canceled = true; ac.abort() }
  }, [audioUrl])

  // unmount 時に最後の blob URL を解放。旧実装は「次の blob 成功時」しか revoke
  // しないため、ラジオ⇔ホームを往復するたび ~6MB の Blob がタブ寿命まで残留し、
  // iOS PWA のメモリ死の一因だった (2026-07-12 review M3)。
  useEffect(() => () => {
    const last = prevBlobUrlRef.current
    prevBlobUrlRef.current = null
    if (last) setTimeout(() => URL.revokeObjectURL(last), 1500)
  }, [])

  // audio 要素に playbackRate を反映 (speed menu からの変更 + 新 blob load 時)
  // 多重防御で「効いたり効かなかったり」事象を確実に潰す:
  //  1. defaultPlaybackRate: src reload 後にブラウザが自動再適用
  //  2. playbackRate: 直接 set
  //  3. loadeddata / play / ratechange イベントで再注入
  //  4. 500ms polling で実値と state の乖離を強制補正 (SUPER VIDEO SPEED
  //     CONTROLLER 拡張機能と同じ手法、React の useEffect race を吸収)
  //  5. preservesPitch: 倍速時の声の高さを維持 (Safari/Firefox 旧名も併用)
  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    const apply = () => {
      try {
        ;(a as any).preservesPitch = true
        ;(a as any).mozPreservesPitch = true
        ;(a as any).webkitPreservesPitch = true
      } catch {}
      a.defaultPlaybackRate = playbackRate
      if (Math.abs(a.playbackRate - playbackRate) > 0.001) {
        a.playbackRate = playbackRate
      }
    }
    apply()
    a.addEventListener('loadeddata', apply)
    a.addEventListener('play', apply)
    a.addEventListener('ratechange', apply)
    // 500ms polling: React state と audio.playbackRate が drift したら強制補正
    const pollId = setInterval(apply, 500)
    return () => {
      a.removeEventListener('loadeddata', apply)
      a.removeEventListener('play', apply)
      a.removeEventListener('ratechange', apply)
      clearInterval(pollId)
    }
  }, [playbackRate, blobUrl])

  const segments: Segment[] = program?.audio_meta?.segments || []
  const currentSegment = segments.find(
    (s) => currentTime >= s.start_sec && currentTime < s.end_sec
  )

  // Speech segment が変わるたびに、その speaker の最後の active tone を ref に焼き付ける。
  // これで「自分の次の発話まで前回の表情を保持」が成立する (zunda が話してる間も
  // tsumugi は前回の kanashimi 等を維持、partner_tone 経由で normal にリセットされない)。
  useEffect(() => {
    if (currentSegment?.type === 'speech') {
      const segTone = (currentSegment as any).tone || 'normal'
      const t: Tone = (VALID_TONES as readonly string[]).includes(segTone) ? (segTone as Tone) : 'normal'
      if (currentSegment.speaker === 'zunda') lastZundaTone.current = t
      else if (currentSegment.speaker === 'metan') lastMetanTone.current = t
      else if (currentSegment.speaker === 'tsumugi') lastTsumugiTone.current = t
      else if (currentSegment.speaker === 'ankomon') lastAnkomonTone.current = t
    }
  }, [currentSegment])

  // 立ち絵の先読み: 現在のセグメントから SPRITE_LOOKAHEAD 個先までに出る
  // (speaker, tone) のコマを decode まで済ませておく。seek で飛んでも
  // 飛び先のセグメントから即先読みが走る。
  useEffect(() => {
    if (segments.length === 0) return
    const hasTsumugi = segments.some(s => s.type === 'speech' && s.speaker === 'tsumugi')
    const hasAnkomon = segments.some(s => s.type === 'speech' && s.speaker === 'ankomon')
    const introPartner = hasAnkomon ? 'ankomon' : hasTsumugi ? 'tsumugi' : 'metan'
    const start = currentSegment ? Math.max(0, segments.indexOf(currentSegment)) : 0
    const end = Math.min(segments.length, start + SPRITE_LOOKAHEAD)
    for (let i = start; i < end; i++) {
      const s = segments[i]
      if (s.type === 'speech') {
        const raw = (s as any).tone || 'normal'
        const t = (VALID_TONES as readonly string[]).includes(raw) ? raw : 'normal'
        preloadToneFrames(s.speaker, t)
      } else if (s.type === 'intro') {
        preloadToneFrames('zunda', 'normal')
        preloadToneFrames(introPartner, 'intro')
      }
    }
  }, [currentSegment, segments])

  // 口パク: 4 種のランダムパターンをセグメントごとに選び、100ms フレームで cycle 回す
  // (他ゲームの kuti1-4 アルゴリズムを参考に、機械的な開閉でなく自然なリズム差を作る)
  // 0=closed, 1=mid, 2=open
  // intro セグメントの場合、ジングル単独部分 (前後) では口を閉じ、ナレーション部分だけパクパクする
  useEffect(() => {
    const isSpeech = currentSegment?.type === 'speech'
    const isIntroSeg = currentSegment?.type === 'intro'
    // tsumugi がいる episode の intro は title call もつむぎが担当。
    // 雑学回 (ankomon 出演) はあんこもんが担当 — backend/tools/radio_intro.py の
    // cast 判定 (zatsugaku > retro > default) と同じ優先順にする。
    const introHasTsumugi = isIntroSeg && segments.some(s => s.type === 'speech' && s.speaker === 'tsumugi')
    const introHasAnkomon = isIntroSeg && segments.some(s => s.type === 'speech' && s.speaker === 'ankomon')
    const speaker = isSpeech
      ? currentSegment.speaker
      : isIntroSeg
      ? (introHasAnkomon ? 'ankomon' : introHasTsumugi ? 'tsumugi' : 'metan')
      : null
    if (!isPlaying || !speaker) {
      setZundaMouth(0)
      setMetanMouth(0)
      setTsumugiMouth(0)
      setAnkomonMouth(0)
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
          setTsumugiMouth(0)
          setAnkomonMouth(0)
          return
        }
      }
      const frame = pattern[step % pattern.length]
      step++
      // 発話者だけ frame を進め、他は 0 (閉じ) に落とす。
      setZundaMouth(speaker === 'zunda' ? frame : 0)
      setMetanMouth(speaker === 'metan' ? frame : 0)
      setTsumugiMouth(speaker === 'tsumugi' ? frame : 0)
      setAnkomonMouth(speaker === 'ankomon' ? frame : 0)
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

  // 左メインジャケット用のローテーション画像 (program_background + screenshot_rels、30秒周期切替)
  const bgImages = useMemo(() => {
    const fg = program?.featured_game
    const base = program?.program_background || null
    const screenshots = (fg?.screenshot_rels || []).filter(Boolean)
    const out: string[] = []
    if (base) out.push(base)
    for (const s of screenshots) {
      if (s && s !== base) out.push(s)
    }
    return out
  }, [program])
  const [bgIdx, setBgIdx] = useState(0)
  useEffect(() => { setBgIdx(0) }, [program?.episode_id])
  useEffect(() => {
    if (bgImages.length <= 1) return
    const id = setInterval(() => setBgIdx((i) => (i + 1) % bgImages.length), 30000)
    return () => clearInterval(id)
  }, [bgImages.length])

  const handleSeek = (sec: number) => {
    const a = audioRef.current
    if (!a) return
    const dur = isFinite(a.duration) && a.duration > 0 ? a.duration : duration
    a.currentTime = Math.max(0, Math.min(dur, sec))
  }

  // 波形のドラッグシーク (pointer events でタッチ・マウス両対応)
  const seekingRef = useRef(false)
  const seekFromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    const a = audioRef.current
    if (!a) return
    const rect = e.currentTarget.getBoundingClientRect()
    const f = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const dur = isFinite(a.duration) && a.duration > 0 ? a.duration : duration
    if (dur > 0) a.currentTime = f * dur
  }
  const onWaveformPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    seekingRef.current = true
    seekFromEvent(e)
  }
  const onWaveformPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!seekingRef.current) return
    seekFromEvent(e)
  }
  const onWaveformPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    seekingRef.current = false
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch {}
  }
  const togglePlay = () => {
    const a = audioRef.current
    if (!a) return
    if (a.paused) a.play().catch(() => {})
    else a.pause()
  }

  const progressFrac = duration > 0 ? currentTime / duration : 0

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#1b2838] via-[#1b2838] to-[#171a21] text-zinc-100">
      {/* hidden audio: ローディング中も DOM に維持してナビ間で MediaSession を継続させる。
          MP3 を Blob として fetch して in-memory 再生するのでシーク可能 */}
      <audio ref={audioRef} src={blobUrl || undefined} preload="auto" hidden />

      {/* エピソードナビ (画面下部中央、左右配置)。左=新しい / 右=古い */}
      <div className="fixed left-1/2 -translate-x-1/2 bottom-4 md:bottom-6 z-50 flex items-center gap-3 md:gap-4 px-3 py-2 rounded-full bg-black/40 backdrop-blur-md ring-1 ring-white/10">
        <button
          onClick={goNewer}
          disabled={!hasNewer}
          className="w-9 h-9 md:w-10 md:h-10 inline-flex items-center justify-center text-2xl md:text-3xl font-light leading-none text-white/70 enabled:hover:text-white disabled:text-white/30 disabled:cursor-not-allowed shrink-0 focus:outline-none appearance-none p-0 m-0 border-0 bg-transparent"
          title="新しいエピソード"
          aria-label="新しいエピソード"
        >‹</button>
        <span className="text-[10px] md:text-xs text-zinc-300 tracking-widest select-none">EPISODE</span>
        <button
          onClick={goOlder}
          disabled={!hasOlder}
          className="w-9 h-9 md:w-10 md:h-10 inline-flex items-center justify-center text-2xl md:text-3xl font-light leading-none text-white/70 enabled:hover:text-white disabled:text-white/30 disabled:cursor-not-allowed shrink-0 focus:outline-none appearance-none p-0 m-0 border-0 bg-transparent"
          title="古いエピソード"
          aria-label="古いエピソード"
        >›</button>
      </div>

      <div className="max-w-md md:max-w-5xl mx-auto px-4 pt-6 pb-10">
        {/* 上部バー */}
        <div className="flex items-center justify-between mb-5">
          <Link href={homeHref(profile)} className="text-zinc-300 hover:text-white text-sm">← 戻る</Link>
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
          <EpisodeShare title={program?.title} gameTitle={program?.featured_game?.title} episodeId={currentEpisode} />
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
              {/* 背景画像: 30 秒周期で cover + screenshots をクロスフェード rotate */}
              {(() => {
                if (bgImages.length === 0) {
                  const fallback = currentCover?.og_image || null
                  if (!fallback) {
                    return (
                      <div className="w-full h-full bg-gradient-to-br from-[#1b2838] to-zinc-900 flex items-center justify-center text-7xl">
                        📻
                      </div>
                    )
                  }
                  return (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={fallback}
                      alt=""
                      className="w-full h-full object-cover transition-opacity duration-500"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }}
                    />
                  )
                }
                return (
                  <>
                    {bgImages.map((src, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={src}
                        src={src}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover transition-opacity duration-700"
                        style={{ opacity: i === bgIdx ? 1 : 0 }}
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }}
                      />
                    ))}
                  </>
                )
              })()}
              {/* ずんだ (左) + めたん / つむぎ / あんこもん (右) の立ち絵:
                  tone 切替 + 目パチ + 口パク + intro マイク持ち。
                  右側の相方は segments を見て自動判定する:
                    ankomon 出演 → 雑学回、tsumugi 出演 → レトロ回、それ以外 → めたん */}
              {(() => {
                // VALID_TONES は backend/data/speakers/*.json から自動生成 (npm run gen:tones)。
                // 新 tone 追加時は speaker JSON 編集 → gen:tones → 自動反映。
                type Tone = typeof VALID_TONES[number]
                const segTone = (currentSegment && 'tone' in currentSegment ? currentSegment.tone : undefined) as Tone | undefined
                const tone: Tone = (segTone && (VALID_TONES as readonly string[]).includes(segTone) ? segTone : 'normal')
                const isIntro = !!(currentSegment && currentSegment.type === 'intro')
                const activeSpeaker = currentSegment && currentSegment.type === 'speech' ? currentSegment.speaker : null
                const zundaActive   = activeSpeaker === 'zunda'
                const metanActive   = activeSpeaker === 'metan'
                const tsumugiActive = activeSpeaker === 'tsumugi'
                const ankomonActive = activeSpeaker === 'ankomon'

                // Determine cast: tsumugi (retro) / ankomon (雑学) がいれば
                // その回はめたんの代わりに右側に立つ。
                const hasTsumugi = segments.some(s => s.type === 'speech' && s.speaker === 'tsumugi')
                const hasAnkomon = segments.some(s => s.type === 'speech' && s.speaker === 'ankomon')

                // partner_tone: speech segment に付けると「発話してない側」の立ち絵 tone を override
                const partnerToneRaw = (currentSegment && 'partner_tone' in currentSegment ? (currentSegment as any).partner_tone : undefined) as Tone | undefined
                const partnerTone: Tone | null = (partnerToneRaw && (VALID_TONES as readonly string[]).includes(partnerToneRaw)) ? partnerToneRaw : null

                // 非 active キャラは「自分の最後の active 時の tone」を維持。
                // partnerTone がセグメントで明示されている場合のみそれを優先 (= 反応指定)。
                // ref ベースで保持するので、自分の次の発話まで表情が normal に戻らない。
                const zundaTone:   Tone = zundaActive
                  ? tone
                  : (partnerTone ?? lastZundaTone.current)
                const metanTone:   Tone = metanActive
                  ? tone
                  : (partnerTone ?? lastMetanTone.current)
                const tsumugiTone: Tone = tsumugiActive
                  ? tone
                  : (partnerTone ?? lastTsumugiTone.current)
                const ankomonTone: Tone = ankomonActive
                  ? tone
                  : (partnerTone ?? lastAnkomonTone.current)

                // mouth phase -> suffix: 0=base, 1=_talk (mid), 2=_talk2 (open)
                const mouthSuffix = (m: number) => m === 2 ? '_talk2' : m === 1 ? '_talk' : ''

                // 元から目を閉じている表情ではまばたきさせない。_blink は 目 を無条件に
                // 閉じ目へ差し替えるので、閉じ目の tone に当てると「閉じ目 -> 別の閉じ目」に
                // なり、まばたきではなく表情が 150ms だけ変わってしまう。ずんだもんの
                // namidame では泣き目 >< が笑顔の目に化けていた (2026-08-26 user 指摘)。
                const canBlink = (speaker: string, t: string) => !NO_BLINK[speaker]?.includes(t)

                // ずんだ image state: 優先順 blink > mouth-phase > base
                const zundaSrc = zundaBlink && canBlink('zunda', zundaTone)
                  ? `/characters/zunda/${zundaTone}_blink.png`
                  : zundaActive
                  ? `/characters/zunda/${zundaTone}${mouthSuffix(zundaMouth)}.png`
                  : `/characters/zunda/${zundaTone}.png`

                // めたん image state (intro 時はマイク持ち専用ポーズ + 口パク、blink も intro_blink.png 使用)
                const metanSrc = isIntro
                  ? (metanBlink
                      ? `/characters/metan/intro_blink.png`
                      : `/characters/metan/intro${mouthSuffix(metanMouth)}.png`)
                  : metanBlink && canBlink('metan', metanTone)
                  ? `/characters/metan/${metanTone}_blink.png`
                  : metanActive
                  ? `/characters/metan/${metanTone}${mouthSuffix(metanMouth)}.png`
                  : `/characters/metan/${metanTone}.png`

                // つむぎ image state (intro 時はゆびさし+カメラ目線ポーズ + 口パク、blink も intro_blink.png 使用)
                const tsumugiSrc = (isIntro && hasTsumugi)
                  ? (tsumugiBlink
                      ? `/characters/tsumugi/intro_blink.png`
                      : `/characters/tsumugi/intro${mouthSuffix(tsumugiMouth)}.png`)
                  : tsumugiBlink && canBlink('tsumugi', tsumugiTone)
                  ? `/characters/tsumugi/${tsumugiTone}_blink.png`
                  : tsumugiActive
                  ? `/characters/tsumugi/${tsumugiTone}${mouthSuffix(tsumugiMouth)}.png`
                  : `/characters/tsumugi/${tsumugiTone}.png`

                // あんこもん image state (intro 時はマイク持ち+カメラ目線ポーズ + 口パク)
                const ankomonSrc = (isIntro && hasAnkomon)
                  ? (ankomonBlink
                      ? `/characters/ankomon/intro_blink.png`
                      : `/characters/ankomon/intro${mouthSuffix(ankomonMouth)}.png`)
                  : ankomonBlink && canBlink('ankomon', ankomonTone)
                  ? `/characters/ankomon/${ankomonTone}_blink.png`
                  : ankomonActive
                  ? `/characters/ankomon/${ankomonTone}${mouthSuffix(ankomonMouth)}.png`
                  : `/characters/ankomon/${ankomonTone}.png`

                // 右側に立つ相方を 1 つに決める (立ち絵・active 判定・配置オフセット)。
                //
                // オフセットは「体が枠外にどれだけ切れるか」で揃えている。left/right の %
                // は枠に対する値だが、PSD ごとに画像の縦横比も素体の余白も違うので、
                // 同じ % でも切れ方は揃わない。実測 (alpha bbox ベース):
                //   ankomon right:-5%   -> はみ出し  2%   (PSD 1500x3300、右余白 6.5%)
                //   metan   right:-14%  -> はみ出し  8%   (PSD 1082x1820、右余白 10.4%)
                //   tsumugi right:-14%  -> はみ出し  8%
                //   zunda   left:-16%   -> はみ出し  8%   (scaleX(-1) 済みなので元の右余白が効く)
                // 2026-08-25: 中央寄せの要望で 24/22% (はみ出し 17%) から半減させた。
                // さらに寄せてあんこもんと完全に揃えるなら zunda -9% / 他 -8%。
                const partner = hasAnkomon
                  ? { src: ankomonSrc, active: ankomonActive, right: '-5%' }
                  : hasTsumugi
                  ? { src: tsumugiSrc, active: tsumugiActive, right: '-14%' }
                  : { src: metanSrc,   active: metanActive,   right: '-14%' }

                // <img> 直書きではなく SpriteImg: decode 済みのコマにしか src を
                // 差し替えない (読み込み中の空白/前ポーズ残りを防ぐ)。
                return (
                  <>
                    <SpriteImg
                      src={zundaSrc}
                      style={{
                        left: '-16%',
                        bottom: '-32%',
                        height: '100%',
                        zIndex: zundaActive ? 5 : 4,
                        transform: 'scaleX(-1)',
                      }}
                    />
                    <SpriteImg
                      src={partner.src}
                      style={{
                        right: partner.right,
                        bottom: '-32%',
                        height: '100%',
                        zIndex: partner.active ? 5 : 4,
                      }}
                    />
                  </>
                )
              })()}
              {/* 上端: グラデ + 番組タイトル */}
              <div className="absolute inset-x-0 top-0 pt-5 pb-6 px-5 bg-gradient-to-b from-black/80 via-black/50 to-transparent">
                <h1 className="text-xl font-bold leading-tight drop-shadow-2xl text-white line-clamp-2">
                  {titleMain || '(無題)'}
                </h1>
                {titleSub && (
                  <p className="text-xs text-zinc-200/90 mt-1 drop-shadow leading-snug line-clamp-1">
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
                    currentSegment.speaker === 'zunda'
                      ? 'text-emerald-200'
                      : currentSegment.speaker === 'ankomon'
                      ? 'text-rose-200'
                      : 'text-zinc-50',
                  ].join(' ')}>
                    {currentSegment.text}
                  </p>
                ) : currentSegment && currentSegment.type === 'music' ? (
                  <p className="text-center text-base md:text-lg leading-relaxed text-[#c7d5e0] px-4 py-4 max-w-[92%] max-h-[88%] overflow-hidden [text-shadow:_0_0_6px_rgb(0_0_0_/_0.95),_0_2px_4px_rgb(0_0_0_/_0.9)]">
                    🎵 {currentSegment.intro_text}
                  </p>
                ) : null}
              </div>

              {/* 左下: ▶/⏸ インジケータ + 倍速切替ボタン (popup 式)。
                  ▶/⏸ は pointer-events-none でジャケットクリック (togglePlay) を素通り。
                  速度ボタンだけは pointer-events-auto + stopPropagation でジャケットクリックを抑止。 */}
              <div className="absolute left-3 bottom-3 z-40 flex items-end gap-2">
                <div className="w-12 h-12 rounded-full bg-black/65 ring-1 ring-white/25 flex items-center justify-center text-white shadow-lg pointer-events-none">
                  {isPlaying ? (
                    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
                      <rect x="6" y="5" width="4" height="14" rx="1" />
                      <rect x="14" y="5" width="4" height="14" rx="1" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </div>
                <div className="relative pointer-events-auto" data-speed-menu>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setShowSpeedMenu((v) => !v) }}
                    aria-label="再生速度"
                    aria-haspopup="menu"
                    aria-expanded={showSpeedMenu}
                    className="w-10 h-10 rounded-full bg-black/65 ring-1 ring-white/25 flex items-center justify-center text-white text-[11px] font-bold shadow-lg hover:bg-black/85 active:scale-95 transition-all"
                  >
                    ×{playbackRate}
                  </button>
                  {showSpeedMenu && (
                    <div
                      role="menu"
                      onClick={(e) => e.stopPropagation()}
                      className="absolute left-0 bottom-12 mb-1 bg-zinc-900/95 backdrop-blur-sm ring-1 ring-white/15 rounded-xl py-1 shadow-2xl min-w-[88px]"
                    >
                      {[1, 1.25, 1.5, 1.75, 2].map((r) => (
                        <button
                          key={r}
                          type="button"
                          role="menuitemradio"
                          aria-checked={playbackRate === r}
                          onClick={(e) => { e.stopPropagation(); setPlaybackRate(r); setShowSpeedMenu(false) }}
                          className={[
                            'block w-full px-4 py-1.5 text-sm text-left transition-colors',
                            playbackRate === r
                              ? 'text-emerald-300 font-bold bg-white/5'
                              : 'text-zinc-100 hover:bg-white/10',
                          ].join(' ')}
                        >
                          ×{r}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* 下端: グラデ + 現ニュース or Featured ゲーム表示 */}
              {(() => {
                // Indie で featured_game ある時はゲーム名 + 開発元、テック回は
                // companies 一覧を「・」区切り、それ以外は記事サムネのタイトル
                let displayTitle = ''
                let displaySource = ''
                if (program.featured_game) {
                  const fg = program.featured_game
                  const companies = fg.companies || []
                  if (companies.length > 0) {
                    // テック回: 企業名を主表示、副表示は「テックニュース」固定
                    // (featured_game.title は番組タイトルと重複するので使わない)
                    displayTitle = companies.join('・')
                    displaySource = 'テックニュース'
                  } else {
                    displayTitle = fg.title
                    const devs = fg.developers || []
                    displaySource = devs.length > 0 ? devs.join(' / ') : 'Steam'
                  }
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

            {/* 波形 (クリック/ドラッグでシーク) */}
            <div
              className="relative h-14 mb-2 cursor-pointer select-none touch-none"
              onPointerDown={onWaveformPointerDown}
              onPointerMove={onWaveformPointerMove}
              onPointerUp={onWaveformPointerUp}
              onPointerCancel={onWaveformPointerUp}
              title="ドラッグでシーク"
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
                      speakerLabel = seg.speaker === 'zunda' ? '🟢'
                        : seg.speaker === 'tsumugi' ? '🌸'
                        : seg.speaker === 'ankomon' ? '🟣'
                        : '🔴'
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

            {/* モバイル時の概要パネル (デスクトップ時は右カラムが同じ情報を持つので非表示) */}
            {program.featured_game && (
              <div className="md:hidden mt-3 bg-black/30 backdrop-blur-sm rounded-2xl p-4 space-y-2 text-zinc-100">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="text-base font-bold leading-tight">{program.featured_game.title}</h2>
                  <ViewCounter episodeId={currentEpisode} isPlaying={isPlaying} />
                </div>
                <div className="text-[11px] text-zinc-400 flex flex-wrap gap-x-3 gap-y-1">
                  {program.featured_game.developers?.length ? (
                    <span>👤 {program.featured_game.developers.join(' / ')}</span>
                  ) : null}
                  {program.featured_game.release_date ? (
                    <span>📅 {program.featured_game.release_date}</span>
                  ) : null}
                  {program.featured_game.price ? (
                    <span>💴 {program.featured_game.price}</span>
                  ) : null}
                </div>
                {program.featured_game.genres?.length ? (
                  <div className="flex flex-wrap gap-1">
                    {program.featured_game.genres.map((g) => (
                      <Link
                        key={g}
                        href={`/?genre=${encodeURIComponent(g)}&profile=${profile}`}
                        className="px-2 py-0.5 text-[10px] bg-white/10 hover:bg-white/20 rounded-full text-zinc-300 hover:text-white transition-colors"
                      >{g}</Link>
                    ))}
                  </div>
                ) : null}
                {(program.program_description || program.featured_game.short_description) ? (
                  <p className="text-xs text-zinc-200/85 leading-relaxed">
                    {program.program_description || program.featured_game.short_description}
                  </p>
                ) : null}
              </div>
            )}

            </div>

            {/* 右カラム (デスクトップのみ): Steam 横長 header (or fallback) + ゲーム概要 */}
            {program.featured_game && (program.featured_game.app_id || program.featured_game.image_rel) && (
              <aside className="hidden md:block sticky top-6 self-start space-y-3">
                {/* 右カラム header は固定 (rotation せず)、cover 画像 1 枚を表示。
                    左メイン jacket の方が 30 秒周期で cover+screenshots を rotate */}
                {(() => {
                  // header_url は radio_export.py が mtime ?v= 付きで焼く
                  // (SW が /images/ を cache-first 永続化するため、無いと
                  // Steam jacket 差し替えても古い画像が出続ける)。
                  // 旧 ep (header_url 無) は app_id fallback、それも無ければ image_rel。
                  const src =
                    program.featured_game.header_url
                      || (program.featured_game.app_id
                            ? `/images/games/${program.featured_game.app_id}_header.jpg`
                            : program.featured_game.image_rel || '')
                  // 枠の比率は中身に合わせる。Steam の header は 460x215 (約 2.14:1)、
                  // 自前で合成したカード (/images/topics/*_chars.webp) は 16:9。
                  // 一律 460/215 にしていたため、合成カードは上下が 8.5% ずつ切れていた。
                  const isSteamHeader = /_header\.(jpe?g|png)/i.test(src)
                  return (
                    <div
                      className="relative w-full rounded-2xl overflow-hidden ring-1 ring-white/10 shadow-2xl"
                      style={{ aspectRatio: isSteamHeader ? '460 / 215' : '16 / 9' }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={src}
                        alt={program.featured_game.title}
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                    </div>
                  )
                })()}
                <div className="bg-black/30 backdrop-blur-sm rounded-2xl p-5">
                  <div className="flex items-baseline justify-between gap-3 mb-2">
                    <h2 className="text-lg font-bold text-zinc-50 leading-tight">
                      {program.featured_game.title}
                    </h2>
                    <ViewCounter episodeId={currentEpisode} isPlaying={isPlaying} />
                  </div>
                  <div className="text-xs text-zinc-400 mb-3 flex flex-wrap gap-x-3 gap-y-1">
                    {program.featured_game.developers?.length ? (
                      <span>👤 {program.featured_game.developers.join(' / ')}</span>
                    ) : null}
                    {program.featured_game.release_date?.trim() ? (
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
                        リリース: {program.featured_game.release_date.trim()}
                      </span>
                    ) : null}
                    {program.featured_game.price?.trim() ? (
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
                        {program.featured_game.price.trim()}
                      </span>
                    ) : null}
                  </div>
                  {program.featured_game.genres?.length ? (
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {program.featured_game.genres.map((g) => (
                        <Link
                          key={g}
                          href={`/?genre=${encodeURIComponent(g)}&profile=${profile}`}
                          className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 hover:bg-white/20 text-zinc-200 hover:text-white transition-colors"
                        >
                          {g}
                        </Link>
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
          <div className="bg-[#171a21]/40 border border-[#66c0f4]/40 rounded-2xl p-4 text-[#c7d5e0]">
            台本はあるけど音声がまだ生成されていない。<code>radio_synthesize.py --all</code> を実行してください。
          </div>
        )}
      </div>
    </main>
  )
}
