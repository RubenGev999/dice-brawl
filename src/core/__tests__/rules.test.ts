import { describe, expect, it } from 'vitest'
import {
  BOSS_TRAITS,
  CONFIG,
  NORMAL_TRAITS,
  UPGRADE_IDS,
  canWalkAway,
  clampBet,
  computeMods,
  createGame,
  currentWalkAwayPayout,
  enemyBonusMilliForFight,
  failedCheckpointFee,
  fightPayout,
  generateEnemy,
  getUpgrade,
  isBossFight,
  isUseful,
  isValidBuyIn,
  maxBetFor,
  minBetFor,
  replay,
  rollExchange,
  shopOffersForFight,
  shopOrderForFight,
  skipPawnValue,
  stageOfFight,
  targetForStage,
  traitText,
  walkAwayPayoutAt,
} from '../index.ts'
import type { Action, EnemyDef, Game, UpgradeId } from '../index.ts'
import { BOTS, pickIndex, playRun } from './bots.ts'
import { BOSS_DUMMY, DUMMY, findSeed, playFight, playToBoss, rollUntilDone, scriptedFight } from './helpers.ts'

const ALL_ACTIONS: Action[] = [
  { type: 'bet', amount: 10 },
  { type: 'roll' },
  { type: 'walkAway' },
  { type: 'continue' },
  { type: 'leave' },
  { type: 'pickUpgrade', index: 0 },
  { type: 'skip' },
  { type: 'pawn', index: 0 },
]

const KO = CONFIG.fullKoMultiplierMilli + CONFIG.koBonusMilli
const BOSS_KO = CONFIG.bossFullKoMultiplierMilli + CONFIG.bossKoBonusMilli

function clone(game: Game): Game {
  const probe = createGame(game.state.seed, game.state.buyIn)
  for (const e of game.log) {
    while (probe.state.tick < e.tick) probe.tick()
    probe.dispatch(e.action)
  }
  while (probe.state.tick < game.state.tick) probe.tick()
  return probe
}

function validTypes(game: Game): string[] {
  return ALL_ACTIONS.filter((a) => clone(game).dispatch(a)).map((a) => a.type)
}

function firstFightOutcome(outcome: 'won' | 'lost', amount: number): Game {
  return findSeed((g) => {
    playFight(g, amount)
    return g.state.lastResult?.outcome === outcome
  })
}

function brokeWithUpgrade(): Game {
  return findSeed((game) => {
    playFight(game, 10)
    if (game.state.lastResult?.outcome !== 'won') return false
    game.dispatch({ type: 'continue' })
    if (game.state.phase !== 'shop' || game.state.shopOffers.length === 0) return false
    game.dispatch({ type: 'pickUpgrade', index: 0 })
    playFight(game, game.state.maxBet)
    const after: Game['state'] = game.state
    if (after.lastResult?.outcome !== 'lost' || after.bankroll !== 0 || after.isBossFight) return false
    return shopOffersForFight(after.seed, 1, after.upgrades.map((u) => u.id)).length > 0
  })
}

function reachCheckpoint(passed: boolean): Game {
  return findSeed((g) => {
    playToBoss(g, (x) => x.state.minBet)
    if (g.state.phase !== 'bet' || !g.state.isBossFight) return false
    playFight(g, passed ? g.state.maxBet : Math.floor(g.state.bankroll / 2))
    const afterFight: Game['state'] = g.state
    if (afterFight.phase !== 'result') return false
    g.dispatch({ type: 'continue' })
    const after: Game['state'] = g.state
    return passed ? after.phase === 'checkpoint' : after.gameOverReason === 'checkpoint' && after.bankroll > 0
  })
}

describe('buy-in', () => {
  it('starts the bankroll at the buy-in and scales every coin amount with it', () => {
    for (const buyIn of [100, 250, 1000]) {
      const s = createGame(1, buyIn).state
      expect(s.buyIn).toBe(buyIn)
      expect(s.bankroll).toBe(buyIn)
      expect(s.stageEntryBankroll).toBe(buyIn)
      expect(s.peakBankroll).toBe(buyIn)
      expect(s.target).toBe(Math.floor((buyIn * (100 + CONFIG.targetGrowthPercent)) / 100))
      expect(s.minBet).toBe(Math.ceil((buyIn * CONFIG.minBetPercent) / 100))
      expect(s.maxBet).toBe(buyIn)
      expect(s.skipCoins).toBe(Math.max(1, Math.floor((buyIn * CONFIG.skipPawnPermilleOfBuyIn) / 1000)))
      expect(s.pawnValue).toBe(s.skipCoins)
      expect(s.cashOut).toBeNull()
      expect(s.cashOutFee).toBeNull()
      expect(s.failedCheckpointFeePercent).toBe(CONFIG.failedCheckpointFeePercent)
    }
    expect(createGame(1).state.buyIn).toBe(CONFIG.defaultBuyIn)
  })

  it('rejects invalid buy-ins', () => {
    expect(CONFIG.minBuyIn).toBe(100)
    expect(CONFIG.buyInPresets).toEqual([100, 250, 500, 1000])
    expect(isValidBuyIn(100)).toBe(true)
    expect(isValidBuyIn(99)).toBe(false)
    expect(isValidBuyIn(50)).toBe(false)
    expect(() => createGame(1, 50)).toThrow(RangeError)
    expect(() => createGame(1, 99)).toThrow(RangeError)
    expect(createGame(1, 100).state.bankroll).toBe(100)
    expect(() => createGame(1, CONFIG.minBuyIn - 1)).toThrow(RangeError)
    expect(() => createGame(1, 100.5)).toThrow(RangeError)
    expect(() => createGame(1, Number.NaN)).toThrow(RangeError)
    expect(CONFIG.buyInPresets.every((b) => b >= CONFIG.minBuyIn)).toBe(true)
  })
})

