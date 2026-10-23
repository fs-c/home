import type { Tool } from '../editor/PlanCanvas'
import { Kbd } from './ui'

export const TOOLS: { id: Tool; label: string; key: string; icon: string }[] = [
  { id: 'select', label: 'Select', key: 'V', icon: '↖\uFE0E' },
  { id: 'polygon', label: 'Draw', key: 'D', icon: '⬠' },
  { id: 'calibrate', label: 'Scale', key: 'S', icon: '↔\uFE0E' },
]

const HINTS: Record<Tool, string> = {
  select: 'Select a room to edit it: drag its corners or walls, ◦ on a wall adds a corner',
  polygon: 'Place the corners, then close on the first one · draw across a room, wall to wall, to split it',
  calibrate: 'Place both ends of a dimension you know, e.g. a labelled wall',
}

const KEY_HINTS: Partial<Record<Tool, string>> = {
  select: 'Double-click a corner to remove it · Del removes the room',
  polygon: 'Type a number + ⏎ for an exact wall length · ⌫ removes the last corner',
}

export function ToolHint({ tool }: { tool: Tool }) {
  return (
    <div className="max-w-md rounded-lg bg-stone-900/80 px-3 py-1.5 text-center text-xs text-stone-100">
      {HINTS[tool]}
      {/* keyboard and mouse extras only matter with a mouse */}
      <span className="hidden pointer-fine:block mt-0.5 text-stone-300">
        {KEY_HINTS[tool] && <>{KEY_HINTS[tool]} · </>}
        {tool !== 'select' && <><Kbd>Shift</Kbd> angle snapping · <Kbd>Alt</Kbd> no snapping · </>}
        <Kbd>Space</Kbd>+drag pan · <Kbd>Ctrl</Kbd>+scroll zoom
      </span>
    </div>
  )
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
  const btn = 'flex min-w-0 flex-1 md:max-w-24 flex-col items-center gap-0.5 rounded-lg py-1.5 text-[11px] font-medium'
  return (
    <nav className="flex shrink-0 items-stretch justify-center gap-0.5 border-t border-line bg-surface px-1 pt-1 pb-[max(env(safe-area-inset-bottom),0.25rem)]">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          title={`${t.label} (${t.key})`}
          onClick={() => setTool(t.id)}
          className={`${btn} ${tool === t.id ? 'bg-accent text-white' : 'text-muted hover:bg-canvas'}`}
        >
          <span className="text-lg leading-6">{t.icon}</span>
          {t.label}
        </button>
      ))}
      <div className="mx-0.5 my-2 w-px bg-sunken" />
      <button title="Undo (Ctrl/⌘+Z)" disabled={!canUndo} onClick={undo} className={`${btn} text-muted hover:bg-canvas disabled:opacity-30`}>
        <span className="text-lg leading-6">↶</span>Undo
      </button>
      <button title="Redo (Ctrl/⌘+Shift+Z)" disabled={!canRedo} onClick={redo} className={`${btn} text-muted hover:bg-canvas disabled:opacity-30`}>
        <span className="text-lg leading-6">↷</span>Redo
      </button>
    </nav>
  )
}
