import type { Tool } from '../editor/PlanCanvas'
import { Kbd } from './ui'

export const TOOLS: { id: Tool; label: string; key: string; icon: string }[] = [
  { id: 'select', label: 'Select & edit', key: 'V', icon: '↖' },
  { id: 'wand', label: 'Magic wand', key: 'W', icon: '✦' },
  { id: 'rect', label: 'Rectangle', key: 'R', icon: '▭' },
  { id: 'polygon', label: 'Polygon', key: 'P', icon: '⬠' },
  { id: 'split', label: 'Split', key: 'X', icon: '✂' },
  { id: 'calibrate', label: 'Set scale', key: 'S', icon: '↔' },
]

const HINTS: Record<Tool, string[]> = {
  select: ['Click a room to select', 'Drag corners, walls or the whole room', 'Click ◦ on a wall to add a corner', 'Double-click a corner to remove it', 'Del removes the room'],
  wand: ['Click inside a room on the plan to detect its walls', 'Tune detection in the sidebar if it leaks or misses'],
  rect: ['Draw one wall (drag, or click both ends)', 'then click to set the depth'],
  polygon: ['Click to add corners', 'Type a number + ⏎ for an exact wall length', 'Click the first corner or ⏎ to finish', '⌫ removes last corner'],
  split: ['Click a wall to start the cut', 'click inside for bends', 'click the opposite wall to split the room', '⌫ removes last point'],
  calibrate: ['Click both ends of a dimension you know (e.g. a labelled wall)', 'Optionally straighten the plan along it'],
}

export function Toolbar({
  tool, setTool, canUndo, canRedo, undo, redo,
}: {
  tool: Tool
  setTool: (t: Tool) => void
  canUndo: boolean
  canRedo: boolean
  undo: () => void
  redo: () => void
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 flex flex-col items-center gap-2">
      <div className="pointer-events-auto flex items-center gap-0.5 rounded-xl border border-stone-300 bg-white p-1 shadow-sm">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            title={`${t.label} (${t.key})`}
            onClick={() => setTool(t.id)}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm ${
              tool === t.id ? 'bg-blue-600 text-white' : 'text-stone-700 hover:bg-stone-100'
            }`}
          >
            <span className="w-4 text-center">{t.icon}</span>
            <span className="hidden lg:inline">{t.label}</span>
          </button>
        ))}
        <div className="mx-1 h-6 w-px bg-stone-200" />
        <button title="Undo (Ctrl/⌘+Z)" disabled={!canUndo} onClick={undo} className="rounded-lg px-2 py-1.5 text-stone-700 hover:bg-stone-100 disabled:opacity-30">↶</button>
        <button title="Redo (Ctrl/⌘+Shift+Z)" disabled={!canRedo} onClick={redo} className="rounded-lg px-2 py-1.5 text-stone-700 hover:bg-stone-100 disabled:opacity-30">↷</button>
      </div>
      <div className="flex max-w-[90%] flex-wrap justify-center gap-x-3 gap-y-1 rounded-lg bg-stone-900/75 px-3 py-1 text-xs text-stone-100">
        {HINTS[tool].map((h) => <span key={h}>{h}</span>)}
        {tool !== 'select' && (
          <span className="text-stone-300">
            <Kbd>Shift</Kbd> toggle angle snapping · <Kbd>Alt</Kbd> no snapping
          </span>
        )}
        <span className="text-stone-300">
          <Kbd>Space</Kbd>+drag pan · <Kbd>Ctrl</Kbd>+scroll zoom
        </span>
      </div>
    </div>
  )
}
