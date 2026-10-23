import { Button, Check, Slider } from '../panels/ui'
import { labelDebug } from './MapEngine'
import { DEFAULT_MAP_SETTINGS, SETTING_GROUPS, type MapSettings } from './settings'

/** A bottom sheet for tweaking the look of the map; the map stays visible above it. */
export function MapSettingsPanel({
  settings, onChange, onClose,
}: {
  settings: MapSettings
  onChange: (s: MapSettings) => void
  onClose: () => void
}) {
  const set = <K extends keyof MapSettings>(key: K, value: MapSettings[K]) => onChange({ ...settings, [key]: value })
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex max-h-[48dvh] flex-col rounded-t-2xl border-t border-line bg-surface/95 shadow-2xl backdrop-blur">
      <div className="flex shrink-0 items-center gap-2 px-4 py-2">
        <h2 className="font-semibold">Map settings</h2>
        <Button className="ml-auto" onClick={() => navigator.clipboard?.writeText(JSON.stringify(settings, null, 2))}>
          Copy JSON
        </Button>
        {settings.debugLabels && (
          <Button onClick={() => navigator.clipboard?.writeText(labelDebug.snapshot)}>Copy labels</Button>
        )}
        <Button onClick={() => onChange(DEFAULT_MAP_SETTINGS)}>Reset</Button>
        <Button variant="primary" onClick={onClose}>Done</Button>
      </div>
      <div className="space-y-4 overflow-y-auto px-4 pb-6 pt-1 pb-[max(env(safe-area-inset-bottom),1.5rem)]">
        {SETTING_GROUPS.map((g) => (
          <section key={g.title} className="space-y-1.5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ghost">{g.title}</h3>
            {g.bools?.map((b) => (
              <Check key={b.key} label={b.label} checked={settings[b.key] as boolean} onChange={(v) => set(b.key, v as never)} />
            ))}
            {g.numbers?.map((n) => (
              <Slider
                key={n.key} label={n.label} min={n.min} max={n.max} step={n.step}
                value={settings[n.key] as number}
                onChange={(v) => set(n.key, v as never)}
                format={(v) => `${v}${n.unit ?? ''}`}
              />
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}
