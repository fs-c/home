import { useCallback, useRef, useState } from 'react'

interface History<T> {
  past: T[]
  present: T
  future: T[]
}

const LIMIT = 200

/**
 * Undo/redo state. `commit` records a step; `replace` changes the present
 * without recording (used during drags, after a `checkpoint`).
 * Commits with the same `mergeKey` in quick succession (e.g. typing) are
 * merged into one undo step.
 */
export function useHistory<T>(initial: () => T) {
  const [h, setH] = useState<History<T>>(() => ({ past: [], present: initial(), future: [] }))

  const lastMerge = useRef<{ key: string; at: number } | null>(null)

  const commit = useCallback((fn: (prev: T) => T, mergeKey?: string) => {
    const now = Date.now()
    const merge = !!mergeKey && lastMerge.current?.key === mergeKey && now - lastMerge.current.at < 1500
    lastMerge.current = mergeKey ? { key: mergeKey, at: now } : null
    setH((s) => {
      const next = fn(s.present)
      if (next === s.present) return s
      if (merge) return { ...s, present: next, future: [] }
      return { past: [...s.past, s.present].slice(-LIMIT), present: next, future: [] }
    })
  }, [])

  const replace = useCallback((fn: (prev: T) => T) => {
    setH((s) => ({ ...s, present: fn(s.present) }))
  }, [])

  const checkpoint = useCallback(() => {
    setH((s) => ({ past: [...s.past, s.present].slice(-LIMIT), present: s.present, future: [] }))
  }, [])

  const undo = useCallback(() => {
    setH((s) => {
      if (!s.past.length) return s
      return { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] }
    })
  }, [])

  const redo = useCallback(() => {
    setH((s) => {
      if (!s.future.length) return s
      return { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) }
    })
  }, [])

  const reset = useCallback((value: T) => setH({ past: [], present: value, future: [] }), [])

  return {
    present: h.present,
    canUndo: h.past.length > 0,
    canRedo: h.future.length > 0,
    commit,
    replace,
    checkpoint,
    undo,
    redo,
    reset,
  }
}
