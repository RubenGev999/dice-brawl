export type Cue =
  | 'roll'
  | 'hitDealt'
  | 'hitTaken'
  | 'crit'
  | 'block'
  | 'heal'
  | 'escape'
  | 'koWin'
  | 'koLoss'
  | 'boss'
  | 'tick'
  | 'coins'
  | 'stageCleared'
  | 'upgrade'
  | 'failed'
  | 'tap'

export interface Feedback {
  unlock(): void
  play(cue: Cue): void
  setSound(on: boolean): void
  setVibration(on: boolean): void
  dispose(): void
}

export const silentFeedback: Feedback = {
  unlock() {},
  play() {},
  setSound() {},
  setVibration() {},
  dispose() {},
}

export interface RecordingFeedback extends Feedback {
  readonly played: Cue[]
  readonly state: { sound: boolean; vibration: boolean; unlocked: boolean; disposed: boolean }
}

export function recordingFeedback(): RecordingFeedback {
  const played: Cue[] = []
  const state = { sound: true, vibration: true, unlocked: false, disposed: false }
  return {
    played,
    state,
    unlock() {
      state.unlocked = true
    },
    play(cue) {
      played.push(cue)
    },
    setSound(on) {
      state.sound = on
    },
    setVibration(on) {
      state.vibration = on
    },
    dispose() {
      state.disposed = true
    },
  }
}

export type ImpactStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'
export type NotificationStyle = 'success' | 'warning' | 'error'

export interface HapticSpec {
  readonly vibrate: number | ReadonlyArray<number>
  readonly telegram: { readonly kind: 'impact'; readonly style: ImpactStyle } | { readonly kind: 'notification'; readonly style: NotificationStyle }
}

const HAPTICS: Readonly<Partial<Record<Cue, HapticSpec>>> = {
  hitDealt: { vibrate: 12, telegram: { kind: 'impact', style: 'light' } },
  hitTaken: { vibrate: 38, telegram: { kind: 'impact', style: 'heavy' } },
  crit: { vibrate: [24, 30, 46], telegram: { kind: 'impact', style: 'rigid' } },
  block: { vibrate: 18, telegram: { kind: 'impact', style: 'medium' } },
  boss: { vibrate: [40, 40, 60], telegram: { kind: 'impact', style: 'medium' } },
  koWin: { vibrate: [30, 40, 30, 40, 70], telegram: { kind: 'notification', style: 'success' } },
  koLoss: { vibrate: [90, 50, 130], telegram: { kind: 'notification', style: 'error' } },
  stageCleared: { vibrate: [30, 50, 30, 50, 30, 50, 120], telegram: { kind: 'notification', style: 'success' } },
  failed: { vibrate: [70, 40, 70], telegram: { kind: 'notification', style: 'error' } },
  upgrade: { vibrate: 14, telegram: { kind: 'impact', style: 'light' } },
  escape: { vibrate: [20, 30, 20], telegram: { kind: 'notification', style: 'warning' } },
}

export function hapticFor(cue: Cue): HapticSpec | null {
  return HAPTICS[cue] ?? null
}

interface TelegramHaptics {
  impactOccurred?(style: string): void
  notificationOccurred?(type: string): void
}

export interface FeedbackEnv {
  readonly audio?: (() => AudioContext | null) | null
  readonly vibrate?: ((pattern: number | number[]) => boolean) | null
  readonly telegram?: (() => TelegramHaptics | null) | null
}

function defaultEnv(): FeedbackEnv {
  return {
    audio: () => {
      const g = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
      const Ctor = g.AudioContext ?? g.webkitAudioContext
      return Ctor ? new Ctor() : null
    },
    vibrate: (pattern) => {
      const nav = (globalThis as { navigator?: Navigator }).navigator
      return nav && typeof nav.vibrate === 'function' ? nav.vibrate(pattern) : false
    },
    telegram: () => {
      const w = globalThis as unknown as { Telegram?: { WebApp?: { HapticFeedback?: TelegramHaptics } } }
      return w.Telegram?.WebApp?.HapticFeedback ?? null
    },
  }
}

interface Voice {
  readonly ctx: AudioContext
  readonly out: AudioNode
  readonly at: number
  readonly noise: AudioBuffer
  readonly track: (node: AudioScheduledSourceNode, chain: AudioNode[]) => void
}

