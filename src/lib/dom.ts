const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file'])

/** True if keyboard shortcuts should be ignored because the user is typing. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el?.closest) return false
  if (el.closest('textarea, select, [contenteditable]')) return true
  const input = el.closest('input')
  return !!input && !NON_TEXT_INPUTS.has(input.type)
}

/** Resolves a theme variable (e.g. `--color-stone-100`) to a `#rrggbb` string, for APIs that can't parse Tailwind's oklch values. */
export function cssColor(variable: string): string {
  const ctx = document.createElement('canvas').getContext('2d')!
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(variable).trim()
  return ctx.fillStyle
}
