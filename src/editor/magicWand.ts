/**
 * Semi-automatic room detection on a raster floor plan.
 *
 * Pipeline (all on a downscaled grayscale copy of the image):
 *  1. walls      = pixels darker than `threshold`
 *  2. opening    = remove wall strokes thinner than `minWallPx`
 *                  (text, furniture, hatching, dimension lines)
 *  3. blocked    = everything within `gapPx` of a wall, which closes
 *                  door openings narrower than 2 * gapPx
 *  4. components = connected regions of the remaining free space
 *  5. reclaim    = grow every component back into the free (non-wall) space
 *                  simultaneously; the fronts meet in the middle of door
 *                  openings, so corners stay sharp and doorways get a
 *                  straight cut
 *  6. trace the outline of the clicked component, simplify, orthogonalize
 */
import {
  angleDiffMod, cleanPolygon, dominantAngle, orthogonalize, removeJogs, removeNotches, rotate, simplifyPolygon,
} from '../lib/geometry'
import type { Vec } from '../model/types'

export interface WandParams {
  /** 0–255; pixels darker than this count as wall. */
  threshold: number
  /**
   * Judge darkness by the brightest colour channel, so saturated markings
   * (highlighter, coloured annotations) count as paper, not wall.
   */
  ignoreColor: boolean
  /** Preferred wall orientation (radians, image frame), e.g. from existing rooms. */
  angleHint?: number
  /** Strokes thinner than this (in image px) are ignored. */
  minWallPx: number
  /** Openings up to this width (in image px) are treated as closed. */
  maxOpeningPx: number
}

export interface PreparedImage {
  w: number
  h: number
  /** Luminance. */
  lum: Uint8Array
  /** Brightest channel (HSV value): coloured ink is "light". */
  val: Uint8Array
  /** Original image pixels per processed pixel. */
  factor: number
}

const MAX_DIM = 1600

export async function prepareImage(url: string): Promise<PreparedImage> {
  const img = new Image()
  img.src = url
  await img.decode()
  const factor = Math.max(1, Math.max(img.naturalWidth, img.naturalHeight) / MAX_DIM)
  const w = Math.round(img.naturalWidth / factor)
  const h = Math.round(img.naturalHeight / factor)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h).data
  const lum = new Uint8Array(w * h)
  const val = new Uint8Array(w * h)
  for (let i = 0, j = 0; i < lum.length; i++, j += 4) {
    lum[i] = (data[j] * 299 + data[j + 1] * 587 + data[j + 2] * 114) / 1000
    val[i] = Math.max(data[j], data[j + 1], data[j + 2])
  }
  return { w, h, lum, val, factor }
}

/** Squared Euclidean distance to the nearest set pixel (Felzenszwalb & Huttenlocher). */
function distanceTransform(mask: Uint8Array, w: number, h: number): Float64Array {
  const INF = 1e20
  const out = new Float64Array(w * h)
  for (let i = 0; i < out.length; i++) out[i] = mask[i] ? 0 : INF
  const n = Math.max(w, h)
  const f = new Float64Array(n)
  const d = new Float64Array(n)
  const v = new Int32Array(n)
  const z = new Float64Array(n + 1)

  const pass = (len: number) => {
    let k = 0
    v[0] = 0
    z[0] = -INF
    z[1] = INF
    for (let q = 1; q < len; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
      while (s <= z[k]) {
        k--
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
      }
      k++
      v[k] = q
      z[k] = s
      z[k + 1] = INF
    }
    k = 0
    for (let q = 0; q < len; q++) {
      while (z[k + 1] < q) k++
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]
    }
  }

  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = out[y * w + x]
    pass(h)
    for (let y = 0; y < h; y++) out[y * w + x] = d[y]
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = out[y * w + x]
    pass(w)
    for (let x = 0; x < w; x++) out[y * w + x] = d[x]
  }
  return out
}

