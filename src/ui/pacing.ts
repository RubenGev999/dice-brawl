import { TIMELINE } from './fighters.ts'
import type { Timeline } from './fighters.ts'

export interface AnimClock {
  readonly start: number
  readonly timeline: Timeline
  readonly skipped: boolean
}

export interface AnimFrame {
  readonly elapsed: number
  readonly impacted: boolean
  readonly done: boolean
}

export function animFrame(clock: AnimClock, now: number): AnimFrame {
  const total = clock.timeline.totalMs
  const raw = clock.skipped ? total : now - clock.start
  const elapsed = Math.max(0, Math.min(total, raw))
  return { elapsed, impacted: elapsed >= clock.timeline.impactAt, done: elapsed >= total }
}

export function skipClock(clock: AnimClock): AnimClock {
  return clock.skipped ? clock : { ...clock, skipped: true }
}

export function fxFactor(timeline: Timeline): number {
  return timeline.totalMs / TIMELINE.totalMs
}

export interface ImpactGate {
  readonly fire: boolean
  readonly fired: boolean
}

export function impactGate(frame: AnimFrame, alreadyFired: boolean): ImpactGate {
  if (alreadyFired) return { fire: false, fired: true }
  return { fire: frame.impacted, fired: frame.impacted }
}

export function easeOutCubic(t: number): number {
  const c = Math.max(0, Math.min(1, t))
  return 1 - Math.pow(1 - c, 3)
}

export function tweenValue(from: number, to: number, elapsed: number, duration: number): number {
  if (duration <= 0 || elapsed >= duration) return to
  if (elapsed <= 0) return from
  return Math.round(from + (to - from) * easeOutCubic(elapsed / duration))
}

export interface Tween {
  readonly from: number
  readonly to: number
  readonly start: number
  readonly duration: number
}

export function retarget(current: Tween | null, shown: number, target: number, now: number, duration: number): Tween {
  if (current && current.to === target) return current
  return { from: shown, to: target, start: now, duration }
}

export function tweenAt(t: Tween, now: number): number {
  return tweenValue(t.from, t.to, now - t.start, t.duration)
}

export function countDuration(delta: number, fast: boolean, reduced: boolean): number {
  if (reduced || delta === 0) return 0
  const base = Math.min(1100, 450 + Math.log10(Math.abs(delta) + 1) * 220)
  return Math.round(fast ? base * 0.45 : base)
}

export function shouldTick(lastAt: number, now: number, minGap: number): boolean {
  return now - lastAt >= minGap
}
