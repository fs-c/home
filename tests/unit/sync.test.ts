import { describe, expect, it } from 'vitest'
import type { HomeDoc } from '../../src/model/types'
import { build, flatten } from '../../src/sync/entities'
import { SyncEngine, type SyncState } from '../../src/sync/engine'
import type { Entity } from '../../src/sync/protocol'

const square = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]

const doc = (): HomeDoc => ({
  version: 1,
  name: 'Home',
  floors: [
    {
      id: 'f1',
      name: 'Ground',
      rooms: [
        { id: 'r1', name: 'Kitchen', color: '#fff', points: square, items: [{ id: 'i1', kind: 'todo', text: 'Fix tap', createdAt: 1 }] },
        { id: 'r2', name: 'Hall', color: '#000', points: square, items: [] },
      ],
    },
  ],
})

const state = (over: Partial<SyncState> = {}): SyncState => ({
  homeId: 'h', token: 't', seq: 0, base: {}, pending: {}, fresh: false, ...over,
})

/** Stand-in for the Durable Object's merge rule. */
class FakeServer {
  entities = new Map<string, Entity>()
  apply(ops: Entity[]) {
    const lost: Entity[] = []
    const accepted: Entity[] = []
    for (const op of ops) {
      const cur = this.entities.get(op.id)
      if (cur && cur.ts > op.ts) lost.push(cur)
      else {
        this.entities.set(op.id, op)
        accepted.push(op)
      }
    }
    return { done: ops.map(({ id, ts }) => ({ id, ts })), lost, accepted }
  }
}

describe('flatten/build', () => {
  it('round-trips a doc', () => {
    const entities = [...flatten(doc()).values()].map((d) => ({ ...d, ts: 1 }))
    expect(build(entities, doc())).toEqual(doc())
  })

  it('drops children of deleted parents and keeps device-local backdrops', () => {
    const d = doc()
    d.floors[0].backdrop = { imageId: 'img', width: 1, height: 1, x: 0, y: 0, scale: 1, opacity: 1, visible: true, calibrated: true }
    const entities = [...flatten(d).values()].map((e) => ({ ...e, ts: 1 }))
    const room = entities.find((e) => e.id === 'r1')!
    Object.assign(room, { deleted: true, data: undefined })
    const out = build(entities, d)
    expect(out.floors[0].rooms.map((r) => r.id)).toEqual(['r2'])
    expect(out.floors[0].backdrop?.imageId).toBe('img')
  })
})

describe('SyncEngine', () => {
  it('uploads the whole doc on first change, then only diffs', () => {
    const e = new SyncEngine(state(), () => 100)
    expect(e.localChanged(doc())).toHaveLength(5) // home, floor, 2 rooms, 1 item
    const d = doc()
    d.floors[0].rooms[0].items[0].done = true
    const ops = e.localChanged(d)
    expect(ops.map((o) => o.id)).toEqual(['i1'])
  })

  it('emits tombstones for deleted entities', () => {
    const e = new SyncEngine(state(), () => 100)
    e.localChanged(doc())
    const d = doc()
    d.floors[0].rooms.pop()
    expect(e.localChanged(d)).toMatchObject([{ id: 'r2', deleted: true }])
  })

  it('does not push the placeholder doc right after joining', () => {
    const e = new SyncEngine(state({ fresh: true }), () => 100)
    expect(e.localChanged(doc())).toEqual([])
  })

  it('converges two clients, last write wins per entity', () => {
    const server = new FakeServer()
    const a = new SyncEngine(state(), () => 100)
    const b = new SyncEngine(state(), () => 200)
    let da = doc()
    let db = doc()

    const ops = a.localChanged(da)
    const r = server.apply(ops)
    a.acked(r.done, r.lost, 1, da)
    db = b.receive(r.accepted, 1, db) ?? db
    expect(b.localChanged(db)).toEqual([])

    // Both edit the same item while apart; b is later.
    da = doc()
    da.floors[0].rooms[0].items[0].text = 'from a'
    db = structuredClone(db)
    db.floors[0].rooms[0].items[0].text = 'from b'
    const opsB = b.localChanged(db)
    const opsA = a.localChanged(da)
    const rb = server.apply(opsB)
    const ra = server.apply(opsA)
    expect(ra.lost).toHaveLength(1)
    expect(rb.accepted).toHaveLength(1)

    const nextA = a.acked(ra.done, ra.lost, 3, da)
    expect(nextA?.floors[0].rooms[0].items[0].text).toBe('from b')
  })

  it('keeps a newer pending local change over an older incoming one', () => {
    const e = new SyncEngine(state(), () => 500)
    const d = doc()
    e.localChanged(d)
    const incoming: Entity = { id: 'r1', kind: 'room', parent: 'f1', data: { name: 'Old', color: '#fff', points: square, pos: 0 }, ts: 10 }
    expect(e.receive([incoming], 1, d)).toBeNull()
    expect(e.state.pending.r1).toBeDefined()
  })

  it('applies a remote delete', () => {
    const e = new SyncEngine(state(), () => 100)
    const d = doc()
    const ops = e.localChanged(d)
    e.acked(ops.map(({ id, ts }) => ({ id, ts })), [], 1, d)
    const out = e.receive([{ id: 'r2', kind: 'room', parent: 'f1', deleted: true, ts: 999 }], 2, d)
    expect(out?.floors[0].rooms.map((r) => r.id)).toEqual(['r1'])
  })
})
