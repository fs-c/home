import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { calibrate, clicker, cornerAngles, readDoc, uploadPlan, wallAngle, zoomTo } from './helpers'

// A real-world photo of a building plan: rotated ~-16°, highlighted with a pink marker.
// Not part of the repo's fixtures (it contains personal data); skipped when absent.
const SAMPLE = path.join(import.meta.dirname, '../../samples/stockhofstrasse-top37.jpg')
const W = 1848
const H = 4000

// Image-pixel corners of "Zimmer 18.32 m2" (482 x 380 cm) and the room below it.
const Z18 = [{ x: 635, y: 1615 }, { x: 906, y: 1538 }, { x: 982, y: 1752 }, { x: 709, y: 1838 }]

test.skip(!fs.existsSync(SAMPLE), 'sample plan not available')

test('tracing a rotated photo plan: angles snap relative to existing walls', async ({ page }) => {
  await page.goto('/')
  await uploadPlan(page, SAMPLE)
  const click = clicker(page, W, H)

  // scale from the 482 cm wall, without straightening
  await calibrate(page, click, { x: 635, y: 1615 }, { x: 905, y: 1535 }, '4.82', false)
  await zoomTo(page, { x: 850, y: 1750 }, 4, W, H)

  // imprecise clicks still produce a rectangle at the plan's angle
  await page.keyboard.press('p')
  for (const p of Z18) await click(p.x, p.y)
  await click(Z18[0].x, Z18[0].y)
  let doc = await readDoc(page)
  const z18 = doc.floors[0].rooms[0].points
  expect(z18).toHaveLength(4)
  for (const a of cornerAngles(z18)) expect(a).toBeCloseTo(90, 6)

  // rectangle tool continues the same angle off the shared wall
  await page.keyboard.press('r')
  await click(711, 1842)
  await click(983, 1760)
  await click(1035, 1995)
  doc = await readDoc(page)
  const z20 = doc.floors[0].rooms[1].points
  for (const a of cornerAngles(z20)) expect(a).toBeCloseTo(90, 6)
  expect(wallAngle(z20[0], z20[1])).toBeCloseTo(wallAngle(z18[0], z18[1]), 6)

  // re-measure with straightening: the plan and the rooms rotate upright
  await page.keyboard.press('s')
  await click(635, 1615)
  await click(905, 1535)
  await page.getByPlaceholder('e.g. 4.25 m').fill('4.82')
  await expect(page.getByLabel(/Straighten the plan/)).toBeChecked()
  await page.keyboard.press('Enter')
  doc = await readDoc(page)
  const straight = doc.floors[0].rooms[0].points
  for (let i = 0; i < 4; i++) {
    const a = wallAngle(straight[i], straight[(i + 1) % 4])
    expect(Math.abs(a - Math.round(a / 90) * 90)).toBeLessThan(1e-6)
  }
})
