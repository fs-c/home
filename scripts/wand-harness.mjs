// Runs the magic-wand room detection on an arbitrary plan image in a real
// browser and renders the detected wall mask + room outlines for inspection.
// Useful for tuning the detection pipeline against real-world plans.
//
// Usage:
//   pnpm wand-harness <image> '<seeds>' ['<params>'] [out.png]
//     seeds:  JSON object of name -> [x, y] in image pixels (points inside rooms)
//     params: JSON WandParams overrides, in image pixels
//             (default: threshold 140, ignoreColor false, minWallPx 3.5, maxOpeningPx 64)
//
// Example (samples/ plan, ~58 px per meter):
//   pnpm wand-harness samples/stockhofstrasse-top37.jpg '{"z18":[780,1660],"kitchen":[1140,1600]}'
import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'vite'

const [image, seedsJson, paramsJson = '{}', out = 'test-results/wand-harness.png'] = process.argv.slice(2)
if (!image || !seedsJson) {
  console.error("usage: pnpm wand-harness <image> '<seeds json>' ['<params json>'] [out.png]")
  process.exit(1)
}
const seeds = JSON.parse(seedsJson)
const params = { threshold: 140, ignoreColor: false, minWallPx: 3.5, maxOpeningPx: 64, ...JSON.parse(paramsJson) }

const server = await createServer({ server: { port: 0 }, logLevel: 'error' })
await server.listen()
const base = server.resolvedUrls.local[0]
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.error('pageerror:', e.message))
  await page.goto(base)
  const imageUrl = '/@fs' + path.resolve(image)
  const res = await page.evaluate(
    async ({ imageUrl, seeds, params }) => {
      const wand = await import('/src/editor/magicWand.ts')
      const img = await wand.prepareImage(imageUrl)
      const results = {}
      const t0 = performance.now()
      for (const [name, [x, y]] of Object.entries(seeds)) {
        const r = wand.detectRoom(img, { x, y }, params)
        results[name] = r.ok ? r.polygon : r.reason
      }
      const ms = performance.now() - t0

      // crop around the seeds, draw photo + wall mask + outlines
      const photo = new Image()
      photo.src = imageUrl
      await photo.decode()
      const mask = new Image()
      mask.src = wand.wallMaskOverlay(img, params)
      await mask.decode()
      const xs = Object.values(seeds).map((s) => s[0])
      const ys = Object.values(seeds).map((s) => s[1])
      const pad = 400
      const ox = Math.max(0, Math.min(...xs) - pad)
      const oy = Math.max(0, Math.min(...ys) - pad)
      const cw = Math.min(photo.naturalWidth - ox, Math.max(...xs) - ox + pad)
      const ch = Math.min(photo.naturalHeight - oy, Math.max(...ys) - oy + pad)
      const c = document.createElement('canvas')
      c.width = cw
      c.height = ch
      const g = c.getContext('2d')
      g.drawImage(photo, -ox, -oy)
      g.drawImage(mask, -ox, -oy, photo.naturalWidth, photo.naturalHeight)
      g.lineWidth = 3
      g.font = '16px sans-serif'
      for (const poly of Object.values(results)) {
        if (typeof poly === 'string') continue
        g.strokeStyle = '#0a0'
        g.fillStyle = 'rgba(0,200,0,0.15)'
        g.beginPath()
        poly.forEach((q, i) => (i ? g.lineTo(q.x - ox, q.y - oy) : g.moveTo(q.x - ox, q.y - oy)))
        g.closePath()
        g.fill()
        g.stroke()
      }
      for (const [name, [x, y]] of Object.entries(seeds)) {
        g.fillStyle = '#00f'
        g.fillRect(x - ox - 5, y - oy - 5, 10, 10)
        g.fillText(name, x - ox + 8, y - oy)
      }
      return { results, ms, png: c.toDataURL('image/png'), processed: [img.w, img.h] }
    },
    { imageUrl, seeds, params },
  )
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, Buffer.from(res.png.split(',')[1], 'base64'))
  console.log(`processed at ${res.processed.join('x')}, detection took ${res.ms.toFixed(0)} ms`)
  for (const [name, r] of Object.entries(res.results)) {
    console.log(`  ${name}: ${typeof r === 'string' ? r : `${r.length} corners`}`)
  }
  console.log(`→ ${out}`)
} finally {
  await browser.close()
  await server.close()
}
