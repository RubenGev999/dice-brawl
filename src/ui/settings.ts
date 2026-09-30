import type { StorageLike } from './wallet.ts'

export const SETTINGS_KEY = 'diceBrawl.settings.v1'

export interface Settings {
  readonly fast: boolean
  readonly sound: boolean
  readonly vibration: boolean
}

export const DEFAULT_SETTINGS: Settings = { fast: false, sound: true, vibration: true }

export function parseSettings(raw: string | null): Settings {
  if (raw === null) return DEFAULT_SETTINGS
  try {
    const data: unknown = JSON.parse(raw)
    if (typeof data !== 'object' || data === null) return DEFAULT_SETTINGS
    const rec = data as Record<string, unknown>
    const pick = (key: keyof Settings): boolean => (typeof rec[key] === 'boolean' ? (rec[key] as boolean) : DEFAULT_SETTINGS[key])
    return { fast: pick('fast'), sound: pick('sound'), vibration: pick('vibration') }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function loadSettings(storage: StorageLike | null): Settings {
  try {
    return storage ? parseSettings(storage.getItem(SETTINGS_KEY)) : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(storage: StorageLike | null, settings: Settings): boolean {
  try {
    if (!storage) return false
    storage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    return true
  } catch {
    return false
  }
}

export interface SettingsStore {
  get(): Settings
  set(patch: Partial<Settings>): Settings
  subscribe(listener: (s: Settings) => void): () => void
}

export function createSettingsStore(storage: StorageLike | null): SettingsStore {
  let current = loadSettings(storage)
  const listeners = new Set<(s: Settings) => void>()
  return {
    get: () => current,
    set(patch) {
      const next: Settings = {
        fast: typeof patch.fast === 'boolean' ? patch.fast : current.fast,
        sound: typeof patch.sound === 'boolean' ? patch.sound : current.sound,
        vibration: typeof patch.vibration === 'boolean' ? patch.vibration : current.vibration,
      }
      current = next
      saveSettings(storage, next)
      for (const l of [...listeners]) l(next)
      return next
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
