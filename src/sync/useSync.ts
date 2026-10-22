import { useCallback, useEffect, useRef, useState } from 'react'
import { uid } from '../model/ids'
import type { HomeDoc } from '../model/types'
import { SyncEngine, type SyncState } from './engine'
import type { ClientMessage, Entity, ServerMessage } from './protocol'

const STATE_KEY = 'home-hub:sync:v1'
const MAX_BACKOFF_MS = 30_000

export type SyncStatus = 'off' | 'connecting' | 'online' | 'offline' | 'denied'

function loadState(): SyncState | null {
  try {
    const raw = localStorage.getItem(STATE_KEY)
    return raw ? (JSON.parse(raw) as SyncState) : null
  } catch {
    return null
  }
}

function saveState(state: SyncState | null) {
  try {
    if (state) localStorage.setItem(STATE_KEY, JSON.stringify(state))
    else localStorage.removeItem(STATE_KEY)
  } catch {
    // Without storage we just lose offline edits across reloads.
  }
}

function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
}

export function inviteLink(state: Pick<SyncState, 'homeId' | 'token'>): string {
  return `${location.origin}/#join=${state.homeId}.${state.token}`
}

export function parseInvite(hash: string): { homeId: string; token: string } | null {
  const m = /^#join=([\w-]{8,64})\.([0-9a-f]{32})$/.exec(hash)
  return m && { homeId: m[1], token: m[2] }
}

/**
 * Keeps `doc` in sync with a shared home on the server (see worker/HomeRoom.ts).
 * Remote changes come in through `setDoc`, which should not create an undo step.
 * Local-first: edits apply immediately and are queued while offline.
 */
export function useSync(doc: HomeDoc, setDoc: (doc: HomeDoc) => void) {
  const [state, setState] = useState<SyncState | null>(loadState)
  const [status, setStatus] = useState<SyncStatus>('off')
  const engine = useRef<SyncEngine | null>(null)
  const ws = useRef<WebSocket | null>(null)
  const ready = useRef(false)
  const docRef = useRef(doc)
  docRef.current = doc

  const homeId = state?.homeId
  const token = state?.token

  const send = (msg: ClientMessage) => ws.current?.send(JSON.stringify(msg))
  const pushOps = (ops: Entity[]) => {
    if (ready.current && ops.length) send({ type: 'ops', ops })
  }

  // (Re)connect whenever the shared home changes.
  useEffect(() => {
    if (!homeId || !token) {
      engine.current = null
      setStatus('off')
      return
    }
    const eng = (engine.current = new SyncEngine(loadState() as SyncState))
    let closed = false
    let retry: ReturnType<typeof setTimeout> | undefined
    let backoff = 1000

    const apply = (next: HomeDoc | null) => {
      saveState(eng.state)
      if (next) {
        docRef.current = next
        setDoc(next)
      }
    }

    const connect = () => {
      setStatus('connecting')
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const socket = (ws.current = new WebSocket(`${proto}://${location.host}/api/homes/${homeId}/ws`))
      socket.onopen = () => send({ type: 'hello', token, since: eng.state.seq })
      socket.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as ServerMessage
        if (msg.type === 'sync') {
          apply(eng.receive(msg.changes, msg.seq, docRef.current))
          ready.current = true
          backoff = 1000
          setStatus('online')
          // Edits made since the last sync (offline, or the initial upload when sharing starts).
          eng.localChanged(docRef.current)
          saveState(eng.state)
          pushOps(eng.outbox())
        } else if (msg.type === 'changes') {
          apply(eng.receive(msg.changes, msg.seq, docRef.current))
        } else if (msg.type === 'ack') {
          apply(eng.acked(msg.done, msg.lost, msg.seq, docRef.current))
        } else if (msg.type === 'error' && msg.reason === 'unauthorized') {
          closed = true
          setStatus('denied')
        }
      }
      socket.onclose = () => {
        ready.current = false
        if (closed) return
        setStatus('offline')
        retry = setTimeout(connect, backoff)
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
      }
    }

    const onOnline = () => {
      if (ws.current?.readyState !== WebSocket.OPEN) {
        clearTimeout(retry)
        backoff = 1000
        connect()
      }
    }
    window.addEventListener('online', onOnline)
    connect()
    return () => {
      closed = true
      clearTimeout(retry)
      window.removeEventListener('online', onOnline)
      ready.current = false
      ws.current?.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homeId, token])

  // Queue and send local edits.
  useEffect(() => {
    const eng = engine.current
    if (!eng) return
    const ops = eng.localChanged(doc)
    if (ops.length) saveState(eng.state)
    pushOps(ops)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc])

  const begin = useCallback((next: SyncState) => {
    saveState(next)
    setState(next)
  }, [])

  /** Publishes this device's data as a new shared home. Returns the invite link. */
  const start = useCallback(() => {
    const next: SyncState = { homeId: uid(), token: randomToken(), seq: 0, base: {}, pending: {}, fresh: false }
    begin(next)
    return inviteLink(next)
  }, [begin])

  /** Replaces this device's data with the shared home from an invite. */
  const join = useCallback(
    (invite: { homeId: string; token: string }) =>
      begin({ ...invite, seq: 0, base: {}, pending: {}, fresh: true }),
    [begin],
  )

  /** Stops syncing on this device. The shared home itself stays available to others. */
  const stop = useCallback(() => {
    saveState(null)
    setState(null)
  }, [])

  return { status, state, start, join, stop }
}