function tone(v: Voice, type: OscillatorType, from: number, to: number, start: number, dur: number, gain: number): void {
  const osc = v.ctx.createOscillator()
  const g = v.ctx.createGain()
  const t0 = v.at + start
  osc.type = type
  osc.frequency.setValueAtTime(from, t0)
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.012, dur / 3))
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(g)
  g.connect(v.out)
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
  v.track(osc, [osc, g])
}

function burst(v: Voice, freq: number, q: number, start: number, dur: number, gain: number, kind: BiquadFilterType = 'bandpass'): void {
  const src = v.ctx.createBufferSource()
  src.buffer = v.noise
  const filter = v.ctx.createBiquadFilter()
  filter.type = kind
  filter.frequency.value = freq
  filter.Q.value = q
  const g = v.ctx.createGain()
  const t0 = v.at + start
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.006)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  src.connect(filter)
  filter.connect(g)
  g.connect(v.out)
  src.start(t0)
  src.stop(t0 + dur + 0.02)
  v.track(src, [src, filter, g])
}

const NOTE = { c5: 523.25, e5: 659.25, g5: 783.99, c6: 1046.5, a4: 440, e4: 329.63, g4: 392 }

const RECIPES: Readonly<Record<Cue, (v: Voice) => void>> = {
  roll(v) {
    burst(v, 1900, 3, 0, 0.05, 0.22)
    burst(v, 2400, 3, 0.07, 0.05, 0.2)
    burst(v, 1600, 3, 0.14, 0.06, 0.24)
    tone(v, 'triangle', 220, 420, 0, 0.2, 0.05)
  },
  hitDealt(v) {
    tone(v, 'sine', 200, 70, 0, 0.16, 0.5)
    burst(v, 1200, 0.8, 0, 0.07, 0.3)
  },
  hitTaken(v) {
    tone(v, 'sawtooth', 150, 48, 0, 0.24, 0.32)
    burst(v, 500, 0.7, 0, 0.12, 0.34, 'lowpass')
  },
  crit(v) {
    tone(v, 'triangle', 520, 1500, 0, 0.16, 0.28)
    tone(v, 'sine', 180, 60, 0, 0.2, 0.5)
    burst(v, 3000, 1.2, 0, 0.09, 0.26)
  },
  block(v) {
    tone(v, 'square', 940, 900, 0, 0.14, 0.14)
    tone(v, 'square', 1410, 1380, 0, 0.1, 0.09)
    burst(v, 4200, 4, 0, 0.05, 0.16)
  },
  heal(v) {
    tone(v, 'sine', NOTE.c5, NOTE.c5, 0, 0.16, 0.22)
    tone(v, 'sine', NOTE.g5, NOTE.g5, 0.09, 0.22, 0.22)
  },
  escape(v) {
    burst(v, 700, 1, 0, 0.3, 0.22)
    tone(v, 'triangle', 300, 900, 0, 0.28, 0.12)
  },
  koWin(v) {
    const notes = [NOTE.g4, NOTE.c5, NOTE.e5, NOTE.g5]
    notes.forEach((f, i) => tone(v, 'triangle', f, f, i * 0.075, 0.22, 0.3))
    tone(v, 'sine', 160, 55, 0, 0.2, 0.4)
  },
  koLoss(v) {
    tone(v, 'sawtooth', 320, 70, 0, 0.55, 0.26)
    tone(v, 'sine', 120, 40, 0.05, 0.5, 0.4)
  },
  boss(v) {
    tone(v, 'sawtooth', 95, 55, 0, 0.7, 0.22)
    tone(v, 'sine', 48, 42, 0, 0.7, 0.45)
    burst(v, 220, 0.6, 0, 0.5, 0.2, 'lowpass')
  },
  tick(v) {
    tone(v, 'square', 1500, 1500, 0, 0.022, 0.05)
  },
  coins(v) {
    tone(v, 'square', 1480, 1480, 0, 0.09, 0.08)
    tone(v, 'square', 1975, 1975, 0.07, 0.14, 0.08)
  },
  stageCleared(v) {
    const notes = [NOTE.c5, NOTE.e5, NOTE.g5, NOTE.c6, NOTE.g5, NOTE.c6]
    notes.forEach((f, i) => tone(v, 'square', f, f, i * 0.09, i === notes.length - 1 ? 0.5 : 0.16, 0.16))
    tone(v, 'triangle', NOTE.c5 / 2, NOTE.c5 / 2, 0, 0.7, 0.3)
  },
  upgrade(v) {
    tone(v, 'triangle', 660, 660, 0, 0.12, 0.24)
    tone(v, 'triangle', 990, 990, 0.08, 0.2, 0.24)
    burst(v, 5000, 3, 0.08, 0.1, 0.08)
  },
  failed(v) {
    tone(v, 'triangle', NOTE.a4, NOTE.a4, 0, 0.26, 0.26)
    tone(v, 'triangle', NOTE.e4, NOTE.e4 * 0.94, 0.22, 0.5, 0.26)
  },
  tap(v) {
    tone(v, 'sine', 880, 760, 0, 0.03, 0.05)
  },
}

