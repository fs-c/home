import { useEffect, useRef, useState } from 'react'
import { isTyping } from './lib/dom'
import { newDoc, updateRoom } from './model/doc'
import { clearImages, exportDoc, getImage, importDoc, loadDoc, saveDoc } from './model/persistence'
import type { HomeDoc, Room } from './model/types'
import { useHistory } from './model/useHistory'
import { HomeView } from './panels/HomeView'
import { PlanEditor } from './panels/PlanEditor'
import { ShareDialog } from './panels/ShareDialog'
import { ConfirmDialog } from './panels/ui'
import { parseInvite, useSync } from './sync/useSync'

export default function App() {
  const history = useHistory<HomeDoc>(() => loadDoc() ?? newDoc())
  const doc = history.present
  const [floorId, setFloorId] = useState(doc.floors[0].id)
  const floor = doc.floors.find((f) => f.id === floorId) ?? doc.floors[0]
  const [view, setView] = useState<'home' | 'plan'>('home')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const imageUrls = useImageUrls(doc)
  const importRef = useRef<HTMLInputElement>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [invite, setInvite] = useState(() => parseInvite(location.hash))
  const sync = useSync(doc, (next) => history.replace(() => next))

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

  const changeRoom = (roomId: string, fn: (r: Room) => Room, mergeKey?: string) =>
    history.commit((d) => updateRoom(d, floor.id, roomId, fn), mergeKey)

  const selectFloor = (id: string) => {
    setFloorId(id)
    setSelectedId(null)
  }

  const renameHome = () => {
    const name = prompt('Name', doc.name)
    if (name?.trim()) history.commit((d) => ({ ...d, name: name.trim() }))
  }

  const doExport = async () => {
    const blob = await exportDoc(doc)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${doc.name.replace(/[^\w-]+/g, '_') || 'home'}.homehub.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const closeInvite = () => {
    setInvite(null)
    window.history.replaceState(null, '', location.pathname)
  }

  const acceptInvite = () => {
    if (!invite) return
    sync.join(invite)
    setMessage('Joined the shared home.')
    closeInvite()
  }

  const doImport = async (file: File) => {
    try {
      const next = await importDoc(file)
      sync.stop()
      history.reset(next)
      setFloorId(next.floors[0].id)
      setSelectedId(null)
      setMessage(`Imported "${next.name}".`)
    } catch (e) {
      setMessage(`Import failed: ${(e as Error).message}`)
    }
  }

  const doReset = () => {
    sync.stop()
    const next = newDoc()
    history.reset(next)
    setFloorId(next.floors[0].id)
    setSelectedId(null)
    setConfirmReset(false)
    void clearImages().catch(() => {})
    setMessage('Everything was reset.')
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
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        history.redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [history.undo, history.redo])

  const bd = floor.backdrop
  const imageUrl = bd ? imageUrls.urls[bd.imageId] : undefined

  return (
    <>
      {view === 'plan' ? (
        <PlanEditor
          doc={doc}
          floor={floor}
          history={history}
          imageUrl={imageUrl}
          registerImage={imageUrls.register}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onSelectFloor={selectFloor}
          onMessage={setMessage}
          onDone={() => setView('home')}
        />
      ) : (
        <HomeView
          doc={doc}
          floor={floor}
          imageUrl={imageUrl}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onSelectFloor={selectFloor}
          changeRoom={changeRoom}
          onEditPlan={() => setView('plan')}
          menu={[
            { label: 'Rename…', onClick: renameHome },
            { label: sync.state ? 'Sharing…' : 'Share…', onClick: () => setSharing(true) },
            { label: 'Import backup…', onClick: () => importRef.current?.click() },
            { label: 'Export backup', onClick: () => void doExport() },
            { label: 'Reset…', onClick: () => setConfirmReset(true) },
          ]}
        />
      )}
      <input
        ref={importRef} type="file" accept=".json,application/json" className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void doImport(f)
          e.target.value = ''
        }}
      />
      {sharing && (
        <ShareDialog
          state={sync.state}
          status={sync.status}
          onStart={sync.start}
          onStop={() => {
            sync.stop()
            setSharing(false)
          }}
          onClose={() => setSharing(false)}
        />
      )}
      {invite && (
        <ConfirmDialog title="Join shared home?" confirmLabel="Join" onConfirm={acceptInvite} onCancel={closeInvite}>
          This replaces everything on this device with the shared home. Export a backup first if you want to keep
          what's here.
        </ConfirmDialog>
      )}
      {confirmReset && (
        <ConfirmDialog
          title="Reset everything?"
          confirmLabel="Reset"
          danger
          onConfirm={doReset}
          onCancel={() => setConfirmReset(false)}
        >
          All floors, rooms, notes and uploaded plans will be deleted from this device. This can't be undone, so
          export a backup first if you might want them back. If this home is shared, you'll leave it; the others
          keep their copy.
        </ConfirmDialog>
      )}
      {message && (
        <div className="pointer-events-none fixed inset-x-0 top-14 z-50 flex justify-center px-4">
          <div className="max-w-md rounded-lg bg-stone-900 px-4 py-2 text-sm text-white shadow-lg">{message}</div>
        </div>
      )}
    </>
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
