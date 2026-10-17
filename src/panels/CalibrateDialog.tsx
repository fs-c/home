import { useState } from 'react'
import { dist } from '../lib/geometry'
import type { Vec } from '../model/types'
import { Button, inputClass } from './ui'

/** Parse "3.5", "3,5 m", "350cm", "3500 mm" into meters. */
export function parseLength(s: string): number | null {
  const m = s.trim().replace(',', '.').match(/^(\d+(?:\.\d+)?)\s*(mm|cm|m)?$/i)
  if (!m) return null
  const v = parseFloat(m[1])
  const unit = (m[2] ?? 'm').toLowerCase()
  const meters = unit === 'mm' ? v / 1000 : unit === 'cm' ? v / 100 : v
  return meters > 0 ? meters : null
}

/** Rotation that makes the line a→b exactly horizontal or vertical (whichever is closer). */
export function straightenAngle(a: Vec, b: Vec): number {
  const phi = Math.atan2(b.y - a.y, b.x - a.x)
  return Math.round(phi / (Math.PI / 2)) * (Math.PI / 2) - phi
}

export function CalibrateDialog({
  line, onApply, onCancel,
}: {
  line: [Vec, Vec]
  onApply: (meters: number, straighten: boolean) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState('')
  const parsed = parseLength(value)
  const current = dist(line[0], line[1])
  const turnDeg = (straightenAngle(line[0], line[1]) * 180) / Math.PI
  const canStraighten = Math.abs(turnDeg) > 0.05
  const [straighten, setStraighten] = useState(canStraighten)
  return (
    <div className="absolute inset-x-0 bottom-0 z-10 flex justify-center p-2">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (parsed) onApply(parsed, straighten && canStraighten)
        }}
        className="w-full max-w-sm rounded-xl border border-stone-300 bg-white p-4 shadow-lg"
      >
        <h3 className="font-semibold">How long is this line in reality?</h3>
        <p className="mt-1 text-xs text-stone-500">
          Use a dimension printed on the plan. The more of the plan the line spans, the more accurate the scale.
          Currently measures {current.toFixed(2)} m.
        </p>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onCancel()}
          placeholder="Length in meters, e.g. 4.25"
          inputMode="decimal"
          className={`${inputClass} mt-3 w-full`}
        />
        {canStraighten && (
          <label className="mt-3 flex items-start gap-2 text-sm text-stone-700">
            <input
              type="checkbox" checked={straighten} onChange={(e) => setStraighten(e.target.checked)}
              className="mt-0.5 accent-blue-600"
            />
            <span>
              Straighten the plan along this line
              <span className="block text-xs text-stone-500">
                Rotates by {turnDeg > 0 ? '+' : ''}{turnDeg.toFixed(1)}° so this wall is {Math.abs(Math.round(Math.atan2(line[1].y - line[0].y, line[1].x - line[0].x) / (Math.PI / 2))) % 2 ? 'vertical' : 'horizontal'}.
              </span>
            </span>
          </label>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!parsed}>Set scale</Button>
        </div>
      </form>
    </div>
  )
}