/** Wall mask after dropping strokes thinner than minWallPx. */
export function wallMask(img: PreparedImage, params: WandParams): Uint8Array {
  const { w, h } = img
  const src = params.ignoreColor ? img.val : img.lum
  const n = w * h
  const raw = new Uint8Array(n)
  for (let i = 0; i < n; i++) raw[i] = src[i] < params.threshold ? 1 : 0
  const r = params.minWallPx / img.factor / 2
  if (r < 0.5) return raw

  // Morphological opening: erode by r, then dilate by r.
  const free = new Uint8Array(n)
  for (let i = 0; i < n; i++) free[i] = raw[i] ? 0 : 1
  const dFree = distanceTransform(free, w, h)
  const eroded = new Uint8Array(n)
  const r2 = r * r
  for (let i = 0; i < n; i++) eroded[i] = dFree[i] > r2 ? 1 : 0
  const dEroded = distanceTransform(eroded, w, h)
  const opened = new Uint8Array(n)
  for (let i = 0; i < n; i++) opened[i] = dEroded[i] <= r2 ? 1 : 0
  return opened
}

export type WandResult =
  | { ok: true; polygon: Vec[] } // in original image pixels
  | { ok: false; reason: string }

interface Analysis {
  img: PreparedImage
  key: string
  /** Region id per pixel; -1 = wall. */
  label: Int32Array
}

let cache: Analysis | null = null

/** Partition the free space into rooms. Independent of the click, so cached. */
function analyze(img: PreparedImage, params: WandParams): Analysis {
  const key = `${params.threshold}|${params.ignoreColor}|${params.minWallPx}|${params.maxOpeningPx}`
  if (cache && cache.img === img && cache.key === key) return cache

  const { w, h, factor } = img
  const n = w * h
  const walls = wallMask(img, params)

  // Close openings: block everything within gap of a wall.
  const gap = params.maxOpeningPx / factor / 2 + 1
  const gap2 = gap * gap
  const dWall = distanceTransform(walls, w, h)
  const label = new Int32Array(n) // 0 = unassigned, -1 = wall
  for (let i = 0; i < n; i++) if (walls[i]) label[i] = -1

  // Label connected components of the unblocked free space (4-connected).
  const queue = new Int32Array(n)
  let next = 1
  for (let i = 0; i < n; i++) {
    if (label[i] !== 0 || dWall[i] <= gap2) continue
    const id = next++
    let head = 0
    let tail = 0
    queue[tail++] = i
    label[i] = id
    while (head < tail) {
      const p = queue[head++]
      const x = p % w
      for (let k = 0; k < 4; k++) {
        const q = neighbour(p, x, k, w, n)
        if (q >= 0 && label[q] === 0 && dWall[q] > gap2) {
          label[q] = id
          queue[tail++] = q
        }
      }
    }
  }

  // Reclaim the blocked free pixels: multi-source BFS from all components,
  // so fronts meet in the middle of door openings.
  let head = 0
  let tail = 0
  for (let i = 0; i < n; i++) if (label[i] > 0) queue[tail++] = i
  while (head < tail) {
    const p = queue[head++]
    const x = p % w
    for (let k = 0; k < 4; k++) {
      const q = neighbour(p, x, k, w, n)
      if (q >= 0 && label[q] === 0) {
        label[q] = label[p]
        queue[tail++] = q
      }
    }
  }

  cache = { img, key, label }
  return cache
}

function neighbour(p: number, x: number, k: number, w: number, n: number): number {
  switch (k) {
    case 0: return x > 0 ? p - 1 : -1
    case 1: return x < w - 1 ? p + 1 : -1
    case 2: return p >= w ? p - w : -1
    default: return p < n - w ? p + w : -1
  }
}

