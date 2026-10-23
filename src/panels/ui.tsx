import { useEffect, useState, type ReactNode } from 'react'
import type { Floor } from '../model/types'

/** Text inputs are 16px on small screens so iOS doesn't zoom in on focus. */
export const inputClass = 'rounded-md border border-line-strong bg-surface px-2 py-1.5 text-base md:text-sm focus:border-blue-500 focus:outline-none'

export function Section({ title, step, children, right }: { title: string; step?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="border-b border-line px-4 py-4">
      <div className="mb-3 flex items-center gap-2">
        {step && (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-white">
            {step}
          </span>
        )}
        <h2 className="text-xs font-semibold uppercase tracking-wide text-faint">{title}</h2>
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
    default: 'border border-line-strong bg-surface hover:bg-subtle text-ink-soft',
    primary: 'bg-accent hover:bg-accent-strong text-white',
    ghost: 'hover:bg-sunken/70 text-muted',
    danger: 'border border-red-200 bg-surface text-danger hover:bg-red-50',
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

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-line-strong bg-subtle px-1 py-px font-mono text-[10px] text-muted">
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
      <div className="flex justify-between text-muted">
        <span>{label}</span>
        <span className="tabular-nums text-faint">{format ? format(value) : value}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-accent"
      />
    </label>
  )
}

export function Check({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: ReactNode }) {
  return (
    <label className="flex items-center gap-2 py-1.5 text-sm text-ink-soft">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-accent" />
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
        className="flex h-9 w-9 items-center justify-center rounded-md text-xl text-muted hover:bg-canvas"
      >
        ⋯
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 w-52 rounded-lg border border-line bg-surface py-1 shadow-lg">
            {items.map((i) => (
              <button
                key={i.label}
                onClick={() => {
                  setOpen(false)
                  i.onClick()
                }}
                className="block w-full px-4 py-2.5 text-left text-sm text-ink-soft hover:bg-canvas"
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
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-2xl bg-surface p-5 shadow-2xl">
        <h2 id="confirm-title" className="text-lg font-semibold">{title}</h2>
        <div className="mt-1 text-sm text-faint">{children}</div>
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" className="!py-2.5 sm:!py-1.5" onClick={onCancel} autoFocus>Cancel</Button>
          <button
            onClick={onConfirm}
            className={`rounded-md px-2.5 py-2.5 text-sm font-medium text-white transition-colors sm:py-1.5 ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-accent hover:bg-accent-strong'}`}
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
          className={`shrink-0 rounded-full px-3 py-1 text-sm ${f.id === current ? 'bg-ink text-white' : 'text-muted hover:bg-canvas'}`}
        >
          {f.name}
        </button>
      ))}
      {onAdd && (
        <button onClick={onAdd} className="shrink-0 rounded-full px-2.5 py-1 text-sm text-faint hover:bg-canvas">+ Floor</button>
      )}
    </nav>
  )
}