describe('bets', () => {
  it('clamps bets to [minBet, maxBet] and floors them', () => {
    const g1 = createGame(1)
    expect(g1.dispatch({ type: 'bet', amount: 5000 })).toBe(true)
    expect(g1.state.bet).toBe(100)
    expect(g1.state.bankroll).toBe(0)

    const g2 = createGame(1)
    g2.dispatch({ type: 'bet', amount: 0 })
    expect(g2.state.bet).toBe(minBetFor(100))

    const g3 = createGame(1)
    g3.dispatch({ type: 'bet', amount: 13.7 })
    expect(g3.state.bet).toBe(13)
    expect(g3.state.totalWagered).toBe(13)

    const g4 = createGame(1)
    expect(g4.dispatch({ type: 'bet', amount: Number.NaN })).toBe(false)
    expect(g4.dispatch({ type: 'bet', amount: Number.POSITIVE_INFINITY })).toBe(false)
    expect(g4.log.length).toBe(0)
  })

  it('bet limits are shares of the bankroll, all-in allowed on every fight', () => {
    expect(minBetFor(100)).toBe(4)
    expect(maxBetFor(100, false)).toBe(100)
    expect(maxBetFor(100, true)).toBe(100)
    expect(minBetFor(1)).toBe(1)
    expect(maxBetFor(1, false)).toBe(1)
    expect(maxBetFor(3, false)).toBe(3)
    expect(clampBet(1000, 100, false)).toBe(100)
    expect(clampBet(1000, 100, true)).toBe(100)
    expect(clampBet(1, 100, true)).toBe(4)
    expect(clampBet(1, 100, false)).toBe(4)
  })

  it('all-in is allowed on a normal fight and leaves a bankroll of 0', () => {
    const g = createGame(5)
    expect(g.state.isBossFight).toBe(false)
    expect(g.state.maxBet).toBe(100)
    expect(g.dispatch({ type: 'bet', amount: g.state.maxBet })).toBe(true)
    expect(g.state.bet).toBe(100)
    expect(g.state.bankroll).toBe(0)
    expect(g.state.fight?.bet).toBe(100)
  })

  it('presets are the same shares on every fight and the last one is All-in', () => {
    const g = createGame(1)
    expect(g.state.betPresets).toEqual([
      { id: 'low', label: 'Low', percent: 10, amount: 10, isAllIn: false },
      { id: 'medium', label: 'Medium', percent: 25, amount: 25, isAllIn: false },
      { id: 'high', label: 'High', percent: 50, amount: 50, isAllIn: false },
      { id: 'max', label: 'All-in', percent: 100, amount: 100, isAllIn: true },
    ])
    expect(CONFIG.betPresetPercents).toEqual({ low: 10, medium: 25, high: 50 })
    const mid = createGame(1, 100)
    playFight(mid, 90)
    mid.dispatch({ type: 'continue' })
    if (mid.state.phase === 'shop') mid.dispatch({ type: 'skip' })
    if (mid.state.phase === 'bet') {
      const b = mid.state.bankroll
      const presets = mid.state.betPresets
      expect(presets[3]?.label).toBe('All-in')
      expect(presets[3]?.amount).toBe(b)
      expect(presets[3]?.isAllIn).toBe(true)
      for (const p of presets) {
        expect(p.amount).toBeGreaterThanOrEqual(mid.state.minBet)
        expect(p.amount).toBeLessThanOrEqual(b)
      }
    }
    expect(g.state.canBet).toBe(true)
    playToBoss(g, (x) => x.state.minBet)
    expect(g.state.isBossFight).toBe(true)
    const last = g.state.betPresets[3]
    expect(last?.label).toBe('All-in')
    expect(last?.amount).toBe(g.state.bankroll)
    expect(last?.isAllIn).toBe(true)
    expect(g.state.maxBet).toBe(g.state.bankroll)
  })
})

describe('phases and invalid actions', () => {
  it('only the listed actions are valid in each phase and invalid ones are not logged', () => {
    const g = createGame(3)
    expect(validTypes(g)).toEqual(['bet'])
    expect(g.state.fight).toBeNull()
    g.dispatch({ type: 'bet', amount: 10 })
    expect(g.state.phase).toBe('fight')
    expect(validTypes(g)).toEqual(['roll'])
    expect(g.state.fight?.canWalkAway).toBe(false)
    const before = g.log.length
    expect(g.dispatch({ type: 'walkAway' })).toBe(false)
    expect(g.dispatch({ type: 'continue' })).toBe(false)
    expect(g.dispatch({ type: 'leave' })).toBe(false)
    expect(g.dispatch({ type: 'bet', amount: 5 })).toBe(false)
    expect(g.log.length).toBe(before)
    rollUntilDone(g)
    expect(g.state.phase).toBe('result')
    expect(validTypes(g)).toEqual(['continue'])
    expect(g.state.fight?.canRoll).toBe(false)
    expect(g.state.fight?.canWalkAway).toBe(false)
    g.dispatch({ type: 'continue' })
    expect(g.state.phase).toBe('shop')
    expect(g.state.fight).toBeNull()
    expect(validTypes(g)).toEqual(['pickUpgrade', 'skip'])
    expect(g.dispatch({ type: 'pickUpgrade', index: 3 })).toBe(false)
    expect(g.dispatch({ type: 'pickUpgrade', index: -1 })).toBe(false)
    expect(g.dispatch({ type: 'pickUpgrade', index: 0.5 })).toBe(false)
  })

  it('the checkpoint phase only accepts leave or continue', () => {
    const g = reachCheckpoint(true)
    expect(validTypes(g)).toEqual(['continue', 'leave'])
    expect(g.state.canLeave).toBe(true)
  })

  it('nothing is valid after game over', () => {
    const g = reachCheckpoint(false)
    expect(g.state.phase).toBe('gameover')
    const n = g.log.length
    expect(validTypes(g)).toEqual([])
    for (const a of ALL_ACTIONS) expect(g.dispatch(a)).toBe(false)
    expect(g.log.length).toBe(n)
  })

  it('tick only advances the tick counter', () => {
    const g = createGame(9)
    g.dispatch({ type: 'bet', amount: 10 })
    g.dispatch({ type: 'roll' })
    const s = g.state
    for (let i = 0; i < 120; i++) g.tick()
    expect(g.state.tick).toBe(s.tick + 120)
    expect({ ...g.state, tick: 0 }).toEqual({ ...s, tick: 0 })
  })
})

