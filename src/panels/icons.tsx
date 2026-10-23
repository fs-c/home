import type { CSSProperties, ReactNode } from 'react'

/** A 24×24 stroke icon that takes the current text color. */
function Icon({ children, className = 'h-[18px] w-[18px]', style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <svg
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} style={style}
    >
      {children}
    </svg>
  )
}

/** A compass needle pointing to the plan's "up"; `rotation` (radians) turns it with the view. */
export function CompassIcon({ rotation = 0 }: { rotation?: number }) {
  return (
    <Icon style={{ transform: `rotate(${rotation}rad)` }}>
      <path d="M12 3 16 12H8Z" fill="currentColor" />
      <path d="M8 12h8l-4 9Z" strokeOpacity={0.45} />
    </Icon>
  )
}

export function FitIcon() {
  return (
    <Icon>
      <path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </Icon>
  )
}

/** The scanned / imported floor plan image. */
export function PlanImageIcon() {
  return (
    <Icon>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 12h7v9M10 7v1M14 12h7M14 3v9" />
    </Icon>
  )
}

export function PlusIcon() {
  return (
    <Icon>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  )
}

export function MinusIcon() {
  return (
    <Icon>
      <path d="M5 12h14" />
    </Icon>
  )
}
