import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import {
  add, area, boundaryParam, bounds, cleanPolygon, dist, dot, fmtArea, fmtLen, labelPoint, len, mid, mul,
  pointInPolygon, projectOnSegment, rotate, splitPolygon, sub, subtractPolygons,
} from '../lib/geometry'
import { isTyping } from '../lib/dom'
import { nextRoomColor, nextRoomName } from '../model/doc'
import { uid } from '../model/ids'
import type { Floor, Room, Vec } from '../model/types'
import { mainFrame, snapPoint, targetsFrom, type Guide, type SnapResult, type SnapSettings } from './snapping'
import { backdropCorners, backdropTransform } from '../model/backdrop'

export type Tool = 'select' | 'polygon' | 'calibrate'
export type Mode = 'plan' | 'home'

interface View {
  tx: number
  ty: number
  /** Screen pixels per meter. */
  k: number
  /** Rotation of the view (radians, clockwise on screen). */
  r: number
}

/** World → canvas pixels. */
const toScreenOf = (v: View, p: Vec): Vec => add(mul(rotate(p, v.r), v.k), { x: v.tx, y: v.ty })

/** Wrap an angle into (-π, π]. */
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

/** A two-finger twist has to exceed this before the view starts rotating, so zooming doesn't rotate by accident. */
const ROTATE_THRESHOLD = (12 * Math.PI) / 180
/** While rotating, the view sticks to multiples of 90° within this angle. */
const ROTATE_SNAP = (4 * Math.PI) / 180

type Drag =
  /** `tap`: what to select if the pointer is released without panning (null = nothing). */
  | { type: 'pan'; sx: number; sy: number; view: View; tap?: string | null; moved?: boolean }
  /**
   * Two-finger zoom/pan/rotate. `w0` is the world point under the fingers' start midpoint,
   * `a0` the angle between the fingers that rotation is measured from.
   */
  | { type: 'pinch'; d0: number; a0: number; w0: Vec; view: View; rotating: boolean }
  /** Touch drawing: the point follows the finger and is placed on release. */
  | { type: 'aim' }
  /** After a pinch, until all fingers are lifted. */
  | { type: 'idle' }
  | { type: 'vertex'; roomId: string; idx: number; started: boolean; sx: number; sy: number }
  | { type: 'edge'; roomId: string; idx: number; start: Vec; orig: Vec[]; started: boolean; sx: number; sy: number }
  | { type: 'room'; roomId: string; start: Vec; orig: Vec[]; started: boolean; sx: number; sy: number }
  /** An end of the scale line; it moves with the pointer rather than jumping under it. */
  | { type: 'calib'; idx: number; start: Vec; orig: Vec; started: boolean; sx: number; sy: number }

interface Props {
  floor: Floor
  imageUrl?: string
  mode: Mode
  tool: Tool
  selectedId: string | null
  onSelect: (id: string | null) => void
  snap: SnapSettings
  showBackdrop: boolean
  /** Bump `n` to re-fit the view; with `focus`, fit around those points instead of everything. */
  fitRequest: { n: number; focus?: Vec[] }
  pendingCalibration: [Vec, Vec] | null
  onCalibrate: (a: Vec, b: Vec) => void
  /** An end of the pending scale line was dragged. */
  onCalibrationChange?: (line: [Vec, Vec]) => void
  onMessage: (msg: string) => void
  commit: (fn: (f: Floor) => Floor) => void
  replace: (fn: (f: Floor) => Floor) => void
  checkpoint: () => void
  openTodoCount: (room: Room) => number
  /** Camera tilt (radians) outside the editor: 0 looks straight down, larger shows half-height walls. */
  pitch?: number
}

/** Wall height (m) of the tilted home view. */
const WALL_H = 0.7

const DRAG_THRESHOLD = 3
/** Smallest area (m²) a drawn shape needs to become a room. */
const MIN_ROOM_AREA = 0.05

