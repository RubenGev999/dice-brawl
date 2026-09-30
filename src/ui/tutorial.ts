import type { GameState } from '../core/index.ts'
import { coinsText, formatCoins } from './format.ts'
import type { StorageLike } from './wallet.ts'

export const TUTORIAL_KEY = 'diceBrawl.tutorial.v1'

export interface TutorialProgress {
  readonly next: number
  readonly shopTip: boolean
  readonly brokeTip: boolean
  readonly off: boolean
}

export const FRESH_TUTORIAL: TutorialProgress = { next: 0, shopTip: false, brokeTip: false, off: false }

export interface TutorialCtx {
  readonly mode: 'lobby' | 'run'
  readonly state: GameState | null
}

export type TutorialTarget = 'buyin' | 'bets' | 'roll' | 'money' | 'walk' | 'progress' | 'offers' | 'skip' | 'pawn'

export interface TutorialView {
  readonly kind: 'step' | 'tip'
  readonly id: string
  readonly index: number
  readonly total: number
  readonly text: string
  readonly target: TutorialTarget
}

interface StepDef {
  readonly id: string
  readonly target: TutorialTarget
  readonly when: (c: TutorialCtx) => boolean
  readonly text: (c: TutorialCtx) => string
}

function inFight(c: TutorialCtx): boolean {
  return c.mode === 'run' && c.state !== null && c.state.phase === 'fight' && c.state.fight !== null
}

export function keepPercent(keep: number): number {
  return Math.round(keep * 100)
}

export const STEPS: ReadonlyArray<StepDef> = [
  {
    id: 'buyin',
    target: 'buyin',
    when: (c) => c.mode === 'lobby',
    text: () => 'Your buy-in is the money you risk in this run, and it becomes your starting bankroll.',
  },
  {
    id: 'bet',
    target: 'bets',
    when: (c) => c.mode === 'run' && c.state !== null && c.state.phase === 'bet' && c.state.canBet,
    text: () => 'Pick a bet: a bigger bet wins more when you hit and loses more when you do not.',
  },
  {
    id: 'roll',
    target: 'roll',
    when: (c) => inFight(c) && (c.state?.fight?.exchanges.length ?? 1) === 0,
    text: () => 'Tap ROLL: both sides roll and the higher total hits for the difference.',
  },
  {
    id: 'payout',
    target: 'money',
    when: (c) => inFight(c) && (c.state?.fight?.exchanges.length ?? 0) > 0,
    text: (c) => {
      const ko = c.state?.fight ? coinsText(c.state.fight.koPayout) : 'the most'
      return `Your payout grows as you damage the enemy, and a knockout pays the most (${ko} here).`
    },
  },
  {
    id: 'walk',
    target: 'walk',
    when: (c) => inFight(c) && c.state?.fight?.canWalkAway === true,
    text: (c) => {
      const keep = c.state?.fight ? keepPercent(c.state.fight.walkAwayKeep) : 0
      return `Walk away keeps only ${keep}% of your payout, so use it as an emergency exit.`
    },
  },
  {
    id: 'stage',
    target: 'progress',
    when: (c) => c.mode === 'run' && c.state !== null && c.state.phase === 'result',
    text: (c) => {
      const s = c.state
      if (!s) return ''
      return `Beat ${s.fightsPerStage - 1} enemies and then a boss, reach ${formatCoins(s.target)} coins or ${s.failedCheckpointFeePercent}% is withheld, then leave with your coins or go on.`
    },
  },
]

const SHOP_TIP: StepDef = {
  id: 'tip-shop',
  target: 'offers',
  when: (c) => c.mode === 'run' && c.state !== null && c.state.phase === 'shop',
  text: (c) => {
    const skip = c.state ? coinsText(c.state.skipCoins) : 'a few coins'
    return `Pick one upgrade to keep for the run, or skip the shop for ${skip}.`
  },
}

