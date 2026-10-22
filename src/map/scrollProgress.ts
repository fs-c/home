/** A scroll position that can change many times a second without re-rendering React. */
export interface ScrollProgress {
  /** 0 when the page is at its top, 1 once the map has collapsed completely. */
  value: number
  subscribe: (fn: () => void) => () => void
}

export function createScrollProgress(): ScrollProgress & { set: (v: number) => void } {
  const subs = new Set<() => void>()
  const store = {
    value: 0,
    subscribe: (fn: () => void) => {
      subs.add(fn)
      return () => void subs.delete(fn)
    },
    set: (v: number) => {
      if (v === store.value) return
      store.value = v
      subs.forEach((fn) => fn())
    },
  }
  return store
}