describe('exchange rules', () => {
  it('higher total wins and deals the difference; multiplier follows damage share', () => {
    const f = scriptedFight([6, 5], [2, 3])
    const r = rollExchange(f)
    if (!r) throw new Error('no exchange')
    expect(r.playerFaces).toEqual([6, 5])
    expect(r.enemyFaces).toEqual([2, 3])
    expect(r.playerTotal).toBe(11)
    expect(r.enemyTotal).toBe(5)
    expect(r.winner).toBe('player')
    expect(r.damageDealt).toBe(6)
    expect(r.enemyHpAfter).toBe(4)
    expect(r.playerCritFactor).toBe(1)
    expect(r.enemyCritFactor).toBe(1)
    expect(r.rerolled).toBe(false)
    expect(r.playerFacesBeforeReroll).toBeNull()
    expect(r.escaped).toBe(false)
    expect(r.multiplierGainedMilli).toBe(Math.floor((6 * CONFIG.fullKoMultiplierMilli) / 10))
    expect(r.multiplierAfterMilli).toBe(f.multiplierMilli)
    expect(r.multiplierGained).toBe(r.multiplierGainedMilli / 1000)
    expect(f.status).toBe('active')
  })

  it('ties deal no damage', () => {
    const f = scriptedFight([3, 4], [4, 3])
    const r = rollExchange(f)
    expect(r?.winner).toBe('tie')
    expect(r?.damageDealt).toBe(0)
    expect(r?.damageTaken).toBe(0)
    expect(canWalkAway(f)).toBe(false)
  })

  it('losing an exchange costs player HP', () => {
    const f = scriptedFight([1, 2], [5, 6])
    const r = rollExchange(f)
    expect(r?.winner).toBe('enemy')
    expect(r?.damageTaken).toBe(8)
    expect(f.playerHp).toBe(CONFIG.playerBaseHp - 8)
  })

  it('winning with doubles crits and a knockout pays full multiplier plus KO bonus', () => {
    const f = scriptedFight([4, 4], [1, 2])
    const r = rollExchange(f)
    expect(r?.playerCrit).toBe(true)
    expect(r?.playerCritFactor).toBe(CONFIG.critFactor)
    expect(r?.damageDealt).toBe(10)
    expect(f.status).toBe('won')
    expect(f.multiplierMilli).toBe(KO)
    expect(fightPayout(f)).toBe(Math.floor((100 * KO) / 1000))
    expect(rollExchange(f)).toBeNull()
  })

  it('enemy doubles crit, damage is capped at remaining HP, and a loss pays 0', () => {
    const f = scriptedFight([1, 3], [5, 5])
    const r = rollExchange(f)
    expect(r?.enemyCrit).toBe(true)
    expect(r?.enemyCritFactor).toBe(CONFIG.critFactor)
    expect(r?.damageTaken).toBe(CONFIG.playerBaseHp)
    expect(f.status).toBe('lost')
    expect(fightPayout(f)).toBe(0)
  })

  it('normal traits: savage, armored, vicious, lucky', () => {
    const savage = rollExchange(scriptedFight([1, 2], [3, 3], [], { ...DUMMY, trait: 'savage' }))
    expect(savage?.damageTaken).toBe(3 * CONFIG.traitSavageCritFactor)
    expect(savage?.enemyCritFactor).toBe(CONFIG.traitSavageCritFactor)
    expect(rollExchange(scriptedFight([6, 5], [2, 3], [], { ...DUMMY, trait: 'armored' }))?.damageDealt).toBe(
      6 - CONFIG.traitArmorReduction,
    )
    expect(rollExchange(scriptedFight([1, 2], [4, 5], [], { ...DUMMY, trait: 'vicious' }))?.damageTaken).toBe(
      6 + CONFIG.traitViciousDamage,
    )
    const lucky = rollExchange(scriptedFight([2, 2], [2, 2], [], { ...DUMMY, trait: 'lucky' }))
    expect(lucky?.winner).toBe('enemy')
    expect(lucky?.enemyCrit).toBe(false)
    expect(lucky?.damageTaken).toBe(CONFIG.traitLuckyTieDamage)
  })

  it('boss traits: enrage, regenerate, ironhide, executioner', () => {
    const enrage = scriptedFight([6, 5, 2, 3], [1, 1, 2, 2], [], BOSS_DUMMY)
    rollExchange(enrage)
    expect(enrage.enemyHp).toBe(1)
    const r2 = rollExchange(enrage)
    expect(r2?.enemyTotal).toBe(4 + CONFIG.bossEnrageBonus)
    expect(r2?.winner).toBe('tie')

    const regen = scriptedFight([6, 5], [2, 3], [], { ...BOSS_DUMMY, trait: 'regenerate' })
    const rr = rollExchange(regen)
    expect(rr?.damageDealt).toBe(6)
    expect(rr?.enemyHealed).toBe(CONFIG.bossRegenerateHp)
    expect(regen.enemyHp).toBe(4 + CONFIG.bossRegenerateHp)
    expect(regen.multiplierMilli).toBe(
      Math.floor(((6 - CONFIG.bossRegenerateHp) * CONFIG.bossFullKoMultiplierMilli) / 10),
    )

    expect(rollExchange(scriptedFight([6, 5], [2, 3], [], { ...BOSS_DUMMY, trait: 'ironhide' }))?.damageDealt).toBe(
      6 - CONFIG.bossIronhideReduction,
    )
    expect(rollExchange(scriptedFight([1, 2], [4, 5], [], { ...BOSS_DUMMY, trait: 'executioner' }))?.damageTaken).toBe(
      6 + CONFIG.bossExecutionerDamage,
    )
  })

  it('a boss knockout pays the boss multiplier', () => {
    const f = scriptedFight([4, 4], [1, 2], [], { ...BOSS_DUMMY, trait: 'executioner' })
    rollExchange(f)
    expect(f.status).toBe('won')
    expect(f.isBoss).toBe(true)
    expect(f.multiplierMilli).toBe(BOSS_KO)
    expect(fightPayout(f)).toBe(Math.floor((100 * BOSS_KO) / 1000))
    expect(BOSS_KO).toBeGreaterThan(KO)
  })

  it('walk-away needs an exchange, pays at least 1 coin, and keeps only part of the payout', () => {
    const f = scriptedFight([6, 5], [2, 3])
    expect(canWalkAway(f)).toBe(false)
    rollExchange(f)
    expect(canWalkAway(f)).toBe(true)
    const expected = Math.floor((100 * f.multiplierMilli * CONFIG.walkAwayKeepMilli) / 1_000_000)
    expect(currentWalkAwayPayout(f)).toBe(expected)
    expect(expected).toBeLessThan(Math.floor((100 * f.multiplierMilli) / 1000))
    f.status = 'walkedAway'
    expect(fightPayout(f)).toBe(expected)
    const tiny = scriptedFight([2, 1], [1, 1], [], { ...DUMMY, maxHp: 1000 }, 1)
    rollExchange(tiny)
    expect(tiny.multiplierMilli).toBeGreaterThan(0)
    expect(currentWalkAwayPayout(tiny)).toBe(0)
    expect(canWalkAway(tiny)).toBe(false)
    expect(CONFIG.walkAwayKeepMilli).toBe(500)
  })

  it('payout helpers floor with integer math', () => {
    expect(walkAwayPayoutAt(7, 1333, 500)).toBe(4)
    expect(walkAwayPayoutAt(1_000_000_000, 2000, 500)).toBe(1_000_000_000)
  })
})

