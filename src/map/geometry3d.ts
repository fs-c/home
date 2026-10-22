import polygonClipping, { type MultiPolygon, type Pair, type Polygon } from 'polygon-clipping'
import * as THREE from 'three'
import { len, sub } from '../lib/geometry'
import type { Room, Vec } from '../model/types'

// World (x, y) maps to three.js (x, z), with y pointing up. Shapes are built in the XY plane and then
// rotated: extruding by `depth` grows downwards from y = 0, which is why walls are shifted up afterwards.

/** A rectangle along the edge a→b, `t` thick and overshooting both ends by t/2 so corners close up. */
function edgeBox(a: Vec, b: Vec, t: number): Polygon | null {
  const l = len(sub(b, a))
  if (l < 1e-6) return null
  const d = { x: (b.x - a.x) / l, y: (b.y - a.y) / l }
  const h = t / 2
  const n = { x: -d.y * h, y: d.x * h }
  const s = { x: d.x * h, y: d.y * h }
  const pt = (p: Vec, sx: number, nx: number): Pair => [p.x + sx * s.x + nx * n.x, p.y + sx * s.y + nx * n.y]
  return [[pt(a, -1, -1), pt(b, 1, -1), pt(b, 1, 1), pt(a, -1, 1), pt(a, -1, -1)]]
}

/** The union of thick edges of all the given rooms: shared walls come out as one wall. */
function wallOutline(rooms: Room[], t: number): MultiPolygon {
  const boxes: Polygon[] = []
  for (const r of rooms) {
    r.points.forEach((p, i) => {
      const box = edgeBox(p, r.points[(i + 1) % r.points.length], t)
      if (box) boxes.push(box)
    })
  }
  if (!boxes.length) return []
  try {
    return polygonClipping.union(boxes[0], ...boxes.slice(1))
  } catch {
    // polygon-clipping can choke on near-degenerate input; merge what we can and keep the rest as separate boxes
    let acc: MultiPolygon = []
    const rest: MultiPolygon = []
    for (const box of boxes) {
      try {
        acc = acc.length ? polygonClipping.union(acc, box) : [box]
      } catch {
        rest.push(box)
      }
    }
    return [...acc, ...rest]
  }
}

const ringPoints = (ring: Pair[]) => ring.slice(0, -1).map(([x, y]) => new THREE.Vector2(x, y))

function shapesOf(mp: MultiPolygon): THREE.Shape[] {
  return mp.map(([outer, ...holes]) => {
    const shape = new THREE.Shape(ringPoints(outer))
    shape.holes = holes.map((h) => new THREE.Path(ringPoints(h)))
    return shape
  })
}

/** A prism whose top is at y = 0 and which reaches `depth` down. */
export function slabGeometry(points: Vec[], depth: number): THREE.ExtrudeGeometry {
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(points.map((p) => new THREE.Vector2(p.x, p.y))), {
    depth,
    bevelEnabled: false,
  })
  g.rotateX(Math.PI / 2)
  return g
}

/** Walls standing on y = 0, reaching up to `height`. */
export function wallGeometry(rooms: Room[], thickness: number, height: number): THREE.ExtrudeGeometry | null {
  const shapes = shapesOf(wallOutline(rooms, thickness))
  if (!shapes.length || height <= 0) return null
  const g = new THREE.ExtrudeGeometry(shapes, { depth: height, bevelEnabled: false })
  g.rotateX(Math.PI / 2)
  g.translate(0, height, 0)
  return g
}
