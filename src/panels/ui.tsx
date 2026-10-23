import { useEffect, useState, type ReactNode } from 'react'
import type { Floor } from '../model/types'

/** Text inputs are 16px on small screens so iOS doesn't zoom in on focus. */
export const inputClass = 'rounded-md border border-stone-300 bg-white px-2 py-1.5 text-base md:text-sm focus:border-blue-500 focus:outline-none'

export function Section({ title, step, children, right }: { title: string; step?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="border-b border-stone-200 px-4 py-4">
      <div className="mb-3 flex items-center gap-2">
        {step && (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-stone-800 text-[11px] font-semibold text-white">
            {step}
          </span>
        )}
        <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">{title}</h2>
        <div className="ml-auto">{right}</div>
      </div>
      {children}
    </section>
  )
}

export function Button({
  children, onClick, variant = 'default', className = '', title, disabled, autoFocus, type = 'button',
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'default' | 'primary' | 'ghost' | 'danger'
  className?: string
  title?: string
  disabled?: boolean
  autoFocus?: boolean
  type?: 'button' | 'submit'
}) {
  const styles = {
    default: 'border border-stone-300 bg-white hover:bg-stone-50 text-stone-700',
    primary: 'bg-blue-600 hover:bg-blue-700 text-white',
    ghost: 'hover:bg-stone-200/70 text-stone-600',
    danger: 'border border-red-200 bg-white text-red-600 hover:bg-red-50',
  }[variant]
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      autoFocus={autoFocus}
      onClick={onClick}
      className={`rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors disabled:opacity-40 ${styles} ${className}`}
    >
      {children}
    </button>
  )
}

/** A column of icon buttons floating over a map; secondary to the map itself, so it stays quiet. */
export function MapControls({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col divide-y divide-stone-200 overflow-hidden rounded-lg bg-white/80 shadow-sm ring-1 ring-stone-200 backdrop-blur ${className}`}>
      {children}
    </div>
  )
}

/** One button of `MapControls` (or on its own). 36px square: MapEngine keeps labels clear of that size. */
export function MapButton({
  label, onClick, pressed, children,
}: {
  label: string
  onClick: () => void
  /** For toggles: on shows in the accent color. */
  pressed?: boolean
  children: ReactNode
}) {
  return (
    <button
      title={label} aria-label={label} aria-pressed={pressed} onClick={onClick}
      className={`flex h-9 w-9 items-center justify-center transition-colors hover:bg-stone-100 ${pressed ? 'text-blue-600' : 'text-stone-500 hover:text-stone-700'}`}
    >
      {children}
    </button>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-stone-300 bg-stone-50 px-1 py-px font-mono text-[10px] text-stone-600">
      {children}
    </kbd>
  )
}

export function Slider({
  label, value, min, max, step, onChange, format,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  format?: (v: number) => string
}) {
  return (
    <label className="block text-sm">
      <div className="flex justify-between text-stone-600">
        <span>{label}</span>
        <span className="tabular-nums text-stone-500">{format ? format(value) : value}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-blue-600"
      />
    </label>
  )
}

export function Check({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: ReactNode }) {
  return (
    <label className="flex items-center gap-2 py-1.5 text-sm text-stone-700">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-blue-600" />
      <span>{label}</span>
      {hint && <span className="ml-auto">{hint}</span>}
    </label>
  )
}

export function Menu({ items }: { items: { label: string; onClick: () => void }[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        aria-label="Menu" onClick={() => setOpen(!open)}
        className="flex h-9 w-9 items-center justify-center rounded-md text-xl text-stone-600 hover:bg-stone-100"
      >
        ⋯
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 w-52 rounded-lg border border-stone-200 bg-white py-1 shadow-lg">
            {items.map((i) => (
              <button
                key={i.label}
                onClick={() => {
                  setOpen(false)
                  i.onClick()
                }}
                className="block w-full px-4 py-2.5 text-left text-sm text-stone-700 hover:bg-stone-100"
              >
                {i.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/** Modal yes/no question, e.g. before something destructive. Cancel has focus so Enter doesn't confirm by accident. */
export function ConfirmDialog({
  title, children, confirmLabel, danger, onConfirm, onCancel,
}: {
  title: string
  children: ReactNode
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div
      role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" onClick={onCancel}
      className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/50 p-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] sm:items-center"
    >
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
        <h2 id="confirm-title" className="text-lg font-semibold">{title}</h2>
        <div className="mt-1 text-sm text-stone-500">{children}</div>
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" className="!py-2.5 sm:!py-1.5" onClick={onCancel} autoFocus>Cancel</Button>
          <button
            onClick={onConfirm}
            className={`rounded-md px-2.5 py-2.5 text-sm font-medium text-white transition-colors sm:py-1.5 ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export function FloorTabs({
  floors, current, onSelect, onAdd,
}: {
  floors: Floor[]
  current: string
  onSelect: (id: string) => void
  onAdd?: () => void
}) {
  return (
    <nav className="flex min-w-0 items-center gap-1 overflow-x-auto">
      {floors.map((f) => (
        <button
          key={f.id}
          onClick={() => onSelect(f.id)}
          className={`shrink-0 rounded-full px-3 py-1 text-sm ${f.id === current ? 'bg-stone-800 text-white' : 'text-stone-600 hover:bg-stone-100'}`}
        >
          {f.name}
        </button>
      ))}
      {onAdd && (
        <button onClick={onAdd} className="shrink-0 rounded-full px-2.5 py-1 text-sm text-stone-500 hover:bg-stone-100">+ Floor</button>
      )}
    </nav>
  )
}
