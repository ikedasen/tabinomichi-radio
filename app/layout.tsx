import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import ServiceWorkerRegister from './sw-register'

const inter = Inter({ subsets: ['latin'] })

const SITE_URL = 'https://news.tabinomichi.jp'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: '旅の道ラジオ — Tabinomichi Radio',
  description: 'ずんだもん × めたん × つむぎが届ける、ゲーム & テックニュース雑談ラジオ。',
  manifest: '/manifest.json',
  alternates: {
    types: {
      'application/rss+xml': [{ url: '/feed.xml', title: '旅の道ラジオ — Podcast RSS' }],
    },
  },
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: '旅の道ラジオ',
    title: '旅の道ラジオ — Tabinomichi Radio',
    description: 'ずんだもん × めたん × つむぎが届ける、ゲーム & テックニュース雑談ラジオ。',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: '旅の道ラジオ' }],
    locale: 'ja_JP',
  },
  twitter: {
    card: 'summary_large_image',
    title: '旅の道ラジオ — Tabinomichi Radio',
    description: 'ずんだもん × めたん × つむぎが届ける、ゲーム & テックニュース雑談ラジオ。',
    images: ['/og-image.png'],
  },
  appleWebApp: {
    capable: true,
    title: '旅の道ラジオ',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
}

export const viewport: Viewport = {
  // 実 UI の Steam 系パレットに一致させる (旧 #451a03 は改装前の琥珀色で、
  // Android のステータスバー/スプラッシュだけ茶色くなっていた)
  themeColor: '#171a21',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className="dark">
      <body className={inter.className}>
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  )
}
