import * as THREE from 'three'
import { bounds, labelPoint } from '../lib/geometry'
import type { Floor, Room, Vec } from '../model/types'
import { slabGeometry, wallGeometry } from './geometry3d'
import type { MapSettings } from './settings'

export interface MapData {
  floor: Floor
  openCounts: Record<string, number>
  selectedId: string | null
  settings: MapSettings
  /** The original plan image, drawn on the floor when set. */
  backdropUrl?: string
}

export interface ViewState {
  rotated: boolean
  fitted: boolean
}

interface Callbacks {
  onSelect: (roomId: string | null) => void
  onView: (v: ViewState) => void
}

interface Label {
  el: HTMLElement
  pill: HTMLElement
  /** leader line + anchor dot, shown while the label floats outside its room */
  leader: SVGGElement
  line: SVGLineElement[]
  dot: SVGCircleElement
  /** measured pill size in px (0 until first layout) */
  w: number
  h: number
  room: Room
  anchor: THREE.Vector3
  corners: THREE.Vector3[]
}

type Pt = { x: number; y: number }
interface Rect { x0: number; y0: number; x1: number; y1: number }

const SVG_NS = 'http://www.w3.org/2000/svg'
const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>) => {
  const e = document.createElementNS(SVG_NS, tag)
  for (const k in attrs) e.setAttribute(k, attrs[k])
  return e
}
const rectsOverlap = (a: Rect, b: Rect, gap = 0) =>
  a.x0 < b.x1 + gap && a.x1 + gap > b.x0 && a.y0 < b.y1 + gap && a.y1 + gap > b.y0
const inPoly = (p: Pt, poly: Pt[]) => {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}
/** Whether the rect touches the polygon (screen space). */
const rectHitsPoly = (r: Rect, poly: Pt[]) => {
  const mx = (r.x0 + r.x1) / 2, my = (r.y0 + r.y1) / 2
  const probes = [
    [r.x0, r.y0], [r.x1, r.y0], [r.x0, r.y1], [r.x1, r.y1], [mx, my],
    [mx, r.y0], [mx, r.y1], [r.x0, my], [r.x1, my],
  ]
  return probes.some(([x, y]) => inPoly({ x, y }, poly)) || poly.some((q) => q.x >= r.x0 && q.x <= r.x1 && q.y >= r.y0 && q.y <= r.y1)
}

const ccw = (p: Pt, q: Pt, r: Pt) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
const segsCross = (p1: Pt, p2: Pt, p3: Pt, p4: Pt) => ccw(p1, p2, p3) * ccw(p1, p2, p4) < 0 && ccw(p3, p4, p1) * ccw(p3, p4, p2) < 0
const segHitsRect = (p: Pt, q: Pt, r: Rect) => {
  const inside = (v: Pt) => v.x >= r.x0 && v.x <= r.x1 && v.y >= r.y0 && v.y <= r.y1
  if (inside(p) || inside(q)) return true
  const c = [{ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 }, { x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 }]
  return c.some((v, i) => segsCross(p, q, v, c[(i + 1) % 4]))
}
const segHitsPoly = (p: Pt, q: Pt, poly: Pt[]) =>
  inPoly(p, poly) || inPoly(q, poly) || poly.some((v, i) => segsCross(p, q, v, poly[(i + 1) % poly.length]))

/** Latest label layout, for debugging (see the `debugLabels` setting): paste it to someone who can analyse it. */
export const labelDebug = { snapshot: '' }

const RAD = Math.PI / 180
const TAP_SLOP = 6
const WARM_WHITE = new THREE.Color('#faf7f2')

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * Renders the floor as a small 3D model (floor slabs, thick walls, sun and shadows) and handles
 * the touch / mouse camera. Plain three.js rather than React state, so gestures stay smooth.
 */
export class MapEngine {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(24, 1, 0.1, 1000)
  private content = new THREE.Group()
  private hemi = new THREE.HemisphereLight(0xffffff, 0xd8cfc2, 1)
  private sun = new THREE.DirectionalLight(0xfff1de, 2)
  private ground: THREE.Mesh
  private textures = new Map<string, THREE.Texture>()
  private raycaster = new THREE.Raycaster()
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private roomMeshes: THREE.Mesh[] = []
  private labels: Label[] = []
  private leaders: SVGSVGElement | null = null
  private controlCount = 0
  private tmp = new THREE.Vector3()

