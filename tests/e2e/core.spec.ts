import { expect, test } from '@playwright/test'
import { calibrate, clicker, fixture, imagePoint, readDoc, roomList, uploadPlan } from './helpers'

// Synthetic plan: 1400x1000 px, 1 m = 100 px, dimension line "12.00" from x=100..1300 at y=110.
const W = 1400
const H = 1000

test('trace a plan with the wand and manual tools, then use it at home', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await uploadPlan(page, fixture('plan.png'))
  const click = clicker(page, W, H)

  await calibrate(page, click, { x: 100, y: 110 }, { x: 1300, y: 110 }, '12')
  await page.getByTitle('Fit to content').click()

  // magic wand on each room
  for (const [x, y] of [[400, 750], [780, 750], [1100, 250], [1200, 800]]) {
    await click(x, y)
    await page.waitForTimeout(300)
  }
  await expect(roomList(page)).toHaveText([/Room 1\s*34\.8 m²/, /Room 2\s*24\.7 m²/, /Room 3\s*12\.7 m²/, /Room 4\s*11\.1 m²/])

  // clicking outside the building explains the leak
  await click(50, 950)
  await expect(page.getByText(/leaks to the outside/)).toBeVisible()

  // polygon with a typed wall length: 4 m x 0.5 m
  await page.keyboard.press('p')
  await click(400, 940)
  const dir = await imagePoint(page, 700, 942, W, H)
  await page.mouse.move(dir.x, dir.y)
  await page.keyboard.type('4')
  await page.keyboard.press('Enter')
  await click(800, 990)
  await click(402, 991)
  await page.keyboard.press('Enter')
  await expect(roomList(page).nth(4)).toHaveText(/Room 5\s*2\.0 m²/)

  // drag a corner, then undo
  await page.keyboard.press('v')
  await click(400, 700)
  const corner = await imagePoint(page, 114, 164, W, H)
  await page.mouse.move(corner.x, corner.y)
  await page.mouse.down()
  await page.mouse.move(corner.x + 40, corner.y + 30, { steps: 5 })
  await page.mouse.up()
  await expect(roomList(page).first()).not.toHaveText(/34\.8 m²/)
  await page.keyboard.press('Control+z')
  await expect(roomList(page).first()).toHaveText(/34\.8 m²/)

  // rename + TODOs in Home mode
  await page.locator('aside').last().locator('input').first().fill('Living room')
  await page.getByRole('button', { name: 'Home', exact: true }).click()
  for (const todo of ['Fix squeaky door', 'Paint ceiling']) {
    await page.getByPlaceholder('e.g. Replace radiator valve').fill(todo)
    await page.keyboard.press('Enter')
  }
  await expect(page.getByText('2 open TODOs')).toBeVisible()

  // everything survives a reload
  await readDoc(page)
  await page.reload()
  const sidebar = page.locator('aside').first()
  await expect(sidebar).toContainText('Living room')
  await expect(sidebar).toContainText('Fix squeaky door')
  await expect(sidebar).toContainText('Paint ceiling')
  expect(errors).toEqual([])
})
