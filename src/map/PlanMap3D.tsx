import { useLayoutEffect, useRef, useState } from 'react'
import type { Floor, Room } from '../model/types'
import { MapEngine, type ViewState } from './MapEngine'
import type { MapSettings } from './settings'

/** The floor as a tilted 3D model; tapping a room selects it. */
export function PlanMap3D({
  floor, imageUrl, showBackdrop, selectedId, onSelect, openTodoCount, settings, scroll,
}: {
  floor: Floor
  imageUrl?: string
  showBackdrop: boolean
  selectedId: string | null
  onSelect: (id: string | null) => void
  openTodoCount: (room: Room) => number
  settings: MapSettings
  /** 0 when the page is at its top, 1 once the map has collapsed completely; drives the tilt. */
  scroll: number
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const labelsRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<MapEngine | null>(null)
  const [view, setView] = useState<ViewState>({ rotated: false, fitted: true })
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  const openCounts = Object.fromEntries(floor.rooms.map((r) => [r.id, openTodoCount(r)]))
  const countsKey = JSON.stringify(openCounts)
  const pitch = settings.fixPitch ? settings.fixedPitch : settings.pitchMin + (settings.pitchMax - settings.pitchMin) * scroll

  useLayoutEffect(() => {
    const engine = new MapEngine(hostRef.current!, labelsRef.current!, {
      onSelect: (id) => onSelectRef.current(id),
      onView: setView,
    })
    engineRef.current = engine
    return () => {
      engine.dispose()
      engineRef.current = null
    }
  }, [])

  useLayoutEffect(() => {
    engineRef.current!.setPitch(pitch)
  }, [pitch])

  useLayoutEffect(() => {
    engineRef.current!.setData({
      floor, openCounts, selectedId, settings, backdropUrl: showBackdrop ? imageUrl : undefined,
    })
    // `openCounts` is covered by its key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floor, countsKey, selectedId, settings, imageUrl, showBackdrop])

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      style={{ background: `radial-gradient(ellipse at 50% 40%, ${settings.groundColor}, ${settings.groundColor2})` }}
    >
      <div ref={hostRef} className="absolute inset-0" />
      <div ref={labelsRef} className="pointer-events-none absolute inset-0 overflow-hidden" />
      {(view.rotated || !view.fitted) && (
        <div className="absolute bottom-3 right-3 flex flex-col overflow-hidden rounded-lg border border-stone-300 bg-white/90 shadow-sm backdrop-blur">
          {view.rotated && (
            <button title="Reset rotation" onClick={() => engineRef.current?.resetRotation()} className="h-9 w-9 text-lg font-semibold text-red-600 hover:bg-stone-100">
              ↑
            </button>
          )}
          {!view.fitted && (
            <button title="Fit to content" onClick={() => engineRef.current?.fit()} className="h-9 w-9 text-lg text-stone-600 hover:bg-stone-100">
              ⤢
            </button>
          )}
        </div>
      )}
    </div>
  )
}
