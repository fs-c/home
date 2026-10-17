import { describe, expect, it } from 'vitest'
import { area, cleanPolygon, dominantAngle, orthogonalize, removeJogs, removeNotches, rotate } from '../../src/lib/geometry'

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
