/** World coordinates are in meters. */
export type Vec = { x: number; y: number }

export type ItemKind = 'note' | 'todo' | 'link'

export interface Item {
  id: string
  kind: ItemKind
  text: string
  url?: string
  done?: boolean
  createdAt: number
}

export interface Room {
  id: string
  name: string
  color: string
  points: Vec[]
  items: Item[]
}

/** The uploaded plan image used as a tracing stencil. */
export interface Backdrop {
  imageId: string
  /** Natural image size in pixels. */
  width: number
  height: number
  /** World position of the image's top-left corner. */
  x: number
  y: number
  /** Meters per image pixel. */
  scale: number
  /** Rotation (radians) about the top-left corner, e.g. to straighten a skewed plan. */
  rotation?: number
  opacity: number
  visible: boolean
  calibrated: boolean
}

export interface Floor {
  id: string
  name: string
  backdrop?: Backdrop
  rooms: Room[]
}

export interface HomeDoc {
  version: 1
  name: string
  floors: Floor[]
}
