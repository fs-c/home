import { describe, expect, it } from 'vitest'
import { snapPoint, targetsFrom } from '../../src/editor/snapping'
import { rotate } from '../../src/lib/geometry'
import type { Vec } from '../../src/model/types'

// A plan rotated by -20°: R() maps "plan-local" coordinates (meters) into the world.
const TH = (-20 * Math.PI) / 180
const R = (x: number, y: number) => rotate({ x, y }, TH)
const local = (p: Vec) => rotate(p, -TH)
const deg = (a: Vec, b: Vec) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
const K = 100 // screen px per meter → 10px tolerance = 0.1 m
const S = { enabled: true, angles: true }
const room = [R(0, 0), R(4, 0), R(4, 3), R(0, 3)]

describe('snapPoint – angles relative to existing walls', () => {
  it('snaps a new wall parallel to an existing (rotated) wall and highlights it', () => {
    const a = R(6, 0.5)
    const raw = rotate(R(9, 0.5), (3 * Math.PI) / 180, a) // 3° off
    const r = snapPoint(raw, targetsFrom([room], [a]), K, S, a)
    expect(deg(a, r.p)).toBeCloseTo(-20, 6)
    expect(r.guides.some((g) => g.kind === 'ref')).toBe(true)
  })

  it('snaps perpendicular to the previous wall of the polygon being drawn, even with no rooms', () => {
    const rot = (-33 * Math.PI) / 180
    const d0 = { x: 0, y: 0 }
    const d1 = rotate({ x: 3, y: 0 }, rot)
    const raw = rotate(rotate({ x: 3, y: 2 }, rot), (4 * Math.PI) / 180, d1)
    const r = snapPoint(raw, targetsFrom([], [d0, d1], [[d0, d1]]), K, S, d1)
    expect(deg(d1, r.p)).toBeCloseTo(57, 6)
  })

  it('leaves the angle free when far from every reference direction', () => {
    const a = R(6, 0.5)
    const raw = rotate(R(9, 0.5), (25 * Math.PI) / 180, a)
    const r = snapPoint(raw, targetsFrom([room], [a]), K, S, a)
    expect(r.kind).toBe('none')
    expect(r.p).toEqual(raw)
  })

  it('combines the angle lock with alignment to another corner', () => {
    const b0 = R(6, 0)
    const r = snapPoint(R(6.03, 3.04), targetsFrom([room], [b0]), K, S, b0)
    expect(local(r.p).x).toBeCloseTo(6, 6)
    expect(local(r.p).y).toBeCloseTo(3, 6)
  })

  it('snaps a free point to the intersection of two alignment lines', () => {
    const neighbour = [R(7, 0), R(9, 0), R(9, 1), R(7, 1)]
    const r = snapPoint(R(7.05, 2.96), targetsFrom([room, neighbour]), K, S)
    expect(local(r.p).x).toBeCloseTo(7, 6)
    expect(local(r.p).y).toBeCloseTo(3, 6)
  })

  it('squares the closing corner of a polygon with its first corner', () => {
    const [p0, p1, p2] = [R(0, 0), R(4, 0), R(4, 3)]
    const t = targetsFrom([], [p0, p1, p2], [[p0, p1], [p1, p2]])
    const raw = R(0.2, 3.15) // ~25px off the square spot
    const closed = local(snapPoint(raw, t, K, S, p2, undefined, p0).p)
    expect(closed.x).toBeCloseTo(0, 6)
    expect(closed.y).toBeCloseTo(3, 6)
    // without the close anchor it is only constrained to the wall direction
    expect(local(snapPoint(raw, t, K, S, p2).p).x).toBeCloseTo(0.2, 6)
  })

  it('snaps to existing corners first', () => {
    const r = snapPoint({ x: room[1].x + 0.05, y: room[1].y }, targetsFrom([room]), K, S)
    expect(r.kind).toBe('vertex')
    expect(r.p).toEqual(room[1])
  })

  it('does nothing when snapping is disabled', () => {
    const raw = { x: room[1].x + 0.05, y: room[1].y }
    expect(snapPoint(raw, targetsFrom([room]), K, { enabled: false, angles: true }).p).toEqual(raw)
  })
})
