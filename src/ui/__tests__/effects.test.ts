import { describe, expect, it } from 'vitest'
import { computeMods, createGame, hasDoubles } from '../../core/index.ts'
import type { ExchangeRecord, FightState, Game, UpgradeId } from '../../core/index.ts'
import {
  PARTICLE_CAP,
  bossBanner,
  cappedParticles,
  checkpointCountRange,
  coinBurstCount,
  confettiCount,
  exchangeCues,
  exchangeTags,
  finisherBonus,
  fightCelebration,
  fightStartTags,
  isKnockout,
  ownedFrom,
  ownedIds,
  resultTags,
  transitionCues,
} from '../effects.ts'

function ex(over: Partial<ExchangeRecord> = {}): ExchangeRecord {
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

function baseFight(): FightState {
  const g = createGame(1, 100)
  g.dispatch({ type: 'bet', amount: 25 })
  return g.state.fight as FightState
}

function owned(...ids: UpgradeId[]) {
  return ownedFrom(ids.map((id) => ({ id })))
}

describe('owned helpers', () => {
  it('counts copies and expands them back to ids', () => {
    const o = owned('vitality', 'vitality', 'shield')
    expect(o.vitality).toBe(2)
    expect(o.shield).toBe(1)
    expect(ownedIds(o).sort()).toEqual(['shield', 'vitality', 'vitality'])
    expect(ownedIds({})).toEqual([])
  })
})

describe('upgrade tags from exchange records', () => {
  const fight = baseFight()

  it('tags nothing when no upgrade is owned', () => {
    expect(exchangeTags(ex({ blocked: 3, healed: 3, rerolled: true, escaped: true }), fight, {})).toEqual([])
  })

  it('attributes a block to the shield with the blocked amount', () => {
    const tags = exchangeTags(ex({ winner: 'enemy', damageDealt: 0, damageTaken: 2, blocked: 4 }), fight, owned('shield'))
    expect(tags.map((t) => t.text)).toEqual(['Shield -4'])
    expect(tags[0]?.upgrade).toBe('shield')
    expect(tags[0]?.side).toBe('player')
    expect(exchangeTags(ex({ blocked: 0 }), fight, owned('shield'))).toEqual([])
  })

  it('attributes a reroll to Second Wind', () => {
    const tags = exchangeTags(ex({ rerolled: true, playerFacesBeforeReroll: [1, 2] }), fight, owned('secondWind'))
    expect(tags.map((t) => t.upgrade)).toEqual(['secondWind'])
    expect(tags[0]?.text).toBe('Second Wind')
  })

  it('attributes healing to the Vampire Fang with the healed amount and skips zero heals', () => {
    expect(exchangeTags(ex({ healed: 3 }), fight, owned('vampire')).map((t) => t.text)).toEqual(['Vampire +3'])
    expect(exchangeTags(ex({ healed: 0 }), fight, owned('vampire'))).toEqual([])
  })

  it('shows Sharp Blade only when its bonus is visible in the damage', () => {
    const withBlade: FightState = { ...fight, player: { ...fight.player, damageBonus: 1 } }
    const exact = ex({ playerTotal: 7, enemyTotal: 3, damageDealt: 5 })
    expect(exchangeTags(exact, withBlade, owned('sharpBlade')).map((t) => t.text)).toEqual(['Sharp Blade +1'])
    const crit = ex({ playerTotal: 7, enemyTotal: 3, playerCrit: true, playerCritFactor: 2, damageDealt: 9 })
    expect(exchangeTags(crit, withBlade, owned('sharpBlade')).map((t) => t.text)).toEqual(['Sharp Blade +1'])
    const reducedByTrait = ex({ playerTotal: 7, enemyTotal: 3, damageDealt: 3 })
    expect(exchangeTags(reducedByTrait, withBlade, owned('sharpBlade'))).toEqual([])
    const capped = ex({ playerTotal: 7, enemyTotal: 3, damageDealt: 2, enemyHpAfter: 0 })
    expect(exchangeTags(capped, withBlade, owned('sharpBlade'))).toEqual([])
    expect(exchangeTags(exact, fight, owned('sharpBlade'))).toEqual([])
  })

  it('shows Loaded Dice only for a crit without doubles', () => {
    const noDoubles = ex({ playerFaces: [6, 5], playerTotal: 11, playerCrit: true, playerCritFactor: 2 })
    expect(exchangeTags(noDoubles, fight, owned('loadedDice')).map((t) => t.text)).toEqual(['Loaded Dice crit'])
    const doubles = ex({ playerFaces: [6, 6], playerTotal: 12, playerCrit: true, playerCritFactor: 2 })
    expect(hasDoubles(doubles.playerFaces)).toBe(true)
    expect(exchangeTags(doubles, fight, owned('loadedDice'))).toEqual([])
    expect(exchangeTags(noDoubles, fight, {})).toEqual([])
  })

  it('shows Escape Rope on an escape', () => {
    expect(exchangeTags(ex({ escaped: true, winner: 'enemy' }), fight, owned('escapeRope')).map((t) => t.text)).toEqual(['Escape Rope!'])
  })

  it('shows the Finisher bonus on a knockout using only the fight state', () => {
    const mods = computeMods(['finisher'])
    const base = computeMods([])
    const extra = (mods.koBonusMilli - base.koBonusMilli) / 1000
    const ko = ex({ enemyHpAfter: 0, damageDealt: 4 })
    const boosted: FightState = { ...fight, koBonusMultiplier: fight.koBonusMultiplier + extra }
    expect(isKnockout(ko)).toBe(true)
    expect(finisherBonus(boosted)).toBeCloseTo(extra, 9)
    expect(exchangeTags(ko, boosted, owned('finisher')).map((t) => t.text)).toEqual(['Finisher +0.3x'])
    expect(exchangeTags(ex({ enemyHpAfter: 2 }), boosted, owned('finisher'))).toEqual([])
    expect(finisherBonus(fight)).toBe(0)
    expect(exchangeTags(ko, fight, owned('finisher'))).toEqual([])
  })

  it('stacks several tags in one exchange', () => {
    const f: FightState = { ...fight, player: { ...fight.player, damageBonus: 1 } }
    const tags = exchangeTags(ex({ healed: 3, damageDealt: 5 }), f, owned('vampire', 'sharpBlade'))
    expect(tags.map((t) => t.upgrade).sort()).toEqual(['sharpBlade', 'vampire'])
  })
})

describe('result and fight-start tags', () => {
  it('shows Insurance on a lost fight that paid a refund', () => {
    expect(resultTags({ outcome: 'lost', payout: 20 }, owned('insurance')).map((t) => t.text)).toEqual(['Insurance +20'])
    expect(resultTags({ outcome: 'lost', payout: 0 }, owned('insurance'))).toEqual([])
    expect(resultTags({ outcome: 'won', payout: 90 }, owned('insurance'))).toEqual([])
    expect(resultTags({ outcome: 'lost', payout: 20 }, {})).toEqual([])
  })

  it('tags passive upgrades once at the start of a fight', () => {
    const base = baseFight()
    const upgraded: FightState = { ...base, player: { ...base.player, maxHp: base.player.maxHp + 3, minFace: 2 } }
    const tags = fightStartTags(upgraded, owned('vitality', 'weightedDice', 'intimidate'))
    expect(tags.map((t) => t.text)).toEqual(['Vitality +3 HP', 'Weighted Dice min 2', `Intimidate -${computeMods(['intimidate']).enemyHpCutPercent}% HP`])
    expect(tags.find((t) => t.upgrade === 'intimidate')?.side).toBe('enemy')
    expect(fightStartTags(base, {})).toEqual([])
    expect(fightStartTags({ ...upgraded, exchanges: [ex()] }, owned('vitality'))).toEqual([])
    expect(fightStartTags(base, owned('vitality'))).toEqual([])
  })

  it('scales the intimidate label with stacked copies', () => {
    const base = baseFight()
    const one = fightStartTags(base, owned('intimidate'))[0]?.text
    const two = fightStartTags(base, owned('intimidate', 'intimidate'))[0]?.text
    expect(one).toBe(`Intimidate -${computeMods(['intimidate']).enemyHpCutPercent}% HP`)
    expect(two).toBe(`Intimidate -${computeMods(['intimidate', 'intimidate']).enemyHpCutPercent}% HP`)
  })
})

describe('tags against a real core game', () => {
  function botStep(game: Game, i: number): void {
    const s = game.state
    if (s.phase === 'bet') {
      if (s.canPawn) game.dispatch({ type: 'pawn', index: 0 })
      else game.dispatch({ type: 'bet', amount: (s.betPresets[1] ?? s.betPresets[0])?.amount ?? 1 })
    } else if (s.phase === 'result' || s.phase === 'checkpoint') game.dispatch({ type: 'continue' })
    else if (s.phase === 'shop') game.dispatch(s.shopOffers.length > 0 ? { type: 'pickUpgrade', index: i % s.shopOffers.length } : { type: 'skip' })
  }

  it('only ever attributes what the exposed fields prove', () => {
    const seen = new Set<UpgradeId>()
    let exchanges = 0
    for (let seed = 1; seed <= 80; seed++) {
      const game = createGame(seed, 1000)
      let guard = 0
      while (game.state.phase !== 'gameover' && guard++ < 400) {
        if (game.state.phase === 'fight') {
          const o = ownedFrom(game.state.upgrades)
          game.dispatch({ type: 'roll' })
          const f = game.state.fight as FightState
          const e = f.exchanges[f.exchanges.length - 1] as ExchangeRecord
          exchanges += 1
          const tags = exchangeTags(e, f, o)
          const by = new Map(tags.map((t) => [t.upgrade, t]))
          for (const t of tags) seen.add(t.upgrade)
          expect(by.has('shield')).toBe(e.blocked > 0 && (o.shield ?? 0) > 0)
          expect(by.has('vampire')).toBe(e.healed > 0 && (o.vampire ?? 0) > 0)
          expect(by.has('secondWind')).toBe(e.rerolled && (o.secondWind ?? 0) > 0)
          expect(by.has('escapeRope')).toBe(e.escaped && (o.escapeRope ?? 0) > 0)
          if (by.has('loadedDice')) expect(e.playerCrit && !hasDoubles(e.playerFaces)).toBe(true)
          if (by.has('sharpBlade')) expect(e.damageDealt).toBe(e.playerTotal - e.enemyTotal + f.player.damageBonus + (e.playerCritFactor - 1) * (e.playerTotal - e.enemyTotal))
          if (by.has('finisher')) expect(isKnockout(e)).toBe(true)
          if (f.status === 'lost' || f.status === 'escaped' || f.status === 'won') {
            expect(exchangeCues(e, f.status).length).toBeGreaterThan(0)
          }
        } else {
          botStep(game, guard)
        }
      }
    }
    expect(exchanges).toBeGreaterThan(500)
    expect(seen.size).toBeGreaterThanOrEqual(4)
  })
})

describe('cues', () => {
  it('maps exchanges to cues', () => {
    expect(exchangeCues(ex(), 'active')).toEqual(['hitDealt'])
    expect(exchangeCues(ex({ playerCritFactor: 2 }), 'active')).toEqual(['crit'])
    expect(exchangeCues(ex({ winner: 'enemy', damageDealt: 0, damageTaken: 3 }), 'active')).toEqual(['hitTaken'])
    expect(exchangeCues(ex({ winner: 'enemy', damageDealt: 0, damageTaken: 6, enemyCritFactor: 2 }), 'active')).toEqual(['hitTaken', 'crit'])
    expect(exchangeCues(ex({ winner: 'enemy', damageDealt: 0, damageTaken: 0, blocked: 4 }), 'active')).toEqual(['block'])
    expect(exchangeCues(ex({ healed: 3 }), 'active')).toEqual(['hitDealt', 'heal'])
    expect(exchangeCues(ex({ winner: 'tie', damageDealt: 0 }), 'active')).toEqual([])
    expect(exchangeCues(ex({ enemyHpAfter: 0 }), 'won')).toEqual(['hitDealt', 'koWin'])
    expect(exchangeCues(ex({ winner: 'enemy', damageDealt: 0, damageTaken: 2 }), 'lost')).toEqual(['hitTaken', 'koLoss'])
    expect(exchangeCues(ex({ winner: 'enemy', damageDealt: 0, damageTaken: 2, escaped: true }), 'escaped')).toEqual(['hitTaken', 'escape'])
  })

  it('maps actions to cues', () => {
    const none = { phase: 'bet', gameOverReason: null, fight: null } as const
    expect(transitionCues(none, { type: 'roll' })).toEqual(['roll'])
    expect(transitionCues(none, { type: 'bet', amount: 10 })).toEqual([])
    const g = createGame(1, 100)
    g.dispatch({ type: 'bet', amount: 10 })
    expect(transitionCues(g.state, { type: 'bet', amount: 10 })).toEqual([])
    expect(transitionCues({ ...none, fight: { isBoss: true } as FightState }, { type: 'bet', amount: 10 })).toEqual(['boss'])
    expect(transitionCues({ ...none, phase: 'checkpoint' }, { type: 'continue' })).toEqual(['stageCleared'])
    expect(transitionCues({ ...none, phase: 'gameover', gameOverReason: 'checkpoint' }, { type: 'continue' })).toEqual(['failed'])
    expect(transitionCues({ ...none, phase: 'shop' }, { type: 'continue' })).toEqual([])
    expect(transitionCues(none, { type: 'pickUpgrade', index: 0 })).toEqual(['upgrade'])
    expect(transitionCues(none, { type: 'skip' })).toEqual(['coins'])
    expect(transitionCues(none, { type: 'leave' })).toEqual(['coins'])
  })
})

describe('celebrations', () => {
  it('grows from a normal knockout to a boss knockout', () => {
    expect(fightCelebration('won', false)).toBe('ko')
    expect(fightCelebration('won', true)).toBe('boss')
    expect(fightCelebration('lost', false)).toBe('loss')
    expect(fightCelebration('walkedAway', false)).toBe('none')
    expect(fightCelebration('escaped', true)).toBe('none')
    expect(coinBurstCount('boss')).toBeGreaterThan(coinBurstCount('ko'))
    expect(coinBurstCount('ko')).toBeGreaterThan(0)
    expect(coinBurstCount('loss')).toBe(0)
    expect(confettiCount()).toBeGreaterThan(coinBurstCount('boss'))
    expect(bossBanner('boss')).toBe('BOSS DEFEATED')
    expect(bossBanner('ko')).toBeNull()
  })

  it('caps particles', () => {
    expect(cappedParticles(10, 0)).toBe(10)
    expect(cappedParticles(100, 0)).toBe(PARTICLE_CAP)
    expect(cappedParticles(10, PARTICLE_CAP - 3)).toBe(3)
    expect(cappedParticles(10, PARTICLE_CAP + 5)).toBe(0)
    expect(confettiCount()).toBeLessThanOrEqual(PARTICLE_CAP)
    expect(coinBurstCount('boss')).toBeLessThanOrEqual(PARTICLE_CAP)
  })

  it('counts a checkpoint bankroll up from the stage entry', () => {
    expect(checkpointCountRange({ entryBankroll: 100 }, 130)).toEqual({ from: 100, to: 130 })
    expect(checkpointCountRange({ entryBankroll: 200 }, 130)).toEqual({ from: 130, to: 130 })
  })
})