describe('upgrades', () => {
  it('copies beyond the cap have no effect', () => {
    expect(computeMods(['weightedDice', 'weightedDice']).minFace).toBe(2)
    expect(computeMods(Array.from({ length: 6 }, () => 'sharpBlade' as const)).damageBonus).toBe(
      CONFIG.upgradeMaxCopies.sharpBlade * CONFIG.upgradeEffects.sharpBladeDamage,
    )
    expect(computeMods(['escapeRope', 'escapeRope']).escapeRope).toBe(true)
    expect(computeMods(Array.from({ length: 5 }, () => 'insurance' as const)).lossRefundMilli).toBe(
      CONFIG.upgradeMaxCopies.insurance * CONFIG.upgradeEffects.insuranceRefundMilli,
    )
  })

  it('Weighted Dice raises the minimum face', () => {
    expect(rollExchange(scriptedFight([1, 1], [1, 1], ['weightedDice']))?.playerFaces).toEqual([2, 2])
  })

  it('Sharp Blade adds damage to hits', () => {
    expect(rollExchange(scriptedFight([6, 5], [2, 3], ['sharpBlade']))?.damageDealt).toBe(7)
  })

  it('Second Wind rerolls the lowest die on a losing roll, keeping the better', () => {
    const f = scriptedFight([1, 2, 6, 1, 2], [3, 3, 5, 6], ['secondWind'])
    const r1 = rollExchange(f)
    expect(r1?.rerolled).toBe(true)
    expect(r1?.playerFacesBeforeReroll).toEqual([1, 2])
    expect(r1?.playerFaces).toEqual([6, 2])
    expect(r1?.winner).toBe('player')
    expect(f.rerollsLeft).toBe(0)
    const r2 = rollExchange(f)
    expect(r2?.rerolled).toBe(false)
    expect(r2?.winner).toBe('enemy')
  })

  it('Vitality adds max HP', () => {
    expect(scriptedFight([], [], ['vitality']).playerHp).toBe(CONFIG.playerBaseHp + CONFIG.upgradeEffects.vitalityHp)
  })

  it('Shield softens the first hit taken each fight', () => {
    const f = scriptedFight([1, 2, 1, 2], [5, 6, 5, 6], ['shield'])
    const r1 = rollExchange(f)
    expect(r1?.blocked).toBe(CONFIG.upgradeEffects.shieldBlockAmount)
    expect(r1?.damageTaken).toBe(8 - CONFIG.upgradeEffects.shieldBlockAmount)
    const r2 = rollExchange(f)
    expect(r2?.blocked).toBe(0)
    expect(r2?.damageTaken).toBe(Math.min(8, f.mods.maxHp - (8 - CONFIG.upgradeEffects.shieldBlockAmount)))
  })

  it('Loaded Dice crits on a high total', () => {
    const r = rollExchange(scriptedFight([4, 6], [1, 2], ['loadedDice'], { ...DUMMY, maxHp: 50 }))
    expect(r?.playerCrit).toBe(true)
    expect(r?.playerCritFactor).toBe(CONFIG.critFactor)
    expect(r?.damageDealt).toBe(7 * CONFIG.critFactor)
    expect(rollExchange(scriptedFight([4, 6], [1, 2], [], { ...DUMMY, maxHp: 50 }))?.damageDealt).toBe(7)
    expect(rollExchange(scriptedFight([3, 6], [1, 2], ['loadedDice'], { ...DUMMY, maxHp: 50 }))?.playerCrit).toBe(false)
  })

  it('Escape Rope turns a knockout into the walk-away payout', () => {
    const f = scriptedFight([6, 5, 1, 1], [2, 3, 6, 6], ['escapeRope'])
    rollExchange(f)
    const expected = currentWalkAwayPayout(f)
    const r = rollExchange(f)
    expect(r?.escaped).toBe(true)
    expect(f.status).toBe('escaped')
    expect(fightPayout(f)).toBe(expected)
    const plain = scriptedFight([6, 5, 1, 1], [2, 3, 6, 6])
    rollExchange(plain)
    rollExchange(plain)
    expect(plain.status).toBe('lost')
    const early = scriptedFight([1, 1], [6, 6], ['escapeRope'])
    expect(rollExchange(early)?.escaped).toBe(false)
    expect(early.status).toBe('lost')
  })

  it('Insurance refunds part of the bet on a loss', () => {
    const f = scriptedFight([1, 3], [5, 5], ['insurance'])
    rollExchange(f)
    expect(f.status).toBe('lost')
    expect(fightPayout(f)).toBe(Math.floor((100 * CONFIG.upgradeEffects.insuranceRefundMilli) / 1000))
  })

  it('Finisher raises the KO bonus', () => {
    const f = scriptedFight([4, 4], [1, 2], ['finisher'])
    rollExchange(f)
    expect(f.multiplierMilli).toBe(KO + CONFIG.upgradeEffects.finisherKoBonusMilli)
  })

  it('Intimidate lowers enemy max HP', () => {
    const f = scriptedFight([6, 5], [2, 3], ['intimidate'])
    const hp = 10 - Math.floor((10 * CONFIG.upgradeEffects.intimidateEnemyHpPercent) / 100)
    expect(f.enemyMaxHp).toBe(hp)
    rollExchange(f)
    expect(f.multiplierMilli).toBe(Math.floor((6 * CONFIG.fullKoMultiplierMilli) / hp))
  })

  it('Vampire Fang heals on a landed hit', () => {
    const f = scriptedFight([1, 2, 6, 5], [4, 5, 1, 3], ['vampire'])
    rollExchange(f)
    expect(f.playerHp).toBe(4)
    const r = rollExchange(f)
    expect(r?.healed).toBe(CONFIG.upgradeEffects.vampireHeal)
    expect(f.playerHp).toBe(4 + CONFIG.upgradeEffects.vampireHeal)
  })

  it('Thick Skin reduces damage taken, minimum 1', () => {
    expect(rollExchange(scriptedFight([1, 2], [4, 5], ['thickSkin']))?.damageTaken).toBe(5)
    expect(rollExchange(scriptedFight([2, 3], [1, 5], ['thickSkin']))?.damageTaken).toBe(1)
  })

  it('every upgrade has readable text, a cap and the shared pawn value', () => {
    for (const id of UPGRADE_IDS) {
      const u = getUpgrade(id, 1000)
      expect(u.name.length).toBeGreaterThan(0)
      expect(u.description.length).toBeGreaterThan(0)
      expect(u.maxCopies).toBeGreaterThanOrEqual(1)
      expect(u.pawnValue).toBe(skipPawnValue(1000))
    }
  })
})

