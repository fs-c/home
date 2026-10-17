import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import {
  add, area, boundaryParam, bounds, cleanPolygon, dist, dot, fmtArea, fmtLen, labelPoint, len, mid, mul,
  pointInPolygon, projectOnSegment, splitPolygon, sub,
} from '../lib/geometry'
import { isTyping } from '../lib/dom'
import { nextRoomColor, nextRoomName } from '../model/doc'
import { uid } from '../model/ids'
import type { Floor, Room, Vec } from '../model/types'
import { mainFrame, snapPoint, targetsFrom, type Guide, type SnapResult, type SnapSettings } from './snapping'
import { backdropCorners, backdropTransform } from '../model/backdrop'

export type Tool = 'select' | 'polygon' | 'rect' | 'split' | 'calibrate'
export type Mode = 'plan' | 'home'

interface View {
  tx: number
  ty: number
  /** Screen pixels per meter. */
  k: number
}

type Drag =
  /** `tap`: what to select if the pointer is released without panning (null = nothing). */
  | { type: 'pan'; sx: number; sy: number; view: View; tap?: string | null; moved?: boolean }
  /** Two-finger zoom/pan; `m0` is the start midpoint relative to the canvas. */
  | { type: 'pinch'; d0: number; m0: Vec; view: View }
  /** Touch drawing: the point follows the finger and is placed on release. */
  | { type: 'aim' }
  /** After a pinch, until all fingers are lifted. */
  | { type: 'idle' }
  | { type: 'vertex'; roomId: string; idx: number; started: boolean; sx: number; sy: number }
  | { type: 'edge'; roomId: string; idx: number; start: Vec; orig: Vec[]; started: boolean; sx: number; sy: number }
  | { type: 'room'; roomId: string; start: Vec; orig: Vec[]; started: boolean; sx: number; sy: number }
  | { type: 'rect'; sx: number; sy: number }  // dragging the first wall of a rectangle

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
  onMessage: (msg: string) => void
  commit: (fn: (f: Floor) => Floor) => void
  replace: (fn: (f: Floor) => Floor) => void
  checkpoint: () => void
  openTodoCount: (room: Room) => number
}

const DRAG_THRESHOLD = 3