  private data: MapData | null = null
  private floorId = ''
  private bbox = { minX: 0, maxX: 1, minZ: 0, maxZ: 1 }
  private size = { w: 0, h: 0 }
  private raf = 0
  private ro: ResizeObserver

  // camera state: it looks at `target` from `dist` away, `pitch` off the vertical and turned by `yaw`
  private target = new THREE.Vector3()
  private dist = 20
  private fitDist = 20
  private yaw = 0
  private pitch = 45 * RAD
  /** Whether the camera is still the automatic fit (the user hasn't panned or zoomed since). */
  private autoFit = true

  private pointers = new Map<number, Pt>()
  private tap: { x: number; y: number; t: number; moved: boolean; single: boolean } | null = null
  private lastTap: { x: number; y: number; t: number } | null = null

  constructor(private host: HTMLElement, private labelHost: HTMLElement, private cb: Callbacks) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.toneMapping = THREE.NeutralToneMapping
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    const canvas = this.renderer.domElement
    canvas.style.cssText = 'display:block;touch-action:none;user-select:none'
    host.append(canvas)

    this.sun.shadow.mapSize.set(2048, 2048)
    this.sun.shadow.bias = -0.0004
    this.sun.shadow.normalBias = 0.02
    this.scene.add(this.hemi, this.sun, this.sun.target, this.content)

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new THREE.ShadowMaterial())
    this.ground.receiveShadow = true
    this.scene.add(this.ground)

    canvas.addEventListener('pointerdown', this.onDown)
    canvas.addEventListener('pointermove', this.onMove)
    canvas.addEventListener('pointerup', this.onUp)
    canvas.addEventListener('pointercancel', this.onUp)
    canvas.addEventListener('wheel', this.onWheel, { passive: false })
    canvas.addEventListener('contextmenu', (e) => e.preventDefault())

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(host)
    this.resize()
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    this.clear()
    this.textures.forEach((t) => t.dispose())
    this.ground.geometry.dispose()
    ;(this.ground.material as THREE.Material).dispose()
    this.sun.shadow.map?.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  // ---------- public API ----------

  /** Camera tilt in degrees from straight down. */
  setPitch(deg: number) {
    const p = clamp(deg * RAD, 0.05, 1.45)
    if (p === this.pitch) return
    this.pitch = p
    if (this.autoFit) this.fit()
    else this.apply()
    this.requestRender()
  }

  setData(data: MapData) {
    this.data = data
    if (data.floor.id !== this.floorId) {
      this.floorId = data.floor.id
      this.autoFit = true
    }
    this.camera.fov = data.settings.fov
    this.camera.updateProjectionMatrix()
    this.rebuild()
    if (this.autoFit) this.fit()
    else this.apply()
    this.requestRender()
  }

  fit() {
    const d = this.data
    if (!d || !this.size.w) return
    const { minX, maxX, minZ, maxZ } = this.bbox
    const h = d.settings.wallHeight
    this.target.set((minX + maxX) / 2, h / 2, (minZ + maxZ) / 2)
    const corners = [minX, maxX].flatMap((x) => [minZ, maxZ].flatMap((z) => [0, h].map((y) => new THREE.Vector3(x, y, z))))
    let dist = Math.max(maxX - minX, maxZ - minZ) * 2
    for (let i = 0; i < 6; i++) {
      this.dist = dist
      this.apply(false)
      let m = 0.01
      for (const c of corners) {
        const v = this.tmp.copy(c).project(this.camera)
        m = Math.max(m, Math.abs(v.x), Math.abs(v.y))
      }
      dist *= m / 0.9
    }
    this.dist = this.fitDist = dist
    this.autoFit = true
    this.apply()
    this.requestRender()
  }

  resetRotation() {
    this.yaw = 0
    if (this.autoFit) this.fit()
    else this.apply()
    this.requestRender()
  }

  // ---------- scene ----------

  private clear() {
    this.content.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose()
        ;[o.material].flat().forEach((m: THREE.Material) => m.dispose())
      }
    })
    this.content.clear()
    this.labelHost.replaceChildren()
    this.leaders = svgEl('svg', { class: 'absolute inset-0 h-full w-full overflow-visible' })
    this.labelHost.append(this.leaders)
    this.roomMeshes = []
    this.labels = []
  }

  private rebuild() {
    const d = this.data!
    const s = d.settings
    this.clear()
    const rooms = d.floor.rooms
    const selecting = d.selectedId !== null
    const shadows = s.shadows

    for (const room of rooms) {
      const sel = room.id === d.selectedId
      const open = d.openCounts[room.id] ?? 0
      // rooms that need attention stay colorful, the others recede (all but the selection, when there is one)
      const fade = selecting ? (sel ? 0 : Math.max(s.idleFade, 0.6)) : open > 0 ? 0 : s.idleFade
      const base = new THREE.Color(room.color)
      const top = base.clone().lerp(WARM_WHITE, 0.1 + fade * 0.75)
      const side = base.clone().multiplyScalar(0.72).lerp(WARM_WHITE, fade * 0.6)
      const mat = (c: THREE.Color) =>
        new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, emissive: sel ? base : 0x000000, emissiveIntensity: sel ? 0.12 : 0 })
      const mesh = new THREE.Mesh(slabGeometry(room.points, s.floorThickness), [mat(top), mat(side)])
      mesh.position.y = sel ? s.selectedLift : 0
      mesh.castShadow = mesh.receiveShadow = shadows
      mesh.userData.roomId = room.id
      this.roomMeshes.push(mesh)
      this.content.add(mesh)
      this.addLabel(room, sel, open, mesh.position.y)
    }

    const wg = wallGeometry(rooms, s.wallThickness, s.wallHeight)
    if (wg) {
      const walls = new THREE.Mesh(wg, new THREE.MeshStandardMaterial({ color: s.wallColor, roughness: 0.95 }))
      walls.castShadow = walls.receiveShadow = shadows
      this.content.add(walls)
    }

    const bd = d.floor.backdrop
    if (bd && d.backdropUrl) this.addBackdrop(bd, d.backdropUrl)

    const all = rooms.flatMap((r) => r.points)
    const b = all.length ? bounds(all) : { minX: 0, minY: 0, maxX: 10, maxY: 8 }
    const pad = s.wallThickness
    this.bbox = { minX: b.minX - pad, maxX: b.maxX + pad, minZ: b.minY - pad, maxZ: b.maxY + pad }

    this.ground.position.y = -s.floorThickness - 0.002
    const gm = this.ground.material as THREE.ShadowMaterial
    gm.opacity = s.shadows ? s.shadowStrength : 0
    this.hemi.intensity = s.ambient
    this.sun.intensity = s.sun
    this.sun.castShadow = shadows
    this.sun.shadow.radius = s.shadowSoftness
    this.sun.shadow.intensity = s.shadowStrength + 0.2
    this.updateSun()
  }

  private addBackdrop(bd: NonNullable<Floor['backdrop']>, url: string) {
    let tex = this.textures.get(url)
    if (!tex) {
      tex = new THREE.TextureLoader().load(url, () => this.requestRender())
      tex.colorSpace = THREE.SRGBColorSpace
      tex.anisotropy = 4
      this.textures.set(url, tex)
    }
    const w = bd.width * bd.scale
    const h = bd.height * bd.scale
    const g = new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2).translate(w / 2, 0, h / 2)
    const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: bd.opacity, depthWrite: false, toneMapped: false })
    const mesh = new THREE.Mesh(g, m)
    mesh.rotation.y = -(bd.rotation ?? 0)
    mesh.position.set(bd.x, 0.01 + this.data!.settings.selectedLift, bd.y)
    mesh.renderOrder = 1
    this.content.add(mesh)
  }

  private addLabel(room: Room, selected: boolean, open: number, lift: number) {
    const s = this.data!.settings
    if (!s.labels) return
    const el = document.createElement('div')
    el.className = 'absolute left-0 top-0 will-change-transform'
    const pill = document.createElement('div')
    pill.className = `flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 pointer-events-auto cursor-pointer font-medium leading-tight ${selected ? 'text-stone-800 ring-2 ring-blue-500' : 'text-stone-600 ring-1 ring-black/5'}`
    pill.style.fontSize = `${11 * s.labelSize}px`
    const name = document.createElement('span')
    name.textContent = room.name
    pill.append(name)
    if (open > 0) {
      const badge = document.createElement('span')
      badge.className = 'rounded-full bg-amber-500 px-1.5 text-[0.9em] font-semibold leading-snug text-white'
      badge.textContent = String(open)
      pill.append(badge)
    }
    pill.style.background = selected ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.6)'
    pill.style.boxShadow = selected ? '0 1px 4px rgba(0,0,0,0.14)' : 'none'
    pill.addEventListener('click', () => this.cb.onSelect(room.id))
    el.append(pill)
    this.labelHost.append(el)

    const leader = svgEl('g', {})
    const line = [
      svgEl('line', { stroke: 'rgba(255,255,255,0.5)', 'stroke-width': '3', 'stroke-linecap': 'round' }),
      svgEl('line', { stroke: 'rgba(68,64,60,0.5)', 'stroke-width': '1', 'stroke-linecap': 'round' }),
    ]
    const dot = svgEl('circle', { r: '2.5', fill: 'rgba(68,64,60,0.6)', stroke: 'rgba(255,255,255,0.7)', 'stroke-width': '1' })
    leader.append(...line, dot)
    this.leaders!.append(leader)

    const p = labelPoint(room.points)
    this.labels.push({
      el, pill, leader, line, dot, w: 0, h: 0, room,
      anchor: new THREE.Vector3(p.x, lift + 0.02, p.y),
      corners: room.points.map((q: Vec) => new THREE.Vector3(q.x, lift, q.y)),
    })
  }

  private updateSun() {
    const s = this.data?.settings
    if (!s) return
    const { minX, maxX, minZ, maxZ } = this.bbox
    const cx = (minX + maxX) / 2
    const cz = (minZ + maxZ) / 2
    const r = Math.hypot(maxX - minX, maxZ - minZ) / 2 + 1
    const az = (s.sunAzimuth - (s.sunFollowsCamera ? this.yaw / RAD : 0)) * RAD
    const el = s.sunElevation * RAD
    this.sun.position.set(cx + Math.sin(az) * Math.cos(el) * r * 3, Math.sin(el) * r * 3, cz - Math.cos(az) * Math.cos(el) * r * 3)
    this.sun.target.position.set(cx, 0, cz)
    this.sun.target.updateMatrixWorld()
    const sc = this.sun.shadow.camera
    sc.left = sc.bottom = -r * 1.1
    sc.right = sc.top = r * 1.1
    sc.near = r * 0.5
    sc.far = r * 6
    sc.updateProjectionMatrix()
  }

  // ---------- camera ----------

  private apply(notify = true) {
    const { target: t, dist: d, pitch: p, yaw: y } = this
    this.camera.position.set(t.x + d * Math.sin(p) * Math.sin(y), t.y + d * Math.cos(p), t.z + d * Math.sin(p) * Math.cos(y))
    this.camera.lookAt(t)
    this.camera.updateMatrixWorld()
    const rotated = Math.abs(Math.atan2(Math.sin(y), Math.cos(y))) > 1e-3
    this.controlCount = (rotated ? 1 : 0) + (this.autoFit ? 0 : 1) // the buttons PlanMap3D shows
    if (notify) this.cb.onView({ rotated, fitted: this.autoFit })
  }

  /** The point of the floor under a screen position. */
  private ground_(x: number, y: number): THREE.Vector3 | null {
    const r = this.renderer.domElement.getBoundingClientRect()
    this.raycaster.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), this.camera)
    return this.raycaster.ray.intersectPlane(this.groundPlane, new THREE.Vector3())
  }

  /**
   * Zoom and rotate about the target, then pan so that the floor point that was under `from` is under `to`.
   * With `from` = `to` this zooms / rotates about that screen position, which is what fingers expect.
   */
  private move(from: Pt, to: Pt, zoom = 1, dYaw = 0) {
    const p0 = this.ground_(from.x, from.y)
    this.yaw += dYaw
    this.dist = clamp(this.dist / zoom, this.fitDist * 0.12, this.fitDist * 2.5)
    this.apply(false)
    const p1 = this.ground_(to.x, to.y)
    if (p0 && p1) {
      const { minX, maxX, minZ, maxZ } = this.bbox
      const mx = (maxX - minX) * 0.5
      const mz = (maxZ - minZ) * 0.5
      this.target.x = clamp(this.target.x + p0.x - p1.x, minX - mx, maxX + mx)
      this.target.z = clamp(this.target.z + p0.z - p1.z, minZ - mz, maxZ + mz)
    }
    this.autoFit = false
    this.apply()
    this.requestRender()
  }

  // ---------- gestures ----------

  private onDown = (e: PointerEvent) => {
    this.renderer.domElement.setPointerCapture(e.pointerId)
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (this.pointers.size === 1) this.tap = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false, single: true }
    else if (this.tap) this.tap.single = false
  }

  private onMove = (e: PointerEvent) => {
    const prev = this.pointers.get(e.pointerId)
    if (!prev) return
    const now = { x: e.clientX, y: e.clientY }
    if (this.tap && Math.hypot(now.x - this.tap.x, now.y - this.tap.y) > TAP_SLOP) this.tap.moved = true
    if (this.pointers.size === 1) {
      this.pointers.set(e.pointerId, now)
      if (!this.tap?.moved) return
      if (e.pointerType === 'mouse' && (e.buttons & 2 || e.shiftKey)) {
        this.yaw += (now.x - prev.x) * 0.008
        this.autoFit = false
        this.apply()
        this.requestRender()
      } else {
        this.move(prev, now)
      }
    } else if (this.pointers.size === 2) {
      const other = [...this.pointers.entries()].find(([id]) => id !== e.pointerId)![1]
      this.pointers.set(e.pointerId, now)
      const mid = (a: Pt, b: Pt) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
      const span = (a: Pt, b: Pt) => Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1)
      const ang = (a: Pt, b: Pt) => Math.atan2(b.y - a.y, b.x - a.x)
      const dA = ang(other, now) - ang(other, prev)
      this.move(mid(other, prev), mid(other, now), span(other, now) / span(other, prev), Math.atan2(Math.sin(dA), Math.cos(dA)))
    }
  }

  private onUp = (e: PointerEvent) => {
    if (!this.pointers.delete(e.pointerId)) return
    const tap = this.tap
    if (this.pointers.size > 0 || !tap) return
    this.tap = null
    if (e.type === 'pointercancel' || !tap.single || tap.moved || performance.now() - tap.t > 500) return
    const now = performance.now()
    if (this.lastTap && now - this.lastTap.t < 320 && Math.hypot(tap.x - this.lastTap.x, tap.y - this.lastTap.y) < 30) {
      this.lastTap = null
      this.fit()
      return
    }
    this.lastTap = { x: tap.x, y: tap.y, t: now }
    this.cb.onSelect(this.pick(tap.x, tap.y))
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault()
    const p = { x: e.clientX, y: e.clientY }
    if (e.ctrlKey || e.metaKey) this.move(p, p, Math.exp(-e.deltaY * 0.01))
    else this.move(p, { x: p.x - e.deltaX, y: p.y - e.deltaY })
  }

  /** The room whose floor is under a screen position (walls don't take taps). */
  private pick(x: number, y: number): string | null {
    const r = this.renderer.domElement.getBoundingClientRect()
    this.raycaster.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), this.camera)
    return this.raycaster.intersectObjects(this.roomMeshes, false)[0]?.object.userData.roomId ?? null
  }

  // ---------- drawing ----------

  private resize() {
    const w = this.host.clientWidth
    const h = this.host.clientHeight
    if (!w || !h) return
    this.size = { w, h }
    this.renderer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    if (this.data) {
      if (this.autoFit) this.fit()
      else this.apply()
      this.draw() // right away: a resized canvas is blank until redrawn
    }
  }

  private requestRender() {
    if (this.raf) return
    this.raf = requestAnimationFrame(() => {
      this.raf = 0
      this.draw()
    })
  }

  private draw() {
    this.updateSun()
    this.renderer.render(this.scene, this.camera)
    this.placeLabels()
  }

  /**
   * Labels that fit inside their room stay there. The others float: they are moved just outside
   * the building (or into any free spot) and tied to their room by a leader line and dot.
   */
  private placeLabels() {
    const { w, h } = this.size
    const q = new THREE.Vector3()
    const MARGIN = 4
    const edge = this.data?.settings.floatLabels ?? false
    const project = (v: THREE.Vector3): Pt => {
      q.copy(v).project(this.camera)
      return { x: ((q.x + 1) / 2) * w, y: ((1 - q.y) / 2) * h }
    }

    const items = this.labels.map((l) => {
      if (!l.w) {
        l.w = l.pill.offsetWidth
        l.h = l.pill.offsetHeight
      }
      const poly = l.corners.map(project)
      const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y)
      const rw = Math.max(...xs) - Math.min(...xs)
      const rh = Math.max(...ys) - Math.min(...ys)
      const a = project(l.anchor)
      const fits = !edge && rw > l.w + 8 && rh > l.h + 4
      return { l, poly, a, fits, pos: a, placed: false }
    })

    const polys = items.map((i) => i.poly)
    const boxOf = (p: Pt, l: Label): Rect => ({ x0: p.x - l.w / 2, y0: p.y - l.h / 2, x1: p.x + l.w / 2, y1: p.y + l.h / 2 })
    const taken: Rect[] = items.filter((i) => i.fits).map((i) => boxOf(i.a, i.l))
    // keep clear of the map buttons in the bottom right corner (36px each, 12px from the edges)
    if (this.controlCount) taken.push({ x0: w - 52, y0: h - 12 - 36 * this.controlCount - 4, x1: w, y1: h })

    // direction "away from the building", measured from the centre of everything on screen
    const all = polys.flat()
    const cx = all.length ? (Math.min(...all.map((p) => p.x)) + Math.max(...all.map((p) => p.x))) / 2 : w / 2
    const cy = all.length ? (Math.min(...all.map((p) => p.y)) + Math.max(...all.map((p) => p.y))) / 2 : h / 2

    const floating = items
      .filter((i) => !i.fits)
      .sort((m, n) => Math.hypot(n.a.x - cx, n.a.y - cy) - Math.hypot(m.a.x - cx, m.a.y - cy))

    // penalties, in px-equivalents of leader length
    const W = {
      coverRoom: 400, // the label itself sits on top of a room
      lineRoom: 40, // the leader passes over a foreign room (each)
      lineLine: 120, // the leader crosses another leader (each)
      lineLabel: 300, // the leader runs through another label, or another leader through this label (each)
    }
    const inView = (r: Rect) => r.x0 >= MARGIN && r.y0 >= MARGIN && r.x1 <= w - MARGIN && r.y1 <= h - MARGIN
    type Item = (typeof items)[number]
    const fixedLabels = items.filter((i) => i.fits)

    /** Costs that depend only on the label and its own spot. */
    const staticTerms = (it: Item, p: Pt) => {
      const r = boxOf(p, it.l)
      return {
        // the visible leader: from the dot to the nearest edge of the label
        dist: Math.hypot(Math.max(r.x0 - it.a.x, 0, it.a.x - r.x1), Math.max(r.y0 - it.a.y, 0, it.a.y - r.y1)),
        coverRoom: polys.some((poly) => rectHitsPoly(r, poly)) ? W.coverRoom : 0,
        lineRoom: W.lineRoom * items.filter((o) => o !== it && segHitsPoly(it.a, p, o.poly)).length,
      }
    }
    /** Costs that depend on where the other labels currently are. */
    const dynamicTerms = (it: Item, p: Pt) => {
      const r = boxOf(p, it.l)
      const others = floating.filter((o) => o !== it && o.placed)
      return {
        lineLine: W.lineLine * others.filter((o) => segsCross(it.a, p, o.a, o.pos)).length,
        lineLabel:
          W.lineLabel *
          (fixedLabels.filter((o) => segHitsRect(it.a, p, boxOf(o.a, o.l))).length +
            others.filter((o) => segHitsRect(it.a, p, boxOf(o.pos, o.l)) || segHitsRect(o.a, o.pos, r)).length),
      }
    }
    const sum = (t: Record<string, number>) => Object.values(t).reduce((m, n) => m + n, 0)
    const costAt = (it: Item, p: Pt) => sum(staticTerms(it, p)) + sum(dynamicTerms(it, p))

    // 1. candidate spots per label: along the screen border, or in rings around the room
    type Cand = { p: Pt; rect: Rect; cost: number }
    const candsOf = new Map<Item, Cand[]>()
    for (const it of floating) {
      const { l, a } = it
      const spots: Pt[] = []
      if (edge) {
        const x0 = MARGIN + l.w / 2, x1 = w - MARGIN - l.w / 2, y0 = MARGIN + l.h / 2, y1 = h - MARGIN - l.h / 2
        for (let x = x0; x <= x1; x += 10) spots.push({ x, y: y0 }, { x, y: y1 })
        for (let y = y0; y <= y1; y += 10) spots.push({ x: x0, y }, { x: x1, y })
      } else {
        for (let r = 4; r <= 204; r += 8) {
          for (let k = 0; k < 24; k++) {
            const ang = (k * Math.PI) / 12
            // keep the label's near edge, not just its centre, at distance r
            const reach = r + (Math.abs(Math.cos(ang)) * l.w) / 2 + (Math.abs(Math.sin(ang)) * l.h) / 2
            spots.push({ x: a.x + Math.cos(ang) * reach, y: a.y + Math.sin(ang) * reach })
          }
        }
      }
      candsOf.set(
        it,
        spots.map((p) => ({ p, rect: boxOf(p, l) })).filter((c) => inView(c.rect)).map((c) => ({ ...c, cost: sum(staticTerms(it, c.p)) })),
      )
    }

    const free = (rect: Rect, skip: Item[]) =>
      !taken.some((t) => rectsOverlap(rect, t, 3)) &&
      !floating.some((o) => !skip.includes(o) && o.placed && rectsOverlap(rect, boxOf(o.pos, o.l), 3))

    // 2. greedy start: furthest-out labels first, each taking its cheapest free spot
    for (const it of floating) {
      const best = candsOf.get(it)!.filter((c) => free(c.rect, [it])).sort((m, n) => m.cost - n.cost)[0]
      it.placed = !!best
      if (best) it.pos = best.p
      else taken.push(boxOf(it.a, it.l))
    }
    const movable = floating.filter((it) => it.placed)

    // 3. refine: greedy order alone gives odd results (e.g. two labels that would both be closer if swapped),
    //    so repeatedly move single labels and swap pairs while that lowers the total cost
    for (let pass = 0; pass < 6; pass++) {
      let changed = false
      for (const it of movable) {
        let best = costAt(it, it.pos)
        let bestP: Pt | null = null
        for (const c of candsOf.get(it)!) {
          if (c.cost >= best || !free(c.rect, [it])) continue
          const v = c.cost + sum(dynamicTerms(it, c.p))
          if (v < best - 0.5) { best = v; bestP = c.p }
        }
        if (bestP) { it.pos = bestP; changed = true }
      }
      for (let i = 0; i < movable.length; i++) {
        for (let j = i + 1; j < movable.length; j++) {
          const m = movable[i], n = movable[j]
          const rm = boxOf(n.pos, m.l), rn = boxOf(m.pos, n.l)
          if (!inView(rm) || !inView(rn) || rectsOverlap(rm, rn, 3) || !free(rm, [m, n]) || !free(rn, [m, n])) continue
          const before = costAt(m, m.pos) + costAt(n, n.pos)
          const mp = m.pos, np = n.pos
          m.pos = np; n.pos = mp
          if (costAt(m, m.pos) + costAt(n, n.pos) < before - 0.5) changed = true
          else { m.pos = mp; n.pos = np }
        }
      }
      if (changed) continue
      // 4. stuck: a label with a conflict may need another one to step aside first (two labels crossing
      //    can often only be untangled by moving both), so try joint moves of the top spots of each pair
      const K = 24
      const top = new Map(movable.map((it) => [it, [...candsOf.get(it)!].sort((m, n) => m.cost - n.cost).slice(0, K)]))
      const conflicted = movable.filter((it) => sum(dynamicTerms(it, it.pos)) > 0)
      for (const m of conflicted) {
        for (const n of movable) {
          if (n === m) continue
          const mp = m.pos, np = n.pos
          let best = costAt(m, mp) + costAt(n, np)
          let pick: [Pt, Pt] | null = null
          for (const cm of top.get(m)!) {
            if (!free(cm.rect, [m, n])) continue
            for (const cn of top.get(n)!) {
              if (rectsOverlap(cm.rect, cn.rect, 3) || !free(cn.rect, [m, n])) continue
              m.pos = cm.p; n.pos = cn.p
              const v = cm.cost + cn.cost + sum(dynamicTerms(m, cm.p)) + sum(dynamicTerms(n, cn.p))
              if (v < best - 0.5) { best = v; pick = [cm.p, cn.p] }
            }
          }
          m.pos = pick ? pick[0] : mp
          n.pos = pick ? pick[1] : np
          if (pick) changed = true
        }
      }
      if (!changed) break
    }

    if (this.data?.settings.debugLabels) {
      const r = (n: number) => Math.round(n)
      const pt = (p: Pt) => [r(p.x), r(p.y)]
      labelDebug.snapshot = JSON.stringify({
        viewport: { w, h }, edge, labelSize: this.data.settings.labelSize, weights: W,
        labels: items.map((it) => {
          const base = { room: it.l.room.name, size: [r(it.l.w), r(it.l.h)], anchor: pt(it.a), roomOnScreen: it.poly.map(pt) }
          if (it.fits) return { ...base, mode: 'inside room' }
          if (!it.placed) return { ...base, mode: 'floating, NO FREE SPOT' }
          const terms = { ...staticTerms(it, it.pos), ...dynamicTerms(it, it.pos) }
          const alternatives = candsOf.get(it)!
            .filter((c) => free(c.rect, [it]) && (c.p.x !== it.pos.x || c.p.y !== it.pos.y))
            .map((c) => ({ c, v: c.cost + sum(dynamicTerms(it, c.p)) }))
            .sort((m, n) => m.v - n.v).slice(0, 3)
            .map(({ c, v }) => ({ at: pt(c.p), cost: r(v), ...staticTerms(it, c.p), ...dynamicTerms(it, c.p) }))
          return { ...base, mode: 'floating', at: pt(it.pos), cost: r(sum(terms)), terms, bestAlternatives: alternatives }
        }),
      }, null, 1)
    }

    for (const it of items) {
      const { l, a, pos } = it
      l.el.style.transform = `translate(${pos.x}px, ${pos.y}px) translate(-50%, -50%)`
      l.leader.style.display = it.fits ? 'none' : ''
      if (it.fits) continue
      // leader ends where the line from the anchor meets the pill's edge
      const dx = pos.x - a.x, dy = pos.y - a.y
      const t = Math.min(dx ? l.w / 2 / Math.abs(dx) : Infinity, dy ? l.h / 2 / Math.abs(dy) : Infinity, 1)
      const ex = pos.x - dx * t, ey = pos.y - dy * t
      for (const ln of l.line) {
        ln.setAttribute('x1', String(a.x)); ln.setAttribute('y1', String(a.y))
        ln.setAttribute('x2', String(ex)); ln.setAttribute('y2', String(ey))
      }
      l.dot.setAttribute('cx', String(a.x)); l.dot.setAttribute('cy', String(a.y))
    }
  }
}
