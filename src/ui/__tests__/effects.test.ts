import { describe, expect, it } from 'vitest'
import { UPGRADE_IDS, createGame } from '../../core/index.ts'
import type { FightState, Game, UpgradeId } from '../../core/index.ts'
import {
  PARTICLE_CAP,
  bossBanner,
  cappedParticles,
  checkpointCountRange,
  coinBurstCount,
  confettiCount,
  exchangeCues,
  fightCelebration,
  isKnockout,
  transitionCues,
  triggerTags,
} from '../effects.ts'
import { exchange as ex } from './fixtures.ts'

describe('trigger tags', () => {
  it('has a style for every upgrade and keeps the core text verbatim', () => {
    const tags = triggerTags(UPGRADE_IDS.map((id) => ({ id, text: `${id} text` })))
    expect(tags.map((t) => t.upgrade)).toEqual([...UPGRADE_IDS])
    for (const t of tags) {
      expect(t.text).toBe(`${t.upgrade} text`)
      expect(['good', 'bad', 'gold', 'info']).toContain(t.tone)
      expect(['player', 'enemy']).toContain(t.side)
    }
  })

  it('puts Intimidate on the enemy and every other trigger on the player', () => {
    const tags = triggerTags(UPGRADE_IDS.map((id) => ({ id, text: id })))
    expect(tags.filter((t) => t.side === 'enemy').map((t) => t.upgrade)).toEqual(['intimidate'])
  })

  it('maps nothing to nothing and keeps the order', () => {
    expect(triggerTags([])).toEqual([])
    const tags = triggerTags([
      { id: 'shield', text: 'Shield -4' },
      { id: 'riposte', text: 'Riposte 1' },
    ])
    expect(tags.map((t) => t.text)).toEqual(['Shield -4', 'Riposte 1'])
    expect(tags[0]?.tone).toBe('info')
    expect(tags[1]?.tone).toBe('gold')
  })
})

describe('triggers against a real core game', () => {
  function botStep(game: Game, i: number): void {
    const s = game.state
    if (s.phase === 'bet') game.dispatch({ type: 'bet', amount: (s.betPresets[1] ?? s.betPresets[0])?.amount ?? 1 })
    else if (s.phase === 'result' || s.phase === 'checkpoint') game.dispatch({ type: 'continue' })
    else if (s.phase === 'shop') game.dispatch(s.shopOffers.length > 0 ? { type: 'pickUpgrade', index: i % s.shopOffers.length } : { type: 'skip' })
  }

  it('maps every trigger the core reports to an owned upgrade', () => {
    const seen = new Set<UpgradeId>()
    let exchanges = 0
    for (let seed = 1; seed <= 80; seed++) {
      const game = createGame(seed, 1000)
      let guard = 0
      while (game.state.phase !== 'gameover' && guard++ < 400) {
        if (game.state.phase === 'fight') {
          const owned = new Set(game.state.upgrades.map((u) => u.id))
          game.dispatch({ type: 'roll' })
          const f = game.state.fight as FightState
          const e = f.exchanges[f.exchanges.length - 1]
          if (!e) continue
          exchanges += 1
          for (const t of triggerTags(e.upgradeTriggers)) {
            seen.add(t.upgrade)
            expect(owned.has(t.upgrade), t.upgrade).toBe(true)
            expect(t.text.length).toBeGreaterThan(0)
          }
          if (f.status === 'lost' || f.status === 'won') expect(exchangeCues(e, f.status).length).toBeGreaterThan(0)
        } else {
          botStep(game, guard)
        }
      }
    }
    expect(exchanges).toBeGreaterThan(500)
    expect(seen.size).toBeGreaterThanOrEqual(6)
  })

  it('reads fight-start triggers from the fight state', () => {
    let found = false
    for (let seed = 1; seed <= 200 && !found; seed++) {
      const game = createGame(seed, 1000)
      let guard = 0
      while (game.state.phase !== 'gameover' && guard++ < 200 && !found) {
        if (game.state.phase === 'fight') {
          const f = game.state.fight as FightState
          if (f.startTriggers.length > 0) {
            found = true
            const tags = triggerTags(f.startTriggers)
            expect(tags.every((t) => t.upgrade === 'vitality' || t.upgrade === 'intimidate')).toBe(true)
          }
          game.dispatch({ type: 'roll' })
        } else botStep(game, guard)
      }
    }
    expect(found).toBe(true)
  })
})

describe('knockouts', () => {
  it('counts a player knockout and a riposte knockout', () => {
    expect(isKnockout(ex({ enemyHpAfter: 0 }))).toBe(true)
    expect(isKnockout(ex({ enemyHpAfter: 2 }))).toBe(false)
    expect(isKnockout(ex({ winner: 'enemy', damageDealt: 1, riposteDamage: 1, damageTaken: 2, enemyHpAfter: 0 }))).toBe(true)
    expect(isKnockout(ex({ winner: 'enemy', damageDealt: 0, damageTaken: 2, enemyHpAfter: 0 }))).toBe(false)
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
  })

  it('plays the enemy hit before a riposte and a thorn hit as damage taken', () => {
    expect(exchangeCues(ex({ winner: 'enemy', damageDealt: 1, riposteDamage: 1, damageTaken: 2 }), 'active')).toEqual(['hitTaken', 'hitDealt'])
    expect(exchangeCues(ex({ winner: 'enemy', damageDealt: 1, riposteDamage: 1, damageTaken: 2, enemyCritFactor: 2 }), 'active')).toEqual(['hitTaken', 'crit', 'hitDealt'])
    expect(exchangeCues(ex({ thornDamage: 1 }), 'active')).toEqual(['hitDealt', 'hitTaken'])
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
    expect(transitionCues(none, { type: 'skip' })).toEqual([])
    expect(transitionCues(none, { type: 'walkAway' })).toEqual(['coins'])
    expect(transitionCues(none, { type: 'leave' })).toEqual(['coins'])
  })
})

describe('celebrations', () => {
  it('grows from a normal knockout to a boss knockout', () => {
    expect(fightCelebration('won', false)).toBe('ko')
    expect(fightCelebration('won', true)).toBe('boss')
    expect(fightCelebration('lost', false)).toBe('loss')
    expect(fightCelebration('walkedAway', false)).toBe('none')
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

  it('counts a checkpoint bankroll up from the level entry', () => {
    expect(checkpointCountRange({ entryBankroll: 100 }, 130)).toEqual({ from: 100, to: 130 })
    expect(checkpointCountRange({ entryBankroll: 200 }, 130)).toEqual({ from: 130, to: 130 })
  })
})
