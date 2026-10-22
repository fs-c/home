import type { HomeDoc } from '../model/types'
import { build, flatten } from './entities'
import type { Entity } from './protocol'

/** Everything the engine needs to survive a reload (kept in localStorage by the caller). */
export interface SyncState {
  homeId: string
  token: string
  /** Highest server sequence number applied. */
  seq: number
  /** Last state known to be on the server, by id. */
  base: Record<string, Entity>
  /** Local changes the server hasn't acknowledged yet, by id. */
  pending: Record<string, Entity>
  /** Just joined: the local doc is a placeholder until the first `sync` arrives, so don't push it. */
  fresh: boolean
}

/** Deep equality that ignores key order (rebuilt docs list keys differently). */
const canon = (v: unknown) =>
  JSON.stringify(v, (_, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1)))
      : x,
  )
const same = (a: unknown, b: unknown) => canon(a) === canon(b)

/**
 * Pure bookkeeping for one client: turns local doc edits into ops and server
 * changes into doc updates. No I/O, so it can be unit-tested.
 */
export class SyncEngine {
  private lastTs = 0

  constructor(public state: SyncState, private now: () => number = Date.now) {}

  /** Server state with our unacknowledged changes on top. */
  private effective(): Map<string, Entity> {
    const m = new Map(Object.entries(this.state.base))
    for (const [id, e] of Object.entries(this.state.pending)) m.set(id, e)
    return m
  }

  private tick(): number {
    this.lastTs = Math.max(this.now(), this.lastTs + 1)
    return this.lastTs
  }

  /** Call after every local doc change. Returns the ops that became pending. */
  localChanged(doc: HomeDoc): Entity[] {
    if (this.state.fresh) return []
    const eff = this.effective()
    const local = flatten(doc)
    const ops: Entity[] = []
    for (const [id, d] of local) {
      const cur = eff.get(id)
      if (cur && !cur.deleted && cur.parent === d.parent && same(cur.data, d.data)) continue
      ops.push({ ...d, ts: this.tick() })
    }
    for (const [id, cur] of eff) {
      if (cur.deleted || local.has(id)) continue
      ops.push({ id, kind: cur.kind, parent: cur.parent, deleted: true, ts: this.tick() })
    }
    for (const op of ops) this.state.pending[op.id] = op
    return ops
  }

  /** Pending ops to (re)send, e.g. after reconnecting. */
  outbox(): Entity[] {
    return Object.values(this.state.pending)
  }

  /**
   * Applies changes from the server. Returns the new doc if it changed.
   * A pending local change survives only if it is newer than the incoming one.
   */
  receive(changes: Entity[], seq: number, doc: HomeDoc): HomeDoc | null {
    for (const c of changes) {
      const mine = this.state.pending[c.id]
      if (mine && mine.ts >= c.ts) continue
      delete this.state.pending[c.id]
      this.state.base[c.id] = c
    }
    this.state.seq = Math.max(this.state.seq, seq)
    this.state.fresh = false
    const next = build(this.effective().values(), doc)
    return same(next, doc) ? null : next
  }

  /** Handles the server's reply to a batch of ops. Returns the new doc if a losing op changed it. */
  acked(done: { id: string; ts: number }[], lost: Entity[], seq: number, doc: HomeDoc): HomeDoc | null {
    for (const { id, ts } of done) {
      const p = this.state.pending[id]
      if (p && p.ts === ts) {
        delete this.state.pending[id]
        this.state.base[id] = p
      }
    }
    return this.receive(lost, seq, doc)
  }
}
