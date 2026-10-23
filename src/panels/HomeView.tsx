import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { MapSettingsPanel } from '../map/MapSettingsPanel'
import { PlanMap3D } from '../map/PlanMap3D'
import { createScrollProgress, type ScrollProgress } from '../map/scrollProgress'
import { useMapSettings } from '../map/settings'
import type { Floor, HomeDoc, Item, Room } from '../model/types'
import { AddItemBar, Overview, RoomDetail, openTodos } from './RoomContent'
import { PlanImageIcon } from './icons'
import { Button, FloorTabs, MapButton, MapControls, Menu } from './ui'

const openTodoCount = (r: Room) => openTodos(r).length

/** The progress of a map that is always fully shown (the side-by-side layout). */
const fullyScrolled: ScrollProgress = { value: 1, heightAt: () => undefined, subscribe: () => () => {} }

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
  const [mapSettings, setMapSettings] = useMapSettings()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const wide = useMediaQuery('(min-width: 768px)')
  const selected = floor.rooms.find((r) => r.id === selectedId) ?? null
  const hasRooms = floor.rooms.length > 0
  const firstRun = !doc.floors.some((f) => f.rooms.length)
  const toggle = (room: Room, item: Item) =>
    changeRoom(room.id, (r) => ({ ...r, items: r.items.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)) }))

  /** `scroll`: how far the page is scrolled over the map, from 0 to 1. */
  const map = hasRooms && ((scroll: ScrollProgress) => (
    <div className="relative h-full">
      <PlanMap3D
        floor={floor}
        imageUrl={imageUrl}
        showBackdrop={showPlan}
        selectedId={selectedId}
        onSelect={onSelect}
        openTodoCount={openTodoCount}
        settings={mapSettings}
        scroll={scroll}
      />
      {floor.backdrop && (
        <MapControls className="absolute bottom-3 left-3">
          <MapButton label={showPlan ? 'Hide original plan' : 'Show original plan'} pressed={showPlan} onClick={() => setShowPlan(!showPlan)}>
            <PlanImageIcon />
          </MapButton>
        </MapControls>
      )}
    </div>
  ))

  const content = (
    <div className="mx-auto max-w-2xl">
      {!hasRooms ? (
        <div className="p-6 text-center">
          <h2 className="text-lg font-semibold">{firstRun ? 'Welcome to Home Hub' : `No rooms on ${floor.name} yet`}</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-faint">
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
      <header className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-3 py-1.5 pt-[max(env(safe-area-inset-top),0.375rem)]">
        <h1 className="shrink-0 truncate font-semibold">{doc.name}</h1>
        {doc.floors.length > 1 && <FloorTabs floors={doc.floors} current={floor.id} onSelect={onSelectFloor} />}
        <div className="ml-auto shrink-0">
          <Menu items={[{ label: 'Edit floor plan', onClick: onEditPlan }, { label: 'Map settings', onClick: () => setSettingsOpen(true) }, ...menu]} />
        </div>
      </header>

      {wide ? (
        <div className="flex min-h-0 flex-1">
          {map && <section className="shrink-0 basis-[45%] border-r border-line">{map(fullyScrolled)}</section>}
          <section className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto bg-subtle">{content}</div>
            {addBar}
          </section>
        </div>
      ) : (
        <>
          <CollapsingMap map={map} resetKey={selectedId}>{content}</CollapsingMap>
          {addBar}
        </>
      )}
      {settingsOpen && <MapSettingsPanel settings={mapSettings} onChange={setMapSettings} onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}

/**
 * The map sits on top of the scrolling content and shrinks as the content
 * scrolls up underneath it, down to a minimum height.
 */
function CollapsingMap({ map, resetKey, children }: { map: false | ((scroll: ScrollProgress) => ReactNode); resetKey: unknown; children: ReactNode }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)
  const [progress] = useState(createScrollProgress)
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
    const top = scrollRef.current!.scrollTop
    if (mapRef.current) mapRef.current.style.height = `${Math.max(min, max - top)}px`
    progress.set(max > min ? Math.min(1, Math.max(0, top / (max - min))) : 1)
  }
  useLayoutEffect(() => {
    progress.setRange(max, min)
    resize()
  }, [max, min, !!map])

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
        className="h-full overflow-y-auto bg-subtle"
        // sticky headers in the content stop below the collapsed map
        style={{ '--sticky-top': map ? `${min}px` : '0px' } as CSSProperties}
      >
        {/* a spacer rather than padding, which would offset sticky headers too */}
        {map && <div style={{ height: max }} />}
        {/* tall enough that the map can always be collapsed */}
        <div style={{ minHeight: map ? height - min : undefined }}>{children}</div>
      </div>
      {map && (
        <div ref={mapRef} className="absolute inset-x-0 top-0 z-20 border-b border-line bg-canvas shadow-sm">
          {map(progress)}
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
