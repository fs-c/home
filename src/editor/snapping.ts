import { add, angleDiffMod, dist, dot, lineSegmentIntersection, mul, projectOnSegment, sub } from '../lib/geometry'
import type { Vec } from '../model/types'

export interface SnapSettings {
  enabled: boolean
  /** Snap angles to be parallel/perpendicular to existing walls. */
  angles: boolean
}

/** A reference direction derived from existing walls (mod 180°). */
export interface RefDir {
  angle: number
  u: Vec
  /** The wall this direction comes from (for highlighting); none for fallback axes. */
  source?: [Vec, Vec]
  /** Total wall length supporting this direction (parallel walls add up). */
  weight: number
}

export interface SnapTargets {
  vertices: Vec[]
  edges: [Vec, Vec][]
  dirs: RefDir[]
}

export type SnapKind = 'none' | 'vertex' | 'edge' | 'align' | 'angle'

export interface Guide {
  a: Vec
  b: Vec
  /** 'ref' = the existing wall a snap is relative to. */
  kind?: 'guide' | 'ref'
}

export interface SnapResult {
  p: Vec
  kind: SnapKind
  guides: Guide[]
}

const TOLERANCE_PX = 10
const ANGLE_TOLERANCE = (6 * Math.PI) / 180
const MERGE_ANGLE = (1 * Math.PI) / 180
const MAX_DIRS = 8

const unit = (angle: number): Vec => ({ x: Math.cos(angle), y: Math.sin(angle) })
const perp = (u: Vec): Vec => ({ x: -u.y, y: u.x })

/**
 * Directions of the given walls plus their perpendiculars, merged when
 * within 1° and ranked by supporting wall length. Falls back to the
 * screen axes when there are no walls yet.
 */
export function referenceDirections(edges: [Vec, Vec][]): RefDir[] {
  const clusters: { angle: number; weight: number; source: [Vec, Vec]; srcLen: number }[] = []
  for (const e of edges) {
    const l = dist(e[0], e[1])
    if (l < 1e-6) continue
    const angle = ((Math.atan2(e[1].y - e[0].y, e[1].x - e[0].x) % Math.PI) + Math.PI) % Math.PI
    const c = clusters.find((k) => angleDiffMod(k.angle, angle) < MERGE_ANGLE)
    if (c) {
      c.weight += l
      if (l > c.srcLen) {
        c.source = e
        c.srcLen = l
      }
    } else {
      clusters.push({ angle, weight: l, source: e, srcLen: l })
    }
  }
  if (!clusters.length) {
    return [
      { angle: 0, u: unit(0), weight: 0 },
      { angle: Math.PI / 2, u: unit(Math.PI / 2), weight: 0 },
    ]
  }
  clusters.sort((a, b) => b.weight - a.weight)
  const dirs: RefDir[] = []
  for (const c of clusters.slice(0, MAX_DIRS / 2)) {
    for (const angle of [c.angle, (c.angle + Math.PI / 2) % Math.PI]) {
      if (dirs.some((d) => angleDiffMod(d.angle, angle) < MERGE_ANGLE)) continue
      dirs.push({ angle, u: unit(angle), source: c.source, weight: c.weight })
    }
  }
  return dirs
}

/** Intersection of two infinite lines, or null if (nearly) parallel. */
function lineLine(p: Vec, u: Vec, q: Vec, v: Vec): Vec | null {
  const denom = u.x * v.y - u.y * v.x
  if (Math.abs(denom) < 1e-9) return null
  const w = sub(q, p)
  const t = (w.x * v.y - w.y * v.x) / denom
  return add(p, mul(u, t))
}

function distToLine(p: Vec, origin: Vec, u: Vec): number {
  const w = sub(p, origin)
  return Math.abs(w.x * u.y - w.y * u.x)
}

interface Line {
  origin: Vec
  u: Vec
  /** For segments: the endpoints; intersections must lie on it. */
  seg?: [Vec, Vec]
  kind: 'edge' | 'align'
  guides: Guide[]
  d: number
}

