import type { ReactNode } from 'react'

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
  children, onClick, variant = 'default', className = '', title, disabled, type = 'button',
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'default' | 'primary' | 'ghost' | 'danger'
  className?: string
  title?: string
  disabled?: boolean
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
      onClick={onClick}
      className={`rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors disabled:opacity-40 ${styles} ${className}`}
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
    <label className="flex items-center gap-2 py-0.5 text-sm text-stone-700">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-blue-600" />
      <span>{label}</span>
      {hint && <span className="ml-auto">{hint}</span>}
    </label>
  )
}
