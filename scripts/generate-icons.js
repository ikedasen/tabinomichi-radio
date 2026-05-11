const sharp = require('sharp')
const fs = require('fs')
const path = require('path')

const SRC = 'D:/NEWStool/indienews/アートボード 1.svg'
const OUT_DIR = path.join(__dirname, '..', 'public', 'icons')

const sizes = [
  [512, 'icon-512.png'],
  [192, 'icon-192.png'],
  [180, 'apple-touch-icon.png'],
  [32, 'favicon-32.png'],
]

;(async () => {
  const svg = fs.readFileSync(SRC)
  for (const [size, name] of sizes) {
    await sharp(svg)
      .resize(size, size)
      .png()
      .toFile(path.join(OUT_DIR, name))
    console.log(`wrote ${name} (${size}x${size})`)
  }
})()
