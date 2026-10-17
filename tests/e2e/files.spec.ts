import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import { cornerAngles, fixture, readDoc, roomList, uploadPlan } from './helpers'

test('PDF upload uses the first page with content', async ({ page }) => {
  await page.goto('/')
  await uploadPlan(page, fixture('plan.pdf'))
  // page 1 of the fixture is blank; the stencil must contain ink
  const ink = await page.evaluate(async () => {
    const el = document.querySelector('svg image') as SVGImageElement
    const img = new Image()
    img.src = el.getAttribute('href')!
    await img.decode()
    const c = document.createElement('canvas')
    c.width = 300
    c.height = Math.round((300 * img.naturalHeight) / img.naturalWidth)
    const g = c.getContext('2d')!
    g.drawImage(img, 0, 0, c.width, c.height)
    const d = g.getImageData(0, 0, c.width, c.height).data
    let dark = 0
    for (let i = 0; i < d.length; i += 4) if (d[i] < 128) dark++
    return dark
  })
  expect(ink).toBeGreaterThan(500)
})

test('rectangle tool: first wall, then depth', async ({ page }) => {
  await page.goto('/')
  await uploadPlan(page, fixture('plan.png'))
  await page.keyboard.press('Escape')
  await page.keyboard.press('r')
  const s = (await page.locator('svg').first().boundingBox())!
  // drag the first wall, then click for the depth
  await page.mouse.move(s.x + 300, s.y + 300)
  await page.mouse.down()
  await page.mouse.move(s.x + 500, s.y + 300, { steps: 6 })
  await page.mouse.up()
  await page.mouse.move(s.x + 500, s.y + 450, { steps: 4 })
  await page.mouse.click(s.x + 500, s.y + 450)
  await expect(roomList(page)).toHaveCount(1)
  const room = (await readDoc(page)).floors[0].rooms[0]
  expect(room.points).toHaveLength(4)
  for (const a of cornerAngles(room.points)) expect(a).toBeCloseTo(90, 6)
})

test('export and import round-trip including the stencil image', async ({ page, browser }) => {
  await page.goto('/')
  await uploadPlan(page, fixture('plan.png'))
  await page.keyboard.press('Escape')
  await page.keyboard.press('r')
  const s = (await page.locator('svg').first().boundingBox())!
  await page.mouse.click(s.x + 300, s.y + 300)
  await page.mouse.click(s.x + 500, s.y + 300)
  await page.mouse.click(s.x + 500, s.y + 450)

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export' }).click()])
  const file = test.info().outputPath('export.json')
  await download.saveAs(file)
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  expect(data.format).toBe('home-hub')
  expect(data.doc.floors[0].rooms).toHaveLength(1)
  expect(Object.keys(data.images)).toHaveLength(1)

  const fresh = await (await browser.newContext()).newPage()
  await fresh.goto('/')
  await fresh.setInputFiles('input[type=file][accept^=".json"]', file)
  await fresh.getByRole('button', { name: 'Plan', exact: true }).click()
  await expect(fresh.locator('svg image').first()).toBeVisible()
  await expect(roomList(fresh)).toHaveCount(1)
})
