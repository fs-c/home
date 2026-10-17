import type { Vec } from '../model/types'

export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y })
export const mul = (a: Vec, s: number): Vec => ({ x: a.x * s, y: a.y * s })
export const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y
export const len = (a: Vec) => Math.hypot(a.x, a.y)
export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y)
export const mid = (a: Vec, b: Vec): Vec => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

export function signedArea(pts: Vec[]): number {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    s += a.x * b.y - b.x * a.y
  }
  return s / 2
}

export const area = (pts: Vec[]) => Math.abs(signedArea(pts))

export function perimeter(pts: Vec[]): number {
  let s = 0
  for (let i = 0; i < pts.length; i++) s += dist(pts[i], pts[(i + 1) % pts.length])
  return s
}

export function pointInPolygon(p: Vec, pts: Vec[]): boolean {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]
    const b = pts[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** Closest point on segment ab to p. */
export function projectOnSegment(p: Vec, a: Vec, b: Vec): Vec {
  const ab = sub(b, a)
  const l2 = dot(ab, ab)
  if (l2 === 0) return a
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2))
  return add(a, mul(ab, t))
}

/** Intersection of the infinite line (origin, dir) with segment ab, if any. */
export function lineSegmentIntersection(origin: Vec, dir: Vec, a: Vec, b: Vec): Vec | null {
  const e = sub(b, a)
  const denom = dir.x * e.y - dir.y * e.x
  if (Math.abs(denom) < 1e-12) return null
  const w = sub(a, origin)
  const u = (w.x * dir.y - w.y * dir.x) / denom
  if (u < 0 || u > 1) return null
  return add(a, mul(e, u))
}

export function bounds(pts: Vec[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY }
}

export function centroid(pts: Vec[]): Vec {
  const a = signedArea(pts)
  if (Math.abs(a) < 1e-9) {
    const b = bounds(pts)
    return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }
  }
  let cx = 0, cy = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % pts.length]
    const f = p.x * q.y - q.x * p.y
    cx += (p.x + q.x) * f
    cy += (p.y + q.y) * f
  }
  return { x: cx / (6 * a), y: cy / (6 * a) }
}

/**
 * A point that is guaranteed to be inside the polygon (for labels).
 * Uses the centroid if inside, otherwise the middle of the widest
 * horizontal span through the polygon's vertical middle.
 */
export function labelPoint(pts: Vec[]): Vec {
  const c = centroid(pts)
  if (pointInPolygon(c, pts)) return c
  const b = bounds(pts)
  let best: Vec = c
  let bestW = -1
  for (let k = 1; k < 10; k++) {
    const y = b.minY + ((b.maxY - b.minY) * k) / 10
    const xs: number[] = []
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]
      const q = pts[(i + 1) % pts.length]
      if (a.y > y !== q.y > y) xs.push(a.x + ((y - a.y) * (q.x - a.x)) / (q.y - a.y))
    }
    xs.sort((m, n) => m - n)
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const w = xs[i + 1] - xs[i]
      if (w > bestW) {
        bestW = w
        best = { x: (xs[i] + xs[i + 1]) / 2, y }
      }
    }
  }
  return best
}

/** Ramer–Douglas–Peucker on an open polyline. */
function rdpOpen(pts: Vec[], eps: number): Vec[] {
  if (pts.length < 3) return pts.slice()
  const a = pts[0]
  const b = pts[pts.length - 1]
  let maxD = -1
  let idx = 0
  for (let i = 1; i < pts.length - 1; i++) {
    const d = dist(pts[i], projectOnSegment(pts[i], a, b))
    if (d > maxD) {
      maxD = d
      idx = i
    }
  }
  if (maxD <= eps) return [a, b]
  const left = rdpOpen(pts.slice(0, idx + 1), eps)
  const right = rdpOpen(pts.slice(idx), eps)
  return left.slice(0, -1).concat(right)
}