describe('shop', () => {
  it('the seeded order is a permutation and offers are its first useful entries', () => {
    const order = shopOrderForFight(7, 3)
    expect([...order].sort()).toEqual([...UPGRADE_IDS].sort())
    expect(shopOffersForFight(7, 3)).toEqual(order.slice(0, CONFIG.shopOfferCount))
    const owned: UpgradeId[] = [order[0] as UpgradeId, order[0] as UpgradeId, order[0] as UpgradeId]
    const expected = order.filter((id) => isUseful(owned, id)).slice(0, CONFIG.shopOfferCount)
    expect(shopOffersForFight(7, 3, owned)).toEqual(expected)
    expect(shopOffersForFight(7, 3, owned)).not.toContain(order[0])
  })

  it('offers only upgrades that still have an effect, and may show fewer than three', () => {
    const owned: UpgradeId[] = []
    for (const id of UPGRADE_IDS) for (let i = 0; i < CONFIG.upgradeMaxCopies[id]; i++) owned.push(id)
    const keep = shopOrderForFight(11, 0).slice(0, 2)
    const partial = owned.filter((id) => !keep.includes(id))
    const offers = shopOffersForFight(11, 0, partial)
    expect(offers.length).toBe(2)
    expect(new Set(offers)).toEqual(new Set(keep))
    expect(shopOffersForFight(11, 0, owned)).toEqual([])
  })

  it('a capped upgrade never appears again in a real run', () => {
    const g = createGame(4)
    let checked = 0
    for (let guard = 0; guard < 5000 && g.state.phase !== 'gameover' && checked < 25; guard++) {
      const st = g.state
      if (st.phase === 'shop') {
        const owned = st.upgrades.map((u) => u.id)
        for (const o of st.shopOffers) {
          expect(isUseful(owned, o.id)).toBe(true)
          expect(o.owned).toBe(owned.filter((x) => x === o.id).length)
        }
        expect(st.shopOffers.map((o) => o.id)).toEqual(shopOffersForFight(st.seed, st.fightsCompleted - 1, owned))
        checked++
        if (st.shopOffers.length > 0) g.dispatch({ type: 'pickUpgrade', index: pickIndex(st.shopOffers) })
        else g.dispatch({ type: 'skip' })
      } else if (st.phase === 'bet') {
        if (st.canPawn) g.dispatch({ type: 'pawn', index: 0 })
        else g.dispatch({ type: 'bet', amount: st.minBet })
      } else if (st.phase === 'fight') g.dispatch({ type: 'roll' })
      else g.dispatch({ type: 'continue' })
    }
    expect(checked).toBeGreaterThan(3)
  })

  it('skip pays the same coins as pawning, relative to the buy-in', () => {
    const g = createGame(4, 1000)
    playFight(g, 100)
    g.dispatch({ type: 'continue' })
    const bankroll = g.state.bankroll
    expect(g.state.skipCoins).toBe(10)
    expect(g.dispatch({ type: 'skip' })).toBe(true)
    expect(g.state.bankroll).toBe(bankroll + 10)
    expect(g.state.upgrades.length).toBe(0)
    expect(g.state.phase).toBe('bet')
  })
})

