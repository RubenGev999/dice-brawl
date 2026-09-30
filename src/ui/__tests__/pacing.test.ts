import { describe, expect, it } from 'vitest'
import { FAST_TOTAL_MS, TIMELINE, planExchange, scaleTimeline, timelineFor } from '../fighters.ts'
import type { Timeline } from '../fighters.ts'
import type { ExchangeRecord } from '../../core/index.ts'
import { animFrame, countDuration, easeOutCubic, fxFactor, impactGate, retarget, shouldTick, skipClock, tweenAt, tweenValue } from '../pacing.ts'
import type { AnimClock } from '../pacing.ts'

function record(over: Partial<ExchangeRecord> = {}): ExchangeRecord {
  return {
    index: 0,
    playerFaces: [4, 3],
    playerFacesBeforeReroll: null,
    rerolled: false,
    enemyFaces: [2, 1],
    playerTotal: 7,
    enemyTotal: 3,
    winner: 'player',
    playerCrit: false,
    enemyCrit: false,
    playerCritFactor: 1,
    enemyCritFactor: 1,
    damageDealt: 4,
    damageTaken: 0,
    blocked: 0,
    healed: 0,
    enemyHealed: 0,
    escaped: false,
    playerHpAfter: 10,
    enemyHpAfter: 4,
    multiplierGained: 0.5,
    multiplierGainedMilli: 500,
    multiplierAfterMilli: 500,
    ...over,
  }
}

function clock(timeline: Timeline, start = 1000, skipped = false): AnimClock {
  return { start, timeline, skipped }
}

describe('timeline scaling', () => {
  it('keeps the normal timeline and compresses the fast one to about 450 ms', () => {
    expect(timelineFor(false)).toBe(TIMELINE)
    const fast = timelineFor(true)
    expect(fast.totalMs).toBe(FAST_TOTAL_MS)
    expect(fast.totalMs).toBe(450)
    expect(fast.windupAt).toBe(0)
    expect(fast.lungeAt).toBeLessThan(fast.impactAt)
    expect(fast.impactAt).toBeLessThan(fast.endAt)
    expect(fast.endAt).toBeLessThan(fast.totalMs)
  })

  it('preserves the proportions of the steps', () => {
    const fast = timelineFor(true)
    const k = fast.totalMs / TIMELINE.totalMs
    expect(fast.impactAt).toBe(Math.round(TIMELINE.impactAt * k))
    expect(fast.endAt).toBe(Math.round(TIMELINE.endAt * k))
    expect(scaleTimeline(TIMELINE, TIMELINE.totalMs)).toEqual(TIMELINE)
  })

  it('exposes the css speed factor', () => {
    expect(fxFactor(TIMELINE)).toBe(1)
    expect(fxFactor(timelineFor(true))).toBeCloseTo(0.36, 5)
  })

  it('compresses the exchange plan with the same steps in the same order', () => {
    const normal = planExchange(record(), 'won')
    const fast = planExchange(record(), 'won', timelineFor(true))
    expect(fast.map((s) => s.kind)).toEqual(normal.map((s) => s.kind))
    expect(fast.map((s) => s.at)).toEqual(fast.map((s) => s.at).slice().sort((a, b) => a - b))
    for (const step of fast) expect(step.at).toBeLessThan(FAST_TOTAL_MS)
    const impact = fast.find((s) => s.kind === 'impact')
    expect(impact?.at).toBe(timelineFor(true).impactAt)
    const defaultPlan = planExchange(record(), 'won', TIMELINE)
    expect(defaultPlan).toEqual(normal)
  })
})

