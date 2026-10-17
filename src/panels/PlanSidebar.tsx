import { useRef } from 'react'
import type { Tool } from '../editor/PlanCanvas'
import type { SnapSettings } from '../editor/snapping'
import { area, fmtArea } from '../lib/geometry'
import type { Backdrop, Floor } from '../model/types'
import { Button, Check, Kbd, Section, Slider } from './ui'

export function PlanSidebar({
  floor, selectedId, onSelect, onUpload, onBackdrop, onRemoveBackdrop, setTool,
  snap, setSnap,
}: {
  floor: Floor
  selectedId: string | null
  onSelect: (id: string) => void
  onUpload: (file: File) => void
  onBackdrop: (patch: Partial<Backdrop>) => void
  onRemoveBackdrop: () => void
  setTool: (t: Tool) => void
  snap: SnapSettings
  setSnap: (s: SnapSettings) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const bd = floor.backdrop
  const total = floor.rooms.reduce((s, r) => s + area(r.points), 0)

  return (
    <div>
      <input
        ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onUpload(f)
          e.target.value = ''
        }}
      />
      <Section step="1" title="Floor plan stencil">
        {!bd ? (
          <button
            onClick={() => fileRef.current?.click()}
            className="w-full rounded-lg border-2 border-dashed border-stone-300 px-4 py-6 text-center text-sm text-stone-500 hover:border-blue-400 hover:bg-blue-50/50"
          >
            <div className="font-medium text-stone-700">Upload your floor plan</div>
            <div className="mt-1 text-xs">Image or PDF – or drop it on the canvas.<br />You can also draw without one.</div>
          </button>
        ) : (
          <div className="space-y-3">
            <Slider
              label="Opacity" value={bd.opacity} min={0.05} max={1} step={0.05}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(opacity) => onBackdrop({ opacity })}
            />
            <Check label="Show stencil" checked={bd.visible} onChange={(visible) => onBackdrop({ visible })} />
            <div className="flex gap-2">
              <Button className="flex-1" onClick={() => fileRef.current?.click()}>Replace…</Button>
              <Button variant="ghost" onClick={onRemoveBackdrop}>Remove</Button>
            </div>
          </div>
        )}
      </Section>

      <Section step="2" title="Scale">
        {!bd ? (
          <p className="text-sm text-stone-500">Upload a plan first.</p>
        ) : bd.calibrated ? (
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

      <Section step="3" title="Rooms" right={floor.rooms.length > 0 && <span className="text-xs text-stone-500">{fmtArea(total)}</span>}>
        {floor.rooms.length === 0 ? (
          <p className="text-sm text-stone-500">
            Draw rooms as <b>rectangles</b> <Kbd>R</Kbd> or <b>polygons</b> <Kbd>P</Kbd>. Corners snap to existing rooms, and new walls snap parallel or perpendicular to existing ones – so on a rotated plan, getting the first wall right makes the rest easy.
            <span className="mt-2 block">
              Or trace the whole outline first, then cut it into rooms with <b>split</b> <Kbd>X</Kbd>.
            </span>
          </p>
        ) : (
          <ul className="-mx-2">
            {floor.rooms.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => onSelect(r.id)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm ${r.id === selectedId ? 'bg-blue-100' : 'hover:bg-stone-100'}`}
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
        <Check label="Snap to corners & walls" checked={snap.enabled} onChange={(enabled) => setSnap({ ...snap, enabled })} hint={<Kbd>Alt</Kbd>} />
        <Check
          label="Snap angles to existing walls (∥ / ⊥)"
          checked={snap.angles}
          onChange={(angles) => setSnap({ ...snap, angles })}
          hint={<Kbd>Shift</Kbd>}
        />
      </Section>
    </div>
  )
}