describe('failed checkpoint fee', () => {
  it('withholds the fee percent, flooring the amount returned', () => {
    expect(CONFIG.failedCheckpointFeePercent).toBeGreaterThanOrEqual(8)
    expect(CONFIG.failedCheckpointFeePercent).toBeLessThanOrEqual(15)
    const pct = CONFIG.failedCheckpointFeePercent
    for (const b of [0, 1, 2, 5, 9, 10, 11, 19, 99, 100, 107, 1000, 123457, 1_000_000_007]) {
      const fee = failedCheckpointFee(b)
      const net = b - fee
      expect(Number.isInteger(fee)).toBe(true)
      expect(net).toBe(Math.floor((b * (100 - pct)) / 100))
      expect(fee).toBeGreaterThanOrEqual(0)
      expect(fee).toBeLessThanOrEqual(b)
      expect(fee).toBeGreaterThanOrEqual(Math.floor((b * pct) / 100))
      expect(fee).toBeLessThanOrEqual(Math.ceil((b * pct) / 100))
    }
    expect(failedCheckpointFee(0)).toBe(0)
    expect(failedCheckpointFee(1)).toBe(1)
  })

  it('at 10% the small-bankroll rounding favours the house', () => {
    expect(CONFIG.failedCheckpointFeePercent).toBe(10)
    expect(failedCheckpointFee(1)).toBe(1)
    expect(failedCheckpointFee(9)).toBe(1)
    expect(failedCheckpointFee(10)).toBe(1)
    expect(failedCheckpointFee(11)).toBe(2)
    expect(failedCheckpointFee(100)).toBe(10)
    expect(failedCheckpointFee(105)).toBe(11)
    expect(failedCheckpointFee(1000)).toBe(100)
  })

  it('a failed checkpoint with bankroll 0 returns 0 with no fee', () => {
    const g = findSeed((game) => {
      playToBoss(game, (x) => x.state.minBet)
      if (game.state.phase !== 'bet' || !game.state.isBossFight) return false
      playFight(game, game.state.maxBet)
      return game.state.lastResult?.outcome === 'lost' && game.state.bankroll === 0
    })
    g.dispatch({ type: 'continue' })
    expect(g.state.gameOverReason).toBe('checkpoint')
    expect(g.state.lastCheckpoint?.outcome).toBe('failed')
    expect(g.state.cashOut).toBe(0)
    expect(g.state.cashOutFee).toBe(0)
  })

  it('a failed checkpoint at a small bankroll rounds the fee up', () => {
    const g = findSeed((game) => {
      playToBoss(game, (x) => x.state.minBet)
      if (game.state.phase !== 'bet' || !game.state.isBossFight) return false
      playFight(game, game.state.bankroll - 7)
      return game.state.lastResult?.outcome === 'lost' && game.state.bankroll > 0 && game.state.bankroll < 10
    })
    const b = g.state.bankroll
    g.dispatch({ type: 'continue' })
    expect(g.state.gameOverReason).toBe('checkpoint')
    expect(g.state.cashOutFee).toBe(1)
    expect(g.state.cashOut).toBe(b - 1)
  })
})

