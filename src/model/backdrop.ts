import { rotate } from '../lib/geometry'
import type { Backdrop, Vec } from './types'

/** Image pixel → world. The image is scaled, then rotated about its top-left corner. */
export function imageToWorld(bd: Backdrop, p: Vec): Vec {
  const origin = { x: bd.x, y: bd.y }
  return rotate({ x: bd.x + p.x * bd.scale, y: bd.y + p.y * bd.scale }, bd.rotation ?? 0, origin)
}

export function worldToImage(bd: Backdrop, w: Vec): Vec {
  const q = rotate(w, -(bd.rotation ?? 0), { x: bd.x, y: bd.y })
  return { x: (q.x - bd.x) / bd.scale, y: (q.y - bd.y) / bd.scale }
}

export function backdropCorners(bd: Backdrop): Vec[] {
  return [
    { x: 0, y: 0 }, { x: bd.width, y: 0 }, { x: bd.width, y: bd.height }, { x: 0, y: bd.height },
  ].map((p) => imageToWorld(bd, p))
}

/** SVG transform for an <image> placed at (bd.x, bd.y) in world units. */
export function backdropTransform(bd: Backdrop): string | undefined {
  return bd.rotation ? `rotate(${(bd.rotation * 180) / Math.PI} ${bd.x} ${bd.y})` : undefined
}