const MASTER_GAIN = 0.32
const MAX_ACTIVE_SOURCES = 40

export function createFeedback(envIn?: FeedbackEnv, initial: { sound: boolean; vibration: boolean } = { sound: true, vibration: true }): Feedback {
  const base = defaultEnv()
  const env: FeedbackEnv = {
    audio: envIn?.audio === undefined ? base.audio : envIn.audio,
    vibrate: envIn?.vibrate === undefined ? base.vibrate : envIn.vibrate,
    telegram: envIn?.telegram === undefined ? base.telegram : envIn.telegram,
  }
  let sound = initial.sound
  let vibration = initial.vibration
  let ctx: AudioContext | null = null
  let master: GainNode | null = null
  let noise: AudioBuffer | null = null
  let failed = false
  let disposed = false
  const active = new Set<AudioScheduledSourceNode>()
  const chains = new Map<AudioScheduledSourceNode, AudioNode[]>()

  function ensure(): boolean {
    if (disposed || failed) return false
    if (ctx) return true
    try {
      const made = env.audio ? env.audio() : null
      if (!made) {
        failed = true
        return false
      }
      ctx = made
      master = made.createGain()
      master.gain.value = MASTER_GAIN
      master.connect(made.destination)
      const len = Math.floor(made.sampleRate * 0.6)
      noise = made.createBuffer(1, len, made.sampleRate)
      const data = noise.getChannelData(0)
      let seed = 1234567
      for (let i = 0; i < len; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0
        data[i] = (seed / 4294967296) * 2 - 1
      }
      return true
    } catch {
      failed = true
      ctx = null
      return false
    }
  }

  function detach(node: AudioScheduledSourceNode): void {
    active.delete(node)
    const chain = chains.get(node)
    chains.delete(node)
    if (!chain) return
    for (const n of chain) {
      try {
        n.disconnect()
      } catch {
        continue
      }
    }
  }

  function track(node: AudioScheduledSourceNode, chain: AudioNode[]): void {
    active.add(node)
    chains.set(node, chain)
    node.onended = () => detach(node)
  }

  function release(): void {
    for (const node of [...active]) {
      try {
        node.stop()
      } catch {
        continue
      } finally {
        detach(node)
      }
    }
  }

  function haptic(cue: Cue): void {
    if (!vibration) return
    const spec = hapticFor(cue)
    if (!spec) return
    try {
      const tg = env.telegram ? env.telegram() : null
      if (tg) {
        if (spec.telegram.kind === 'impact' && tg.impactOccurred) tg.impactOccurred(spec.telegram.style)
        else if (spec.telegram.kind === 'notification' && tg.notificationOccurred) tg.notificationOccurred(spec.telegram.style)
        return
      }
      if (env.vibrate) env.vibrate(typeof spec.vibrate === 'number' ? spec.vibrate : [...spec.vibrate])
    } catch {
      return
    }
  }

  function audible(cue: Cue): void {
    if (!sound || !ensure() || !ctx || !master || !noise) return
    try {
      if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
      if (active.size > MAX_ACTIVE_SOURCES) return
      RECIPES[cue]({ ctx, out: master, at: ctx.currentTime + 0.005, noise, track })
    } catch {
      return
    }
  }

  return {
    unlock() {
      if (disposed || !sound) return
      if (ensure() && ctx && ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
    },
    play(cue) {
      if (disposed) return
      audible(cue)
      haptic(cue)
    },
    setSound(on) {
      sound = on
      if (!on) release()
    },
    setVibration(on) {
      vibration = on
      if (!on) {
        try {
          if (env.vibrate) env.vibrate(0)
        } catch {
          return
        }
      }
    },
    dispose() {
      disposed = true
      release()
      const c = ctx
      ctx = null
      master = null
      noise = null
      if (c) void c.close().catch(() => undefined)
    },
  }
}