export function detectRoom(img: PreparedImage, seedPx: Vec, params: WandParams): WandResult {
  const { w, h, factor } = img
  const sx = Math.floor(seedPx.x / factor)
  const sy = Math.floor(seedPx.y / factor)
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return { ok: false, reason: 'Click inside the plan image.' }

  const { label } = analyze(img, params)
  const target = label[sy * w + sx]
  if (target === -1) return { ok: false, reason: 'You clicked on a wall – click inside a room.' }
  if (target === 0) {
    return { ok: false, reason: 'No room found here – try a smaller "close openings" value.' }
  }

  // Reject regions touching the image border: they leaked outside.
  let size = 0
  let touchesBorder = false
  let startIdx = -1
  for (let i = 0; i < label.length; i++) {
    if (label[i] !== target) continue
    if (startIdx < 0) startIdx = i
    size++
    const x = i % w
    const y = (i - x) / w
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesBorder = true
  }
  if (touchesBorder) {
    return {
      ok: false,
      reason: 'This area leaks to the outside. Increase "close openings" or lower the wall threshold.',
    }
  }
  if (size < 50) return { ok: false, reason: 'Detected area is too small.' }

  const gap = params.maxOpeningPx / factor / 2 + 1
  const outline = traceOutline(label, target, w, startIdx)
  let poly = simplifyPolygon(outline, 2)

  // Square up the outline in the room's own frame, so rotated plans work.
  let theta = dominantAngle(poly)
  if (params.angleHint !== undefined && angleDiffMod(theta, params.angleHint, Math.PI / 2) < (4 * Math.PI) / 180) {
    theta = params.angleHint
  }
  if (Math.abs(theta) < 1e-9) theta = 0 // keep axis-aligned plans exact
  poly = poly.map((p) => (theta ? rotate(p, -theta) : p))
  poly = orthogonalize(poly, 12, gap)
  poly = removeNotches(poly, gap * 0.6)
  poly = removeJogs(poly, Math.max(3, gap * 0.25))
  poly = cleanPolygon(poly, 0.5)
  poly = poly.map((p) => (theta ? rotate(p, theta) : p))
  if (poly.length < 3) return { ok: false, reason: 'Could not build an outline.' }
  return { ok: true, polygon: poly.map((p) => ({ x: p.x * factor, y: p.y * factor })) }
}

/**
 * Walk the pixel-crack boundary of a 4-connected region clockwise
 * (inside on the right), emitting a vertex at every turn.
 * `start` must be the top-most, left-most pixel of the region.
 */
function traceOutline(label: Int32Array, target: number, w: number, start: number): Vec[] {
  const h = label.length / w
  const inside = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h && label[y * w + x] === target
  // directions: 0 right, 1 down, 2 left, 3 up
  const DX = [1, 0, -1, 0]
  const DY = [0, 1, 0, -1]
  const aheadRight = (x: number, y: number, d: number) =>
    d === 0 ? inside(x, y) : d === 1 ? inside(x - 1, y) : d === 2 ? inside(x - 1, y - 1) : inside(x, y - 1)
  const aheadLeft = (x: number, y: number, d: number) =>
    d === 0 ? inside(x, y - 1) : d === 1 ? inside(x, y) : d === 2 ? inside(x - 1, y) : inside(x - 1, y - 1)

  const x0 = start % w
  const y0 = (start - x0) / w
  let x = x0
  let y = y0
  let d = 0
  const pts: Vec[] = [{ x, y }]
  const limit = label.length * 4
  for (let steps = 0; steps < limit; steps++) {
    x += DX[d]
    y += DY[d]
    let nd: number
    if (!aheadRight(x, y, d)) nd = (d + 1) % 4
    else if (aheadLeft(x, y, d)) nd = (d + 3) % 4
    else nd = d
    if (x === x0 && y === y0) break
    if (nd !== d) pts.push({ x, y })
    d = nd
  }
  return pts
}

/** Render the wall mask as a translucent overlay (data URL) for tuning. */
export function wallMaskOverlay(img: PreparedImage, params: WandParams): string {
  const mask = wallMask(img, params)
  const canvas = document.createElement('canvas')
  canvas.width = img.w
  canvas.height = img.h
  const ctx = canvas.getContext('2d')!
  const out = ctx.createImageData(img.w, img.h)
  for (let i = 0, j = 0; i < mask.length; i++, j += 4) {
    if (!mask[i]) continue
    out.data[j] = 239
    out.data[j + 1] = 68
    out.data[j + 2] = 68
    out.data[j + 3] = 170
  }
  ctx.putImageData(out, 0, 0)
  return canvas.toDataURL()
}
