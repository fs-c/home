import { expect, test } from '@playwright/test'
import type { Vec } from '../../src/model/types'
import { calibrate, clicker, fixture, readDoc, roomList, uploadPlan } from './helpers'

const area = (pts: Vec[]) =>
  Math.abs(pts.reduce((s, a, i) => s + a.x * pts[(i + 1) % pts.length].y - pts[(i + 1) % pts.length].x * a.y, 0)) / 2

// Synthetic plan (1 m = 100 px): inner outline of the flat is x 114..1286, y 164..886.
const W = 1400
const H = 1000

test('trace the whole outline, then split it into rooms', async ({ page }) => {
  await page.goto('/')
  await uploadPlan(page, fixture('plan.png'))
  const click = clicker(page, W, H)
  await calibrate(page, click, { x: 100, y: 110 }, { x: 1300, y: 110 }, '12')
  await page.getByTitle('Fit to content').click()

  // whole flat as one rectangle: 11.72 m x 7.22 m
  await page.keyboard.press('r')
  await click(114, 164)
  await click(1286, 164)
  await click(1286, 886)
  await expect(roomList(page)).toHaveText([/Room 1\s*84\.6 m²/])
  const outline = area((await readDoc(page)).floors[0].rooms[0].points)

  // straight cut along the living room wall (x = 600): start on the top wall, end on the bottom wall
  await page.keyboard.press('x')
  await click(600, 164)
  await click(601, 886) // a pixel off: the cut snaps perpendicular to the wall it starts on
  await expect(roomList(page)).toHaveText([/Room 1\s*49\.5 m²/, /Room 2\s*35\.1 m²/])

  // L-shaped cut carving the kitchen out of the bigger piece
  await click(950, 164)
  await click(950, 550)
  await click(1286, 550)
  await expect(roomList(page)).toHaveCount(3)
  const rooms = (await readDoc(page)).floors[0].rooms
  const areas = rooms.map((r) => area(r.points))
  expect(areas[0] + areas[1] + areas[2]).toBeCloseTo(outline, 9) // nothing lost or overlapping
  expect(Math.min(...areas)).toBeCloseTo(3.36 * 3.86, 1)

  // a cut that leaves the room is rejected
  await click(300, 164)
  await click(300, 950)
  await expect(page.getByText(/inside the room|through the inside/)).toBeVisible()
  await page.keyboard.press('Escape')

  // one undo step per split
  await page.keyboard.press('Control+z')
  await expect(roomList(page)).toHaveCount(2)
})