export function PlanCanvas(props: Props) {
  const { floor, mode, tool, selectedId, snap } = props
  const bd = floor.backdrop
  const svgRef = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [view, setView] = useState<View>({ tx: 40, ty: 40, k: 50, r: 0 })
  const [cursor, setCursor] = useState<SnapResult | null>(null)
  const [draft, setDraft] = useState<Vec[]>([])
  const [calibStart, setCalibStart] = useState<Vec | null>(null)
  const [lengthInput, setLengthInput] = useState('')
  const [hover, setHover] = useState<string | null>(null)
  /** Select tool: a corner tapped without dragging, offered for removal. */
  const [activeVertex, setActiveVertex] = useState<number | null>(null)
  const drag = useRef<Drag | null>(null)
  const pointers = useRef(new Map<number, Vec>())
  const lastPointerType = useRef('mouse')
  const spaceDown = useRef(false)

  const editing = mode === 'plan'
  const pitch = editing ? 0 : props.pitch ?? 0
  const pc = Math.cos(pitch)
  const ps = Math.sin(pitch)
  /** The ends of the scale line placed so far. */
  const calibPts: Vec[] = props.pendingCalibration ?? (calibStart ? [calibStart] : [])
  const selected = floor.rooms.find((r) => r.id === selectedId) ?? null

  // Reset transient drawing state when the tool or floor changes.
  useEffect(() => {
    setDraft([])
    setCalibStart(null)
    setLengthInput('')
  }, [tool, floor.id, mode])
  useEffect(() => setActiveVertex(null), [tool, selectedId])

  // ---------- viewport ----------

  useLayoutEffect(() => {
    const el = svgRef.current!
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  /** The view that shows all rooms (in the editor also the visible stencil), or around `focus`. */
  const computeFit = (focus?: Vec[]): View | null => {
    if (!size.w || !size.h) return null
    const pts: Vec[] = focus ? [...focus] : floor.rooms.flatMap((r) => r.points)
    if (focus) {
      // leave some context (≥ 3 m, as the plan is calibrated by now) around the focus
      const fb = bounds(focus)
      const m = Math.max(0.3 * Math.max(fb.maxX - fb.minX, fb.maxY - fb.minY), 3)
      pts.push({ x: fb.minX - m, y: fb.minY - m }, { x: fb.maxX + m, y: fb.maxY + m })
    } else if (bd && editing && props.showBackdrop) {
      pts.push(...backdropCorners(bd))
    }
    const r = view.r
    if (!pts.length) return { ...toScreenFit({ minX: 0, minY: 0, maxX: 10, maxY: 8 }, 50), r }
    // fit the plan as it appears on screen, i.e. rotated with the view
    const b = bounds(pts.map((p) => rotate(p, r)))
    const pad = editing ? 48 : 12
    // a tilted view squashes the plan vertically and adds the walls' height on top
    const k = Math.min(
      (size.w - pad * 2) / Math.max(b.maxX - b.minX, 0.5),
      (size.h - pad * 2) / (Math.max(b.maxY - b.minY, 0.5) * pc + (focus ? 0 : WALL_H * ps)),
    )
    return { ...toScreenFit(b, k), r }
  }

  /** Translation that centers (already rotated) bounds `b` at scale `k`. */
  const toScreenFit = (b: ReturnType<typeof bounds>, k: number) => ({
    k,
    tx: (size.w - (b.maxX - b.minX) * k) / 2 - b.minX * k,
    // the tilt is about the canvas middle; push the plan down to make room for the walls above it
    ty: size.h / 2 + (WALL_H * k * ps) / (2 * pc) - ((b.minY + b.maxY) / 2) * k,
  })

  /** Whether the view is still the automatic fit (the user hasn't panned or zoomed since). */
  const autoFit = useRef(true)
  const fitToContent = (focus?: Vec[]) => {
    const v = computeFit(focus)
    if (!v) return
    setView(v)
    autoFit.current = !focus
  }

  const fitRef = useRef(fitToContent)
  fitRef.current = fitToContent
  const sized = size.w > 0
  useEffect(() => {
    if (sized) fitRef.current(props.fitRequest.focus)
  }, [props.fitRequest, floor.id, sized, mode])
  // e.g. the map shrinking while scrolling: stay fitted unless the user has moved the view
  useEffect(() => {
    if (autoFit.current) fitRef.current()
  }, [size.w, size.h, pitch])

  const fitted = computeFit()
  const isFitted = !fitted || (Math.abs(view.k / fitted.k - 1) < 0.01 && Math.abs(view.tx - fitted.tx) < 2 && Math.abs(view.ty - fitted.ty) < 2)

  const zoomAt = (sx: number, sy: number, factor: number) => {
    autoFit.current = false
    setView((v) => {
      const k = Math.min(5000, Math.max(2, v.k * factor))
      const f = k / v.k
      return { ...v, k, tx: sx - (sx - v.tx) * f, ty: sy - (sy - v.ty) * f }
    })
  }

  useEffect(() => {
    const el = svgRef.current!
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) {
        zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.01))
      } else {
        autoFit.current = false
        setView((v) => ({ ...v, tx: v.tx - e.deltaX, ty: v.ty - e.deltaY }))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const toWorld = (clientX: number, clientY: number): Vec => {
    const r = svgRef.current!.getBoundingClientRect()
    const y = size.h / 2 + (clientY - r.top - size.h / 2) / pc
    return rotate({ x: (clientX - r.left - view.tx) / view.k, y: (y - view.ty) / view.k }, -view.r)
  }
  /** World → canvas pixels, including the camera tilt (floor level). */
  const toScreen = (p: Vec) => {
    const q = toScreenOf(view, p)
    return { x: q.x, y: size.h / 2 + (q.y - size.h / 2) * pc }
  }

  const rotated = Math.abs(wrapAngle(view.r)) > 1e-6
  /** Turn the view back to north-up, around the middle of the canvas. */
  const resetRotation = () => {
    const c = { x: size.w / 2, y: size.h / 2 }
    const w = rotate({ x: (c.x - view.tx) / view.k, y: (c.y - view.ty) / view.k }, -view.r)
    setView({ k: view.k, r: 0, tx: c.x - w.x * view.k, ty: c.y - w.y * view.k })
  }

  // ---------- snapping ----------

  const snapSettings = (e: { shiftKey: boolean; altKey: boolean }): SnapSettings => ({
    enabled: snap.enabled && !e.altKey,
    angles: snap.angles !== e.shiftKey,
  })

  const allTargets = (extraVertices: Vec[] = [], extraEdges: [Vec, Vec][] = []) =>
    targetsFrom(floor.rooms.map((r) => r.points), extraVertices, extraEdges)

  const openEdges = (pts: Vec[]) => pts.slice(1).map((p, i) => [pts[i], p] as [Vec, Vec])

  const snapFor = (raw: Vec, e: { shiftKey: boolean; altKey: boolean }): SnapResult => {
    const s = snapSettings(e)
    if (tool === 'polygon') {
      const close = draft.length >= 2 ? draft[0] : undefined
      return snapPoint(raw, allTargets(draft, openEdges(draft)), view.k, s, draft[draft.length - 1], undefined, close)
    }
    if (tool === 'calibrate') return snapPoint(raw, allTargets(), view.k, s, calibStart ?? undefined)
    return { p: raw, kind: 'none', guides: [] }
  }

  /** The room a path cuts through: it starts on the room's wall and its first segment runs inside. */
  const cutRoom = (pts: Vec[]): Room | undefined =>
    pts.length < 2
      ? undefined
      : floor.rooms.find((r) => boundaryParam(r.points, pts[0]) !== null && pointInPolygon(mid(pts[0], pts[1]), r.points))

  /** Pull a point onto a room's wall if it's within snapping distance of it. */
  const ontoWall = (p: Vec, rooms: Room[]): Vec => {
    let best = p
    let bestD = 10 / view.k
    for (const r of rooms) {
      for (let i = 0; i < r.points.length; i++) {
        const q = projectOnSegment(p, r.points[i], r.points[(i + 1) % r.points.length])
        if (dist(p, q) < bestD) {
          bestD = dist(p, q)
          best = q
        }
      }
    }
    return best
  }

  // ---------- mutations ----------

  /** Add the drawn shape as a room, minus whatever existing rooms already cover. */
  const addRoom = (points: Vec[]) => {
    const pts = cleanPolygon(points, 1e-4)
    if (pts.length < 3 || area(pts) < MIN_ROOM_AREA) {
      props.onMessage('That shape is too small to be a room.')
      return
    }
    const pieces = subtractPolygons(pts, floor.rooms.map((r) => r.points))
    if (!pieces) {
      props.onMessage("A room can't surround another room.")
      return
    }
    // slivers are left over where the shape overlaps an existing wall a little
    const parts = pieces.map((q) => cleanPolygon(q, 1e-4)).filter((q) => q.length >= 3 && area(q) >= MIN_ROOM_AREA)
    if (!parts.length) {
      props.onMessage('That area is already part of a room. To split a room, draw from one of its walls to another.')
      return
    }
    parts.sort((a, b) => area(b) - area(a))
    const rooms: Room[] = []
    for (const q of parts) {
      const f = { ...floor, rooms: [...floor.rooms, ...rooms] }
      rooms.push({ id: uid(), name: nextRoomName(f), color: nextRoomColor(f), points: q, items: [] })
    }
    props.commit((f) => ({ ...f, rooms: [...f.rooms, ...rooms] }))
    props.onSelect(rooms[0].id)
    if (rooms.length > 1) props.onMessage(`Existing rooms divide that shape, so it became ${rooms.length} rooms.`)
  }

  /** Replace a room by two pieces; the bigger one keeps its identity (name, notes, colour). */
  const splitRoom = (room: Room, pieces: [Vec[], Vec[]]) => {
    const [big, small] = area(pieces[0]) >= area(pieces[1]) ? pieces : [pieces[1], pieces[0]]
    const newRoom: Room = { id: uid(), name: nextRoomName(floor), color: nextRoomColor(floor), points: small, items: [] }
    props.commit((f) => ({
      ...f,
      rooms: f.rooms.flatMap((r) => (r.id === room.id ? [{ ...r, points: big }, newRoom] : [r])),
    }))
    props.onSelect(newRoom.id)
    props.onMessage(`Split "${room.name}" into ${fmtArea(area(big))} and ${fmtArea(area(small))} (${newRoom.name}).`)
  }

  const setRoomPoints = (roomId: string, points: Vec[]) =>
    props.replace((f) => ({ ...f, rooms: f.rooms.map((r) => (r.id === roomId ? { ...r, points } : r)) }))

  const finishPolygon = () => {
    if (draft.length >= 3) addRoom(draft)
    setDraft([])
    setLengthInput('')
  }

  const placePolygonPoint = (placed: Vec) => {
    // starting on a wall lets the path split that room
    const p = draft.length ? placed : ontoWall(placed, floor.rooms)
    const last = draft[draft.length - 1]
    if (draft.length >= 3 && dist(p, draft[0]) < 1e-6) {
      finishPolygon()
      return
    }
    if (last && dist(p, last) < 1e-6) return
    // A path from one of a room's walls through its inside to a wall again splits the room.
    const room = cutRoom([...draft, p])
    if (room && draft.length) {
      const end = ontoWall(p, [room])
      const pieces = boundaryParam(room.points, end) !== null ? splitPolygon(room.points, [...draft, end]) : null
      if (pieces) {
        splitRoom(room, pieces)
        setDraft([])
        setLengthInput('')
        return
      }
    }
    setDraft([...draft, p])
  }

  // ---------- pointer handling ----------

  const hitOf = (e: ReactPointerEvent | ReactMouseEvent) => {
    const el = (e.target as Element).closest('[data-hit]')
    if (!el) return null
    const [kind, roomId, idx] = el.getAttribute('data-hit')!.split(':')
    return { kind, roomId, idx: Number(idx) }
  }

  const relative = (p: Vec): Vec => {
    const r = svgRef.current!.getBoundingClientRect()
    return { x: p.x - r.left, y: p.y - r.top }
  }

  const startPinch = () => {
    const [a, b] = [...pointers.current.values()]
    const m = mid(a, b)
    // Whatever the first finger started (a tap, a point being placed) is abandoned.
    drag.current = {
      type: 'pinch', d0: Math.max(dist(a, b), 1), a0: Math.atan2(b.y - a.y, b.x - a.x),
      w0: toWorld(m.x, m.y), view, rotating: false,
    }
    setCursor(null)
  }

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current!
    lastPointerType.current = e.pointerType
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    svg.setPointerCapture(e.pointerId)
    if (pointers.current.size === 2) {
      startPinch()
      return
    }
    if (pointers.current.size > 2 || drag.current) return

    const world = toWorld(e.clientX, e.clientY)
    const panning = e.button === 1 || (e.button === 0 && spaceDown.current)
    if (panning) {
      drag.current = { type: 'pan', sx: e.clientX, sy: e.clientY, view }
      return
    }
    if (e.button !== 0) return

    const calibHit = hitOf(e)
    if (calibHit?.kind === 'calib') {
      drag.current = { type: 'calib', idx: calibHit.idx, start: world, orig: calibPts[calibHit.idx], started: false, sx: e.clientX, sy: e.clientY }
      return
    }
    // while the scale is being entered, its line can only be adjusted
    if (props.pendingCalibration) {
      drag.current = { type: 'pan', sx: e.clientX, sy: e.clientY, view }
      return
    }

    if (!editing || tool === 'select') {
      const hit = hitOf(e)
      const base = { started: false, sx: e.clientX, sy: e.clientY }
      if (hit?.kind !== 'vertex') setActiveVertex(null)
      if (editing && hit && hit.roomId === selectedId && selected) {
        if (hit.kind === 'vertex') {
          drag.current = { type: 'vertex', roomId: hit.roomId, idx: hit.idx, ...base }
        } else if (hit.kind === 'mid') {
          // insert a new vertex on this edge, then drag it
          props.checkpoint()
          const pts = selected.points.slice()
          pts.splice(hit.idx + 1, 0, mid(pts[hit.idx], pts[(hit.idx + 1) % pts.length]))
          setRoomPoints(selected.id, pts)
          drag.current = { type: 'vertex', roomId: hit.roomId, idx: hit.idx + 1, ...base, started: true }
        } else if (hit.kind === 'edge') {
          drag.current = { type: 'edge', roomId: hit.roomId, idx: hit.idx, start: world, orig: selected.points, ...base }
        } else {
          drag.current = { type: 'room', roomId: hit.roomId, start: world, orig: selected.points, ...base }
        }
      } else {
        // Dragging pans (so a finger on a room doesn't move it); a tap selects.
        drag.current = { type: 'pan', sx: e.clientX, sy: e.clientY, view, tap: hit?.roomId ?? null }
      }
      return
    }

    const snapped = snapFor(world, e)
    if (e.pointerType === 'mouse') {
      place(snapped.p)
    } else {
      setCursor(snapped)
      drag.current = { type: 'aim' }
    }
  }

  /** Place a point with the current drawing tool. */
  const place = (p: Vec) => {
    if (tool === 'polygon') {
      placePolygonPoint(p)
    } else if (tool === 'calibrate') {
      if (!bd) {
        props.onMessage('Upload a floor plan first.')
      } else if (calibStart) {
        if (dist(calibStart, p) > 1e-6) props.onCalibrate(calibStart, p)
        setCalibStart(null)
      } else {
        setCalibStart(p)
      }
    }
  }

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const world = toWorld(e.clientX, e.clientY)
    const d = drag.current
    if (d?.type === 'pinch') {
      const [a, b] = [...pointers.current.values()]
      if (!b) return
      const m = relative(mid(a, b))
      const k = Math.min(5000, Math.max(2, (d.view.k * dist(a, b)) / d.d0))
      const angle = Math.atan2(b.y - a.y, b.x - a.x)
      if (!d.rotating && Math.abs(wrapAngle(angle - d.a0)) > ROTATE_THRESHOLD) {
        // start rotating from here, so the view doesn't jump by the threshold
        d.rotating = true
        d.a0 = angle
      }
      let r = d.view.r
      if (d.rotating) {
        r = wrapAngle(r + angle - d.a0)
        const right = Math.round(r / (Math.PI / 2)) * (Math.PI / 2)
        if (Math.abs(r - right) < ROTATE_SNAP) r = right
      }
      // keep the world point that was under the fingers' midpoint under it
      autoFit.current = false
      const s = mul(rotate(d.w0, r), k)
      setView({ k, r, tx: m.x - s.x, ty: m.y - s.y })
      return
    }
    if (d?.type === 'idle') return
    if (d?.type === 'aim') {
      setCursor(snapFor(world, e))
      return
    }
    if (d?.type === 'pan') {
      if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < DRAG_THRESHOLD) return
      d.moved = true
      autoFit.current = false
      setView({ ...d.view, tx: d.view.tx + e.clientX - d.sx, ty: d.view.ty + e.clientY - d.sy })
      return
    }
    if (d && 'started' in d && !d.started) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < DRAG_THRESHOLD) return
      if (d.type !== 'calib') props.checkpoint()
      d.started = true
    }
    const s = snapSettings(e)
    if (d?.type === 'calib') {
      const other = calibPts[1 - d.idx]
      const res = snapPoint(add(d.orig, sub(world, d.start)), allTargets(), view.k, s, other)
      setCursor(res)
      if (props.pendingCalibration) {
        const line = [...props.pendingCalibration] as [Vec, Vec]
        line[d.idx] = res.p
        props.onCalibrationChange?.(line)
      } else {
        setCalibStart(res.p)
      }
      return
    }
    if (d?.type === 'vertex') {
      const room = floor.rooms.find((r) => r.id === d.roomId)!
      const others = floor.rooms.filter((r) => r.id !== d.roomId).map((r) => r.points)
      const own = room.points.filter((_, i) => i !== d.idx)
      const res = snapPoint(world, targetsFrom(others, own), view.k, { ...s, angles: false })
      setCursor(res)
      setRoomPoints(room.id, room.points.map((p, i) => (i === d.idx ? res.p : p)))
      return
    }
    if (d?.type === 'edge') {
      const n = d.orig.length
      const a = d.orig[d.idx]
      const b = d.orig[(d.idx + 1) % n]
      const e1 = sub(b, a)
      const normal = mul({ x: -e1.y, y: e1.x }, 1 / len(e1))
      const raw = add(a, mul(normal, dot(sub(world, d.start), normal)))
      const others = floor.rooms.filter((r) => r.id !== d.roomId).map((r) => r.points)
      const own = d.orig.filter((_, i) => i !== d.idx && i !== (d.idx + 1) % n)
      const res = snapPoint(raw, targetsFrom(others, own), view.k, s, a, normal)
      const delta = mul(normal, dot(sub(res.p, a), normal))
      setCursor({ ...res, p: add(a, delta) })
      setRoomPoints(d.roomId, d.orig.map((p, i) => (i === d.idx || i === (d.idx + 1) % n ? add(p, delta) : p)))
      return
    }
    if (d?.type === 'room') {
      let delta = sub(world, d.start)
      if (s.enabled) delta = alignMove(d.orig, delta, floor.rooms.filter((r) => r.id !== d.roomId), 8 / view.k)
      setRoomPoints(d.roomId, d.orig.map((p) => add(p, delta)))
      return
    }
    if (e.pointerType !== 'mouse') return
    if (editing && tool !== 'select') setCursor(snapFor(world, e))
    else if (cursor) setCursor(null)
    if (!editing || tool === 'select') {
      const hit = hitOf(e)
      setHover(hit ? `${hit.kind}:${hit.roomId}` : null)
    }
  }

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId)
    if (svgRef.current!.hasPointerCapture(e.pointerId)) svgRef.current!.releasePointerCapture(e.pointerId)
    const d = drag.current
    if (d?.type === 'pinch' || d?.type === 'idle') {
      drag.current = pointers.current.size ? { type: 'idle' } : null
      return
    }
    drag.current = null
    if (d?.type === 'pan' && !d.moved && d.tap !== undefined) props.onSelect(d.tap)
    if (d?.type === 'aim') {
      setCursor(null)
      place(snapFor(toWorld(e.clientX, e.clientY), e).p)
    }
    if (d?.type === 'vertex' && !d.started) setActiveVertex(d.idx)
    if (d?.type === 'vertex' || d?.type === 'edge' || d?.type === 'calib') setCursor(null)
  }

  const onPointerCancel = (e: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId)
    drag.current = pointers.current.size ? { type: 'idle' } : null
    setCursor(null)
  }

  const removeVertex = (idx: number) => {
    if (!selected || selected.points.length <= 3) return
    props.commit((f) => ({
      ...f,
      rooms: f.rooms.map((r) => (r.id === selected.id ? { ...r, points: r.points.filter((_, i) => i !== idx) } : r)),
    }))
    setActiveVertex(null)
  }

  const onDoubleClick = (e: ReactMouseEvent<SVGSVGElement>) => {
    // double taps are too easily triggered while placing points with a finger
    if (!editing || lastPointerType.current !== 'mouse') return
    if (tool === 'polygon') {
      finishPolygon()
      return
    }
    const hit = hitOf(e)
    if (tool === 'select' && hit?.kind === 'vertex') removeVertex(hit.idx)
  }

  // ---------- keyboard ----------

  const onKey = (e: KeyboardEvent) => {
    if (e.type === 'keyup') {
      if (e.code === 'Space') spaceDown.current = false
      return
    }
    if (isTyping(e.target)) return
    if (e.code === 'Space') {
      spaceDown.current = true
      e.preventDefault()
      return
    }
    if (!editing) return
    if (tool === 'polygon' && draft.length > 0) {
      if (/^[0-9.,]$/.test(e.key)) {
        setLengthInput((s) => s + (e.key === ',' ? '.' : e.key))
        e.preventDefault()
      } else if (e.key === 'Enter') {
        const l = parseFloat(lengthInput)
        if (lengthInput && l > 0) {
          const last = draft[draft.length - 1]
          const target = cursor?.p ?? last
          const dir = sub(target, last)
          if (len(dir) > 0) placePolygonPoint(add(last, mul(dir, l / len(dir))))
          setLengthInput('')
        } else {
          finishPolygon()
        }
        e.preventDefault()
      } else if (e.key === 'Backspace') {
        if (lengthInput) setLengthInput((s) => s.slice(0, -1))
        else setDraft((d) => d.slice(0, -1))
        e.preventDefault()
      } else if (e.key === 'Escape') {
        if (lengthInput) setLengthInput('')
        else setDraft([])
      }
      return
    }
    if (e.key === 'Escape') {
      setCalibStart(null)
      if (tool === 'select') props.onSelect(null)
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected && tool === 'select') {
      props.commit((f) => ({ ...f, rooms: f.rooms.filter((r) => r.id !== selected.id) }))
      props.onSelect(null)
      e.preventDefault()
    }
  }
  const keyRef = useRef(onKey)
  keyRef.current = onKey
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e)
    window.addEventListener('keydown', h)
    window.addEventListener('keyup', h)
    return () => {
      window.removeEventListener('keydown', h)
      window.removeEventListener('keyup', h)
    }
  }, [])

  // ---------- rendering ----------
  // Everything except the stencil is drawn in canvas pixels rather than inside a scaled group,
  // so lines and text are rasterized at their final size and stay sharp at any zoom.

  const k = view.k
  const S = toScreen
  const pointsAttr = (pts: Vec[]) => pts.map(S).map((p) => `${p.x},${p.y}`).join(' ')
  const showHandles = editing && tool === 'select' && selected
  const drawing = editing && tool !== 'select'

  const floorEls: ReactNode[] = []
  const labelEls: ReactNode[] = []
  floor.rooms.forEach((room) => {
    const isSel = room.id === selectedId
    const isHover = hover?.endsWith(room.id)
    const lp = S(labelPoint(room.points))
    const open = props.openTodoCount(room)
    // the small map outside the editor has no room for labels of small rooms
    const rb = bounds(room.points.map(S))
    const showName = editing || (rb.maxX - rb.minX > room.name.length * 7 + 8 && rb.maxY - rb.minY > 40)
    // with walls, labels float at half wall height
    if (pitch > 0) lp.y -= (WALL_H * k * ps) / 2
    const badgeY = showName ? lp.y + 14 : lp.y
    floorEls.push(
      <polygon
        key={room.id}
        data-hit={`room:${room.id}`}
        points={pointsAttr(room.points)}
        fill={room.color}
        // outside the editor, rooms with open TODOs stand out as hot spots
        fillOpacity={editing ? (isSel ? 0.5 : 0.35) : isSel ? 0.85 : (open ? 0.6 : 0.2) + (isHover ? 0.15 : 0)}
        stroke={isSel ? 'var(--color-accent)' : editing ? '#44403c' : '#78716c'}
        strokeWidth={isSel ? 2.5 : editing ? 1.25 : 1.5}
        strokeLinejoin="round"
        className={drawing ? 'pointer-events-none' : 'cursor-pointer'}
      />,
    )
    labelEls.push(
      <g key={room.id}>
        {showName && <text
          x={lp.x}
          y={lp.y}
          fontSize={13}
          textAnchor="middle"
          className="pointer-events-none select-none fill-stone-800 font-medium"
          style={{ paintOrder: 'stroke', stroke: 'white', strokeWidth: 3, strokeOpacity: 0.8 }}
        >
          {room.name}
          {editing && (
            <tspan x={lp.x} dy={15} fontSize={11} className="fill-stone-600 font-normal">
              {fmtArea(area(room.points))}
            </tspan>
          )}
        </text>}
        {!editing && open > 0 && (
          <g className="pointer-events-none">
            <circle cx={lp.x} cy={badgeY} r={9} className="fill-amber-500" />
            <text
              x={lp.x} y={badgeY} fontSize={11} textAnchor="middle" dominantBaseline="central"
              className="select-none fill-white font-semibold"
            >
              {open}
            </text>
          </g>
        )}
      </g>,
    )
  })

  // Half-height walls on every room edge, painted back to front (by the edge's screen height).
  const wallH = WALL_H * k * ps
  const wallEls =
    pitch > 0
      ? floor.rooms
          .flatMap((room) =>
            room.points.map((p, i) => {
              const a = S(p)
              const b = S(room.points[(i + 1) % room.points.length])
              return { room, i, a, b, depth: a.y + b.y }
            }),
          )
          .sort((u, v) => u.depth - v.depth)
          .map(({ room, i, a, b }) => {
            // light falls from the left: walls running steeply on screen are darker
            const e = sub(b, a)
            const shade = 0.55 + (0.35 * Math.abs(e.x)) / (len(e) || 1)
            return (
              <polygon
                key={`${room.id}:${i}`}
                data-hit={`room:${room.id}`}
                points={`${a.x},${a.y} ${b.x},${b.y} ${b.x},${b.y - wallH} ${a.x},${a.y - wallH}`}
                fill={`hsl(30 8% ${Math.round(shade * 100)}%)`}
                stroke={room.id === selectedId ? 'var(--color-accent)' : '#57534e'}
                strokeWidth={room.id === selectedId ? 2 : 1}
                strokeLinejoin="round"
                className="cursor-pointer"
              />
            )
          })
      : null

  let handleEls: ReactNode = null
  if (showHandles && selected) {
    const pts = selected.points.map(S)
    const c = S(labelPoint(selected.points))
    handleEls = (
      <g>
        {pts.map((a, i) => {
          const b = pts[(i + 1) % pts.length]
          const m = mid(a, b)
          const e1 = sub(b, a)
          const l = len(e1)
          // label offset to the outside (polygons may be either winding)
          const n = l ? { x: -e1.y / l, y: e1.x / l } : { x: 0, y: 0 }
          const out = dot(sub(m, c), n) > 0 ? n : mul(n, -1)
          const lpos = add(m, mul(out, 14))
          return (
            <g key={i}>
              <line
                data-hit={`edge:${selected.id}:${i}`}
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke="transparent" strokeWidth={18}
                style={{ cursor: Math.abs(e1.x) > Math.abs(e1.y) ? 'ns-resize' : 'ew-resize' }}
              />
              <text
                x={lpos.x} y={lpos.y} fontSize={11} textAnchor="middle" dominantBaseline="middle"
                className="pointer-events-none select-none fill-accent-strong"
                style={{ paintOrder: 'stroke', stroke: 'white', strokeWidth: 3 }}
              >
                {fmtLen(l / k)}
              </text>
              <g data-hit={`mid:${selected.id}:${i}`} className="group cursor-copy">
                <circle cx={m.x} cy={m.y} r={12} fill="transparent" />
                <circle
                  cx={m.x} cy={m.y} r={4.5}
                  className="fill-white stroke-blue-500 opacity-60 group-hover:opacity-100"
                  strokeWidth={1.5}
                />
              </g>
            </g>
          )
        })}
        {pts.map((p, i) => (
          <g key={`v${i}`} data-hit={`vertex:${selected.id}:${i}`} className="cursor-move">
            <circle cx={p.x} cy={p.y} r={16} fill="transparent" />
            <circle
              cx={p.x} cy={p.y} r={i === activeVertex ? 8 : 6}
              className={i === activeVertex ? 'fill-accent stroke-white' : 'fill-white stroke-accent'}
              strokeWidth={2}
            />
          </g>
        ))}
      </g>
    )
  }

  const guideEls = (cursor?.guides ?? []).map((g: Guide, i) => {
    const a = S(g.a)
    const b = S(g.b)
    return g.kind === 'ref' ? (
      <line
        key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
        stroke="#0891b2" strokeOpacity={0.5} strokeWidth={9} strokeLinecap="round"
        className="pointer-events-none"
      />
    ) : (
      <line
        key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
        stroke="#0891b2" strokeWidth={1} strokeDasharray="4 3"
        className="pointer-events-none"
      />
    )
  })

  let draftEls: ReactNode = null
  const cp = cursor?.p
  if (drawing && tool === 'polygon' && draft.length) {
    const last = draft[draft.length - 1]
    const pts = cp ? [...draft, cp] : draft
    // a path into a room from its wall will split it rather than become a room
    const target = cutRoom(pts)
    draftEls = (
      <g className="pointer-events-none">
        {target ? (
          <polygon points={pointsAttr(target.points)} fill="none" stroke="#0891b2" strokeWidth={3} strokeDasharray="6 4" />
        ) : draft.length >= 2 && (
          <polygon points={pointsAttr(pts)} fill="#3b82f6" fillOpacity={0.12} stroke="none" />
        )}
        <polyline points={pointsAttr(pts)} fill="none" stroke="#2563eb" strokeWidth={2} />
        {draft.map(S).map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={i === 0 ? 6 : 4} className={i === 0 ? 'fill-accent' : 'fill-white stroke-accent'} strokeWidth={1.5} />
        ))}
        {cp && <MeasureLabel a={last} b={cp} toScreen={S} text={lengthInput ? `${lengthInput} m ⏎` : undefined} />}
      </g>
    )
  }

  // The scale line. Its placed ends are handles that can be dragged to fine-tune them.
  const calibDragging = drag.current?.type === 'calib'
  const calibLine: Vec[] | null =
    calibPts.length === 2 ? calibPts
    : calibStart && cp && drawing && tool === 'calibrate' && !calibDragging ? [calibStart, cp]
    : null
  const calibEls = calibPts.length > 0 && (
    <g>
      {calibLine && (() => {
        const [a, b] = calibLine.map(S)
        return (
          <g className="pointer-events-none">
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="white" strokeOpacity={0.8} strokeWidth={5} strokeLinecap="round" />
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#ea580c" strokeWidth={2} />
            <MeasureLabel a={calibLine[0]} b={calibLine[1]} toScreen={S} />
          </g>
        )
      })()}
      {calibPts.map(S).map((p, i) => (
        <g key={i} data-hit={`calib::${i}`} className="cursor-move">
          <circle cx={p.x} cy={p.y} r={22} fill="transparent" />
          <circle cx={p.x} cy={p.y} r={9} fill="white" fillOpacity={0.35} stroke="#ea580c" strokeWidth={2} />
          <circle cx={p.x} cy={p.y} r={1.75} fill="#ea580c" />
        </g>
      ))}
    </g>
  )

  const cursorEl = (drawing || calibDragging) && cp && cursor && (() => {
    const c = S(cp)
    return (
      <g className="pointer-events-none">
        {cursor.kind === 'vertex' ? (
          <rect x={c.x - 6} y={c.y - 6} width={12} height={12} fill="none" stroke="#0891b2" strokeWidth={2} />
        ) : cursor.kind === 'edge' ? (
          <path d={`M${c.x - 6},${c.y + 5} L${c.x},${c.y - 6} L${c.x + 6},${c.y + 5} Z`} fill="none" stroke="#0891b2" strokeWidth={2} />
        ) : calibDragging ? null : (
          <circle cx={c.x} cy={c.y} r={3.5} fill={cursor.kind === 'none' ? 'var(--color-accent)' : '#0891b2'} />
        )}
      </g>
    )
  })()

  const svgCursor = drag.current?.type === 'pan' ? 'grabbing' : drawing ? 'crosshair' : 'default'

  // On-screen versions of the keyboard/double-click actions, needed on touch devices.
  const actions: { label: string; onClick: () => void; primary?: boolean; disabled?: boolean }[] = []
  if (drawing && tool === 'polygon' && draft.length) {
    actions.push(
      { label: 'Undo point', onClick: () => setDraft((d) => d.slice(0, -1)) },
      // a path that is splitting a room ends on a wall rather than being closed
      { label: 'Finish room', onClick: finishPolygon, primary: true, disabled: draft.length < 3 || !!cutRoom(draft) },
      { label: 'Cancel', onClick: () => setDraft([]) },
    )
  } else if (drawing && tool === 'calibrate' && calibStart) {
    actions.push({ label: 'Cancel', onClick: () => setCalibStart(null) })
  } else if (showHandles && activeVertex !== null && selected && selected.points.length > 3) {
    actions.push({ label: 'Remove corner', onClick: () => removeVertex(activeVertex) })
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-[radial-gradient(circle,#d6d3d1_1px,transparent_1px)] [background-size:20px_20px]">
      <svg
        ref={svgRef}
        className="h-full w-full touch-none select-none"
        style={{ cursor: svgCursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={() => !drag.current && setCursor(null)}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      >
        {bd && props.imageUrl && props.showBackdrop && (
          <g transform={`matrix(1 0 0 ${pc} 0 ${(size.h / 2) * (1 - pc)}) translate(${view.tx} ${view.ty}) rotate(${(view.r * 180) / Math.PI}) scale(${k})`}>
            <image
              href={props.imageUrl}
              x={bd.x} y={bd.y} width={bd.width * bd.scale} height={bd.height * bd.scale}
              transform={backdropTransform(bd)}
              opacity={bd.opacity} preserveAspectRatio="none" className="pointer-events-none"
            />
          </g>
        )}
        {floorEls}
        {wallEls}
        {labelEls}
        {handleEls}
        {guideEls}
        {draftEls}
        {calibEls}
        {cursorEl}
      </svg>

      {actions.length > 0 && (
        <div className="absolute inset-x-0 bottom-14 flex justify-center px-3">
          <div className="flex gap-1 rounded-xl border border-line-strong bg-surface p-1 shadow-md">
            {actions.map((a) => (
              <button
                key={a.label}
                onClick={a.onClick}
                disabled={a.disabled}
                className={`rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-40 ${a.primary ? 'bg-accent text-white' : 'text-ink-soft hover:bg-canvas'}`}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {(editing || !isFitted || rotated) && (
        <div className="absolute bottom-3 right-3 flex flex-col overflow-hidden rounded-lg border border-line-strong bg-surface shadow-sm">
          {editing && (
            <>
              <ZoomButton label="+" onClick={() => zoomAt(size.w / 2, size.h / 2, 1.25)} />
              <ZoomButton label="−" onClick={() => zoomAt(size.w / 2, size.h / 2, 0.8)} />
            </>
          )}
          {rotated && (
            <ZoomButton
              label={<span className="inline-block font-semibold text-danger" style={{ transform: `rotate(${view.r}rad)` }}>↑</span>}
              title="Reset rotation"
              onClick={resetRotation}
            />
          )}
          {!isFitted && <ZoomButton label="⤢" title="Fit to content" onClick={() => fitToContent()} />}
        </div>
      )}
      {editing && <ScaleBar k={k} />}
    </div>
  )
}

/**
 * Shift a moving polygon so one of its corners lines up with another room's,
 * along the plan's two main wall directions (not the screen axes).
 */
function alignMove(orig: Vec[], delta: Vec, others: Room[], tol: number): Vec {
  const edges = others.flatMap((r) => r.points.map((p, i) => [p, r.points[(i + 1) % r.points.length]] as [Vec, Vec]))
  if (!edges.length) return delta
  let out = delta
  for (const n of mainFrame(edges)) {
    let best: number | null = null
    for (const p of orig) {
      const q = add(p, delta)
      for (const r of others) {
        for (const v of r.points) {
          const off = dot(sub(v, q), n)
          if (Math.abs(off) < tol && (best === null || Math.abs(off) < Math.abs(best))) best = off
        }
      }
    }
    if (best !== null) out = add(out, mul(n, best))
  }
  return out
}

/** Length of the world segment a–b, shown just above its middle on screen. */
function MeasureLabel({ a, b, toScreen, text }: { a: Vec; b: Vec; toScreen: (p: Vec) => Vec; text?: string }) {
  const sa = toScreen(a)
  const sb = toScreen(b)
  const m = mid(sa, sb)
  if (dist(sa, sb) < 20 && !text) return null
  return (
    <text
      x={m.x} y={m.y - 10} fontSize={12} textAnchor="middle"
      className="pointer-events-none select-none fill-blue-800 font-semibold"
      style={{ paintOrder: 'stroke', stroke: 'white', strokeWidth: 4 }}
    >
      {text ?? fmtLen(dist(a, b))}
    </text>
  )
}

function ZoomButton({ label, title, onClick }: { label: ReactNode; title?: string; onClick: () => void }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="h-9 w-9 border-b border-line text-muted last:border-b-0 hover:bg-canvas"
    >
      {label}
    </button>
  )
}

function ScaleBar({ k }: { k: number }) {
  // pick a "nice" length that is 60–150px on screen
  const nice = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50, 100]
  const m = nice.find((n) => n * k >= 60) ?? 100
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 text-[11px] text-muted">
      <div className="h-1.5 border-x-2 border-b-2 border-stone-600" style={{ width: m * k }} />
      <div className="mt-0.5">{m < 1 ? `${m * 100} cm` : `${m} m`}</div>
    </div>
  )
}
