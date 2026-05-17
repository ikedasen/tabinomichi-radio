// Apple Podcasts / Spotify 用 3000x3000 アートワーク。
// 既存の generate-og.js (1200x630 OG) と同じ pattern、sharp で SVG icon + amber BG + 文字を合成。
const sharp = require('sharp')
const fs = require('fs')
const path = require('path')

const SRC_ICON = 'D:/NEWStool/indienews/アートボード 1.svg'
const OUT = path.join(__dirname, '..', 'public', 'podcast-cover.png')

const SIZE = 3000

;(async () => {
  // amber-950 (#451a03) bg
  const bg = await sharp({
    create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0x45, g: 0x1a, b: 0x03, alpha: 1 } },
  }).png().toBuffer()

  // brand icon (SVG) を 1500x1500 にラスタライズ
  let iconBuf = null
  try {
    iconBuf = await sharp(fs.readFileSync(SRC_ICON))
      .resize(1500, 1500)
      .png()
      .toBuffer()
  } catch (e) {
    console.warn('icon render failed:', e.message)
  }

  // title text SVG (アプリ Podcasts カバー想定で大きめ + 落ち影)
  const titleSvg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="900" viewBox="0 0 ${SIZE} 900">
      <style>
        .t1 { font: 800 280px 'Yu Gothic', 'Hiragino Sans', sans-serif; fill: #fef3c7; }
        .t2 { font: 600 140px 'Yu Gothic', 'Hiragino Sans', sans-serif; fill: #fcd34d; letter-spacing: 0.18em; }
        .t3 { font: 400 90px 'Yu Gothic', 'Hiragino Sans', sans-serif; fill: #fbbf24; opacity: 0.85; }
        .shadow { filter: drop-shadow(8px 8px 0 rgba(0,0,0,0.4)); }
      </style>
      <text x="${SIZE / 2}" y="280" class="t1 shadow" text-anchor="middle">旅の道ラジオ</text>
      <text x="${SIZE / 2}" y="460" class="t2" text-anchor="middle">TABINOMICHI RADIO</text>
      <text x="${SIZE / 2}" y="620" class="t3" text-anchor="middle">ずんだもん × めたん × つむぎ</text>
    </svg>
  `)

  // compose: bg + icon (upper) + text (lower)
  const composites = []
  if (iconBuf) {
    composites.push({ input: iconBuf, top: 350, left: (SIZE - 1500) / 2 })
  }
  composites.push({ input: titleSvg, top: 1900, left: 0 })

  await sharp(bg).composite(composites).png({ compressionLevel: 9 }).toFile(OUT)

  const stat = fs.statSync(OUT)
  console.log(`wrote ${OUT} (${SIZE}x${SIZE}, ${(stat.size / 1024).toFixed(0)} KB)`)
})()
