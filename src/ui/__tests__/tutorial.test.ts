import { describe, expect, it } from 'vitest'
import { createGame } from '../../core/index.ts'
import type { Game, GameState } from '../../core/index.ts'
import {
  FRESH_TUTORIAL,
  STEPS,
  TUTORIAL_KEY,
  acknowledge,
  keepPercent,
  loadTutorial,
  parseTutorial,
  pickTutorial,
  progressLabel,
  refreshText,
  replayTutorial,
  saveTutorial,
  skipTutorial,
  stillActive,
} from '../tutorial.ts'
import type { TutorialCtx, TutorialProgress } from '../tutorial.ts'
import type { StorageLike } from '../wallet.ts'

function ctxFor(game: Game): TutorialCtx {
  return { mode: 'run', state: game.state }
}

const lobby: TutorialCtx = { mode: 'lobby', state: null }

function rollUntil(game: Game, pred: (s: GameState) => boolean): void {
  for (let i = 0; i < 200 && !pred(game.state); i++) game.dispatch({ type: 'roll' })
}

describe('tutorial step selection', () => {
  it('has at most six steps', () => {
    expect(STEPS.length).toBeLessThanOrEqual(6)
  })

  it('starts on the lobby and points at the buy-in', () => {
    const v = pickTutorial(FRESH_TUTORIAL, lobby)
    expect(v?.id).toBe('buyin')
    expect(v?.kind).toBe('step')
    expect(v?.target).toBe('buyin')
    expect(progressLabel(v!)).toBe('1 / 6')
  })

  it('walks through the run screens in order as the player reaches them', () => {
    const game = createGame(3, 100)
    let p: TutorialProgress = FRESH_TUTORIAL
    const seen: string[] = []
    const take = (ctx: TutorialCtx): void => {
      const v = pickTutorial(p, ctx)
      if (!v) return
      seen.push(v.id)
      p = acknowledge(p, v)
    }
    take(lobby)
    take(ctxFor(game))
    game.dispatch({ type: 'bet', amount: 25 })
    take(ctxFor(game))
    game.dispatch({ type: 'roll' })
    take(ctxFor(game))
    take(ctxFor(game))
    rollUntil(game, (s) => s.phase !== 'fight' || s.fight?.canWalkAway === true)
    take(ctxFor(game))
    rollUntil(game, (s) => s.phase !== 'fight')
    take(ctxFor(game))
    expect(seen.slice(0, 4)).toEqual(['buyin', 'bet', 'roll', 'payout'])
    expect(seen.includes('stage')).toBe(true)
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('skips steps the player already moved past instead of getting stuck', () => {
    const game = createGame(3, 100)
    game.dispatch({ type: 'bet', amount: 25 })
    game.dispatch({ type: 'roll' })
    const v = pickTutorial(FRESH_TUTORIAL, ctxFor(game))
    expect(v?.id).toBe('payout')
    expect(acknowledge(FRESH_TUTORIAL, v!).next).toBe(4)
  })

  it('shows the roll step only before the first exchange', () => {
    const game = createGame(3, 100)
    game.dispatch({ type: 'bet', amount: 25 })
    expect(pickTutorial({ ...FRESH_TUTORIAL, next: 2 }, ctxFor(game))?.id).toBe('roll')
    game.dispatch({ type: 'roll' })
    expect(pickTutorial({ ...FRESH_TUTORIAL, next: 2 }, ctxFor(game))?.id).toBe('payout')
  })

  it('pulls every number from the state', () => {
    const game = createGame(5, 500)
    game.dispatch({ type: 'bet', amount: 50 })
    rollUntil(game, (s) => s.phase !== 'fight')
    const s = game.state
    const v = pickTutorial({ ...FRESH_TUTORIAL, next: 5 }, { mode: 'run', state: s })
    expect(v?.id).toBe('stage')
    expect(v?.text).toContain(String(s.fightsPerStage - 1))
    expect(v?.text).toContain(s.target.toLocaleString('en-US'))
    expect(v?.text).toContain(`${s.failedCheckpointFeePercent}%`)
    const altered: GameState = { ...s, target: 4321, failedCheckpointFeePercent: 17, fightsPerStage: 8 }
    const t = refreshText(v!, { mode: 'run', state: altered })
    expect(t).toContain('4,321')
    expect(t).toContain('17%')
    expect(t).toContain('7 enemies')
    expect(t).toContain('level')
    expect(t).not.toContain('stage')
  })

  it('uses the walk-away keep share from the fight state', () => {
    const game = createGame(5, 500)
    game.dispatch({ type: 'bet', amount: 50 })
    rollUntil(game, (s) => s.phase !== 'fight' || s.fight?.canWalkAway === true)
    const s = game.state
    if (s.phase !== 'fight' || !s.fight) return
    const v = pickTutorial({ ...FRESH_TUTORIAL, next: 4 }, { mode: 'run', state: s })
    expect(v?.id).toBe('walk')
    expect(v?.text).toContain(`${keepPercent(s.fight.walkAwayKeep)}%`)
    expect(v?.text).toContain(`${s.fight.walkAwayRefundPercent}% of your bet`)
    expect(v?.text).not.toContain('only')
    expect(keepPercent(0.5)).toBe(50)
    const altered: GameState = { ...s, fight: { ...s.fight, walkAwayRefundPercent: 50, walkAwayKeep: 0.4 } }
    const t = refreshText(v!, { mode: 'run', state: altered })
    expect(t).toContain('50% of your bet')
    expect(t).toContain('40% of the payout')
  })

  it('offers a shop tip once and says skipping pays nothing', () => {
    const game = createGame(7, 100)
    let guard = 0
    while (game.state.phase !== 'shop' && guard++ < 50) {
      if (game.state.phase === 'bet') game.dispatch({ type: 'bet', amount: 10 })
      else if (game.state.phase === 'fight') game.dispatch({ type: 'roll' })
      else game.dispatch({ type: 'continue' })
    }
    expect(game.state.phase).toBe('shop')
    const done: TutorialProgress = { ...FRESH_TUTORIAL, next: STEPS.length }
    const tip = pickTutorial(done, ctxFor(game))
    expect(tip?.kind).toBe('tip')
    expect(tip?.id).toBe('tip-shop')
    expect(tip?.text).toContain('pays nothing')
    expect(pickTutorial(acknowledge(done, tip!), ctxFor(game))).toBeNull()
  })

  it('becomes inactive when the screen moves on', () => {
    const game = createGame(3, 100)
    const v = pickTutorial(FRESH_TUTORIAL, lobby)!
    expect(stillActive(v, lobby)).toBe(true)
    expect(stillActive(v, ctxFor(game))).toBe(false)
  })

  it('can be skipped and replayed', () => {
    const skipped = skipTutorial(FRESH_TUTORIAL)
    expect(pickTutorial(skipped, lobby)).toBeNull()
    expect(pickTutorial(replayTutorial(), lobby)?.id).toBe('buyin')
    expect(acknowledge(FRESH_TUTORIAL, pickTutorial(FRESH_TUTORIAL, lobby)!).next).toBe(1)
  })

  it('never crashes when the state is missing', () => {
    expect(() => pickTutorial(FRESH_TUTORIAL, { mode: 'run', state: null })).not.toThrow()
    expect(pickTutorial(FRESH_TUTORIAL, { mode: 'run', state: null })).toBeNull()
  })
})

describe('tutorial persistence', () => {
  function memory(initial?: string): StorageLike & { data: Map<string, string> } {
    const data = new Map<string, string>()
    if (initial !== undefined) data.set(TUTORIAL_KEY, initial)
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) }
  }

  it('treats a missing flag as a first run and round-trips progress', () => {
    const st = memory()
    expect(loadTutorial(st)).toEqual(FRESH_TUTORIAL)
    saveTutorial(st, { next: 3, shopTip: true, off: false })
    expect(loadTutorial(st)).toEqual({ next: 3, shopTip: true, off: false })
    expect(parseTutorial('{"next":2,"shopTip":true,"brokeTip":true}')).toEqual({ next: 2, shopTip: true, off: false })
  })

  it('survives corrupt data and throwing storage', () => {
    expect(parseTutorial('{{{')).toEqual(FRESH_TUTORIAL)
    expect(parseTutorial('{"next":-4,"off":"x"}')).toEqual(FRESH_TUTORIAL)
    expect(parseTutorial('{"next":999}').next).toBe(STEPS.length)
    const throwing: StorageLike = {
      getItem() {
        throw new Error('no')
      },
      setItem() {
        throw new Error('no')
      },
    }
    expect(loadTutorial(throwing)).toEqual(FRESH_TUTORIAL)
    expect(saveTutorial(throwing, FRESH_TUTORIAL)).toBe(false)
    expect(loadTutorial(null)).toEqual(FRESH_TUTORIAL)
  })
})