describe('run layer', () => {
  it('a stage is four normal fights and a boss', () => {
    const g = createGame(11)
    for (let k = 0; k < CONFIG.fightsPerStage; k++) {
      expect(g.state.fightNumberInStage).toBe(k + 1)
      expect(g.state.fightsPerStage).toBe(5)
      const boss = k === CONFIG.fightsPerStage - 1
      expect(g.state.isBossFight).toBe(boss)
      expect(g.state.isCheckpointFight).toBe(boss)
      g.dispatch({ type: 'bet', amount: g.state.minBet })
      expect(g.state.fight?.isBoss).toBe(boss)
      expect(g.state.fight?.enemy.isBoss).toBe(boss)
      expect(g.state.fight?.fullKoMultiplier).toBe((boss ? BOSS_KO : KO) / 1000)
      rollUntilDone(g)
      expect(g.state.lastResult?.isBoss).toBe(boss)
      g.dispatch({ type: 'continue' })
      if (g.state.phase === 'shop') g.dispatch({ type: 'skip' })
    }
  })

  it('walkAway through the game banks the exact advertised payout', () => {
    const g = findSeed((game) => {
      game.dispatch({ type: 'bet', amount: 20 })
      game.dispatch({ type: 'roll' })
      return game.state.fight?.canWalkAway === true
    })
    const f = g.state.fight
    if (!f) throw new Error('no fight')
    const bankroll = g.state.bankroll
    expect(f.walkAwayKeep).toBe(0.5)
    expect(f.walkAwayPayout).toBe(Math.floor((20 * f.multiplierMilli * CONFIG.walkAwayKeepMilli) / 1_000_000))
    expect(g.dispatch({ type: 'walkAway' })).toBe(true)
    expect(g.state.bankroll).toBe(bankroll + f.walkAwayPayout)
    expect(g.state.totalPaidOut).toBe(f.walkAwayPayout)
    expect(g.state.lastResult).toEqual({
      outcome: 'walkedAway',
      isBoss: false,
      bet: 20,
      multiplier: f.multiplier,
      multiplierMilli: f.multiplierMilli,
      payout: f.walkAwayPayout,
      rolls: 1,
    })
  })

  it('a KO pays bet x (full + KO bonus); a loss pays 0', () => {
    const g = firstFightOutcome('won', 10)
    expect(g.state.lastResult?.payout).toBe(Math.floor((10 * KO) / 1000))
    expect(g.state.bankroll).toBe(90 + Math.floor((10 * KO) / 1000))
    expect(g.state.peakBankroll).toBe(Math.max(100, g.state.bankroll))
    const l = firstFightOutcome('lost', 30)
    expect(l.state.lastResult?.payout).toBe(0)
    expect(l.state.bankroll).toBe(70)
    expect(l.state.totalWagered).toBe(30)
    expect(l.state.totalPaidOut).toBe(0)
  })

  it('a boss KO pays the boss multiplier and counts as a boss defeated', () => {
    const g = findSeed((game) => {
      playToBoss(game, (x) => x.state.minBet)
      if (!game.state.isBossFight || game.state.phase !== 'bet') return false
      playFight(game, 20)
      return game.state.lastResult?.outcome === 'won'
    })
    expect(g.state.lastResult?.payout).toBe(Math.floor((20 * BOSS_KO) / 1000))
    expect(g.state.bossesDefeated).toBe(1)
  })

  it('the checkpoint runs after the boss; passing offers leave or continue', () => {
    const g = reachCheckpoint(true)
    const s = g.state
    expect(s.phase).toBe('checkpoint')
    expect(s.lastCheckpoint?.outcome).toBe('passed')
    expect(s.lastCheckpoint?.stage).toBe(1)
    expect(s.lastCheckpoint?.entryBankroll).toBe(100)
    expect(s.lastCheckpoint?.target).toBe(targetForStage(1, 100))
    expect(s.stage).toBe(2)
    expect(s.stagesCleared).toBe(1)
    expect(s.fightInStage).toBe(0)
    expect(s.stageEntryBankroll).toBe(s.bankroll)
    expect(s.target).toBe(targetForStage(2, s.bankroll))
    expect(s.cashOut).toBeNull()

    const leave = clone(g)
    expect(leave.dispatch({ type: 'leave' })).toBe(true)
    expect(leave.state.phase).toBe('gameover')
    expect(leave.state.gameOverReason).toBe('left')
    expect(leave.state.cashOut).toBe(s.bankroll)
    expect(leave.state.cashOutFee).toBe(0)
    expect(s.cashOutFee).toBeNull()

    expect(g.dispatch({ type: 'continue' })).toBe(true)
    expect(g.state.phase).toBe('shop')
    expect(g.state.shopOffers.map((o) => o.id)).toEqual(
      shopOffersForFight(g.state.seed, 4, g.state.upgrades.map((u) => u.id)),
    )
  })

  it('a failed checkpoint ends the run and returns the bankroll minus the fee', () => {
    const g = reachCheckpoint(false)
    const b = g.state.bankroll
    expect(g.state.gameOverReason).toBe('checkpoint')
    expect(g.state.lastCheckpoint?.outcome).toBe('failed')
    expect(g.state.lastCheckpoint?.bankroll).toBe(b)
    expect(g.state.cashOutFee).toBe(failedCheckpointFee(b))
    expect(g.state.cashOut).toBe(b - failedCheckpointFee(b))
    expect(g.state.cashOut).toBe(Math.floor((b * (100 - CONFIG.failedCheckpointFeePercent)) / 100))
    expect(g.state.cashOutFee).toBeGreaterThan(0)
    expect(g.state.shopOffers).toEqual([])
    expect(g.state.stagesCleared).toBe(0)
  })

  it('going broke on a normal fight with no upgrade ends the run with nothing returned', () => {
    const g = findSeed((game) => {
      playFight(game, game.state.maxBet)
      return game.state.lastResult?.outcome === 'lost' && game.state.lastResult.payout === 0
    })
    expect(g.state.bankroll).toBe(0)
    expect(g.state.fightsCompleted).toBe(1)
    expect(g.state.isBossFight).toBe(false)
    expect(g.dispatch({ type: 'continue' })).toBe(true)
    expect(g.state.phase).toBe('gameover')
    expect(g.state.gameOverReason).toBe('broke')
    expect(g.state.cashOut).toBe(0)
    expect(g.state.cashOutFee).toBe(0)
    expect(g.state.lastCheckpoint).toBeNull()
  })

  it('the allIn bot goes broke mid-stage and pawns in ordinary play', () => {
    let broke = 0
    let pawned = 0
    for (let seed = 1; seed <= 200; seed++) {
      const r = playRun(seed, BOTS.allIn)
      if (r.reason === 'broke') {
        broke++
        expect(r.cashOut).toBe(0)
        expect(r.game.state.cashOutFee).toBe(0)
        expect(r.game.state.upgrades.length).toBe(0)
      }
      if (r.game.log.some((e) => e.action.type === 'pawn')) pawned++
    }
    expect(broke).toBeGreaterThan(20)
    expect(pawned).toBeGreaterThan(20)
  })

  it('going broke mid-stage with an upgrade keeps the run alive through the shop and pawn', () => {
    const g = brokeWithUpgrade()
    expect(g.state.upgrades.length).toBe(1)
    expect(g.dispatch({ type: 'continue' })).toBe(true)
    expect(g.state.phase).toBe('shop')
    expect(g.state.gameOverReason).toBeNull()
    expect(g.state.bankroll).toBe(0)
    const viaSkip = clone(g)
    expect(viaSkip.dispatch({ type: 'skip' })).toBe(true)
    expect(viaSkip.state.bankroll).toBe(viaSkip.state.skipCoins)
    expect(viaSkip.state.canPawn).toBe(false)
    expect(viaSkip.state.canBet).toBe(true)
    expect(g.state.shopOffers.length).toBeGreaterThan(0)
    g.dispatch({ type: 'pickUpgrade', index: 0 })
    expect(g.state.phase).toBe('bet')
    expect(g.state.bankroll).toBe(0)
    expect(g.state.canPawn).toBe(true)
    expect(g.state.canBet).toBe(false)
    expect(g.state.minBet).toBe(0)
    expect(g.state.maxBet).toBe(0)
    expect(g.state.betPresets.length).toBe(4)
    expect(g.state.betPresets.every((p) => p.amount === 0 && !p.isAllIn)).toBe(true)
    const n = g.state.upgrades.length
    expect(g.dispatch({ type: 'bet', amount: 10 })).toBe(false)
    expect(g.dispatch({ type: 'pawn', index: n })).toBe(false)
    expect(g.dispatch({ type: 'pawn', index: 0 })).toBe(true)
    expect(g.state.bankroll).toBe(g.state.pawnValue)
    expect(g.state.bankroll).toBe(viaSkip.state.bankroll)
    expect(g.state.upgrades.length).toBe(n - 1)
    expect(g.state.canPawn).toBe(false)
    expect(g.state.canBet).toBe(true)
  })

  it('taking an upgrade and pawning it never beats skipping', () => {
    const g = brokeWithUpgrade()
    g.dispatch({ type: 'continue' })
    const skip = clone(g)
    skip.dispatch({ type: 'skip' })
    const pickPawn = clone(g)
    pickPawn.dispatch({ type: 'pickUpgrade', index: 0 })
    const last = pickPawn.state.upgrades.length - 1
    expect(pickPawn.dispatch({ type: 'pawn', index: last })).toBe(true)
    expect(pickPawn.state.bankroll).toBe(skip.state.bankroll)
    expect(pickPawn.state.upgrades.map((u) => u.id)).toEqual(skip.state.upgrades.map((u) => u.id))
    expect(pickPawn.dispatch({ type: 'pawn', index: 0 })).toBe(false)
    expect(skip.state.pawnValue).toBe(skip.state.skipCoins)
  })

  it('pawning while broke is only a small lifeline, not a way to grind', () => {
    for (const buyIn of [100, 1000]) {
      let pawnRuns = 0
      let cash = 0
      for (let seed = 1; seed <= 300; seed++) {
        const r = playRun(seed, BOTS.allIn, buyIn)
        const first = r.game.log.findIndex((e) => e.action.type === 'pawn')
        if (first < 0) continue
        pawnRuns++
        cash += r.cashOut
        const at = replay(seed, buyIn, r.game.log.slice(0, first + 1))
        expect(r.game.state.stagesCleared).toBe(at.stagesCleared)
        expect(r.game.state.peakBankroll).toBe(at.peakBankroll)
        expect(r.cashOut).toBeLessThan(buyIn / 4)
      }
      expect(pawnRuns).toBeGreaterThan(50)
      expect(cash / pawnRuns / buyIn).toBeLessThan(0.02)
    }
  })

  it('pawn is invalid while bankroll is positive', () => {
    const g = createGame(2)
    playFight(g, 5)
    g.dispatch({ type: 'continue' })
    g.dispatch({ type: 'pickUpgrade', index: 0 })
    expect(g.state.canPawn).toBe(false)
    expect(g.dispatch({ type: 'pawn', index: 0 })).toBe(false)
  })

  it('run summary fields track wagers, payouts and the peak; no meta currency', () => {
    const r = playRun(77, BOTS.sensible)
    const s = r.game.state
    expect(s.totalWagered).toBe(r.perFight.reduce((a, f) => a + f.bet, 0))
    expect(s.totalPaidOut).toBe(r.perFight.reduce((a, f) => a + f.payout, 0))
    expect(s.peakBankroll).toBeGreaterThanOrEqual(Math.max(s.buyIn, s.bankroll))
    expect(s.bossesDefeated).toBeLessThanOrEqual(s.stagesCleared + 1)
    expect(s.cashOut).not.toBeNull()
    expect('metaCurrency' in s).toBe(false)
  })

  it('fight state exposes everything the UI needs', () => {
    const g = createGame(21)
    g.dispatch({ type: 'bet', amount: 40 })
    const f = g.state.fight
    if (!f) throw new Error('no fight')
    expect(f.index).toBe(0)
    expect(f.stageOfFight).toBe(1)
    expect(f.enemy.hp).toBe(f.enemy.maxHp)
    expect(f.enemy.traitText.length).toBeGreaterThan(0)
    expect(f.player.hp).toBe(CONFIG.playerBaseHp)
    expect(f.player.diceText).toBe('2d6')
    expect(f.player.hasEscapeRope).toBe(false)
    expect(f.multiplierMilli).toBe(0)
    expect(f.koPayout).toBe(Math.floor((40 * KO) / 1000))
    expect(f.canRoll).toBe(true)
    expect(f.exchanges).toEqual([])
    g.dispatch({ type: 'roll' })
    expect(g.state.fight?.exchanges.length).toBe(1)
    expect(f.exchanges.length).toBe(0)
  })
})

