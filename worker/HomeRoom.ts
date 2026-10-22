import { DurableObject } from 'cloudflare:workers'
import {
  MAX_MESSAGE_BYTES, MAX_OPS,
  type ClientMessage, type Entity, type EntityKind, type ServerMessage,
} from '../src/sync/protocol'

const KINDS: EntityKind[] = ['home', 'floor', 'room', 'item']
const MAX_DATA_BYTES = 64 * 1024

interface Row extends Record<string, SqlStorageValue> {
  id: string
  kind: EntityKind
  parent: string | null
  data: string | null
  deleted: number
  ts: number
  seq: number
}

/**
 * One shared home. Holds every entity (including tombstones) in SQLite and
 * relays changes between connected clients. The first client to say hello
 * claims the home with its token; later clients must present the same one.
 */
export class HomeRoom extends DurableObject {
  private sql = this.ctx.storage.sql

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, parent TEXT, data TEXT,
        deleted INTEGER NOT NULL DEFAULT 0, ts INTEGER NOT NULL, seq INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS entities_seq ON entities (seq);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `)
  }

  fetch(): Response {
    const pair = new WebSocketPair()
    this.ctx.acceptWebSocket(pair[1])
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_BYTES) return this.fail(ws, 'too-large')
    let msg: ClientMessage
    try {
      msg = JSON.parse(raw)
    } catch {
      return this.fail(ws, 'bad-request')
    }

    if (msg.type === 'hello') return this.hello(ws, msg)
    if (msg.type === 'ops' && ws.deserializeAttachment()?.authed) return this.ops(ws, msg.ops)
    this.fail(ws, ws.deserializeAttachment()?.authed ? 'bad-request' : 'unauthorized')
  }

  private hello(ws: WebSocket, { token, since }: Extract<ClientMessage, { type: 'hello' }>) {
    if (typeof token !== 'string' || token.length < 16 || typeof since !== 'number') return this.fail(ws, 'bad-request')
    const stored = this.sql.exec<{ value: string }>(`SELECT value FROM meta WHERE key = 'token'`).toArray()[0]?.value
    if (stored === undefined) this.sql.exec(`INSERT INTO meta VALUES ('token', ?)`, token)
    else if (stored !== token) return this.fail(ws, 'unauthorized')

    ws.serializeAttachment({ authed: true })
    const changes = this.sql.exec<Row>(`SELECT * FROM entities WHERE seq > ? ORDER BY seq`, since).toArray().map(toEntity)
    this.send(ws, { type: 'sync', changes, seq: this.seq() })
  }

  private ops(ws: WebSocket, ops: Entity[]) {
    if (!Array.isArray(ops) || ops.length > MAX_OPS) return this.fail(ws, 'bad-request')
    const done: { id: string; ts: number }[] = []
    const lost: Entity[] = []
    const accepted: Entity[] = []
    let seq = this.seq()

    for (const op of ops) {
      const data = op?.deleted ? null : JSON.stringify(op?.data)
      if (
        typeof op?.id !== 'string' || !KINDS.includes(op.kind) || typeof op.ts !== 'number' ||
        (data !== null && (data === undefined || data.length > MAX_DATA_BYTES))
      ) {
        return this.fail(ws, 'bad-request')
      }
      const cur = this.sql.exec<Row>(`SELECT * FROM entities WHERE id = ?`, op.id).toArray()[0]
      done.push({ id: op.id, ts: op.ts })
      if (cur && cur.ts > op.ts) {
        lost.push(toEntity(cur))
        continue
      }
      seq++
      this.sql.exec(
        `INSERT OR REPLACE INTO entities (id, kind, parent, data, deleted, ts, seq) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        op.id, op.kind, op.parent ?? null, data, op.deleted ? 1 : 0, op.ts, seq,
      )
      accepted.push(op)
    }

    this.send(ws, { type: 'ack', done, lost, seq })
    if (accepted.length) {
      for (const other of this.ctx.getWebSockets()) {
        if (other !== ws && other.deserializeAttachment()?.authed) this.send(other, { type: 'changes', changes: accepted, seq })
      }
    }
  }

  private seq(): number {
    return this.sql.exec<{ s: number }>(`SELECT COALESCE(MAX(seq), 0) AS s FROM entities`).one().s
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    ws.send(JSON.stringify(msg))
  }

  private fail(ws: WebSocket, reason: Extract<ServerMessage, { type: 'error' }>['reason']) {
    this.send(ws, { type: 'error', reason })
    ws.close(1008, reason)
  }
}

function toEntity(r: Row): Entity {
  return {
    id: r.id,
    kind: r.kind,
    ...(r.parent !== null && { parent: r.parent }),
    ...(r.deleted ? { deleted: true } : { data: JSON.parse(r.data as string) }),
    ts: r.ts,
  }
}
