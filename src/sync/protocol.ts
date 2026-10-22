/**
 * Wire format shared by the client (src/sync) and the Durable Object (worker/).
 *
 * The document is flattened into entities (home, floors, rooms, items). Each
 * entity is merged independently, last write (by `ts`) wins. Deletions are
 * tombstones so they can propagate to peers that were offline.
 */

export type EntityKind = 'home' | 'floor' | 'room' | 'item'

export interface Entity {
  id: string
  kind: EntityKind
  /** Floor for rooms, room for items. */
  parent?: string
  /** JSON-serialisable payload; absent on tombstones. */
  data?: unknown
  deleted?: boolean
  /** Client clock (ms), made monotonic per client. Decides the winner. */
  ts: number
}

export type ClientMessage =
  | { type: 'hello'; token: string; since: number }
  | { type: 'ops'; ops: Entity[] }

export type ServerMessage =
  /** Everything newer than `since`, sent in reply to `hello`. */
  | { type: 'sync'; changes: Entity[]; seq: number }
  /** Changes made by other clients. */
  | { type: 'changes'; changes: Entity[]; seq: number }
  /** Reply to `ops`: which were processed, and the current winners for those that lost. */
  | { type: 'ack'; done: { id: string; ts: number }[]; lost: Entity[]; seq: number }
  | { type: 'error'; reason: 'unauthorized' | 'too-large' | 'bad-request' }

export const HOME_ID = 'home'
export const MAX_MESSAGE_BYTES = 512 * 1024
export const MAX_OPS = 500