describe('enemies', () => {
  it('stage and boss slot derive from the fight index', () => {
    expect([0, 4, 5, 9, 10].map(stageOfFight)).toEqual([1, 1, 2, 2, 3])
    expect([0, 3, 4, 8, 9, 14].map(isBossFight)).toEqual([false, false, true, false, true, true])
  })

  it('bosses use their own names and traits and have more HP', () => {
    let bossHp = 0
    let normalHp = 0
    for (let s = 1; s <= 300; s++) {
      const b: EnemyDef = generateEnemy(s, 4)
      const n: EnemyDef = generateEnemy(s, 3)
      expect(b.isBoss).toBe(true)
      expect(n.isBoss).toBe(false)
      expect(CONFIG.bossNames).toContain(b.name)
      expect(CONFIG.enemyNames).toContain(n.name)
      expect(BOSS_TRAITS).toContain(b.trait)
      expect(NORMAL_TRAITS).toContain(n.trait)
      bossHp += b.maxHp
      normalHp += n.maxHp
    }
    expect(bossHp / 300).toBeGreaterThan(normalHp / 300 + 2)
  })

  it('every trait has one line of non-empty text', () => {
    for (const t of [...NORMAL_TRAITS, ...BOSS_TRAITS]) {
      const text = traitText(t)
      expect(text.length).toBeGreaterThan(0)
      expect(text.includes('\n')).toBe(false)
    }
  })

  it('enemy strength ramps smoothly with the fight index', () => {
    let prev = enemyBonusMilliForFight(0)
    for (let k = 1; k <= 80; k++) {
      const cur = enemyBonusMilliForFight(k)
      expect(cur).toBeGreaterThanOrEqual(prev)
      expect(cur - prev).toBeLessThanOrEqual(CONFIG.enemyBonusPerFightMilli)
      prev = cur
    }
  })

  it('targets grow from the bankroll the stage is entered with', () => {
    expect(targetForStage(1, 100)).toBe(107)
    expect(targetForStage(3, 250)).toBe(267)
    expect(targetForStage(1, 5)).toBe(6)
    expect(targetForStage(2, 1000)).toBe(1070)
  })
})