/** RDP on a closed polygon: split at the two mutually far points. */
export function simplifyPolygon(pts: Vec[], eps: number): Vec[] {
  if (pts.length < 4) return pts.slice()
  let far = 0
  let farD = -1
  for (let i = 1; i < pts.length; i++) {
    const d = dist(pts[0], pts[i])
    if (d > farD) {
      farD = d
      far = i
    }
  }
  const first = rdpOpen(pts.slice(0, far + 1), eps)
  const second = rdpOpen(pts.slice(far).concat([pts[0]]), eps)
  return first.slice(0, -1).concat(second.slice(0, -1))
}

/** Drop vertices that are (nearly) duplicates or collinear with their neighbours. */
export function cleanPolygon(pts: Vec[], eps = 1e-6): Vec[] {
  let out = pts.slice()
  let changed = true
  while (changed && out.length > 3) {
    changed = false
    for (let i = 0; i < out.length && out.length > 3; i++) {
      const prev = out[(i - 1 + out.length) % out.length]
      const cur = out[i]
      const next = out[(i + 1) % out.length]
      const dup = dist(prev, cur) <= eps
      const collinear = dist(cur, projectOnSegment(cur, prev, next)) <= eps
      if (dup || collinear) {
        out.splice(i, 1)
        changed = true
        i--
      }
    }
  }
  return out
}

type EdgeClass = 'h' | 'v' | 'o'

function classify(a: Vec, b: Vec, tolRad: number): EdgeClass {
  const ang = Math.abs(Math.atan2(b.y - a.y, b.x - a.x))
  if (ang < tolRad || Math.PI - ang < tolRad) return 'h'
  if (Math.abs(ang - Math.PI / 2) < tolRad) return 'v'
  return 'o'
}

/**
 * Snap near-horizontal / near-vertical edges to be exactly axis-aligned and
 * collapse short runs of diagonal edges between perpendicular walls into a
 * proper corner. `shortRun` is the max length of a diagonal run to collapse.
 */
export function orthogonalize(input: Vec[], tolDeg = 12, shortRun = 0): Vec[] {
  const tol = (tolDeg * Math.PI) / 180
  let pts = input.map((p) => ({ ...p }))

  for (let iter = 0; iter < 100 && pts.length > 3; iter++) {
    const n = pts.length
    const cls = pts.map((p, i) => classify(p, pts[(i + 1) % n], tol))

    // Merge consecutive same-direction edges by dropping the shared vertex.
    const keep = pts.map((_, i) => {
      const prevC = cls[(i - 1 + n) % n]
      return prevC === 'o' || prevC !== cls[i]
    })
    if (keep.some((k) => !k)) {
      pts = pts.filter((_, i) => keep[i])
      continue
    }

    if (shortRun > 0) {
      const next = collapseDiagonalRun(pts, cls, shortRun)
      if (next) {
        pts = next
        continue
      }
    }

    // Snap axis-aligned edges.
    for (let i = 0; i < n; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % n]
      if (cls[i] === 'h') {
        a.y = b.y = (a.y + b.y) / 2
      } else if (cls[i] === 'v') {
        a.x = b.x = (a.x + b.x) / 2
      }
    }
    break
  }
  return cleanPolygon(pts, 1e-6)
}

/**
 * Find one short run of diagonal edges between two axis-aligned edges and
 * replace it with proper right-angle corners. Returns null if none found.
 */
