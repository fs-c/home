import type { Floor, Item, Room } from '../model/types'
import { Section } from './ui'

export function HomeSidebar({
  floor, selectedId, onSelect, onToggleTodo,
}: {
  floor: Floor
  selectedId: string | null
  onSelect: (id: string) => void
  onToggleTodo: (room: Room, item: Item) => void
}) {
  const open = floor.rooms.flatMap((room) =>
    room.items.filter((i) => i.kind === 'todo' && !i.done).map((item) => ({ room, item })),
  )
  return (
    <div>
      <Section title="Rooms">
        {floor.rooms.length === 0 ? (
          <p className="text-sm text-stone-500">No rooms on this floor yet – switch to <b>Plan</b> to trace them.</p>
        ) : (
          <ul className="-mx-2">
            {floor.rooms.map((r) => {
              const n = r.items.filter((i) => i.kind === 'todo' && !i.done).length
              return (
                <li key={r.id}>
                  <button
                    onClick={() => onSelect(r.id)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${r.id === selectedId ? 'bg-blue-100' : 'hover:bg-stone-100'}`}
                  >
                    <span className="h-3 w-3 shrink-0 rounded-sm border border-stone-400" style={{ background: r.color }} />
                    <span className="flex-1 truncate">{r.name}</span>
                    {n > 0 && <span className="rounded-full bg-amber-100 px-1.5 text-xs text-amber-800">{n}</span>}
                    {r.items.length - n > 0 && <span className="text-xs text-stone-400">{r.items.length} items</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </Section>
      <Section title="Open TODOs" right={<span className="text-xs text-stone-500">{open.length}</span>}>
        {open.length === 0 ? (
          <p className="text-sm text-stone-500">All done 🎉</p>
        ) : (
          <ul className="space-y-1">
            {open.map(({ room, item }) => (
              <li key={item.id} className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1 accent-blue-600" checked={false} onChange={() => onToggleTodo(room, item)} />
                <button onClick={() => onSelect(room.id)} className="min-w-0 flex-1 text-left">
                  <span className="block truncate">{item.text}</span>
                  <span className="text-xs text-stone-500">{room.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}
