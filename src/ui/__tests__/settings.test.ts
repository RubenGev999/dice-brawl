import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, SETTINGS_KEY, createSettingsStore, loadSettings, parseSettings, saveSettings } from '../settings.ts'
import type { StorageLike } from '../wallet.ts'

function memory(initial?: string): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>()
  if (initial !== undefined) data.set(SETTINGS_KEY, initial)
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v)
    },
  }
}

const throwing: StorageLike = {
  getItem() {
    throw new Error('blocked')
  },
  setItem() {
    throw new Error('blocked')
  },
}

describe('settings persistence', () => {
  it('defaults to slow, sound on, vibration on', () => {
    expect(DEFAULT_SETTINGS).toEqual({ fast: false, sound: true, vibration: true })
    expect(loadSettings(memory())).toEqual(DEFAULT_SETTINGS)
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS)
  })

  it('round-trips through storage', () => {
    const st = memory()
    expect(saveSettings(st, { fast: true, sound: false, vibration: true })).toBe(true)
    expect(loadSettings(st)).toEqual({ fast: true, sound: false, vibration: true })
  })

  it('ignores corrupt or partial data', () => {
    expect(parseSettings('not json')).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings('null')).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings('42')).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings('{"fast":"yes","sound":false}')).toEqual({ fast: false, sound: false, vibration: true })
  })

  it('never throws when storage throws, and still works in memory', () => {
    expect(loadSettings(throwing)).toEqual(DEFAULT_SETTINGS)
    expect(saveSettings(throwing, DEFAULT_SETTINGS)).toBe(false)
    const store = createSettingsStore(throwing)
    expect(store.get()).toEqual(DEFAULT_SETTINGS)
    expect(() => store.set({ fast: true })).not.toThrow()
    expect(store.get().fast).toBe(true)
  })

  it('loads the stored value into a new store', () => {
    const st = memory()
    createSettingsStore(st).set({ vibration: false })
    expect(createSettingsStore(st).get().vibration).toBe(false)
  })

  it('notifies subscribers and stops after unsubscribe', () => {
    const store = createSettingsStore(memory())
    const seen: boolean[] = []
    const off = store.subscribe((s) => seen.push(s.fast))
    store.set({ fast: true })
    off()
    store.set({ fast: false })
    expect(seen).toEqual([true])
  })

  it('ignores non-boolean patches', () => {
    const store = createSettingsStore(memory())
    store.set({ fast: 'x' as unknown as boolean })
    expect(store.get().fast).toBe(false)
  })
})
