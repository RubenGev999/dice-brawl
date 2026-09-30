import { describe, expect, it } from 'vitest'
import { createFeedback, hapticFor, recordingFeedback, silentFeedback } from '../feedback.ts'
import type { Cue } from '../feedback.ts'

const ALL_CUES: ReadonlyArray<Cue> = [
  'roll',
  'hitDealt',
  'hitTaken',
  'crit',
  'block',
  'heal',
  'escape',
  'koWin',
  'koLoss',
  'boss',
  'tick',
  'coins',
  'stageCleared',
  'upgrade',
  'failed',
  'tap',
]

describe('haptic mapping', () => {
  it('is light on a hit dealt and stronger on a hit taken and crit', () => {
    const dealt = hapticFor('hitDealt')
    const taken = hapticFor('hitTaken')
    const crit = hapticFor('crit')
    expect(dealt?.vibrate).toBeTypeOf('number')
    expect(taken?.vibrate as number).toBeGreaterThan(dealt?.vibrate as number)
    expect(Array.isArray(crit?.vibrate)).toBe(true)
    expect(dealt?.telegram).toEqual({ kind: 'impact', style: 'light' })
    expect(taken?.telegram).toEqual({ kind: 'impact', style: 'heavy' })
  })

  it('uses patterns and notifications for knockouts and stage clears', () => {
    expect(Array.isArray(hapticFor('koWin')?.vibrate)).toBe(true)
    expect(Array.isArray(hapticFor('stageCleared')?.vibrate)).toBe(true)
    expect(hapticFor('koWin')?.telegram.kind).toBe('notification')
    expect(hapticFor('koLoss')?.telegram).toEqual({ kind: 'notification', style: 'error' })
    expect(hapticFor('tap')).toBeNull()
    expect(hapticFor('tick')).toBeNull()
  })
})

describe('silent and recording stubs', () => {
  it('silent does nothing and never throws', () => {
    for (const c of ALL_CUES) expect(() => silentFeedback.play(c)).not.toThrow()
    expect(() => {
      silentFeedback.unlock()
      silentFeedback.setSound(false)
      silentFeedback.setVibration(false)
      silentFeedback.dispose()
    }).not.toThrow()
  })

  it('recording keeps the cues in order', () => {
    const fb = recordingFeedback()
    fb.play('roll')
    fb.play('hitDealt')
    fb.setSound(false)
    fb.unlock()
    expect(fb.played).toEqual(['roll', 'hitDealt'])
    expect(fb.state.sound).toBe(false)
    expect(fb.state.unlocked).toBe(true)
  })
})

