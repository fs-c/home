import { useState } from 'react'
import { area, fmtArea } from '../lib/geometry'
import { uid } from '../model/ids'
import type { Item, ItemKind, Room } from '../model/types'
import { Button, inputClass } from './ui'

const KIND_LABEL: Record<ItemKind, string> = { todo: 'TODO', note: 'Note', link: 'Link' }

export const openTodos = (r: Room) => r.items.filter((i) => i.kind === 'todo' && !i.done)

function Swatch({ color }: { color: string }) {
  return <span className="h-3 w-3 shrink-0 rounded-sm border border-stone-400" style={{ background: color }} />
}

function summary(room: Room) {
  const n = (k: ItemKind) => room.items.filter((i) => i.kind === k).length
  const parts = [
    n('note') && `${n('note')} note${n('note') > 1 ? 's' : ''}`,
    n('link') && `${n('link')} link${n('link') > 1 ? 's' : ''}`,
  ].filter(Boolean)
  return parts.join(' · ')
}

/** All rooms of a floor with their open TODOs. */
export function Overview({
  rooms, onOpen, onToggle,
}: {
  rooms: Room[]
  onOpen: (id: string) => void
  onToggle: (room: Room, item: Item) => void
}) {
  const total = rooms.reduce((s, r) => s + openTodos(r).length, 0)
  return (
    <div className="space-y-2 p-3">
      <p className="px-1 text-sm text-stone-500">
        {total ? `${total} open TODO${total > 1 ? 's' : ''}` : 'No open TODOs 🎉'}
      </p>
      {rooms.map((room) => {
        const open = openTodos(room)
        return (
          <div key={room.id} className="rounded-xl border border-stone-200 bg-white">
            <button onClick={() => onOpen(room.id)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
              <Swatch color={room.color} />
              <span className="flex-1 truncate font-medium">{room.name}</span>
              <span className="text-xs text-stone-400">{summary(room)}</span>
              <span className="text-stone-400">›</span>
            </button>
            {open.length > 0 && (
              <ul className="border-t border-stone-100 px-3 py-1">
                {open.map((item) => (
                  <li key={item.id} className="flex items-start gap-3 py-1.5">
                    <input
                      type="checkbox" checked={false} onChange={() => onToggle(room, item)}
                      aria-label={`Done: ${item.text}`}
                      className="mt-0.5 h-5 w-5 shrink-0 accent-blue-600"
                    />
                    <button onClick={() => onOpen(room.id)} className="min-w-0 flex-1 text-left text-sm">{item.text}</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Everything attached to one room. */
export function RoomDetail({
  room, onChange, onBack,
}: {
  room: Room
  onChange: (fn: (r: Room) => Room, mergeKey?: string) => void
  onBack: () => void
}) {
  const updateItem = (id: string, patch: Partial<Item>) =>
    onChange(
      (r) => ({ ...r, items: r.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }),
      'text' in patch ? `item:${id}` : undefined,
    )
  const removeItem = (id: string) => onChange((r) => ({ ...r, items: r.items.filter((i) => i.id !== id) }))

  const todos = room.items.filter((i) => i.kind === 'todo').sort((a, b) => Number(a.done) - Number(b.done))
  const others = room.items.filter((i) => i.kind !== 'todo')

  return (
    <div>
      <div className="sticky top-(--sticky-top,0px) z-10 flex items-center gap-1 border-b border-stone-200 bg-white px-1 py-1.5">
        <button onClick={onBack} className="rounded-md px-2.5 py-1.5 text-sm text-blue-700 hover:bg-stone-100">‹ All rooms</button>
        <Swatch color={room.color} />
        <input
          value={room.name}
          onChange={(e) => onChange((r) => ({ ...r, name: e.target.value }), `name:${room.id}`)}
          aria-label="Room name"
          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-base font-semibold hover:border-stone-300 focus:border-blue-500 focus:outline-none"
        />
        <span className="shrink-0 pr-2 text-xs text-stone-400">{fmtArea(area(room.points))}</span>
      </div>
      <div className="p-3">
        <ItemGroup title="TODOs" items={todos} onUpdate={updateItem} onRemove={removeItem} />
        <ItemGroup title="Notes & links" items={others} onUpdate={updateItem} onRemove={removeItem} />
        {room.items.length === 0 && (
          <p className="px-1 text-sm text-stone-500">Nothing here yet. Add TODOs, notes or links to things about this room (manuals, paint colours, measurements, …).</p>
        )}
      </div>
    </div>
  )
}

function ItemGroup({
  title, items, onUpdate, onRemove,
}: {
  title: string
  items: Item[]
  onUpdate: (id: string, patch: Partial<Item>) => void
  onRemove: (id: string) => void
}) {
  if (!items.length) return null
  return (
    <div className="mb-5">
      <h3 className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-stone-500">{title}</h3>
      <ul>
        {items.map((item) => (
          <li key={item.id} className="flex items-start gap-3 rounded-md px-1 py-1.5">
            {item.kind === 'todo' ? (
              <input
                type="checkbox" checked={!!item.done} aria-label="Done"
                className="mt-0.5 h-5 w-5 shrink-0 accent-blue-600"
                onChange={(e) => onUpdate(item.id, { done: e.target.checked })}
              />
            ) : (
              <span className="w-5 shrink-0 text-center text-sm text-stone-400">{item.kind === 'link' ? '↗\uFE0E' : '¶'}</span>
            )}
            <div className="min-w-0 flex-1 text-base md:text-sm">
              {item.kind === 'link' && item.url ? (
                <a href={item.url} target="_blank" rel="noreferrer" className="break-words text-blue-700 hover:underline">
                  {item.text}
                </a>
              ) : (
                <textarea
                  value={item.text}
                  rows={1}
                  onChange={(e) => onUpdate(item.id, { text: e.target.value })}
                  className={`field-sizing-content w-full resize-none bg-transparent focus:outline-none ${item.done ? 'text-stone-400 line-through' : ''}`}
                />
              )}
            </div>
            <button
              onClick={() => onRemove(item.id)}
              className="-my-1 shrink-0 rounded px-2 py-1 text-sm text-stone-300 hover:text-red-600"
              aria-label="Remove"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Quick capture. Without a fixed `roomId`, the room is picked here. */
export function AddItemBar({
  rooms, roomId, onAdd,
}: {
  rooms: Room[]
  roomId?: string
  onAdd: (roomId: string, item: Item) => void
}) {
  const [kind, setKind] = useState<ItemKind>('todo')
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const target = roomId ?? rooms.find((r) => r.id === picked)?.id ?? rooms[0]?.id

  const add = () => {
    if (!target || (!text.trim() && !(kind === 'link' && url.trim()))) return
    onAdd(target, {
      id: uid(), kind, text: text.trim() || url.trim(), createdAt: Date.now(),
      ...(kind === 'todo' ? { done: false } : {}),
      ...(kind === 'link' ? { url: normalizeUrl(url.trim()) } : {}),
    })
    setText('')
    setUrl('')
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        add()
      }}
      className="shrink-0 border-t border-stone-200 bg-stone-50 px-3 pt-2 pb-[max(env(safe-area-inset-bottom),0.5rem)]"
    >
      <div className="mb-2 flex items-center gap-1">
        {(['todo', 'note', 'link'] as ItemKind[]).map((k) => (
          <button
            key={k} type="button"
            onClick={() => setKind(k)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${kind === k ? 'bg-stone-800 text-white' : 'text-stone-600 hover:bg-stone-200'}`}
          >
            {KIND_LABEL[k]}
          </button>
        ))}
        {!roomId && (
          <label className="ml-auto flex min-w-0 items-center gap-1 text-xs text-stone-500">
            in
            <select
              value={target} onChange={(e) => setPicked(e.target.value)}
              className="min-w-0 rounded-md border border-stone-300 bg-white px-1.5 py-1 text-sm text-stone-800"
            >
              {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
        )}
      </div>
      {kind === 'link' && (
        <input
          value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" inputMode="url"
          className={`${inputClass} mb-1.5 w-full`}
        />
      )}
      <div className="flex gap-1.5">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={kind === 'todo' ? 'e.g. Replace radiator valve' : kind === 'note' ? 'e.g. Wall paint: RAL 9010' : 'Title (optional)'}
          className={`${inputClass} min-w-0 flex-1`}
        />
        <Button type="submit" variant="primary">Add</Button>
      </div>
    </form>
  )
}

function normalizeUrl(u: string) {
  return /^[a-z]+:\/\//i.test(u) ? u : `https://${u}`
}
