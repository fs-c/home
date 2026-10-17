import { uid } from './ids'
import type { Floor, HomeDoc, Room } from './types'

export const ROOM_COLORS = [
  '#93c5fd', '#86efac', '#fcd34d', '#f9a8d4', '#c4b5fd',
  '#fdba74', '#5eead4', '#fca5a5', '#bef264', '#a5b4fc',
]

export function newFloor(name: string): Floor {
  return { id: uid(), name, rooms: [] }
}

export function newDoc(): HomeDoc {
  return { version: 1, name: 'My Home', floors: [newFloor('Ground floor')] }
}

export function nextRoomColor(floor: Floor): string {
  return ROOM_COLORS[floor.rooms.length % ROOM_COLORS.length]
}

export function nextRoomName(floor: Floor): string {
  let n = floor.rooms.length + 1
  while (floor.rooms.some((r) => r.name === `Room ${n}`)) n++
  return `Room ${n}`
}

export function updateFloor(doc: HomeDoc, floorId: string, fn: (f: Floor) => Floor): HomeDoc {
  return { ...doc, floors: doc.floors.map((f) => (f.id === floorId ? fn(f) : f)) }
}

export function updateRoom(doc: HomeDoc, floorId: string, roomId: string, fn: (r: Room) => Room): HomeDoc {
  return updateFloor(doc, floorId, (f) => ({
    ...f,
    rooms: f.rooms.map((r) => (r.id === roomId ? fn(r) : r)),
  }))
}