describe('real feedback without a platform', () => {
  it('is a no-op when audio, vibration and telegram are all missing', () => {
    const fb = createFeedback({ audio: null, vibrate: null, telegram: null })
    for (const c of ALL_CUES) expect(() => fb.play(c)).not.toThrow()
    expect(() => {
      fb.unlock()
      fb.setSound(false)
      fb.dispose()
    }).not.toThrow()
  })

  it('does not throw when the audio constructor throws, and only tries once', () => {
    let calls = 0
    const fb = createFeedback({
      audio: () => {
        calls += 1
        throw new Error('blocked')
      },
      vibrate: null,
      telegram: null,
    })
    fb.unlock()
    for (const c of ALL_CUES) expect(() => fb.play(c)).not.toThrow()
    expect(calls).toBe(1)
  })

  it('does not create the audio context until a gesture unlocks it or a cue plays', () => {
    let created = 0
    createFeedback({
      audio: () => {
        created += 1
        return null
      },
      vibrate: null,
      telegram: null,
    })
    expect(created).toBe(0)
  })

  it('does not create audio when sound is off', () => {
    let created = 0
    const fb = createFeedback(
      {
        audio: () => {
          created += 1
          return null
        },
        vibrate: null,
        telegram: null,
      },
      { sound: false, vibration: false },
    )
    fb.unlock()
    fb.play('koWin')
    expect(created).toBe(0)
  })

  it('vibrates with the mapped pattern and respects the off switch', () => {
    const calls: Array<number | number[]> = []
    const fb = createFeedback({ audio: null, vibrate: (p) => (calls.push(p), true), telegram: null })
    fb.play('hitDealt')
    fb.play('koWin')
    fb.play('tap')
    expect(calls).toEqual([12, [30, 40, 30, 40, 70]])
    calls.length = 0
    fb.setVibration(false)
    expect(calls).toEqual([0])
    fb.play('hitTaken')
    fb.play('koWin')
    expect(calls).toEqual([0])
  })

  it('prefers Telegram haptics over vibrate when present', () => {
    const vib: unknown[] = []
    const tg: string[] = []
    const fb = createFeedback({
      audio: null,
      vibrate: (p) => (vib.push(p), true),
      telegram: () => ({
        impactOccurred: (s) => void tg.push(`impact:${s}`),
        notificationOccurred: (s) => void tg.push(`notify:${s}`),
      }),
    })
    fb.play('hitTaken')
    fb.play('koWin')
    fb.play('koLoss')
    expect(tg).toEqual(['impact:heavy', 'notify:success', 'notify:error'])
    expect(vib).toEqual([])
  })

  it('swallows telegram and vibrate errors', () => {
    const fb = createFeedback({
      audio: null,
      vibrate: () => {
        throw new Error('x')
      },
      telegram: () => {
        throw new Error('y')
      },
    })
    expect(() => fb.play('koWin')).not.toThrow()
  })

  it('plays through a fake audio context and releases its nodes on dispose', () => {
    const created = { osc: 0, src: 0, stopped: 0, disconnected: 0, closed: false }
    const param = () => ({
      value: 0,
      setValueAtTime() {},
      exponentialRampToValueAtTime() {},
    })
    const node = () => ({ connect() {}, disconnect: () => void (created.disconnected += 1) })
    const scheduled = (kind: 'osc' | 'src') => ({
      ...node(),
      onended: null as null | (() => void),
      type: 'sine',
      buffer: null as unknown,
      frequency: param(),
      start() {
        created[kind] += 1
      },
      stop() {
        created.stopped += 1
      },
    })
    const ctx = {
      state: 'running',
      currentTime: 0,
      sampleRate: 8000,
      destination: {},
      createGain: () => ({ ...node(), gain: param() }),
      createOscillator: () => scheduled('osc'),
      createBufferSource: () => scheduled('src'),
      createBiquadFilter: () => ({ ...node(), type: 'bandpass', frequency: param(), Q: param() }),
      createBuffer: () => ({ getChannelData: () => new Float32Array(4800) }),
      resume: () => Promise.resolve(),
      close: () => {
        created.closed = true
        return Promise.resolve()
      },
    }
    const fb = createFeedback({ audio: () => ctx as unknown as AudioContext, vibrate: null, telegram: null })
    for (const c of ALL_CUES) fb.play(c)
    expect(created.osc).toBeGreaterThan(10)
    expect(created.src).toBeGreaterThan(0)
    const stoppedBefore = created.stopped
    fb.dispose()
    expect(created.stopped - stoppedBefore).toBe(created.osc + created.src)
    expect(created.disconnected).toBeGreaterThan(0)
    expect(created.closed).toBe(true)
    expect(() => fb.play('koWin')).not.toThrow()
  })

  it('does not play anything once sound is switched off', () => {
    let osc = 0
    const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} })
    const ctx = {
      state: 'running',
      currentTime: 0,
      sampleRate: 8000,
      destination: {},
      createGain: () => ({ connect() {}, disconnect() {}, gain: param() }),
      createOscillator: () => ({
        connect() {},
        disconnect() {},
        frequency: param(),
        type: 'sine',
        onended: null,
        start: () => void (osc += 1),
        stop() {},
      }),
      createBufferSource: () => ({ connect() {}, disconnect() {}, start() {}, stop() {}, onended: null, buffer: null }),
      createBiquadFilter: () => ({ connect() {}, disconnect() {}, frequency: param(), Q: param(), type: 'bandpass' }),
      createBuffer: () => ({ getChannelData: () => new Float32Array(4800) }),
      resume: () => Promise.resolve(),
      close: () => Promise.resolve(),
    }
    const fb = createFeedback({ audio: () => ctx as unknown as AudioContext, vibrate: null, telegram: null })
    fb.play('hitDealt')
    const before = osc
    expect(before).toBeGreaterThan(0)
    fb.setSound(false)
    fb.play('hitDealt')
    expect(osc).toBe(before)
  })
})
