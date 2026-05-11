import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: '旅の道ラジオ — Tabinomichi Radio',
  description: 'ずんだもん×めたんが届けるインディーゲームの深夜雑談ラジオ。',
}

export const viewport: Viewport = {
  themeColor: '#1a0e08',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className="dark">
      <body className={inter.className}>{children}</body>
    </html>
  )
}