export function PlanCanvas(props: Props) {
  const { floor, mode, tool, selectedId, snap } = props
  const bd = floor.backdrop
  const svgRef = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [view, setView] = useState<View>({ tx: 40, ty: 40, k: 50 })
  const [cursor, setCursor] = useState<SnapResult | null>(null)
  const [draft, setDraft] = useState<Vec[]>([])
  /** Rectangle tool: first wall (1–2 points), then depth. */
  const [rectPts, setRectPts] = useState<Vec[]>([])
  const [calibStart, setCalibStart] = useState<Vec | null>(null)
  /** Split tool: the cut being drawn (starts and ends on a wall of one room). */
  const [cut, setCut] = useState<Vec[]>([])
  const [lengthInput, setLengthInput] = useState('')
  const [hover, setHover] = useState<string | null>(null)
  /** Select tool: a corner tapped without dragging, offered for removal. */
  const [activeVertex, setActiveVertex] = useState<number | null>(null)
  const drag = useRef<Drag | null>(null)
  const pointers = useRef(new Map<number, Vec>())
  const lastPointerType = useRef('mouse')
  const spaceDown = useRef(false)

  const editing = mode === 'plan'
  const selected = floor.rooms.find((r) => r.id === selectedId) ?? null

  // Reset transient drawing state when the tool or floor changes.
  useEffect(() => {
    setDraft([])
    setRectPts([])
    setCalibStart(null)
    setCut([])
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
    if (!pts.length) return { tx: size.w / 2 - 250, ty: size.h / 2 - 200, k: 50 }
    const b = bounds(pts)
    const pad = editing ? 48 : 12
    const k = Math.min((size.w - pad * 2) / Math.max(b.maxX - b.minX, 0.5), (size.h - pad * 2) / Math.max(b.maxY - b.minY, 0.5))
    return {
      k,
      tx: (size.w - (b.maxX - b.minX) * k) / 2 - b.minX * k,
      ty: (size.h - (b.maxY - b.minY) * k) / 2 - b.minY * k,
    }
  }

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
  }, [size.w, size.h])

  const fitted = computeFit()
  const isFitted = !fitted || (Math.abs(view.k / fitted.k - 1) < 0.01 && Math.abs(view.tx - fitted.tx) < 2 && Math.abs(view.ty - fitted.ty) < 2)

  const zoomAt = (sx: number, sy: number, factor: number) => {
    autoFit.current = false
    setView((v) => {
      const k = Math.min(5000, Math.max(2, v.k * factor))
      const f = k / v.k
      return { k, tx: sx - (sx - v.tx) * f, ty: sy - (sy - v.ty) * f }
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
    return { x: (clientX - r.left - view.tx) / view.k, y: (clientY - r.top - view.ty) / view.k }
  }

  // ---------- snapping ----------

  const snapSettings = (e: { shiftKey: boolean; altKey: boolean }): SnapSettings => ({
    enabled: snap.enabled && !e.altKey,
    angles: snap.angles !== e.shiftKey,
  })

  const allTargets = (extraVertices: Vec[] = [], extraEdges: [Vec, Vec][] = []) =>
    targetsFrom(floor.rooms.map((r) => r.points), extraVertices, extraEdges)

  const openEdges = (pts: Vec[]) => pts.slice(1).map((p, i) => [pts[i], p] as [Vec, Vec])

  /** Rectangle depth direction: perpendicular to the first wall. */
  const rectNormal = (a: Vec, b: Vec) => {
    const l = dist(a, b)
    return { x: -(b.y - a.y) / l, y: (b.x - a.x) / l }
  }

  const snapFor = (raw: Vec, e: { shiftKey: boolean; altKey: boolean }): SnapResult => {
    const s = snapSettings(e)
    if (tool === 'polygon') {
      const close = draft.length >= 2 ? draft[0] : undefined
      return snapPoint(raw, allTargets(draft, openEdges(draft)), view.k, s, draft[draft.length - 1], undefined, close)
    }
    if (tool === 'rect') {
      if (rectPts.length === 2) {
        const [a, b] = rectPts
        return snapPoint(raw, allTargets([], [[a, b]]), view.k, s, b, rectNormal(a, b))
      }
      return snapPoint(raw, allTargets(), view.k, s, rectPts[0])
    }
    if (tool === 'calibrate') return snapPoint(raw, allTargets(), view.k, s, calibStart ?? undefined)
    if (tool === 'split') return snapPoint(raw, allTargets(cut, openEdges(cut)), view.k, s, cut[cut.length - 1])
    return { p: raw, kind: 'none', guides: [] }
  }

  /** The room a cut goes through: starts on its wall, first segment runs inside it. */
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

  const placeCutPoint = (placed: Vec) => {
    let p = placed
    if (!cut.length) {
      p = ontoWall(p, floor.rooms)
      if (!floor.rooms.some((r) => boundaryParam(r.points, p) !== null)) {
        props.onMessage('Start the cut on a wall of a room (it snaps when you get close).')
        return
      }
      setCut([p])
      return
    }
    let next = [...cut, p]
    const room = cutRoom(next)
    if (!room) {
      props.onMessage('The cut has to run through the inside of a room.')
      return
    }
    p = ontoWall(p, [room])
    next = [...cut, p]
    if (boundaryParam(room.points, p) === null) {
      if (pointInPolygon(p, room.points)) setCut(next)
      else props.onMessage('Keep the cut inside the room, and finish it on a wall.')
      return
    }
    const pieces = splitPolygon(room.points, next)
    if (!pieces) {
      props.onMessage("Can't split along that line – it must stay inside the room.")
      return
    }
    // The bigger piece keeps the room's identity (name, notes, colour).
    const [big, small] = area(pieces[0]) >= area(pieces[1]) ? pieces : [pieces[1], pieces[0]]
    const newRoom: Room = { id: uid(), name: nextRoomName(floor), color: nextRoomColor(floor), points: small, items: [] }
    props.commit((f) => ({
      ...f,
      rooms: f.rooms.flatMap((r) => (r.id === room.id ? [{ ...r, points: big }, newRoom] : [r])),
    }))
    props.onSelect(newRoom.id)
    setCut([])
    props.onMessage(`Split "${room.name}" into ${fmtArea(area(big))} and ${fmtArea(area(small))} (${newRoom.name}).`)
  }

  /** The rectangle being drawn, once its first wall exists. */
  const rectPreview = (cp: Vec | undefined): Vec[] | null => {
    if (rectPts.length === 1 && cp) return [rectPts[0], cp]
    if (rectPts.length !== 2 || !cp) return null
    const [a, b] = rectPts
    const n = rectNormal(a, b)
    const depth = mul(n, dot(sub(cp, b), n))
    return [a, b, add(b, depth), add(a, depth)]
  }

  // ---------- mutations ----------

  const addRoom = (points: Vec[]) => {
    const pts = cleanPolygon(points, 1e-4)
    if (pts.length < 3 || area(pts) < 0.05) {
      props.onMessage('That shape is too small to be a room.')
      return
    }
    const room: Room = { id: uid(), name: nextRoomName(floor), color: nextRoomColor(floor), points: pts, items: [] }
    props.commit((f) => ({ ...f, rooms: [...f.rooms, room] }))
    props.onSelect(room.id)
  }

  const setRoomPoints = (roomId: string, points: Vec[]) =>
    props.replace((f) => ({ ...f, rooms: f.rooms.map((r) => (r.id === roomId ? { ...r, points } : r)) }))

  const finishPolygon = () => {
    if (draft.length >= 3) addRoom(draft)
    setDraft([])
    setLengthInput('')
  }

  const placePolygonPoint = (p: Vec) => {
    const last = draft[draft.length - 1]
    if (draft.length >= 3 && dist(p, draft[0]) < 1e-6) {
      finishPolygon()
      return
    }
    if (last && dist(p, last) < 1e-6) return
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
    // Whatever the first finger started (a tap, a point being placed) is abandoned.
    drag.current = { type: 'pinch', d0: Math.max(dist(a, b), 1), m0: relative(mid(a, b)), view }
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
      place(snapped.p, e)
    } else {
      setCursor(snapped)
      drag.current = { type: 'aim' }
    }
  }

  /** Place a point with the current drawing tool. */
  const place = (p: Vec, e?: ReactPointerEvent) => {
    if (tool === 'polygon') {
      placePolygonPoint(p)
    } else if (tool === 'rect') {
      if (rectPts.length === 2) {
        finishRect(rectPreview(p)!)
      } else if (rectPts.length === 1) {
        if (dist(rectPts[0], p) > 1e-6) setRectPts([rectPts[0], p])
      } else {
        setRectPts([p])
        // with a mouse, the first wall can also be dragged out
        if (e) drag.current = { type: 'rect', sx: e.clientX, sy: e.clientY }
      }
    } else if (tool === 'calibrate') {
      if (!bd) {
        props.onMessage('Upload a floor plan first.')
      } else if (calibStart) {
        if (dist(calibStart, p) > 1e-6) props.onCalibrate(calibStart, p)
        setCalibStart(null)
      } else {
        setCalibStart(p)
      }
    } else if (tool === 'split') {
      placeCutPoint(p)
    }
  }

  const finishRect = (pts: Vec[]) => {
    setRectPts([])
    if (dist(pts[1], pts[2]) < 1e-3) return
    addRoom(pts)
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
      // keep the world point that was under the fingers' midpoint under it
      autoFit.current = false
      setView({
        k,
        tx: m.x - ((d.m0.x - d.view.tx) / d.view.k) * k,
        ty: m.y - ((d.m0.y - d.view.ty) / d.view.k) * k,
      })
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
      props.checkpoint()
      d.started = true
    }
    const s = snapSettings(e)
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
    if (d?.type === 'vertex' || d?.type === 'edge') setCursor(null)
    if (d?.type === 'rect' && rectPts.length === 1 && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > DRAG_THRESHOLD) {
      setRectPts([rectPts[0], snapFor(toWorld(e.clientX, e.clientY), e).p])
    }
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
    if (tool === 'split' && cut.length > 0) {
      if (e.key === 'Backspace') {
        setCut((c) => c.slice(0, -1))
        e.preventDefault()
      } else if (e.key === 'Escape') {
        setCut([])
      }
      return
    }
    if (e.key === 'Escape') {
      setRectPts([])
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

  const k = view.k
  const px = (n: number) => n / k
  const showHandles = editing && tool === 'select' && selected
  const drawing = editing && tool !== 'select'

  const roomEls = floor.rooms.map((room) => {
    const isSel = room.id === selectedId
    const isHover = hover?.endsWith(room.id)
    const lp = labelPoint(room.points)
    const open = props.openTodoCount(room)
    // the small map outside the editor has no room for labels of small rooms
    const rb = bounds(room.points)
    const showName = editing || ((rb.maxX - rb.minX) * k > room.name.length * 7 + 8 && (rb.maxY - rb.minY) * k > 40)
    const badgeY = showName ? lp.y + px(14) : lp.y
    return (
      <g key={room.id}>
        <polygon
          data-hit={`room:${room.id}`}
          points={room.points.map((p) => `${p.x},${p.y}`).join(' ')}
          fill={room.color}
          // outside the editor, rooms with open TODOs stand out as hot spots
          fillOpacity={editing ? (isSel ? 0.5 : 0.35) : isSel ? 0.85 : (open ? 0.6 : 0.2) + (isHover ? 0.15 : 0)}
          stroke={isSel ? '#2563eb' : editing ? '#44403c' : '#78716c'}
          strokeWidth={isSel ? 2.5 : editing ? 1.25 : 1.5}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          className={drawing ? 'pointer-events-none' : 'cursor-pointer'}
        />
        {showName && <text
          x={lp.x}
          y={lp.y}
          fontSize={px(13)}
          textAnchor="middle"
          className="pointer-events-none select-none fill-stone-800 font-medium"
          style={{ paintOrder: 'stroke', stroke: 'white', strokeWidth: px(3), strokeOpacity: 0.8 }}
        >
          {room.name}
          {editing && (
            <tspan x={lp.x} dy={px(15)} fontSize={px(11)} className="fill-stone-600 font-normal">
              {fmtArea(area(room.points))}
            </tspan>
          )}
        </text>}
        {!editing && open > 0 && (
          <g className="pointer-events-none">
            <circle cx={lp.x} cy={badgeY} r={px(9)} className="fill-amber-500" />
            <text
              x={lp.x} y={badgeY} fontSize={px(11)} textAnchor="middle" dominantBaseline="central"
              className="select-none fill-white font-semibold"
            >
              {open}
            </text>
          </g>
        )}
      </g>
    )
  })

  let handleEls: ReactNode = null
  if (showHandles && selected) {
    const pts = selected.points
    handleEls = (
      <g>
        {pts.map((a, i) => {
          const b = pts[(i + 1) % pts.length]
          const m = mid(a, b)
          const e1 = sub(b, a)
          const l = len(e1)
          // label offset to the outside (polygons may be either winding)
          const n = l ? { x: -e1.y / l, y: e1.x / l } : { x: 0, y: 0 }
          const c = labelPoint(pts)
          const out = dot(sub(m, c), n) > 0 ? n : mul(n, -1)
          const lpos = add(m, mul(out, px(14)))
          return (
            <g key={i}>
              <line
                data-hit={`edge:${selected.id}:${i}`}
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke="transparent" strokeWidth={18} vectorEffect="non-scaling-stroke"
                style={{ cursor: Math.abs(e1.x) > Math.abs(e1.y) ? 'ns-resize' : 'ew-resize' }}
              />
              <text
                x={lpos.x} y={lpos.y} fontSize={px(11)} textAnchor="middle" dominantBaseline="middle"
                className="pointer-events-none select-none fill-blue-700"
                style={{ paintOrder: 'stroke', stroke: 'white', strokeWidth: px(3) }}
              >
                {fmtLen(l)}
              </text>
              <g data-hit={`mid:${selected.id}:${i}`} className="group cursor-copy">
                <circle cx={m.x} cy={m.y} r={px(12)} fill="transparent" />
                <circle
                  cx={m.x} cy={m.y} r={px(4.5)}
                  className="fill-white stroke-blue-500 opacity-60 group-hover:opacity-100"
                  strokeWidth={1.5} vectorEffect="non-scaling-stroke"
                />
              </g>
            </g>
          )
        })}
        {pts.map((p, i) => (
          <g key={`v${i}`} data-hit={`vertex:${selected.id}:${i}`} className="cursor-move">
            <circle cx={p.x} cy={p.y} r={px(16)} fill="transparent" />
            <circle
              cx={p.x} cy={p.y} r={px(i === activeVertex ? 8 : 6)}
              className={i === activeVertex ? 'fill-blue-600 stroke-white' : 'fill-white stroke-blue-600'}
              strokeWidth={2} vectorEffect="non-scaling-stroke"
            />
          </g>
        ))}
      </g>
    )
  }

  const guideEls = (cursor?.guides ?? []).map((g: Guide, i) =>
    g.kind === 'ref' ? (
      <line
        key={i} x1={g.a.x} y1={g.a.y} x2={g.b.x} y2={g.b.y}
        stroke="#0891b2" strokeOpacity={0.5} strokeWidth={9} strokeLinecap="round" vectorEffect="non-scaling-stroke"
        className="pointer-events-none"
      />
    ) : (
      <line
        key={i} x1={g.a.x} y1={g.a.y} x2={g.b.x} y2={g.b.y}
        stroke="#0891b2" strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke"
        className="pointer-events-none"
      />
    ),
  )

  let draftEls: ReactNode = null
  const cp = cursor?.p
  if (drawing && tool === 'polygon' && draft.length) {
    const last = draft[draft.length - 1]
    const pts = cp ? [...draft, cp] : draft
    draftEls = (
      <g className="pointer-events-none">
        {draft.length >= 2 && (
          <polygon points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="#3b82f6" fillOpacity={0.12} stroke="none" />
        )}
        <polyline
          points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none" stroke="#2563eb" strokeWidth={2} vectorEffect="non-scaling-stroke"
        />
        {draft.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={px(i === 0 ? 6 : 4)} className={i === 0 ? 'fill-blue-600' : 'fill-white stroke-blue-600'} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        ))}
        {cp && <MeasureLabel a={last} b={cp} k={k} text={lengthInput ? `${lengthInput} m ⏎` : undefined} />}
      </g>
    )
  } else if (drawing && tool === 'rect' && rectPreview(cp)) {
    const pts = rectPreview(cp)!
    draftEls = (
      <g className="pointer-events-none">
        <polygon
          points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="#3b82f6" fillOpacity={0.12} stroke="#2563eb" strokeWidth={2} vectorEffect="non-scaling-stroke"
        />
        <MeasureLabel a={pts[0]} b={pts[1]} k={k} />
        {pts.length === 4 && <MeasureLabel a={pts[1]} b={pts[2]} k={k} />}
      </g>
    )
  }

  if (drawing && tool === 'split' && cut.length) {
    const pts = cp ? [...cut, cp] : cut
    const target = cutRoom(pts)
    draftEls = (
      <g className="pointer-events-none">
        {target && (
          <polygon
            points={target.points.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none" stroke="#0891b2" strokeWidth={3} strokeDasharray="6 4" vectorEffect="non-scaling-stroke"
          />
        )}
        <polyline
          points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none" stroke="#dc2626" strokeWidth={2.5} strokeDasharray="8 4" vectorEffect="non-scaling-stroke"
        />
        {cut.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={px(4)} className="fill-white stroke-red-600" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        ))}
        {cp && <MeasureLabel a={cut[cut.length - 1]} b={cp} k={k} />}
      </g>
    )
  }

  const calib = props.pendingCalibration ?? (calibStart && cp ? [calibStart, cp] as [Vec, Vec] : null)
  const calibEls = calib && (
    <g className="pointer-events-none">
      <line
        x1={calib[0].x} y1={calib[0].y} x2={calib[1].x} y2={calib[1].y}
        stroke="#ea580c" strokeWidth={2.5} vectorEffect="non-scaling-stroke"
      />
      {calib.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={px(5)} className="fill-orange-500" />
      ))}
    </g>
  )

  const cursorEl = drawing && cp && cursor && (
    <g className="pointer-events-none">
      {cursor.kind === 'vertex' ? (
        <rect x={cp.x - px(6)} y={cp.y - px(6)} width={px(12)} height={px(12)} fill="none" stroke="#0891b2" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      ) : cursor.kind === 'edge' ? (
        <path d={`M${cp.x - px(6)},${cp.y + px(5)} L${cp.x},${cp.y - px(6)} L${cp.x + px(6)},${cp.y + px(5)} Z`} fill="none" stroke="#0891b2" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      ) : (
        <circle cx={cp.x} cy={cp.y} r={px(3.5)} fill={cursor.kind === 'none' ? '#2563eb' : '#0891b2'} />
      )}
    </g>
  )

  const svgCursor = drag.current?.type === 'pan' ? 'grabbing' : drawing ? 'crosshair' : 'default'

  // On-screen versions of the keyboard/double-click actions, needed on touch devices.
  const actions: { label: string; onClick: () => void; primary?: boolean; disabled?: boolean }[] = []
  if (drawing && tool === 'polygon' && draft.length) {
    actions.push(
      { label: 'Undo point', onClick: () => setDraft((d) => d.slice(0, -1)) },
      { label: 'Finish room', onClick: finishPolygon, primary: true, disabled: draft.length < 3 },
      { label: 'Cancel', onClick: () => setDraft([]) },
    )
  } else if (drawing && tool === 'split' && cut.length) {
    actions.push({ label: 'Undo point', onClick: () => setCut((c) => c.slice(0, -1)) }, { label: 'Cancel', onClick: () => setCut([]) })
  } else if (drawing && tool === 'rect' && rectPts.length) {
    actions.push({ label: 'Cancel', onClick: () => setRectPts([]) })
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
        <g transform={`translate(${view.tx} ${view.ty}) scale(${k})`}>
          {bd && props.imageUrl && props.showBackdrop && (
            <image
              href={props.imageUrl}
              x={bd.x} y={bd.y} width={bd.width * bd.scale} height={bd.height * bd.scale}
              transform={backdropTransform(bd)}
              opacity={bd.opacity} preserveAspectRatio="none" className="pointer-events-none"
            />
          )}
          {roomEls}
          {handleEls}
          {guideEls}
          {draftEls}
          {calibEls}
          {cursorEl}
        </g>
      </svg>

      {actions.length > 0 && (
        <div className="absolute inset-x-0 bottom-14 flex justify-center px-3">
          <div className="flex gap-1 rounded-xl border border-stone-300 bg-white p-1 shadow-md">
            {actions.map((a) => (
              <button
                key={a.label}
                onClick={a.onClick}
                disabled={a.disabled}
                className={`rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-40 ${a.primary ? 'bg-blue-600 text-white' : 'text-stone-700 hover:bg-stone-100'}`}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {(editing || !isFitted) && (
        <div className="absolute bottom-3 right-3 flex flex-col overflow-hidden rounded-lg border border-stone-300 bg-white shadow-sm">
          {editing && (
            <>
              <ZoomButton label="+" onClick={() => zoomAt(size.w / 2, size.h / 2, 1.25)} />
              <ZoomButton label="−" onClick={() => zoomAt(size.w / 2, size.h / 2, 0.8)} />
            </>
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

function MeasureLabel({ a, b, k, text }: { a: Vec; b: Vec; k: number; text?: string }) {
  const m = mid(a, b)
  const l = dist(a, b)
  if (l * k < 20 && !text) return null
  return (
    <text
      x={m.x} y={m.y - 10 / k} fontSize={12 / k} textAnchor="middle"
      className="select-none fill-blue-800 font-semibold"
      style={{ paintOrder: 'stroke', stroke: 'white', strokeWidth: 4 / k }}
    >
      {text ?? fmtLen(l)}
    </text>
  )
}

function ZoomButton({ label, title, onClick }: { label: string; title?: string; onClick: () => void }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="h-9 w-9 border-b border-stone-200 text-stone-600 last:border-b-0 hover:bg-stone-100"
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
    <div className="pointer-events-none absolute bottom-3 left-3 text-[11px] text-stone-600">
      <div className="h-1.5 border-x-2 border-b-2 border-stone-600" style={{ width: m * k }} />
      <div className="mt-0.5">{m < 1 ? `${m * 100} cm` : `${m} m`}</div>
    </div>
  )
}
