/** A scroll position that can change many times a second without re-rendering React. */
export interface ScrollProgress {
  /** 0 when the page is at its top, 1 once the map has collapsed completely. */
  value: number
  /** Height of the map in px at a progress, or undefined if the map doesn't scroll. */
  heightAt: (t: number) => number | undefined
  subscribe: (fn: () => void) => () => void
}

export function createScrollProgress() {
  const subs = new Set<() => void>()
  let range: { max: number; min: number } | null = null
  const store = {
    value: 0,
    heightAt: (t: number) => (range ? range.max - t * (range.max - range.min) : undefined),
    subscribe: (fn: () => void) => {
      subs.add(fn)
      return () => void subs.delete(fn)
    },
    set: (v: number) => {
      if (v === store.value) return
      store.value = v
      subs.forEach((fn) => fn())
    },
    /** The map's height when the page is at its top and when it is collapsed. */
    setRange: (max: number, min: number) => {
      if (range?.max === max && range.min === min) return
      range = { max, min }
      subs.forEach((fn) => fn())
    },
  }
  return store
}