function collapseDiagonalRun(pts: Vec[], cls: EdgeClass[], shortRun: number): Vec[] | null {
  const n = pts.length
  for (let i = 0; i < n; i++) {
    if (cls[i] === 'o' || cls[(i + 1) % n] !== 'o') continue
    let j = (i + 1) % n
    let runLen = 0
    for (let count = 0; cls[j] === 'o' && count < n; count++) {
      runLen += dist(pts[j], pts[(j + 1) % n])
      j = (j + 1) % n
    }
    if (cls[j] === 'o' || runLen > shortRun) continue

    const runStart = (i + 1) % n // first vertex of the diagonal run
    const runEnd = j // vertex where the next axis-aligned edge starts
    const s = pts[runStart]
    const e = pts[runEnd]
    let replacement: Vec[]
    if (cls[i] !== cls[j]) {
      // perpendicular walls: corner at the intersection of both lines
      replacement = [cls[i] === 'h' ? { x: e.x, y: s.y } : { x: s.x, y: e.y }]
    } else if (cls[i] === 'h') {
      const xm = (s.x + e.x) / 2
      replacement = Math.abs(s.y - e.y) < shortRun / 4 ? [] : [{ x: xm, y: s.y }, { x: xm, y: e.y }]
    } else {
      const ym = (s.y + e.y) / 2
      replacement = Math.abs(s.x - e.x) < shortRun / 4 ? [] : [{ x: s.x, y: ym }, { x: e.x, y: ym }]
    }

    const removed = new Set<number>()
    for (let k = runStart; ; k = (k + 1) % n) {
      removed.add(k)
      if (k === runEnd) break
    }
    const next: Vec[] = []
    for (let k = 0; k < n; k++) {
      if (k === runStart) next.push(...replacement)
      if (!removed.has(k)) next.push(pts[k])
    }
    if (next.length >= 3) return next
  }
  return null
}

/**
 * Remove small rectangular notches/bumps: two short edges in opposite
 * directions around a middle edge (e.g. a door opening cut into a wall).
 */
export function removeNotches(input: Vec[], maxDepth: number): Vec[] {
  let pts = input.slice()
  for (let changed = true; changed && pts.length > 4; ) {
    changed = false
    const n = pts.length
    for (let i = 0; i < n; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % n]
      const c = pts[(i + 2) % n]
      const d = pts[(i + 3) % n]
      const e1 = sub(b, a)
      const e3 = sub(d, c)
      if (len(e1) > maxDepth || len(e3) > maxDepth || len(e1) === 0 || len(e3) === 0) continue
      const cos = dot(e1, e3) / (len(e1) * len(e3))
      if (cos > -0.99) continue
      // a and d must lie on one line, parallel to the notch's middle edge
      const mDir = sub(c, b)
      if (len(mDir) === 0) continue
      const off = Math.abs((d.x - a.x) * mDir.y - (d.y - a.y) * mDir.x) / len(mDir)
      if (off > maxDepth * 0.25) continue
      const drop = new Set([(i + 1) % n, (i + 2) % n])
      pts = pts.filter((_, k) => !drop.has(k))
      changed = true
      break
    }
  }
  return pts
}

/**
 * Flatten tiny steps: a short axis-aligned edge between two parallel edges
 * going the same way. The shorter neighbour is moved onto the longer one.
 */
export function removeJogs(input: Vec[], maxStep: number): Vec[] {
  let pts = input.map((p) => ({ ...p }))
  for (let iter = 0; iter < 50 && pts.length > 4; iter++) {
    const n = pts.length
    let changed = false
    for (let i = 0; i < n; i++) {
      const a = pts[(i - 1 + n) % n]
      const b = pts[i]
      const c = pts[(i + 1) % n]
      const d = pts[(i + 2) % n]
      const step = sub(c, b)
      const l = len(step)
      if (l === 0 || l > maxStep) continue
      const prev = sub(b, a)
      const next = sub(d, c)
      const horizontalStep = Math.abs(step.y) < 1e-9
      const verticalStep = Math.abs(step.x) < 1e-9
      if (!horizontalStep && !verticalStep) continue
      // neighbours must be perpendicular to the step and point the same way
      if (Math.abs(dot(prev, step)) > 1e-9 || Math.abs(dot(next, step)) > 1e-9 || dot(prev, next) <= 0) continue
      if (len(prev) >= len(next)) {
        if (verticalStep) c.y = d.y = b.y
        else c.x = d.x = b.x
      } else {
        if (verticalStep) b.y = a.y = c.y
        else b.x = a.x = c.x
      }
      changed = true
      break
    }
    if (!changed) break
    pts = cleanPolygon(pts, 1e-6)
  }
  return pts
}

