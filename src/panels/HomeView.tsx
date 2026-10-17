import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { PlanCanvas } from '../editor/PlanCanvas'
import type { Floor, HomeDoc, Item, Room } from '../model/types'
import { AddItemBar, Overview, RoomDetail, openTodos } from './RoomContent'
import { Button, FloorTabs, Menu } from './ui'

const NO_FIT = { n: 0 }
const SNAP = { enabled: false, angles: false }
const noop = () => {}
const openTodoCount = (r: Room) => openTodos(r).length

/** The everyday view: room contents first, with the plan as a map for orientation. */
export function HomeView({
  doc, floor, imageUrl, selectedId, onSelect, onSelectFloor, changeRoom, onEditPlan, menu,
}: {
  doc: HomeDoc
  floor: Floor
  imageUrl?: string
  selectedId: string | null
  onSelect: (id: string | null) => void
  onSelectFloor: (id: string) => void
  changeRoom: (roomId: string, fn: (r: Room) => Room, mergeKey?: string) => void
  onEditPlan: () => void
  menu: { label: string; onClick: () => void }[]
}) {
  const [showPlan, setShowPlan] = useState(false)
  const wide = useMediaQuery('(min-width: 768px)')
  const selected = floor.rooms.find((r) => r.id === selectedId) ?? null
  const hasRooms = floor.rooms.length > 0
  const firstRun = !doc.floors.some((f) => f.rooms.length)
  const toggle = (room: Room, item: Item) =>
    changeRoom(room.id, (r) => ({ ...r, items: r.items.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)) }))

  const map = hasRooms && (
    <div className="relative h-full">
      <PlanCanvas
        floor={floor}
        imageUrl={imageUrl}
        mode="home"
        tool="select"
        selectedId={selectedId}
        onSelect={onSelect}
        snap={SNAP}
        showBackdrop={showPlan}
        fitRequest={NO_FIT}
        pendingCalibration={null}
        onCalibrate={noop}
        onMessage={noop}
        commit={noop}
        replace={noop}
        checkpoint={noop}
        openTodoCount={openTodoCount}
      />
      {floor.backdrop && (
        <button
          onClick={() => setShowPlan(!showPlan)}
          className={`absolute bottom-3 left-2 rounded-md border px-2 py-1 text-xs shadow-sm ${showPlan ? 'border-stone-800 bg-stone-800 text-white' : 'border-stone-300 bg-white/90 text-stone-600'}`}
        >
          Original plan
        </button>
      )}
    </div>
  )

  const content = (
    <div className="mx-auto max-w-2xl">
      {!hasRooms ? (
        <div className="p-6 text-center">
          <h2 className="text-lg font-semibold">{firstRun ? 'Welcome to Home Hub' : `No rooms on ${floor.name} yet`}</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-stone-500">
            {firstRun
              ? 'Keep TODOs, notes and links organised by room. To start, trace the rooms of your floor plan – you only need to do this once.'
              : 'Trace the rooms of this floor to add things to them.'}
          </p>
          <Button variant="primary" className="mt-4 !px-4 !py-2.5" onClick={onEditPlan}>
            {firstRun ? 'Set up floor plan' : 'Trace this floor'}
          </Button>
        </div>
      ) : selected ? (
        <RoomDetail
          key={selected.id}
          room={selected}
          onChange={(fn, mergeKey) => changeRoom(selected.id, fn, mergeKey)}
          onBack={() => onSelect(null)}
        />
      ) : (
        <Overview rooms={floor.rooms} onOpen={onSelect} onToggle={toggle} />
      )}
    </div>
  )

  const addBar = hasRooms && (
    <AddItemBar
      rooms={floor.rooms}
      roomId={selected?.id}
      onAdd={(roomId, item) => changeRoom(roomId, (r) => ({ ...r, items: [...r.items, item] }))}
    />
  )

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-stone-200 bg-white px-3 py-1.5 pt-[max(env(safe-area-inset-top),0.375rem)]">
        <h1 className="shrink-0 truncate font-semibold">{doc.name}</h1>
        {doc.floors.length > 1 && <FloorTabs floors={doc.floors} current={floor.id} onSelect={onSelectFloor} />}
        <div className="ml-auto shrink-0">
          <Menu items={[{ label: 'Edit floor plan', onClick: onEditPlan }, ...menu]} />
        </div>
      </header>

      {wide ? (
        <div className="flex min-h-0 flex-1">
          {map && <section className="shrink-0 basis-[45%] border-r border-stone-200">{map}</section>}
          <section className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto bg-stone-50">{content}</div>
            {addBar}
          </section>
        </div>
      ) : (
        <>
          <CollapsingMap map={map} resetKey={selectedId}>{content}</CollapsingMap>
          {addBar}
        </>
      )}
    </div>
  )
}

/**
 * The map sits on top of the scrolling content and shrinks as the content
 * scrolls up underneath it, down to a minimum height.
 */
function CollapsingMap({ map, resetKey, children }: { map: ReactNode; resetKey: unknown; children: ReactNode }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)
  const max = Math.round(height * 0.5)
  const min = Math.min(140, max)

  useLayoutEffect(() => {
    const el = scrollRef.current!
    const ro = new ResizeObserver(() => setHeight(el.clientHeight))
    ro.observe(el)
    setHeight(el.clientHeight)
    return () => ro.disconnect()
  }, [])

  const resize = () => {
    if (mapRef.current) mapRef.current.style.height = `${Math.max(min, max - scrollRef.current!.scrollTop)}px`
  }
  useLayoutEffect(resize, [max, min, map])

  // Opening a room while the map is collapsed shows the room from its top.
  useEffect(() => {
    const el = scrollRef.current!
    if (el.scrollTop > max - min) el.scrollTop = max - min
  }, [resetKey])

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={resize}
        className="h-full overflow-y-auto bg-stone-50"
        // sticky headers in the content stop below the collapsed map
        style={{ '--sticky-top': map ? `${min}px` : '0px' } as CSSProperties}
      >
        {/* a spacer rather than padding, which would offset sticky headers too */}
        {map && <div style={{ height: max }} />}
        {/* tall enough that the map can always be collapsed */}
        <div style={{ minHeight: map ? height - min : undefined }}>{children}</div>
      </div>
      {map && (
        <div ref={mapRef} className="absolute inset-x-0 top-0 z-20 border-b border-stone-200 bg-stone-100 shadow-sm">
          {map}
        </div>
      )}
    </div>
  )
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => matchMedia(query).matches)
  useEffect(() => {
    const mq = matchMedia(query)
    const on = () => setMatches(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return matches
}
