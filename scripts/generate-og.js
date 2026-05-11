// OGP 画像 (1200x630) を生成: 焦茶背景 + 中央にアイコン
const sharp = require('sharp')
const fs = require('fs')
const path = require('path')

const SRC_ICON = 'D:/NEWStool/indienews/アートボード 1.svg'
const OUT = path.join(__dirname, '..', 'public', 'og-image.png')

;(async () => {
  // 1200x630 の amber-950 (#451a03) 背景
  const bg = await sharp({
    create: { width: 1200, height: 630, channels: 4, background: { r: 0x45, g: 0x1a, b: 0x03, alpha: 1 } },
  }).png().toBuffer()

  // アイコンを 480x480 にリサイズ (高さの 76%)
  const icon = await sharp(fs.readFileSync(SRC_ICON)).resize(480, 480).png().toBuffer()

  // タイトルテキスト SVG (Tabinomichi Radio)
  const titleSvg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="640" height="180" viewBox="0 0 640 180">
      <style>
        .t1 { font: bold 64px 'Yu Gothic', 'Hiragino Sans', sans-serif; fill: #fef3c7; }
        .t2 { font: 28px 'Yu Gothic', 'Hiragino Sans', sans-serif; fill: #fcd34d; letter-spacing: 0.15em; }
      </style>
      <text x="0" y="70" class="t1">旅の道ラジオ</text>
      <text x="4" y="120" class="t2">TABINOMICHI RADIO</text>
      <text x="4" y="160" font="22px sans-serif" fill="#fef3c7" opacity="0.7">ずんだもん × めたんが届けるインディーゲーム雑談ラジオ</text>
    </svg>
  `)

  await sharp(bg)
    .composite([
      { input: icon, left: 60, top: 75 },
      { input: titleSvg, left: 580, top: 220 },
    ])
    .png()
    .toFile(OUT)

  console.log('wrote', OUT)
})()
