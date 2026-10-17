import { expect, type Page } from '@playwright/test'
import path from 'node:path'
import type { HomeDoc, Vec } from '../../src/model/types'

export const fixture = (name: string) => path.join(import.meta.dirname, 'fixtures', name)

export async function uploadPlan(page: Page, file: string) {
  await page.setInputFiles('input[type=file][accept^="image"]', file)
  await expect(page.locator('svg image').first()).toBeVisible()
}

/**
 * Screen position of an image pixel on the stencil, honouring the stencil's
 * SVG transform (scale + rotation). `w`/`h` = natural image size.
 */
export async function imagePoint(page: Page, x: number, y: number, w: number, h: number): Promise<Vec> {
  return page.evaluate(
    ([x, y, w, h]) => {
      const el = document.querySelector('svg image') as SVGImageElement
      const attr = (n: string) => Number(el.getAttribute(n))
      const pt = new DOMPoint(attr('x') + (x / w) * attr('width'), attr('y') + (y / h) * attr('height'))
      const s = pt.matrixTransform(el.getScreenCTM()!)
      return { x: s.x, y: s.y }
    },
    [x, y, w, h],
  )
}

/** Returns a click helper in image-pixel coordinates for a stencil of the given size. */
export function clicker(page: Page, w: number, h: number) {
  return async (x: number, y: number) => {
    const p = await imagePoint(page, x, y, w, h)
    await page.mouse.move(p.x, p.y, { steps: 3 })
    await page.mouse.click(p.x, p.y)
  }
}

export async function calibrate(page: Page, click: (x: number, y: number) => Promise<void>, a: Vec, b: Vec, meters: string, straighten = true) {
  await click(a.x, a.y)
  await click(b.x, b.y)
  await page.getByPlaceholder('e.g. 4.25 m').fill(meters)
  const box = page.getByLabel(/Straighten the plan/)
  if ((await box.count()) && (await box.isChecked()) !== straighten) await box.click()
  await page.keyboard.press('Enter')
  await expect(page.getByText(/^✓ 1 m ≈/)).toBeVisible()
}

/** Fit everything, then zoom in around an image point – a deterministic view. */
export async function zoomTo(page: Page, at: Vec, steps: number, w: number, h: number) {
  await page.getByTitle('Fit to content').click()
  const p = await imagePoint(page, at.x, at.y, w, h)
  await page.mouse.move(p.x, p.y)
  await page.keyboard.down('Control')
  for (let i = 0; i < steps; i++) await page.mouse.wheel(0, -30)
  await page.keyboard.up('Control')
}

export async function readDoc(page: Page): Promise<HomeDoc> {
  await page.waitForTimeout(400) // saving is debounced
  return page.evaluate(() => JSON.parse(localStorage.getItem('home-hub:doc:v1')!))
}

export const roomList = (page: Page) => page.locator('aside').first().locator('ul li')

/** Interior angles in degrees. */
export function cornerAngles(pts: Vec[]): number[] {
  return pts.map((a, i) => {
    const p = pts[(i - 1 + pts.length) % pts.length]
    const n = pts[(i + 1) % pts.length]
    const u = { x: a.x - p.x, y: a.y - p.y }
    const v = { x: n.x - a.x, y: n.y - a.y }
    return (Math.acos((u.x * v.x + u.y * v.y) / Math.hypot(u.x, u.y) / Math.hypot(v.x, v.y)) * 180) / Math.PI
  })
}

export const wallAngle = (a: Vec, b: Vec) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
