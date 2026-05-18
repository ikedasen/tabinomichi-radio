'use client'

import { useEffect, useRef, useState } from 'react'

type Props = {
  title?: string
  url?: string
  /** ボタンの色味 (header の amber 系と radio ページの zinc 系を切り替え) */
  variant?: 'amber' | 'zinc'
}

export default function SharePopover({ title, url: urlOverride, variant = 'amber' }: Props) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('touchstart', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('touchstart', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const getUrl = () => urlOverride || (typeof window !== 'undefined' ? window.location.href : '')
  const SITE_NAME = '旅の道ラジオ'
  const headline = title ? `${title} ー${SITE_NAME}` : SITE_NAME

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(`${headline}\n${getUrl()}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {}
  }

  const openIntent = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer')
    setOpen(false)
  }

  const onX = () => {
    // X side の OG card cache 対策: tweet URL に unique query (timestamp) を
    // 付与して、X が「別 URL」と認識して fresh fetch するよう仕向ける。
    // 元 URL のまま渡すと X 側の cache が永続表示されて、site 側で OG を更新
    // しても新 card が反映されない事故が起きる (= viviON 回で発覚)。
    // _t は 5 分単位の epoch にして、短時間の連続押下では同 URL になるよう丸める
    // (= 同 user の即連続シェアで X の "url ですでに見たことある" 挙動も活かす)。
    const targetUrl = getUrl()
    const sep = targetUrl.includes('?') ? '&' : '?'
    const bucket = Math.floor(Date.now() / (5 * 60 * 1000))  // 5 min バケット
    const freshUrl = `${targetUrl}${sep}_card=${bucket}`
    const shareText = title || SITE_NAME
    const u = `https://x.com/intent/post?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(freshUrl)}`
    openIntent(u)
  }

  const onLine = () => {
    const u = `https://line.me/R/msg/text/?${encodeURIComponent(`${headline}\n${getUrl()}`)}`
    openIntent(u)
  }

  const onHatena = () => {
    const u = `https://b.hatena.ne.jp/add?mode=confirm&url=${encodeURIComponent(getUrl())}&title=${encodeURIComponent(headline)}`
    openIntent(u)
  }

  const triggerCls = variant === 'amber'
    ? 'text-amber-200/80 hover:text-amber-100'
    : 'text-zinc-300 hover:text-white'

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="共有"
        aria-expanded={open}
        title="共有"
        className={`relative inline-flex items-center justify-center w-9 h-9 rounded-full hover:bg-white/10 transition-colors ${triggerCls}`}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-full right-0 mt-1.5 py-1 rounded-xl bg-zinc-900/95 backdrop-blur-md ring-1 ring-white/15 shadow-2xl z-50 min-w-[180px] overflow-hidden"
        >
          <button
            role="menuitem"
            onClick={onCopy}
            className="w-full px-3 py-2.5 text-sm text-left text-zinc-100 hover:bg-white/10 inline-flex items-center gap-2.5 transition-colors"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-zinc-300" aria-hidden>
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            <span>{copied ? 'コピーしました' : 'URL をコピー'}</span>
          </button>

          <button
            role="menuitem"
            onClick={onX}
            className="w-full px-3 py-2.5 text-sm text-left text-zinc-100 hover:bg-white/10 inline-flex items-center gap-2.5 transition-colors"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" className="shrink-0 text-zinc-100" aria-hidden>
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
            </svg>
            <span>X で共有</span>
          </button>

          <button
            role="menuitem"
            onClick={onLine}
            className="w-full px-3 py-2.5 text-sm text-left text-zinc-100 hover:bg-white/10 inline-flex items-center gap-2.5 transition-colors"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" className="shrink-0" style={{ color: '#06C755' }} aria-hidden>
              <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.105.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/>
            </svg>
            <span>LINE で共有</span>
          </button>

          <button
            role="menuitem"
            onClick={onHatena}
            className="w-full px-3 py-2.5 text-sm text-left text-zinc-100 hover:bg-white/10 inline-flex items-center gap-2.5 transition-colors"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" className="shrink-0" style={{ color: '#00A4DE' }} aria-hidden>
              <path d="M20.47 0H3.53A3.53 3.53 0 0 0 0 3.53v16.94A3.53 3.53 0 0 0 3.53 24h16.94A3.53 3.53 0 0 0 24 20.47V3.53A3.53 3.53 0 0 0 20.47 0M14.7 17.34a3.05 3.05 0 0 1-1.43.86 8.6 8.6 0 0 1-2.62.29h-4V6.3h4.16q2.04 0 3.16.79t1.12 2.6c0 .76-.18 1.38-.55 1.86s-.93.81-1.69.99q1.59.27 2.34 1.16t.75 2.39q0 .87-.31 1.59c-.21.49-.5.86-.93 1.23m.65-3c0-1.14-.57-1.71-1.71-1.71h-2.85v3.43h2.85c1.14 0 1.71-.57 1.71-1.72m-.46-5.43c0-1.07-.55-1.6-1.66-1.6h-2.45v3.17h2.45c1.11 0 1.66-.52 1.66-1.57m4.05 7.45a1.65 1.65 0 1 1 0-3.3 1.65 1.65 0 0 1 0 3.3"/>
            </svg>
            <span>はてブで共有</span>
          </button>
        </div>
      )}
    </div>
  )
}
