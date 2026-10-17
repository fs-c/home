import type { Tool } from '../editor/PlanCanvas'
import type { SnapSettings } from '../editor/snapping'
import { area, fmtArea } from '../lib/geometry'
import type { Backdrop, Floor } from '../model/types'
import { Button, Check, Kbd, Section, Slider, inputClass } from './ui'

/** Everything about the plan that isn't drawing: stencil, scale, floor, snapping. */
export function PlanSettings({
  floor, canDeleteFloor, selectedId, onSelect, onPickFile, onBackdrop, onRemoveBackdrop, setTool,
  onRenameFloor, onDeleteFloor, snap, setSnap, onClose,
}: {
  floor: Floor
  canDeleteFloor: boolean
  selectedId: string | null
  onSelect: (id: string) => void
  onPickFile: () => void
  onBackdrop: (patch: Partial<Backdrop>) => void
  onRemoveBackdrop: () => void
  setTool: (t: Tool) => void
  onRenameFloor: (name: string) => void
  onDeleteFloor: () => void
  snap: SnapSettings
  setSnap: (s: SnapSettings) => void
  onClose: () => void
}) {
  const bd = floor.backdrop
  const total = floor.rooms.reduce((s, r) => s + area(r.points), 0)

  return (
    <>
      <div className="absolute inset-0 z-20 bg-stone-900/20 md:hidden" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 z-20 max-h-[80%] overflow-y-auto rounded-t-2xl bg-white shadow-xl md:inset-y-0 md:left-0 md:right-auto md:max-h-none md:w-80 md:rounded-none md:border-r md:border-stone-200">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-200 bg-white px-4 py-2">
          <h2 className="font-semibold">Plan settings</h2>
          <button onClick={onClose} className="rounded px-2 py-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700" aria-label="Close">✕</button>
        </div>

        <Section title="Floor">
          <input
            value={floor.name}
            onChange={(e) => onRenameFloor(e.target.value)}
            className={`${inputClass} w-full`}
          />
          {canDeleteFloor && (
            <Button variant="danger" className="mt-2 w-full" onClick={onDeleteFloor}>Delete this floor</Button>
          )}
        </Section>

        <Section title="Floor plan stencil">
          {!bd ? (
            <Button variant="primary" className="w-full" onClick={onPickFile}>Upload floor plan (image or PDF)</Button>
          ) : (
            <div className="space-y-3">
              <Slider
                label="Opacity" value={bd.opacity} min={0.05} max={1} step={0.05}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(opacity) => onBackdrop({ opacity })}
              />
              <Check label="Show stencil" checked={bd.visible} onChange={(visible) => onBackdrop({ visible })} />
              <div className="flex gap-2">
                <Button className="flex-1" onClick={onPickFile}>Replace…</Button>
                <Button variant="ghost" onClick={onRemoveBackdrop}>Remove</Button>
              </div>
            </div>
          )}
        </Section>

        {bd && (
          <Section title="Scale">
            {bd.calibrated ? (
              <div className="flex items-center justify-between text-sm">
                <span className="text-stone-600">✓ 1 m ≈ {Math.round(1 / bd.scale)} px</span>
                <Button variant="ghost" onClick={() => setTool('calibrate')}>Re-measure</Button>
              </div>
            ) : (
              <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                <p>Not set yet – measurements and areas are guesses until you do.</p>
                <Button variant="primary" className="mt-2 w-full" onClick={() => setTool('calibrate')}>
                  Set scale from a known length
                </Button>
              </div>
            )}
          </Section>
        )}

        <Section title="Rooms" right={floor.rooms.length > 0 && <span className="text-xs text-stone-500">{fmtArea(total)}</span>}>
          {floor.rooms.length === 0 ? (
            <p className="text-sm text-stone-500">
              Draw rooms as <b>rectangles</b> or <b>polygons</b>. Corners snap to existing rooms, and new walls snap parallel or perpendicular to existing ones. Or trace the whole outline first, then cut it into rooms with <b>split</b>.
            </p>
          ) : (
            <ul className="-mx-2">
              {floor.rooms.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => onSelect(r.id)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm ${r.id === selectedId ? 'bg-blue-100' : 'hover:bg-stone-100'}`}
                  >
                    <span className="h-3 w-3 shrink-0 rounded-sm border border-stone-400" style={{ background: r.color }} />
                    <span className="flex-1 truncate">{r.name}</span>
                    <span className="text-xs tabular-nums text-stone-500">{fmtArea(area(r.points))}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Snapping">
          <Check label="Snap to corners & walls" checked={snap.enabled} onChange={(enabled) => setSnap({ ...snap, enabled })} hint={<span className="hidden pointer-fine:inline"><Kbd>Alt</Kbd></span>} />
          <Check
            label="Snap angles to existing walls (∥ / ⊥)"
            checked={snap.angles}
            onChange={(angles) => setSnap({ ...snap, angles })}
            hint={<span className="hidden pointer-fine:inline"><Kbd>Shift</Kbd></span>}
          />
        </Section>
      </div>
    </>
  )
}