/**
 * Snap a raw world point.
 *
 * Priority: existing corner > angle relative to existing walls (optionally
 * landing on a wall or alignment line) > intersection of two nearby
 * walls/alignment lines > single wall/alignment line.
 *
 * @param k       screen pixels per world unit (tolerances are in screen space)
 * @param anchor  previous point, for angle snapping
 * @param lockDir force the direction from the anchor (e.g. rectangle depth)
 * @param closeAnchor  first corner of a polygon being drawn: the point also
 *                squares up with it (within the angle tolerance), so the
 *                closing corner of a room comes out right
 */
export function snapPoint(
  raw: Vec,
  targets: SnapTargets,
  k: number,
  settings: SnapSettings,
  anchor?: Vec,
  lockDir?: Vec,
  closeAnchor?: Vec,
): SnapResult {
  if (!settings.enabled && !lockDir) return { p: raw, kind: 'none', guides: [] }
  const tol = TOLERANCE_PX / k

  if (settings.enabled) {
    let bestV: Vec | null = null
    let bestVD = tol
    for (const v of targets.vertices) {
      const d = dist(raw, v)
      if (d < bestVD) {
        bestVD = d
        bestV = v
      }
    }
    if (bestV) {
      if (!lockDir || !anchor) return { p: { ...bestV }, kind: 'vertex', guides: [] }
    }
  }

  // ---- constrained to a line through the anchor ----
  let constraint: { u: Vec; guides: Guide[] } | null = null
  if (anchor && lockDir) {
    constraint = { u: lockDir, guides: [] }
  } else if (anchor && settings.enabled && settings.angles && dist(raw, anchor) > tol) {
    const ang = Math.atan2(raw.y - anchor.y, raw.x - anchor.x)
    let best: RefDir | null = null
    let bestD = ANGLE_TOLERANCE
    for (const d of targets.dirs) {
      const diff = angleDiffMod(ang, d.angle)
      if (diff < bestD) {
        bestD = diff
        best = d
      }
    }
    if (best) {
      constraint = { u: best.u, guides: best.source ? [{ a: best.source[0], b: best.source[1], kind: 'ref' }] : [] }
    }
  }

  if (anchor && constraint) {
    const { u } = constraint
    const p = add(anchor, mul(u, dot(sub(raw, anchor), u)))
    if (!settings.enabled) return { p, kind: 'angle', guides: [] }
    // Land on a wall or alignment line crossing the constrained line.
    let best: { p: Vec; kind: SnapKind; guides: Guide[] } | null = null
    let bestD = tol
    if (closeAnchor && dist(closeAnchor, anchor) > 1e-9) {
      // Square up with the polygon's first corner (more forgiving than plain alignment).
      const angClose = Math.atan2(p.y - closeAnchor.y, p.x - closeAnchor.x)
      let bestC = tol * 4
      for (const d of targets.dirs) {
        if (angleDiffMod(angClose, d.angle) > ANGLE_TOLERANCE) continue
        const hit = lineLine(anchor, u, closeAnchor, d.u)
        if (hit && dist(hit, p) < bestC) {
          bestC = dist(hit, p)
          best = { p: hit, kind: 'align', guides: [{ a: closeAnchor, b: hit }] }
        }
      }
      if (best) bestD = 0 // takes precedence
    }
    for (const [a, b] of targets.edges) {
      const hit = lineSegmentIntersection(anchor, u, a, b)
      if (hit && dist(hit, p) < bestD) {
        bestD = dist(hit, p)
        best = { p: hit, kind: 'edge', guides: [] }
      }
    }
    for (const v of targets.vertices) {
      if (dist(v, anchor) < 1e-9) continue
      for (const d of targets.dirs) {
        const hit = lineLine(anchor, u, v, d.u)
        if (hit && dist(hit, p) < bestD) {
          bestD = dist(hit, p)
          best = { p: hit, kind: 'align', guides: [{ a: v, b: hit }] }
        }
      }
    }
    const guides = [{ a: anchor, b: best?.p ?? p }, ...constraint.guides, ...(best?.guides ?? [])]
    return { p: best?.p ?? p, kind: best?.kind === 'edge' ? 'edge' : 'angle', guides }
  }

  if (!settings.enabled) return { p: raw, kind: 'none', guides: [] }

  // ---- free point: walls and alignment lines near the cursor ----
  const lines: Line[] = []
  for (const seg of targets.edges) {
    const q = projectOnSegment(raw, seg[0], seg[1])
    const d = dist(q, raw)
    const l = dist(seg[0], seg[1])
    if (d < tol && l > 1e-9) {
      lines.push({ origin: seg[0], u: mul(sub(seg[1], seg[0]), 1 / l), seg, kind: 'edge', guides: [], d })
    }
  }
  for (const v of targets.vertices) {
    for (const dir of targets.dirs) {
      const d = distToLine(raw, v, dir.u)
      if (d < tol) lines.push({ origin: v, u: dir.u, kind: 'align', guides: [{ a: v, b: v }], d })
    }
  }
  if (!lines.length) return { p: raw, kind: 'none', guides: [] }
  lines.sort((a, b) => a.d - b.d)
  const near = lines.slice(0, 12)

  // Prefer the intersection of two lines (e.g. two alignments = a corner).
  let bestX: { p: Vec; a: Line; b: Line } | null = null
  let bestXD = tol * 1.5
  for (let i = 0; i < near.length; i++) {
    for (let j = i + 1; j < near.length; j++) {
      const hit = lineLine(near[i].origin, near[i].u, near[j].origin, near[j].u)
      if (!hit) continue
      if (near[i].seg && dist(hit, projectOnSegment(hit, ...near[i].seg!)) > 1e-6) continue
      if (near[j].seg && dist(hit, projectOnSegment(hit, ...near[j].seg!)) > 1e-6) continue
      const d = dist(hit, raw)
      if (d < bestXD) {
        bestXD = d
        bestX = { p: hit, a: near[i], b: near[j] }
      }
    }
  }
  const guideFor = (l: Line, p: Vec): Guide[] => (l.kind === 'align' ? [{ a: l.origin, b: p }] : [])
  if (bestX) {
    const { p, a, b } = bestX
    const kind: SnapKind = a.kind === 'edge' || b.kind === 'edge' ? 'edge' : 'align'
    return { p, kind, guides: [...guideFor(a, p), ...guideFor(b, p)] }
  }
  // Single line: walls win over alignments at similar distance.
  const single = near.find((l) => l.kind === 'edge' && l.d < near[0].d + tol * 0.3) ?? near[0]
  const p = add(single.origin, mul(single.u, dot(sub(raw, single.origin), single.u)))
  return { p, kind: single.kind, guides: guideFor(single, p) }
}

/** Collect snap targets from polygons plus extra (in-progress) points and edges. */
export function targetsFrom(polygons: Vec[][], extraVertices: Vec[] = [], extraEdges: [Vec, Vec][] = []): SnapTargets {
  const vertices: Vec[] = [...extraVertices]
  const edges: [Vec, Vec][] = []
  for (const poly of polygons) {
    for (let i = 0; i < poly.length; i++) {
      vertices.push(poly[i])
      edges.push([poly[i], poly[(i + 1) % poly.length]])
    }
  }
  // In-progress walls count as references (so the 2nd wall can be ⊥ to the 1st)
  // but aren't snap surfaces themselves.
  return { vertices, edges, dirs: referenceDirections([...extraEdges, ...edges]) }
}

/**
 * The two dominant perpendicular directions among the given walls (for
 * aligning whole rooms when they are moved).
 */
export function mainFrame(edges: [Vec, Vec][]): [Vec, Vec] {
  const dirs = referenceDirections(edges)
  const u = dirs[0].u
  return [u, perp(u)]
}
