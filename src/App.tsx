import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PlanCanvas, type Mode, type Tool } from './editor/PlanCanvas'
import type { SnapSettings } from './editor/snapping'
import { isTyping } from './lib/dom'
import { add, dist, mul, rotate, sub } from './lib/geometry'
import { loadPlanFile } from './lib/loadPlanFile'
import { newDoc, newFloor, updateFloor, updateRoom } from './model/doc'
import { uid } from './model/ids'
import { exportDoc, getImage, importDoc, loadDoc, putImage, saveDoc } from './model/persistence'
import type { Backdrop, Floor, HomeDoc, Room, Vec } from './model/types'
import { useHistory } from './model/useHistory'
import { CalibrateDialog, straightenAngle } from './panels/CalibrateDialog'
import { HomeSidebar } from './panels/HomeSidebar'
import { PlanSidebar, type WandSettings } from './panels/PlanSidebar'
import { RoomPanel } from './panels/RoomPanel'
import { Toolbar, TOOLS } from './panels/Toolbar'
import { Button } from './panels/ui'

export default function App() {
  const history = useHistory<HomeDoc>(() => loadDoc() ?? newDoc())
  const doc = history.present
  const [floorId, setFloorId] = useState(doc.floors[0].id)
  const floor = doc.floors.find((f) => f.id === floorId) ?? doc.floors[0]
  const [mode, setMode] = useState<Mode>(() => (doc.floors.some((f) => f.rooms.length) ? 'home' : 'plan'))
  const [tool, setTool] = useState<Tool>('select')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [snap, setSnap] = useState<SnapSettings>({ enabled: true, angles: true })
  const [wand, setWand] = useState<WandSettings>({ threshold: 140, ignoreColor: false, minWallCm: 6, maxOpeningCm: 110, showMask: false })
  const [showBackdropAtHome, setShowBackdropAtHome] = useState(false)
  const [fitRequest, setFitRequest] = useState<{ n: number; focus?: Vec[] }>({ n: 0 })
  const refit = (focus?: Vec[]) => setFitRequest((r) => ({ n: r.n + 1, focus }))
  const [calibration, setCalibration] = useState<[Vec, Vec] | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const imageUrls = useImageUrls(doc)
  const importRef = useRef<HTMLInputElement>(null)

  const selected = floor.rooms.find((r) => r.id === selectedId) ?? null
  const bd = floor.backdrop

  // ---------- persistence ----------

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        saveDoc(doc)
      } catch {
        setMessage('Could not save to browser storage.')
      }
    }, 300)
    return () => clearTimeout(t)
  }, [doc])

  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => setMessage(null), 5000)
    return () => clearTimeout(t)
  }, [message])

  // ---------- floor-level mutations ----------

  const commitFloor = useCallback((fn: (f: Floor) => Floor) => history.commit((d) => updateFloor(d, floor.id, fn)), [history.commit, floor.id])
  const replaceFloor = useCallback((fn: (f: Floor) => Floor) => history.replace((d) => updateFloor(d, floor.id, fn)), [history.replace, floor.id])
  const changeRoom = (roomId: string, fn: (r: Room) => Room, mergeKey?: string) =>
    history.commit((d) => updateRoom(d, floor.id, roomId, fn), mergeKey)

  const patchBackdrop = (patch: Partial<Backdrop>) =>
    commitFloor((f) => (f.backdrop ? { ...f, backdrop: { ...f.backdrop, ...patch } } : f))

  const upload = async (file: File) => {
    try {
      setMessage('Loading plan…')
      const { blob, width, height } = await loadPlanFile(file)
      const imageId = uid()
      await putImage(imageId, blob)
      imageUrls.register(imageId, blob)
      const prev = floor.backdrop
      // Keep the same world size as a previous stencil so existing rooms stay roughly in place.
      const scale = prev ? (prev.width * prev.scale) / width : 15 / width
      const backdrop: Backdrop = {
        imageId, width, height, scale,
        x: prev?.x ?? 0, y: prev?.y ?? 0, rotation: prev?.rotation ?? 0,
        opacity: prev?.opacity ?? 0.6, visible: true, calibrated: false,
      }
      commitFloor((f) => ({ ...f, backdrop }))
      setMode('plan')
      setTool('calibrate')
      refit()
      setMessage('Plan loaded. Now set the scale: click both ends of a dimension you know.')
    } catch (e) {
      console.error(e)
      setMessage(`Could not load that file: ${(e as Error).message}`)
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
    setTool('wand')
    refit([...calibration.map(mapPt), ...floor.rooms.flatMap((r) => r.points.map(mapPt))])
    setMessage('Scale set. Next: click inside a room with the magic wand, or draw rooms with R / P.')
  }

  const addFloor = () => {
    const f = newFloor(`Floor ${doc.floors.length + 1}`)
    history.commit((d) => ({ ...d, floors: [...d.floors, f] }))
    setFloorId(f.id)
    setSelectedId(null)
    setMode('plan')
  }

  const renameFloor = (id: string) => {
    const f = doc.floors.find((x) => x.id === id)!
    const name = prompt('Floor name', f.name)
    if (name?.trim()) history.commit((d) => updateFloor(d, id, (x) => ({ ...x, name: name.trim() })))
  }

  const deleteFloor = (id: string) => {
    const f = doc.floors.find((x) => x.id === id)!
    if (doc.floors.length < 2 || !confirm(`Delete "${f.name}" and its ${f.rooms.length} rooms?`)) return
    const remaining = doc.floors.filter((x) => x.id !== id)
    history.commit((d) => ({ ...d, floors: d.floors.filter((x) => x.id !== id) }))
    setFloorId(remaining[0].id)
  }

  const doExport = async () => {
    const blob = await exportDoc(doc)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${doc.name.replace(/[^\w-]+/g, '_') || 'home'}.homehub.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const doImport = async (file: File) => {
    try {
      const next = await importDoc(file)
      history.reset(next)
      setFloorId(next.floors[0].id)
      setSelectedId(null)
      refit()
      setMessage(`Imported "${next.name}".`)
    } catch (e) {
      setMessage(`Import failed: ${(e as Error).message}`)
    }
  }

  // ---------- keyboard shortcuts ----------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) history.redo()
        else history.undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        history.redo()
        return
      }
      if (mod || e.altKey || mode !== 'plan') return
      const t = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase())
      if (t) setTool(t.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [history.undo, history.redo, mode])

  const wandParams = useMemo(() => {
    const cmToPx = (cm: number) => (bd ? cm / 100 / bd.scale : 0)
    return {
      threshold: wand.threshold,
      ignoreColor: wand.ignoreColor,
      minWallPx: cmToPx(wand.minWallCm),
      maxOpeningPx: cmToPx(wand.maxOpeningCm),
    }
  }, [wand, bd])

  const openTodoCount = useCallback((r: Room) => r.items.filter((i) => i.kind === 'todo' && !i.done).length, [])

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 border-b border-stone-200 bg-white px-4 py-2">
        <input
          value={doc.name}
          onChange={(e) => history.commit((d) => ({ ...d, name: e.target.value }), 'home-name')}
          className="w-40 rounded-md border border-transparent px-1 py-0.5 font-semibold hover:border-stone-300 focus:border-blue-500 focus:outline-none"
        />
        <nav className="flex items-center gap-1">
          {doc.floors.map((f) => (
            <div key={f.id} className={`group flex items-center rounded-md ${f.id === floor.id ? 'bg-stone-800 text-white' : 'text-stone-600 hover:bg-stone-100'}`}>
              <button
                onClick={() => {
                  setFloorId(f.id)
                  setSelectedId(null)
                }}
                onDoubleClick={() => renameFloor(f.id)}
                title="Double-click to rename"
                className="px-2.5 py-1 text-sm"
              >
                {f.name}
              </button>
              {doc.floors.length > 1 && f.id === floor.id && (
                <button onClick={() => deleteFloor(f.id)} title="Delete floor" className="pr-2 text-xs opacity-50 hover:opacity-100">✕</button>
              )}
            </div>
          ))}
          <button onClick={addFloor} title="Add floor" className="rounded-md px-2 py-1 text-sm text-stone-500 hover:bg-stone-100">+ Floor</button>
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <div className="flex rounded-lg bg-stone-100 p-0.5">
            {(['plan', 'home'] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded-md px-3 py-1 text-sm font-medium ${mode === m ? 'bg-white shadow-sm' : 'text-stone-500'}`}
              >
                {m === 'plan' ? 'Plan' : 'Home'}
              </button>
            ))}
          </div>
          <input
            ref={importRef} type="file" accept=".json,application/json" className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void doImport(f)
              e.target.value = ''
            }}
          />
          <Button variant="ghost" onClick={() => importRef.current?.click()}>Import</Button>
          <Button variant="ghost" onClick={() => void doExport()}>Export</Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-72 shrink-0 overflow-y-auto border-r border-stone-200 bg-white">
          {mode === 'plan' ? (
            <PlanSidebar
              floor={floor}
              selectedId={selectedId}
              onSelect={(id) => {
                setSelectedId(id)
                setTool('select')
              }}
              onUpload={(f) => void upload(f)}
              onBackdrop={patchBackdrop}
              onRemoveBackdrop={() => commitFloor((f) => ({ ...f, backdrop: undefined }))}
              tool={tool}
              setTool={setTool}
              snap={snap}
              setSnap={setSnap}
              wand={wand}
              setWand={setWand}
            />
          ) : (
            <HomeSidebar
              floor={floor}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onToggleTodo={(room, item) =>
                changeRoom(room.id, (r) => ({ ...r, items: r.items.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)) }))
              }
            />
          )}
        </aside>

        <main
          className="relative min-w-0 flex-1"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            const f = e.dataTransfer.files[0]
            if (f) void upload(f)
          }}
        >
          <PlanCanvas
            floor={floor}
            imageUrl={bd ? imageUrls.urls[bd.imageId] : undefined}
            mode={mode}
            tool={mode === 'plan' ? tool : 'select'}
            selectedId={selectedId}
            onSelect={setSelectedId}
            snap={snap}
            wandParams={wandParams}
            showWallMask={wand.showMask}
            showBackdrop={mode === 'plan' ? !!bd?.visible : showBackdropAtHome}
            fitRequest={fitRequest}
            pendingCalibration={calibration}
            onCalibrate={(a, b) => setCalibration([a, b])}
            onMessage={setMessage}
            commit={commitFloor}
            replace={replaceFloor}
            checkpoint={history.checkpoint}
            openTodoCount={openTodoCount}
          />
          {mode === 'plan' ? (
            <Toolbar
              tool={tool}
              setTool={setTool}
              canUndo={history.canUndo}
              canRedo={history.canRedo}
              undo={history.undo}
              redo={history.redo}
            />
          ) : (
            bd && (
              <label className="absolute left-3 top-3 flex items-center gap-2 rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-sm shadow-sm">
                <input type="checkbox" checked={showBackdropAtHome} onChange={(e) => setShowBackdropAtHome(e.target.checked)} className="accent-blue-600" />
                Show original plan
              </label>
            )
          )}
          {calibration && (
            <CalibrateDialog
              line={calibration}
              onApply={applyCalibration}
              onCancel={() => setCalibration(null)}
            />
          )}
          {message && (
            <div className="pointer-events-none absolute bottom-14 left-1/2 max-w-md -translate-x-1/2 rounded-lg bg-stone-900 px-4 py-2 text-sm text-white shadow-lg">
              {message}
            </div>
          )}
        </main>

        {selected && (mode === 'home' || tool === 'select') && (
          <aside className="w-80 shrink-0 border-l border-stone-200 bg-white">
            <RoomPanel
              key={selected.id}
              room={selected}
              editing={mode === 'plan'}
              onChange={(fn, mergeKey) => changeRoom(selected.id, fn, mergeKey)}
              onDelete={() => {
                commitFloor((f) => ({ ...f, rooms: f.rooms.filter((r) => r.id !== selected.id) }))
                setSelectedId(null)
              }}
              onClose={() => setSelectedId(null)}
            />
          </aside>
        )}
      </div>
    </div>
  )
}

/** Object URLs for the stencil images stored in IndexedDB. */
function useImageUrls(doc: HomeDoc) {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const ids = doc.floors.map((f) => f.backdrop?.imageId).filter((x): x is string => !!x)
  const key = ids.join(',')

  useEffect(() => {
    let cancelled = false
    for (const id of ids) {
      if (urls[id]) continue
      void getImage(id).then((blob) => {
        if (blob && !cancelled) setUrls((u) => (u[id] ? u : { ...u, [id]: URL.createObjectURL(blob) }))
      })
    }
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const register = (id: string, blob: Blob) => setUrls((u) => ({ ...u, [id]: URL.createObjectURL(blob) }))
  return { urls, register }
}
