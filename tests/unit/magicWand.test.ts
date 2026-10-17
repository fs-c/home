import { describe, expect, it } from 'vitest'
import { detectRoom, type PreparedImage, type WandParams } from '../../src/editor/magicWand'
import { area, rotate } from '../../src/lib/geometry'

/** Synthetic grayscale floor plan: L-shaped flat, interior wall with a door, a thin furniture line. */
function syntheticPlan(): PreparedImage {
  const w = 400
  const h = 300
  const lum = new Uint8Array(w * h).fill(255)
  const rect = (x0: number, y0: number, x1: number, y1: number, v = 0) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) lum[y * w + x] = v
  }
  rect(20, 20, 300, 26); rect(294, 20, 300, 120); rect(300, 114, 380, 120); rect(374, 114, 380, 280)
  rect(20, 274, 380, 280); rect(20, 20, 26, 280)
  rect(197, 20, 203, 100); rect(197, 135, 203, 280) // interior wall, door at y 100..135
  rect(60, 274, 95, 280, 255) // front door gap
  rect(60, 150, 160, 151); rect(60, 150, 61, 220) // 1px furniture lines
  return { w, h, lum, val: lum, factor: 1 }
}

const PARAMS: WandParams = { threshold: 128, ignoreColor: false, minWallPx: 3, maxOpeningPx: 40 }

describe('detectRoom', () => {
  const img = syntheticPlan()

  it('traces a room through door gaps and furniture as a clean rectangle', () => {
    const r = detectRoom(img, { x: 100, y: 100 }, PARAMS)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.polygon).toEqual([{ x: 26, y: 26 }, { x: 197, y: 26 }, { x: 197, y: 274 }, { x: 26, y: 274 }])
  })

  it('traces an L-shaped room with sharp corners', () => {
    const r = detectRoom(img, { x: 300, y: 200 }, PARAMS)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.polygon).toHaveLength(6)
  })

  it('reports leaks to the outside and clicks on walls', () => {
    const outside = detectRoom(img, { x: 10, y: 10 }, PARAMS)
    expect(outside.ok).toBe(false)
    if (!outside.ok) expect(outside.reason).toMatch(/leaks/)
    const wall = detectRoom(img, { x: 198, y: 50 }, PARAMS)
    expect(wall.ok).toBe(false)
    if (!wall.ok) expect(wall.reason).toMatch(/wall/)
  })

  it('squares up rooms on a rotated plan in their own orientation', () => {
    // Same 171x248 room as above, drawn rotated by -20° on a bigger canvas.
    const w = 500
    const h = 500
    const lum = new Uint8Array(w * h).fill(255)
    const th = (-20 * Math.PI) / 180
    const c = { x: 250, y: 250 }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = rotate({ x, y }, -th, c) // plan-local coords
        const inOuter = Math.abs(p.x - c.x) < 92 && Math.abs(p.y - c.y) < 130
        const inInner = Math.abs(p.x - c.x) < 86 && Math.abs(p.y - c.y) < 124
        if (inOuter && !inInner) lum[y * w + x] = 0
      }
    }
    const r = detectRoom({ w, h, lum, val: lum, factor: 1 }, c, PARAMS)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.polygon).toHaveLength(4)
    for (let i = 0; i < 4; i++) {
      const a = r.polygon[i]
      const b = r.polygon[(i + 1) % 4]
      const ang = (((Math.atan2(b.y - a.y, b.x - a.x) - th) % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2)
      expect(Math.min(ang, Math.PI / 2 - ang)).toBeLessThan(0.01) // walls follow the plan's -20°
    }
    expect(area(r.polygon)).toBeGreaterThan(172 * 248 * 0.95)
  })
})
