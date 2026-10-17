import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { PlanCanvas, type Tool } from '../editor/PlanCanvas'
import type { SnapSettings } from '../editor/snapping'
import { isTyping } from '../lib/dom'
import { add, area, dist, fmtArea, mul, rotate, sub } from '../lib/geometry'
import { loadPlanFile } from '../lib/loadPlanFile'
import { newFloor, ROOM_COLORS, updateFloor, updateRoom } from '../model/doc'
import { uid } from '../model/ids'
import { putImage } from '../model/persistence'
import type { Backdrop, Floor, HomeDoc, Room, Vec } from '../model/types'
import type { useHistory } from '../model/useHistory'
import { CalibrateDialog, straightenAngle } from './CalibrateDialog'
import { PlanSettings } from './PlanSettings'
import { ToolHint, Toolbar, TOOLS } from './Toolbar'
import { Button, FloorTabs, inputClass } from './ui'

const openTodoCount = (r: Room) => r.items.filter((i) => i.kind === 'todo' && !i.done).length

/** Full-screen floor plan editor: mostly used once while setting up, then for small fixes. */
export function PlanEditor({
  doc, floor, history, imageUrl, registerImage, selectedId, onSelect, onSelectFloor, onMessage, onDone,
}: {
  doc: HomeDoc
  floor: Floor
  history: ReturnType<typeof useHistory<HomeDoc>>
  imageUrl?: string
  registerImage: (id: string, blob: Blob) => void
  selectedId: string | null
  onSelect: (id: string | null) => void
  onSelectFloor: (id: string) => void
  onMessage: (msg: string) => void
  onDone: () => void
}) {
  const bd = floor.backdrop
  const [tool, setTool] = useState<Tool>(() => (floor.rooms.length ? 'select' : bd && !bd.calibrated ? 'calibrate' : 'rect'))
  const [snap, setSnap] = useState<SnapSettings>({ enabled: true, angles: true })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [drawWithoutPlan, setDrawWithoutPlan] = useState(false)
  const [calibration, setCalibration] = useState<[Vec, Vec] | null>(null)
  const [fitRequest, setFitRequest] = useState<{ n: number; focus?: Vec[] }>({ n: 0 })
  const refit = (focus?: Vec[]) => setFitRequest((r) => ({ n: r.n + 1, focus }))
  const fileRef = useRef<HTMLInputElement>(null)

  const selected = floor.rooms.find((r) => r.id === selectedId) ?? null

  const commitFloor = useCallback((fn: (f: Floor) => Floor) => history.commit((d) => updateFloor(d, floor.id, fn)), [history.commit, floor.id])
  const replaceFloor = useCallback((fn: (f: Floor) => Floor) => history.replace((d) => updateFloor(d, floor.id, fn)), [history.replace, floor.id])
  const changeRoom = (room: Room) => (fn: (r: Room) => Room, mergeKey?: string) =>
    history.commit((d) => updateRoom(d, floor.id, room.id, fn), mergeKey)
  const patchBackdrop = (patch: Partial<Backdrop>) =>
    commitFloor((f) => (f.backdrop ? { ...f, backdrop: { ...f.backdrop, ...patch } } : f))

  const upload = async (file: File) => {
    try {
      onMessage('Loading plan…')
      const { blob, width, height } = await loadPlanFile(file)
      const imageId = uid()
      await putImage(imageId, blob)
      registerImage(imageId, blob)
      const prev = floor.backdrop
      // Keep the same world size as a previous stencil so existing rooms stay roughly in place.
      const scale = prev ? (prev.width * prev.scale) / width : 15 / width
      const backdrop: Backdrop = {
        imageId, width, height, scale,
        x: prev?.x ?? 0, y: prev?.y ?? 0, rotation: prev?.rotation ?? 0,
        opacity: prev?.opacity ?? 0.6, visible: true, calibrated: false,
      }
      commitFloor((f) => ({ ...f, backdrop }))
      setTool('calibrate')
      setSettingsOpen(false)
      refit()
      onMessage('Plan loaded. Now set the scale: mark both ends of a dimension you know.')
    } catch (e) {
      console.error(e)
      onMessage(`Could not load that file: ${(e as Error).message}`)
    }
  }

  const applyCalibration = (meters: number, straighten: boolean) => {
    if (!calibration || !bd) return
    const [a, b] = calibration
    const f = meters / dist(a, b)
    const turn = straighten ? straightenAngle(a, b) : 0
    const o = { x: bd.x, y: bd.y }
    const mapPt = (p: Vec) => add(o, mul(rotate(sub(p, o), turn), f))
    // Rooms were traced on the stencil, so they scale and rotate with it.
    commitFloor((fl) => ({
      ...fl,
      backdrop: fl.backdrop && {
        ...fl.backdrop,
        scale: fl.backdrop.scale * f,
        rotation: (fl.backdrop.rotation ?? 0) + turn,
        calibrated: true,
      },
      rooms: fl.rooms.map((r) => ({ ...r, points: r.points.map(mapPt) })),
    }))
    setCalibration(null)
    setTool('rect')
    refit([...calibration.map(mapPt), ...floor.rooms.flatMap((r) => r.points.map(mapPt))])
    onMessage('Scale set. Next: draw rooms, or trace the outline and split it into rooms.')
  }

  const addFloor = () => {
    const f = newFloor(`Floor ${doc.floors.length + 1}`)
    history.commit((d) => ({ ...d, floors: [...d.floors, f] }))
    onSelectFloor(f.id)
    setDrawWithoutPlan(false)
  }

  const deleteFloor = () => {
    if (doc.floors.length < 2 || !confirm(`Delete "${floor.name}" and its ${floor.rooms.length} rooms?`)) return
    const remaining = doc.floors.filter((x) => x.id !== floor.id)
    history.commit((d) => ({ ...d, floors: d.floors.filter((x) => x.id !== floor.id) }))
    onSelectFloor(remaining[0].id)
    setSettingsOpen(false)
  }

  const deleteRoom = () => {
    commitFloor((f) => ({ ...f, rooms: f.rooms.filter((r) => r.id !== selectedId) }))
    onSelect(null)
  }

  const showStart = !bd && floor.rooms.length === 0 && !drawWithoutPlan
  const blocked = useRef(showStart)
  blocked.current = showStart

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (blocked.current || isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return
      const t = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase())
      if (t) setTool(t.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const dropTarget = {
    onDragOver: (e: DragEvent) => e.preventDefault(),
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      const f = e.dataTransfer.files[0]
      if (f) void upload(f)
    },
  }

  return (
    <div className="flex h-dvh flex-col bg-stone-100">
      <input
        ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void upload(f)
          e.target.value = ''
        }}
      />
      {/* everything behind the start dialog is inert while it's open */}
      <div className="contents" inert={showStart}>
      <header className="flex shrink-0 items-center gap-2 border-b border-stone-200 bg-white px-3 py-2 pt-[max(env(safe-area-inset-top),0.5rem)]">
        <FloorTabs
          floors={doc.floors}
          current={floor.id}
          onSelect={(id) => {
            onSelectFloor(id)
            setDrawWithoutPlan(false)
          }}
          onAdd={addFloor}
        />
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button variant="ghost" onClick={() => setSettingsOpen(!settingsOpen)}>Settings</Button>
          <Button variant="primary" onClick={onDone}>Done</Button>
        </div>
      </header>

      <main className="relative min-h-0 flex-1" {...dropTarget}>
        <PlanCanvas
          floor={floor}
          imageUrl={imageUrl}
          mode="plan"
          tool={tool}
          selectedId={selectedId}
          onSelect={onSelect}
          snap={snap}
          showBackdrop={!!bd?.visible}
          fitRequest={fitRequest}
          pendingCalibration={calibration}
          onCalibrate={(a, b) => setCalibration([a, b])}
          onCalibrationChange={setCalibration}
          onMessage={onMessage}
          commit={commitFloor}
          replace={replaceFloor}
          checkpoint={history.checkpoint}
          openTodoCount={openTodoCount}
        />

        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-2">
          {selected && tool === 'select' ? (
            <RoomCard room={selected} onChange={changeRoom(selected)} onDelete={deleteRoom} onClose={() => onSelect(null)} />
          ) : (
            !showStart && <ToolHint tool={tool} />
          )}
        </div>

        {calibration && (
          <CalibrateDialog line={calibration} onApply={applyCalibration} onCancel={() => setCalibration(null)} />
        )}

        {settingsOpen && (
          <PlanSettings
            floor={floor}
            canDeleteFloor={doc.floors.length > 1}
            selectedId={selectedId}
            onSelect={(id) => {
              onSelect(id)
              setTool('select')
              setSettingsOpen(false)
            }}
            onPickFile={() => fileRef.current?.click()}
            onBackdrop={patchBackdrop}
            onRemoveBackdrop={() => commitFloor((f) => ({ ...f, backdrop: undefined }))}
            setTool={(t) => {
              setTool(t)
              setSettingsOpen(false)
            }}
            onRenameFloor={(name) => history.commit((d) => updateFloor(d, floor.id, (f) => ({ ...f, name })), `floor-name:${floor.id}`)}
            onDeleteFloor={deleteFloor}
            snap={snap}
            setSnap={setSnap}
            onClose={() => setSettingsOpen(false)}
          />
        )}
      </main>

      <Toolbar
        tool={tool}
        setTool={setTool}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        undo={history.undo}
        redo={history.redo}
      />
      </div>

      {showStart && (
        <div
          role="dialog" aria-modal="true" aria-labelledby="start-title" {...dropTarget}
          className="fixed inset-0 z-40 flex items-end justify-center bg-stone-900/50 p-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] backdrop-blur-[2px] sm:items-center"
        >
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 text-center shadow-2xl">
            <h2 id="start-title" className="text-lg font-semibold">Trace your floor plan</h2>
            <p className="mt-1 text-sm text-stone-500">
              Upload a plan (photo, image or PDF) to trace your rooms on. You only need to do this once.
            </p>
            <Button variant="primary" className="mt-4 w-full !py-2.5" onClick={() => fileRef.current?.click()}>
              Upload floor plan
            </Button>
            <Button variant="ghost" className="mt-2 w-full" onClick={() => setDrawWithoutPlan(true)}>
              Draw rooms without a plan
            </Button>
            <Button variant="ghost" className="mt-1 w-full !text-stone-400" onClick={onDone}>
              Not now
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function RoomCard({
  room, onChange, onDelete, onClose,
}: {
  room: Room
  onChange: (fn: (r: Room) => Room, mergeKey?: string) => void
  onDelete: () => void
  onClose: () => void
}) {
  return (
    <div className="pointer-events-auto w-full max-w-md rounded-xl border border-stone-300 bg-white p-2 shadow-md">
      <div className="flex items-center gap-2">
        <input
          value={room.name}
          onChange={(e) => onChange((r) => ({ ...r, name: e.target.value }), `name:${room.id}`)}
          className={`${inputClass} min-w-0 flex-1 font-medium`}
        />
        <span className="shrink-0 text-xs tabular-nums text-stone-500">{fmtArea(area(room.points))}</span>
        <Button variant="danger" onClick={onDelete}>Delete</Button>
        <button onClick={onClose} className="rounded px-1.5 py-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700" aria-label="Deselect">✕</button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2 px-0.5">
        {ROOM_COLORS.map((c) => (
          <button
            key={c}
            aria-label={`Colour ${c}`}
            onClick={() => onChange((r) => ({ ...r, color: c }))}
            className={`h-6 w-6 rounded-full border ${room.color === c ? 'ring-2 ring-blue-500 ring-offset-1' : 'border-stone-300'}`}
            style={{ background: c }}
          />
        ))}
      </div>
    </div>
  )
}
