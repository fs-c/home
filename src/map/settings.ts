import { useEffect, useState } from 'react'

/** Everything that shapes the look of the 3D home map. Distances are in meters, angles in degrees. */
export interface MapSettings {
  // camera
  pitchMin: number
  pitchMax: number
  /** Ignore the scroll position and always use `fixedPitch`. */
  fixPitch: boolean
  fixedPitch: number
  fov: number
  // geometry
  wallHeight: number
  wallThickness: number
  floorThickness: number
  /** Selected room's floor rises by this much. */
  selectedLift: number
  // look
  /** How much rooms without open TODOs fade towards white (0–1). */
  idleFade: number
  // light
  ambient: number
  sun: number
  sunAzimuth: number
  sunElevation: number
  /** Keep the sun fixed relative to the screen instead of the plan, so shadows don't swing around when rotating. */
  sunFollowsCamera: boolean
  shadows: boolean
  shadowStrength: number
  shadowSoftness: number
  // labels
  labels: boolean
  /** Move every label out to the screen edges instead of keeping those that fit inside their room. */
  floatLabels: boolean
  /** Record the label layout and its costs, to copy from the settings panel. */
  debugLabels: boolean
  labelSize: number
}

export const DEFAULT_MAP_SETTINGS: MapSettings = {
  pitchMin: 25,
  pitchMax: 52,
  fixPitch: false,
  fixedPitch: 45,
  fov: 24,
  wallHeight: 0.35,
  wallThickness: 0.14,
  floorThickness: 0.12,
  selectedLift: 0.08,
  idleFade: 0.55,
  ambient: 1.4,
  sun: 1.9,
  sunAzimuth: 300,
  sunElevation: 48,
  sunFollowsCamera: true,
  shadows: true,
  shadowStrength: 0.35,
  shadowSoftness: 3,
  labels: true,
  floatLabels: true,
  debugLabels: false,
  labelSize: 1,
}

type Num = { key: keyof MapSettings; label: string; min: number; max: number; step: number; unit?: string }
type Bool = { key: keyof MapSettings; label: string }

/** Drives the settings panel, so a new setting only needs an entry here and in the interface/defaults. */
export const SETTING_GROUPS: { title: string; numbers?: Num[]; bools?: Bool[] }[] = [
  {
    title: 'Camera',
    bools: [{ key: 'fixPitch', label: 'Fixed tilt (ignore scrolling)' }],
    numbers: [
      { key: 'fixedPitch', label: 'Fixed tilt', min: 5, max: 80, step: 1, unit: '°' },
      { key: 'pitchMin', label: 'Tilt at top of page', min: 5, max: 80, step: 1, unit: '°' },
      { key: 'pitchMax', label: 'Tilt when scrolled', min: 5, max: 80, step: 1, unit: '°' },
      { key: 'fov', label: 'Field of view (perspective)', min: 8, max: 60, step: 1, unit: '°' },
    ],
  },
  {
    title: 'Geometry',
    numbers: [
      { key: 'wallHeight', label: 'Wall height', min: 0, max: 1.5, step: 0.05, unit: ' m' },
      { key: 'wallThickness', label: 'Wall thickness', min: 0.02, max: 0.4, step: 0.01, unit: ' m' },
      { key: 'floorThickness', label: 'Floor slab thickness', min: 0.01, max: 0.5, step: 0.01, unit: ' m' },
      { key: 'selectedLift', label: 'Selected room lift', min: 0, max: 0.4, step: 0.01, unit: ' m' },
    ],
  },
  {
    title: 'Look',
    numbers: [{ key: 'idleFade', label: 'Fade rooms without TODOs', min: 0, max: 1, step: 0.05 }],
  },
  {
    title: 'Light',
    bools: [
      { key: 'sunFollowsCamera', label: 'Sun follows the view' },
      { key: 'shadows', label: 'Shadows' },
    ],
    numbers: [
      { key: 'ambient', label: 'Ambient light', min: 0, max: 3, step: 0.05 },
      { key: 'sun', label: 'Sun', min: 0, max: 5, step: 0.05 },
      { key: 'sunAzimuth', label: 'Sun direction', min: 0, max: 360, step: 5, unit: '°' },
      { key: 'sunElevation', label: 'Sun height', min: 10, max: 90, step: 1, unit: '°' },
      { key: 'shadowStrength', label: 'Shadow strength', min: 0, max: 1, step: 0.05 },
      { key: 'shadowSoftness', label: 'Shadow softness', min: 0, max: 8, step: 0.5 },
    ],
  },
  {
    title: 'Labels',
    bools: [
      { key: 'labels', label: 'Show room names' },
      { key: 'floatLabels', label: 'Float all labels to the screen edges' },
      { key: 'debugLabels', label: 'Debug: record label layout' },
    ],
    numbers: [{ key: 'labelSize', label: 'Label size', min: 0.6, max: 1.8, step: 0.05, unit: '×' }],
  },
]

const KEY = 'home-hub:map-settings:v1'

/** Keeps only stored values that match the type of the default, with numbers clamped to their slider range. */
function sanitize(raw: unknown): MapSettings {
  const out: Record<string, unknown> = { ...DEFAULT_MAP_SETTINGS }
  const stored = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const ranges = new Map(SETTING_GROUPS.flatMap((g) => g.numbers ?? []).map((n) => [n.key, n]))
  for (const [k, def] of Object.entries(DEFAULT_MAP_SETTINGS)) {
    const v = stored[k]
    if (typeof v !== typeof def) continue
    if (typeof v === 'number') {
      const r = ranges.get(k as keyof MapSettings)
      if (!Number.isFinite(v)) continue
      out[k] = r ? Math.min(r.max, Math.max(r.min, v)) : v
    } else out[k] = v
  }
  return out as unknown as MapSettings
}

function load(): MapSettings {
  try {
    return sanitize(JSON.parse(localStorage.getItem(KEY) ?? '{}'))
  } catch {
    return DEFAULT_MAP_SETTINGS
  }
}

export function useMapSettings() {
  const [settings, setSettings] = useState<MapSettings>(load)
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings))
    } catch {
      // not persisting is fine
    }
  }, [settings])
  return [settings, setSettings] as const
}