const BROKE_TIP: StepDef = {
  id: 'tip-broke',
  target: 'skip',
  when: (c) => c.mode === 'run' && c.state !== null && (c.state.phase === 'shop' || c.state.phase === 'bet') && c.state.bankroll < 1,
  text: (c) => {
    const s = c.state
    const value = s ? coinsText(s.skipCoins) : 'a few coins'
    return s && s.phase === 'bet'
      ? `You are out of coins, so pawn an upgrade for ${value} to keep fighting.`
      : `You are out of coins, so skip the shop for ${value} to keep fighting.`
  },
}

export function parseTutorial(raw: string | null): TutorialProgress {
  if (raw === null) return FRESH_TUTORIAL
  try {
    const data: unknown = JSON.parse(raw)
    if (typeof data !== 'object' || data === null) return FRESH_TUTORIAL
    const r = data as Record<string, unknown>
    const next = typeof r.next === 'number' && Number.isInteger(r.next) && r.next >= 0 ? Math.min(r.next, STEPS.length) : 0
    return {
      next,
      shopTip: r.shopTip === true,
      brokeTip: r.brokeTip === true,
      off: r.off === true,
    }
  } catch {
    return FRESH_TUTORIAL
  }
}

export function loadTutorial(storage: StorageLike | null): TutorialProgress {
  try {
    return storage ? parseTutorial(storage.getItem(TUTORIAL_KEY)) : FRESH_TUTORIAL
  } catch {
    return FRESH_TUTORIAL
  }
}

export function saveTutorial(storage: StorageLike | null, p: TutorialProgress): boolean {
  try {
    if (!storage) return false
    storage.setItem(TUTORIAL_KEY, JSON.stringify(p))
    return true
  } catch {
    return false
  }
}

function view(def: StepDef, kind: 'step' | 'tip', index: number, ctx: TutorialCtx): TutorialView {
  return { kind, id: def.id, index, total: STEPS.length, text: def.text(ctx), target: def.target }
}

export function pickTutorial(p: TutorialProgress, ctx: TutorialCtx): TutorialView | null {
  if (p.off) return null
  for (let i = p.next; i < STEPS.length; i++) {
    const def = STEPS[i]
    if (def && def.when(ctx)) return view(def, 'step', i, ctx)
  }
  if (!p.shopTip && SHOP_TIP.when(ctx)) return view(SHOP_TIP, 'tip', -1, ctx)
  if (!p.brokeTip && BROKE_TIP.when(ctx)) {
    const target: TutorialTarget = ctx.state && ctx.state.phase === 'bet' ? 'pawn' : 'skip'
    return { ...view(BROKE_TIP, 'tip', -1, ctx), target }
  }
  return null
}

function defFor(v: TutorialView): StepDef | null {
  if (v.kind === 'step') return STEPS[v.index] ?? null
  if (v.id === SHOP_TIP.id) return SHOP_TIP
  if (v.id === BROKE_TIP.id) return BROKE_TIP
  return null
}

export function stillActive(v: TutorialView, ctx: TutorialCtx): boolean {
  const def = defFor(v)
  return def !== null && def.when(ctx)
}

export function refreshText(v: TutorialView, ctx: TutorialCtx): string {
  const def = defFor(v)
  return def ? def.text(ctx) : v.text
}

export function acknowledge(p: TutorialProgress, v: TutorialView): TutorialProgress {
  if (v.kind === 'step') return { ...p, next: Math.max(p.next, v.index + 1) }
  if (v.id === SHOP_TIP.id) return { ...p, shopTip: true }
  if (v.id === BROKE_TIP.id) return { ...p, brokeTip: true }
  return p
}

export function skipTutorial(p: TutorialProgress): TutorialProgress {
  return { ...p, off: true }
}

export function replayTutorial(): TutorialProgress {
  return FRESH_TUTORIAL
}

export function progressLabel(v: TutorialView): string {
  return v.kind === 'step' ? `${v.index + 1} / ${v.total}` : 'Tip'
}
