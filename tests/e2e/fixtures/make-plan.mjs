// Regenerates plan.png / plan.pdf: a synthetic floor plan (1 m = 100 px, 12 m wide)
// with thick walls, door gaps + swing arcs, furniture, text and a dimension line.
// Usage: node tests/e2e/fixtures/make-plan.mjs
import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const dir = path.dirname(new URL(import.meta.url).pathname)
const browser = await chromium.launch()
const page = await browser.newPage()
const url = await page.evaluate(() => {
  const c = document.createElement('canvas')
  c.width = 1400
  c.height = 1000
  const g = c.getContext('2d')
  g.fillStyle = '#fff'
  g.fillRect(0, 0, 1400, 1000)
  g.fillStyle = '#222'
  const R = (x, y, w, h) => g.fillRect(x, y, w, h)
  R(100, 150, 1200, 14); R(100, 886, 1200, 14); R(100, 150, 14, 750); R(1286, 150, 14, 750)
  R(596, 164, 8, 236); R(596, 490, 8, 396)
  R(946, 164, 8, 536); R(946, 790, 8, 96)
  R(954, 546, 96, 8); R(1140, 546, 146, 8)
  g.fillStyle = '#fff'; R(250, 886, 90, 14)
  g.strokeStyle = '#333'; g.lineWidth = 1.5
  const arc = (x, y, r, a0, a1) => { g.beginPath(); g.moveTo(x, y); g.arc(x, y, r, a0, a1); g.stroke() }
  arc(600, 400, 90, 0, Math.PI / 2); arc(950, 700, 90, Math.PI / 2, Math.PI); arc(1050, 550, 90, 0, Math.PI / 2)
  g.strokeRect(150, 200, 200, 120); g.strokeRect(700, 220, 160, 200)
  g.beginPath(); g.ellipse(1150, 350, 60, 40, 0, 0, 7); g.stroke()
  g.fillStyle = '#444'; g.font = '28px sans-serif'
  g.fillText('Living 31.5 m²', 260, 600); g.fillText('Bedroom', 700, 650); g.fillText('Kitchen', 1060, 450); g.fillText('Bath', 1080, 760)
  g.lineWidth = 1; g.beginPath()
  g.moveTo(100, 110); g.lineTo(1300, 110); g.moveTo(100, 95); g.lineTo(100, 125); g.moveTo(1300, 95); g.lineTo(1300, 125)
  g.stroke()
  g.fillText('12.00', 660, 100)
  return c.toDataURL('image/png')
})
fs.writeFileSync(path.join(dir, 'plan.png'), Buffer.from(url.split(',')[1], 'base64'))
// PDF version: note the image overflows to page 2, leaving page 1 blank –
// which exercises the "first page with content" logic.
await page.setContent(`<img src="${url}" style="width:100%">`)
await page.pdf({ path: path.join(dir, 'plan.pdf'), format: 'A4', landscape: true })
await browser.close()