describe('animation frame and skip', () => {
  it('reports elapsed time, impact and completion', () => {
    const c = clock(TIMELINE)
    expect(animFrame(c, 1000)).toEqual({ elapsed: 0, impacted: false, done: false })
    expect(animFrame(c, 1000 + TIMELINE.impactAt - 1).impacted).toBe(false)
    expect(animFrame(c, 1000 + TIMELINE.impactAt).impacted).toBe(true)
    expect(animFrame(c, 1000 + TIMELINE.totalMs - 1).done).toBe(false)
    expect(animFrame(c, 1000 + TIMELINE.totalMs).done).toBe(true)
    expect(animFrame(c, 99999).elapsed).toBe(TIMELINE.totalMs)
    expect(animFrame(c, 500).elapsed).toBe(0)
  })

  it('finishes in 450 ms in fast mode', () => {
    const c = clock(timelineFor(true))
    expect(animFrame(c, 1449).done).toBe(false)
    expect(animFrame(c, 1450).done).toBe(true)
  })

  it('jumps to the end state when skipped, including the impact', () => {
    const c = clock(TIMELINE)
    const early = animFrame(c, 1010)
    expect(early.impacted).toBe(false)
    const skipped = skipClock(c)
    expect(skipped.skipped).toBe(true)
    const frame = animFrame(skipped, 1010)
    expect(frame).toEqual({ elapsed: TIMELINE.totalMs, impacted: true, done: true })
    expect(skipClock(skipped)).toBe(skipped)
    expect(c.skipped).toBe(false)
  })

  it('fires the impact exactly once, even when the skip lands before it', () => {
    const c = clock(TIMELINE)
    let fired = false
    let count = 0
    for (const now of [1000, 1100, 1449]) {
      const g = impactGate(animFrame(c, now), fired)
      if (g.fire) count += 1
      fired = g.fired
    }
    expect(count).toBe(0)
    const skipped = skipClock(c)
    for (const now of [1450, 1500, 1600]) {
      const g = impactGate(animFrame(skipped, now), fired)
      if (g.fire) count += 1
      fired = g.fired
    }
    expect(count).toBe(1)
    expect(impactGate(animFrame(skipped, 2000), true)).toEqual({ fire: false, fired: true })
  })
})

describe('count-up tween', () => {
  it('eases from the start to the target and clamps', () => {
    expect(tweenValue(0, 100, 0, 500)).toBe(0)
    expect(tweenValue(0, 100, 500, 500)).toBe(100)
    expect(tweenValue(0, 100, 900, 500)).toBe(100)
    expect(tweenValue(0, 100, -5, 500)).toBe(0)
    expect(tweenValue(50, 10, 250, 500)).toBeLessThan(50)
    expect(tweenValue(50, 10, 250, 500)).toBeGreaterThan(10)
    expect(tweenValue(5, 9, 10, 0)).toBe(9)
    expect(easeOutCubic(2)).toBe(1)
    expect(easeOutCubic(-1)).toBe(0)
  })

  it('is monotonic', () => {
    let last = -1
    for (let t = 0; t <= 600; t += 20) {
      const v = tweenValue(0, 1234, t, 600)
      expect(v).toBeGreaterThanOrEqual(last)
      last = v
    }
    expect(last).toBe(1234)
  })

  it('retargets from the shown value and keeps a running tween for the same target', () => {
    const first = retarget(null, 100, 300, 0, 600)
    expect(first).toEqual({ from: 100, to: 300, start: 0, duration: 600 })
    expect(retarget(first, 180, 300, 200, 600)).toBe(first)
    const second = retarget(first, tweenAt(first, 200), 50, 200, 400)
    expect(second.to).toBe(50)
    expect(second.from).toBe(tweenAt(first, 200))
  })

  it('shortens in fast mode and drops to zero for reduced motion or no change', () => {
    const normal = countDuration(500, false, false)
    const fast = countDuration(500, true, false)
    expect(normal).toBeGreaterThan(0)
    expect(fast).toBeLessThan(normal)
    expect(countDuration(500, false, true)).toBe(0)
    expect(countDuration(0, false, false)).toBe(0)
    expect(countDuration(10_000_000, false, false)).toBeLessThanOrEqual(1100)
    expect(countDuration(-500, false, false)).toBe(normal)
  })

  it('throttles ticks', () => {
    expect(shouldTick(0, 30, 55)).toBe(false)
    expect(shouldTick(0, 55, 55)).toBe(true)
  })
})