export function rotate(p: Vec, angle: number, origin: Vec = { x: 0, y: 0 }): Vec {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const dx = p.x - origin.x
  const dy = p.y - origin.y
  return { x: origin.x + dx * c - dy * s, y: origin.y + dx * s + dy * c }
}

/** Smallest difference between two directions, ignoring orientation (mod 180°). */
export function angleDiffMod(a: number, b: number, period = Math.PI): number {
  const d = (((a - b) % period) + period) % period
  return Math.min(d, period - d)
}

/**
 * Dominant wall orientation of a polygon, modulo 90°, in (-45°, 45°].
 * Length-weighted circular mean of 4·θ, so perpendicular walls reinforce
 * each other instead of cancelling out.
 */
export function dominantAngle(pts: Vec[]): number {
  let cx = 0
  let cy = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    const l = dist(a, b)
    const t = Math.atan2(b.y - a.y, b.x - a.x)
    cx += l * Math.cos(4 * t)
    cy += l * Math.sin(4 * t)
  }
  return Math.atan2(cy, cx) / 4
}

/**
 * Position of a boundary point as `edgeIndex + t` (t in [0, 1)), or null if
 * the point isn't on the polygon's boundary.
 */
export function boundaryParam(pts: Vec[], p: Vec, eps = 1e-6): number | null {
  let best: number | null = null
  let bestD = eps
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    const d = dist(p, projectOnSegment(p, a, b))
    if (d <= bestD) {
      bestD = d
      const l = dist(a, b)
      const t = l ? Math.min(dist(a, p) / l, 1) : 0
      best = t >= 1 ? (i + 1) % pts.length : i + t
    }
  }
  return best
}

/**
 * Split a polygon along a cut polyline that starts and ends on its boundary
 * and runs through its interior. Returns the two pieces, or null if the cut
 * is invalid (endpoints off the boundary, leaves the polygon, degenerate).
 */
export function splitPolygon(pts: Vec[], cut: Vec[], eps = 1e-6): [Vec[], Vec[]] | null {
  if (cut.length < 2) return null
  const n = pts.length
  const c0 = cut[0]
  const cn = cut[cut.length - 1]
  const s0 = boundaryParam(pts, c0, eps)
  const s1 = boundaryParam(pts, cn, eps)
  if (s0 === null || s1 === null || dist(c0, cn) <= eps) return null
  const inner = cut.slice(1, -1)
  if (inner.some((p) => !pointInPolygon(p, pts))) return null
  for (let i = 0; i + 1 < cut.length; i++) {
    if (!pointInPolygon(mid(cut[i], cut[i + 1]), pts)) return null
  }

  /** Polygon vertices strictly between boundary positions `from` and `to`, walking forward. */
  const walk = (from: number, to: number) => {
    const span = (to - from + n) % n
    return pts
      .map((p, j) => ({ p, o: (j - from + n) % n }))
      .filter(({ o }) => o > eps && o < span - eps)
      .sort((a, b) => a.o - b.o)
      .map(({ p }) => p)
  }
  const a = cleanPolygon([c0, ...walk(s0, s1), cn, ...[...inner].reverse()], eps)
  const b = cleanPolygon([cn, ...walk(s1, s0), c0, ...inner], eps)
  if (a.length < 3 || b.length < 3) return null
  // A cut that crosses the boundary yields overlapping pieces: areas won't add up.
  const total = area(pts)
  if (Math.abs(area(a) + area(b) - total) > total * 1e-6 + eps) return null
  if (area(a) < eps || area(b) < eps) return null
  return [a, b]
}

export function fmtLen(m: number): string {
  return `${m.toFixed(2)} m`
}

export function fmtArea(m2: number): string {
  return `${m2.toFixed(1)} m²`
}
