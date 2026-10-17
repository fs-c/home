import { useState } from 'react'
import { area, fmtArea, fmtLen, perimeter } from '../lib/geometry'
import { ROOM_COLORS } from '../model/doc'
import { uid } from '../model/ids'
import type { Item, ItemKind, Room } from '../model/types'
import { Button } from './ui'

const KIND_LABEL: Record<ItemKind, string> = { todo: 'TODO', note: 'Note', link: 'Link' }

export function RoomPanel({
  room, editing, onChange, onDelete, onClose,
}: {
  room: Room
  editing: boolean
  onChange: (fn: (r: Room) => Room, mergeKey?: string) => void
  onDelete: () => void
  onClose: () => void
}) {
  const [kind, setKind] = useState<ItemKind>('todo')
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')

  const addItem = () => {
    if (!text.trim() && !(kind === 'link' && url.trim())) return
    const item: Item = {
      id: uid(), kind, text: text.trim() || url.trim(), createdAt: Date.now(),
      ...(kind === 'todo' ? { done: false } : {}),
      ...(kind === 'link' ? { url: normalizeUrl(url.trim()) } : {}),
    }
    onChange((r) => ({ ...r, items: [...r.items, item] }))
    setText('')
    setUrl('')
  }

  const updateItem = (id: string, patch: Partial<Item>) =>
    onChange(
      (r) => ({ ...r, items: r.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }),
      'text' in patch ? `item:${id}` : undefined,
    )
  const removeItem = (id: string) => onChange((r) => ({ ...r, items: r.items.filter((i) => i.id !== id) }))

  const todos = room.items.filter((i) => i.kind === 'todo').sort((a, b) => Number(a.done) - Number(b.done))
  const others = room.items.filter((i) => i.kind !== 'todo')

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-stone-200 p-4">
        <div className="flex items-start gap-2">
          <input
            value={room.name}
            onChange={(e) => onChange((r) => ({ ...r, name: e.target.value }), `name:${room.id}`)}
            className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-lg font-semibold hover:border-stone-300 focus:border-blue-500 focus:outline-none"
          />
          <button onClick={onClose} className="rounded px-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700" title="Close (Esc)">✕</button>
        </div>
        <div className="mt-1 flex gap-3 px-1 text-xs text-stone-500">
          <span>{fmtArea(area(room.points))}</span>
          <span>perimeter {fmtLen(perimeter(room.points))}</span>
          {editing && <span>{room.points.length} corners</span>}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5 px-1">
          {ROOM_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => onChange((r) => ({ ...r, color: c }))}
              className={`h-5 w-5 rounded-full border ${room.color === c ? 'ring-2 ring-blue-500 ring-offset-1' : 'border-stone-300'}`}
              style={{ background: c }}
            />
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <ItemGroup title="TODOs" items={todos} onUpdate={updateItem} onRemove={removeItem} />
        <ItemGroup title="Notes & links" items={others} onUpdate={updateItem} onRemove={removeItem} />
        {room.items.length === 0 && (
          <p className="text-sm text-stone-500">Nothing here yet. Add TODOs, notes or links to things about this room (manuals, paint colors, measurements, …).</p>
        )}
      </div>

      <div className="border-t border-stone-200 bg-stone-50 p-3">
        <div className="mb-2 flex gap-1">
          {(['todo', 'note', 'link'] as ItemKind[]).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`rounded-md px-2 py-0.5 text-xs font-medium ${kind === k ? 'bg-stone-800 text-white' : 'text-stone-600 hover:bg-stone-200'}`}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            addItem()
          }}
          className="flex flex-col gap-1.5"
        >
          {kind === 'link' && (
            <input
              value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…"
              className="rounded-md border border-stone-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
            />
          )}
          <div className="flex gap-1.5">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={kind === 'todo' ? 'e.g. Replace radiator valve' : kind === 'note' ? 'e.g. Wall paint: RAL 9010' : 'Title (optional)'}
              className="min-w-0 flex-1 rounded-md border border-stone-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
            />
            <Button type="submit" variant="primary" className="!py-1">Add</Button>
          </div>
        </form>
        {editing && (
          <Button variant="danger" className="mt-3 w-full" onClick={onDelete}>Delete room</Button>
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
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">{title}</h3>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.id} className="group flex items-start gap-2 rounded-md px-1 py-1 hover:bg-stone-50">
            {item.kind === 'todo' ? (
              <input
                type="checkbox" checked={!!item.done} className="mt-1 accent-blue-600"
                onChange={(e) => onUpdate(item.id, { done: e.target.checked })}
              />
            ) : (
              <span className="mt-0.5 w-3.5 text-center text-xs text-stone-400">{item.kind === 'link' ? '↗' : '¶'}</span>
            )}
            <div className="min-w-0 flex-1 text-sm">
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
              className="invisible text-xs text-stone-400 hover:text-red-600 group-hover:visible"
              title="Remove"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function normalizeUrl(u: string) {
  return /^[a-z]+:\/\//i.test(u) ? u : `https://${u}`
}
