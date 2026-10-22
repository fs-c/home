import type { Floor, HomeDoc, Item, Room } from '../model/types'
import { HOME_ID, type Entity } from './protocol'

/** An entity as derived from the local doc, before it has a timestamp. */
export type Draft = Omit<Entity, 'ts'>

type FloorData = { name: string; pos: number }
type RoomData = Omit<Room, 'id' | 'items'> & { pos: number }
type ItemData = Omit<Item, 'id'>

/** Splits the doc into independently mergeable pieces. Plan images/backdrops are device-local for now. */
export function flatten(doc: HomeDoc): Map<string, Draft> {
  const out = new Map<string, Draft>()
  out.set(HOME_ID, { id: HOME_ID, kind: 'home', data: { name: doc.name } })
  doc.floors.forEach((f, pos) => {
    out.set(f.id, { id: f.id, kind: 'floor', data: { name: f.name, pos } satisfies FloorData })
    f.rooms.forEach(({ id, items, ...room }, pos) => {
      out.set(id, { id, kind: 'room', parent: f.id, data: { ...room, pos } satisfies RoomData })
      for (const { id: itemId, ...item } of items) {
        out.set(itemId, { id: itemId, kind: 'item', parent: id, data: item satisfies ItemData })
      }
    })
  })
  return out
}

/** Inverse of `flatten`. Orphans (children of deleted parents) are dropped. `local` supplies device-local fields. */
export function build(entities: Iterable<Entity>, local: HomeDoc): HomeDoc {
  const live = [...entities].filter((e) => !e.deleted && e.data !== undefined)
  const home = live.find((e) => e.kind === 'home')?.data as { name: string } | undefined
  const byPos = (a: { pos: number }, b: { pos: number }) => a.pos - b.pos

  const floors: Floor[] = live
    .filter((e) => e.kind === 'floor')
    .map((e) => ({ e, d: e.data as FloorData }))
    .sort((a, b) => byPos(a.d, b.d))
    .map(({ e, d }) => {
      const backdrop = local.floors.find((f) => f.id === e.id)?.backdrop
      const rooms: Room[] = live
        .filter((r) => r.kind === 'room' && r.parent === e.id)
        .map((r) => ({ r, d: r.data as RoomData }))
        .sort((a, b) => byPos(a.d, b.d))
        .map(({ r, d: { pos: _, ...room } }) => ({
          ...room,
          id: r.id,
          items: live
            .filter((i) => i.kind === 'item' && i.parent === r.id)
            .map((i) => ({ ...(i.data as ItemData), id: i.id }))
            .sort((a, b) => a.createdAt - b.createdAt),
        }))
      return { id: e.id, name: d.name, ...(backdrop && { backdrop }), rooms }
    })

  return { version: 1, name: home?.name ?? local.name, floors: floors.length ? floors : local.floors }
}
