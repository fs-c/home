import { describe, expect, it } from 'vitest'
import { area, cleanPolygon, dominantAngle, orthogonalize, removeJogs, removeNotches, rotate, splitPolygon, subtractPolygons } from '../../src/lib/geometry'

describe('geometry', () => {
  it('computes polygon area regardless of winding', () => {
    const sq = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 3 }, { x: 0, y: 3 }]
    expect(area(sq)).toBe(6)
    expect(area([...sq].reverse())).toBe(6)
  })

  it('finds the dominant wall orientation of a rotated rectangle (mod 90°)', () => {
    const th = (-20 * Math.PI) / 180
    const rect = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }].map((p) => rotate(p, th))
    expect(dominantAngle(rect)).toBeCloseTo(th, 9)
    // perpendicular orientation is the same frame
    expect(dominantAngle(rect.map((p) => rotate(p, Math.PI / 2)))).toBeCloseTo(th, 9)
  })

  it('squares up a slightly skewed outline', () => {
    const skewed = [{ x: 0, y: 0 }, { x: 10, y: 0.3 }, { x: 10.2, y: 8 }, { x: 0.1, y: 7.8 }]
    const out = orthogonalize(skewed, 12)
    expect(out).toHaveLength(4)
    for (let i = 0; i < 4; i++) {
      const a = out[i]
      const b = out[(i + 1) % 4]
      expect(a.x === b.x || a.y === b.y).toBe(true)
    }
  })

  it('removes a small rectangular notch (e.g. a door cut)', () => {
    const notched = [
      { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 0.1 }, { x: 5, y: 0.1 }, { x: 5, y: 0 },
      { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 },
    ]
    expect(cleanPolygon(removeNotches(notched, 0.3))).toHaveLength(4)
  })

  it('flattens a tiny step but keeps real ones', () => {
    const stepped = [
      { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 0.05 }, { x: 10, y: 0.05 }, { x: 10, y: 5 }, { x: 0, y: 5 },
    ]
    expect(removeJogs(stepped, 0.1)).toHaveLength(4)
    expect(removeJogs(stepped, 0.01)).toHaveLength(6)
  })
})

describe('splitPolygon', () => {
  const rect = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }, { x: 0, y: 6 }]

  it('splits a rectangle with a straight cut', () => {
    const r = splitPolygon(rect, [{ x: 4, y: 0 }, { x: 4, y: 6 }])!
    expect(r).not.toBeNull()
    expect(r.map(area).sort((m, n) => m - n)).toEqual([24, 36])
    for (const piece of r) expect(piece).toHaveLength(4)
  })

  it('splits with an L-shaped cut', () => {
    const r = splitPolygon(rect, [{ x: 4, y: 0 }, { x: 4, y: 3 }, { x: 10, y: 3 }])!
    expect(r.map(area).sort((m, n) => m - n)).toEqual([18, 42])
    expect(r.map((p) => p.length).sort()).toEqual([4, 6])
  })

  it('handles cuts that start and end on the same wall', () => {
    const r = splitPolygon(rect, [{ x: 2, y: 0 }, { x: 2, y: 2 }, { x: 5, y: 2 }, { x: 5, y: 0 }])!
    expect(r.map(area).sort((m, n) => m - n)).toEqual([6, 54])
  })

  it('handles cuts through existing corners', () => {
    const r = splitPolygon(rect, [{ x: 0, y: 0 }, { x: 10, y: 6 }])!
    expect(r.map(area)).toEqual([30, 30])
    for (const piece of r) expect(piece).toHaveLength(3)
  })

  it('works on rotated, irregular rooms', () => {
    const th = 0.35
    const L = [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 3 }, { x: 3, y: 3 }, { x: 3, y: 7 }, { x: 0, y: 7 }].map((p) => rotate(p, th))
    const r = splitPolygon(L, [rotate({ x: 0, y: 3 }, th), rotate({ x: 3, y: 3 }, th)])!
    expect(r.map(area).map((v) => +v.toFixed(9)).sort((m, n) => m - n)).toEqual([12, 24])
  })

  it('rejects invalid cuts', () => {
    expect(splitPolygon(rect, [{ x: 4, y: 1 }, { x: 4, y: 6 }])).toBeNull() // starts inside
    expect(splitPolygon(rect, [{ x: 4, y: 0 }, { x: 12, y: 3 }, { x: 4, y: 6 }])).toBeNull() // leaves the room
    expect(splitPolygon(rect, [{ x: 0, y: 0 }, { x: 10, y: 0 }])).toBeNull() // along a wall
  })
})

describe('subtractPolygons', () => {
  const rect = (x0: number, y0: number, x1: number, y1: number) =>
    [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]
  const room = rect(0, 0, 4, 4)

  it('keeps a shape that touches nothing', () => {
    expect(subtractPolygons(rect(4, 0, 8, 4), [room])!.map(area)).toEqual([16])
  })

  it('trims the part that overlaps an existing room', () => {
    const r = subtractPolygons(rect(3, 0, 8, 4), [room])!
    expect(r).toHaveLength(1)
    expect(area(r[0])).toBeCloseTo(16, 9)
  })

  it('returns nothing for a shape inside an existing room', () => {
    expect(subtractPolygons(rect(1, 1, 2, 2), [room])).toEqual([])
  })

  it('returns separate pieces when a room divides the shape', () => {
    const r = subtractPolygons(rect(-2, 1, 6, 2), [room])!
    expect(r.map(area).sort()).toEqual([2, 2])
  })

  it('rejects a shape that would surround a room', () => {
    expect(subtractPolygons(rect(-1, -1, 5, 5), [room])).toBeNull()
  })
})
