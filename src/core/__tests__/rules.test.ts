import { describe, expect, it } from 'vitest'
import {
  BOSS_TRAITS,
  CONFIG,
  NORMAL_TRAITS,
  RULES_VERSION,
  UPGRADE_IDS,
  archetypeOf,
  canWalkAway,
  clampBet,
  computeMods,
  createGame,
  createSimFight,
  currentWalkAwayParts,
  currentWalkAwayPayout,
  enemyBonusMilliForFight,
  failedCheckpointFee,
  fightPayout,
  generateEnemy,
  getUpgrade,
  isBossFight,
  isUseful,
  isValidBuyIn,
  koMultiplierMilliForLevel,
  leaveFee,
  levelDef,
  levelInfo,
  lossPayoutAt,
  maxBetFor,
  minBetFor,
  resultTriggers,
  rollExchange,
  shopOffersForFight,
  shopOrderForFight,
  stageOfFight,
  targetForStage,
  traitText,
  walkAwayPartsAt,
  walkAwayPayoutAt,
} from '../index.ts'
import type { Action, Archetype, EnemyDef, Game, UpgradeId, UpgradeTrigger } from '../index.ts'
import { BOTS, pickIndex, playRun, priorityBuild, walkByRule } from './bots.ts'
import { BOSS_DUMMY, DUMMY, findSeed, playFight, playToBoss, rollUntilDone, scriptedFight } from './helpers.ts'

const ALL_ACTIONS: Action[] = [
  { type: 'bet', amount: 10 },
  { type: 'roll' },
  { type: 'walkAway' },
  { type: 'continue' },
  { type: 'leave' },
  { type: 'pickUpgrade', index: 0 },
  { type: 'skip' },
]

const L1 = CONFIG.levels[0] as (typeof CONFIG.levels)[number]
const KO = L1.fullKoMilli + L1.koBonusMilli
const BOSS_KO = L1.bossFullKoMilli + L1.bossKoBonusMilli
const REFUND = CONFIG.walkAwayRefundMilli
const KEEP = CONFIG.walkAwayKeepMilli

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

function ids(triggers: ReadonlyArray<UpgradeTrigger>): UpgradeId[] {
  return triggers.map((t) => t.id)
}

describe('buy-in and version', () => {
  it('starts the bankroll at the buy-in and scales every coin amount with it', () => {
    for (const buyIn of [100, 250, 1000]) {
      const s = createGame(1, buyIn).state
      expect(s.buyIn).toBe(buyIn)
      expect(s.bankroll).toBe(buyIn)
      expect(s.stageEntryBankroll).toBe(buyIn)
      expect(s.peakBankroll).toBe(buyIn)
      expect(s.target).toBe(Math.floor((buyIn * (100 + L1.targetGrowthPercent)) / 100))
      expect(s.minBet).toBe(Math.ceil((buyIn * CONFIG.minBetPercent) / 100))
      expect(s.maxBet).toBe(buyIn)
      expect(s.leaveFeePercent).toBe(CONFIG.leaveFeePercent)
      expect(s.leaveFee).toBe(0)
      expect(s.cashOut).toBeNull()
      expect(s.cashOutFee).toBeNull()
      expect(s.failedCheckpointFeePercent).toBe(CONFIG.failedCheckpointFeePercent)
      expect(s.rulesVersion).toBe(RULES_VERSION)
    }
    expect(createGame(1).state.buyIn).toBe(CONFIG.defaultBuyIn)
  })

  it('exports a non-empty RULES_VERSION string and no pawn API', () => {
    expect(typeof RULES_VERSION).toBe('string')
    expect(RULES_VERSION.length).toBeGreaterThan(0)
    const s = createGame(1).state as unknown as Record<string, unknown>
    for (const gone of ['canPawn', 'pawnValue', 'skipCoins']) expect(gone in s).toBe(false)
    expect('pawnValue' in getUpgrade('shield')).toBe(false)
    expect(createGame(1).dispatch({ type: 'pawn', index: 0 } as unknown as Action)).toBe(false)
  })

  it('rejects invalid buy-ins', () => {
    expect(CONFIG.minBuyIn).toBe(100)
    expect(CONFIG.buyInPresets).toEqual([100, 250, 500, 1000])
    expect(isValidBuyIn(100)).toBe(true)
    expect(isValidBuyIn(99)).toBe(false)
    expect(() => createGame(1, 50)).toThrow(RangeError)
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
    expect(clampBet(1000, 100, false)).toBe(100)
    expect(clampBet(1, 100, true)).toBe(4)
  })

  it('presets are 10 / 25 / 50 / All-in', () => {
    const g = createGame(1)
    expect(g.state.betPresets).toEqual([
      { id: 'low', label: 'Low', percent: 10, amount: 10, isAllIn: false },
      { id: 'medium', label: 'Medium', percent: 25, amount: 25, isAllIn: false },
      { id: 'high', label: 'High', percent: 50, amount: 50, isAllIn: false },
      { id: 'max', label: 'All-in', percent: 100, amount: 100, isAllIn: true },
    ])
    playToBoss(g, (x) => x.state.minBet)
    expect(g.state.isBossFight).toBe(true)
    expect(g.state.betPresets[3]?.amount).toBe(g.state.bankroll)
    expect(g.state.maxBet).toBe(g.state.bankroll)
  })
})

describe('phases and invalid actions', () => {
  it('only the listed actions are valid in each phase and invalid ones are not logged', () => {
    const g = createGame(3)
    expect(validTypes(g)).toEqual(['bet'])
    g.dispatch({ type: 'bet', amount: 10 })
    expect(validTypes(g)).toEqual(['roll'])
    expect(g.state.fight?.canWalkAway).toBe(false)
    const before = g.log.length
    expect(g.dispatch({ type: 'walkAway' })).toBe(false)
    expect(g.dispatch({ type: 'continue' })).toBe(false)
    expect(g.log.length).toBe(before)
    rollUntilDone(g)
    expect(validTypes(g)).toEqual(['continue'])
    g.dispatch({ type: 'continue' })
    expect(g.state.phase).toBe('shop')
    expect(validTypes(g)).toEqual(['pickUpgrade', 'skip'])
    expect(g.dispatch({ type: 'pickUpgrade', index: 3 })).toBe(false)
    expect(g.dispatch({ type: 'pickUpgrade', index: 0.5 })).toBe(false)
  })

  it('the checkpoint phase only accepts leave or continue', () => {
    const g = reachCheckpoint(true)
    expect(validTypes(g)).toEqual(['continue', 'leave'])
    expect(g.state.canLeave).toBe(true)
  })

  it('nothing is valid after game over', () => {
    const g = reachCheckpoint(false)
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
    expect({ ...g.state, tick: 0 }).toEqual({ ...s, tick: 0 })
  })
})

describe('levels', () => {
  it('every level has a label, KO multipliers and a target that the state exposes', () => {
    const s = createGame(1).state
    expect(s.level).toBe(1)
    expect(s.levelInfo).toEqual(levelInfo(1))
    expect(s.levelInfo.koMultiplierMilli).toBe(KO)
    expect(s.levelInfo.bossKoMultiplierMilli).toBe(BOSS_KO)
    expect(s.levelInfo.targetGrowthPercent).toBe(L1.targetGrowthPercent)
    expect(s.levelInfo.difficultyLabel).toBe(L1.label)
    expect(s.levelInfo.enemyDiceText).toMatch(/^2d6([+-]\d+)?$/)
  })

  it('deeper levels pay more and are harder, capped after the table', () => {
    const n = CONFIG.levels.length
    for (let l = 2; l <= n; l++) {
      const a = levelInfo(l - 1)
      const b = levelInfo(l)
      expect(b.koMultiplierMilli).toBeGreaterThan(a.koMultiplierMilli)
      expect(b.bossKoMultiplierMilli).toBeGreaterThan(a.bossKoMultiplierMilli)
      expect(b.maxWinPerLevel).toBeGreaterThan(a.maxWinPerLevel)
      expect(b.targetGrowthPercent).toBeGreaterThanOrEqual(a.targetGrowthPercent)
      expect(levelDef(l).enemyBonusMilli).toBeGreaterThan(levelDef(l - 1).enemyBonusMilli)
      expect(levelDef(l).plainWeight).toBeLessThanOrEqual(levelDef(l - 1).plainWeight)
      expect(b.enemyHpMin).toBeGreaterThanOrEqual(a.enemyHpMin)
    }
    const last = levelInfo(n)
    const over = levelInfo(n + 3)
    expect(over.level).toBe(n + 3)
    expect(over.koMultiplierMilli).toBe(last.koMultiplierMilli)
    expect(levelDef(n + 3).enemyBonusMilli).toBe(levelDef(n).enemyBonusMilli + 3 * CONFIG.levelOverflowBonusMilli)
  })

  it('fights use their level profile for KO multipliers and enemy bonus', () => {
    const g = reachCheckpoint(true)
    g.dispatch({ type: 'continue' })
    if (g.state.phase === 'shop') g.dispatch({ type: 'skip' })
    expect(g.state.level).toBe(2)
    expect(g.state.levelInfo.level).toBe(2)
    g.dispatch({ type: 'bet', amount: g.state.minBet })
    const f = g.state.fight
    if (!f) throw new Error('no fight')
    expect(f.level).toBe(2)
    expect(f.fullKoMultiplier).toBe(koMultiplierMilliForLevel(2, false) / 1000)
    expect(f.koPayout).toBe(Math.floor((f.bet * koMultiplierMilliForLevel(2, false)) / 1000))
    expect(enemyBonusMilliForFight(5)).toBe(levelDef(2).enemyBonusMilli)
  })
})

describe('exchange rules', () => {
  it('higher total wins and deals the difference; multiplier follows damage share', () => {
    const f = scriptedFight([6, 5], [2, 3])
    const r = rollExchange(f)
    if (!r) throw new Error('no exchange')
    expect(r.winner).toBe('player')
    expect(r.damageDealt).toBe(6)
    expect(r.playerCritSource).toBeNull()
    expect(r.upgradeTriggers).toEqual([])
    expect(r.multiplierGainedMilli).toBe(Math.floor((6 * L1.fullKoMilli) / 10))
    expect(f.status).toBe('active')
  })

  it('ties deal no damage; losing costs HP; doubles crit; KO pays the level multiplier', () => {
    expect(rollExchange(scriptedFight([3, 4], [4, 3]))?.winner).toBe('tie')
    const lost = scriptedFight([1, 2], [5, 6])
    expect(rollExchange(lost)?.damageTaken).toBe(8)
    const ko = scriptedFight([4, 4], [1, 2])
    const r = rollExchange(ko)
    expect(r?.playerCritSource).toBe('doubles')
    expect(ko.status).toBe('won')
    expect(ko.multiplierMilli).toBe(KO)
    expect(fightPayout(ko)).toBe(Math.floor((100 * KO) / 1000))
    const dead = scriptedFight([1, 3], [5, 5])
    expect(rollExchange(dead)?.enemyCritFactor).toBe(CONFIG.critFactor)
    expect(dead.status).toBe('lost')
    expect(fightPayout(dead)).toBe(0)
  })

  it('normal traits behave as their text says', () => {
    const savage = rollExchange(scriptedFight([1, 2], [3, 3], [], { ...DUMMY, trait: 'savage' }))
    expect(savage?.damageTaken).toBe(3 * CONFIG.traitSavageCritFactor)
    expect(rollExchange(scriptedFight([6, 5], [2, 3], [], { ...DUMMY, trait: 'armored' }))?.damageDealt).toBe(5)
    expect(rollExchange(scriptedFight([1, 2], [4, 5], [], { ...DUMMY, trait: 'vicious' }))?.damageTaken).toBe(7)
    const lucky = rollExchange(scriptedFight([2, 2], [2, 2], [], { ...DUMMY, trait: 'lucky' }))
    expect(lucky?.winner).toBe('enemy')
    expect(lucky?.damageTaken).toBe(CONFIG.traitLuckyTieDamage)
    const frenzied = scriptedFight([6, 5, 2, 3], [1, 1, 2, 2], [], { ...DUMMY, trait: 'frenzied' })
    rollExchange(frenzied)
    expect(rollExchange(frenzied)?.enemyBonusApplied).toBe(CONFIG.traitFrenziedBonus)
    const leech = scriptedFight([6, 5, 1, 2], [2, 3, 4, 5], [], { ...DUMMY, trait: 'leech' })
    rollExchange(leech)
    expect(rollExchange(leech)?.enemyHealed).toBe(CONFIG.traitLeechHeal)
    const thorny = rollExchange(scriptedFight([6, 5], [2, 3], [], { ...DUMMY, trait: 'thorny' }))
    expect(thorny?.thornDamage).toBe(CONFIG.traitThornDamage)
    expect(thorny?.playerHpAfter).toBe(CONFIG.playerBaseHp - CONFIG.traitThornDamage)
    const cursed = rollExchange(scriptedFight([6, 6], [1, 1], [], { ...DUMMY, trait: 'cursed', maxHp: 50 }))
    expect(cursed?.playerFaces).toEqual([5, 5])
    expect(cursed?.cursedClamps).toBe(2)
  })

  it('boss traits behave as their text says', () => {
    const enrage = scriptedFight([6, 5, 2, 3], [1, 1, 2, 2], [], BOSS_DUMMY)
    rollExchange(enrage)
    expect(rollExchange(enrage)?.enemyTotal).toBe(4 + CONFIG.bossEnrageBonus)
    const regen = scriptedFight([6, 5], [2, 3], [], { ...BOSS_DUMMY, trait: 'regenerate' })
    expect(rollExchange(regen)?.enemyHealed).toBe(CONFIG.bossRegenerateHp)
    expect(rollExchange(scriptedFight([6, 5], [2, 3], [], { ...BOSS_DUMMY, trait: 'ironhide' }))?.damageDealt).toBe(4)
    expect(rollExchange(scriptedFight([1, 2], [4, 5], [], { ...BOSS_DUMMY, trait: 'executioner' }))?.damageTaken).toBe(8)
    const vamp = scriptedFight([6, 5, 1, 2], [2, 3, 4, 5], [], { ...BOSS_DUMMY, trait: 'vampiric' })
    rollExchange(vamp)
    expect(rollExchange(vamp)?.enemyHealed).toBe(CONFIG.bossVampiricHeal)
    const crush = rollExchange(scriptedFight([1, 2], [3, 3], [], { ...BOSS_DUMMY, trait: 'crusher' }))
    expect(crush?.damageTaken).toBe(3 * CONFIG.bossCrusherCritFactor)
    let colossus = 0
    let mighty = 0
    for (let s = 1; s <= 400; s++) {
      const e = generateEnemy(s, 4)
      if (e.trait === 'colossus') colossus++
      if (e.trait === 'mighty') mighty++
    }
    expect(colossus).toBeGreaterThan(10)
    expect(mighty).toBeGreaterThan(10)
  })

  it('a boss knockout pays the level boss multiplier', () => {
    const f = scriptedFight([4, 4], [1, 2], [], { ...BOSS_DUMMY, trait: 'executioner' })
    rollExchange(f)
    expect(f.multiplierMilli).toBe(BOSS_KO)
    expect(BOSS_KO).toBeGreaterThan(KO)
  })
})

describe('walk away', () => {
  it('pays a share of the bet back plus half of what was earned, after one exchange', () => {
    const f = scriptedFight([6, 5], [2, 3])
    expect(canWalkAway(f)).toBe(false)
    rollExchange(f)
    expect(canWalkAway(f)).toBe(true)
    const parts = currentWalkAwayParts(f)
    expect(parts.refund).toBe(Math.floor((100 * REFUND) / 1000))
    expect(parts.fromEarned).toBe(Math.floor((100 * f.multiplierMilli * KEEP) / 1_000_000))
    expect(parts.total).toBe(parts.refund + parts.fromEarned)
    expect(currentWalkAwayPayout(f)).toBe(parts.total)
    f.status = 'walkedAway'
    expect(fightPayout(f)).toBe(parts.total)
    expect(REFUND).toBeGreaterThanOrEqual(300)
    expect(REFUND).toBeLessThanOrEqual(400)
    expect(KEEP).toBe(500)
  })

  it('is available after a lost exchange too, paying the refund share', () => {
    const f = scriptedFight([1, 2], [4, 5])
    rollExchange(f)
    expect(f.multiplierMilli).toBe(0)
    expect(canWalkAway(f)).toBe(true)
    expect(currentWalkAwayPayout(f)).toBe(Math.floor((100 * REFUND) / 1000))
  })

  it('payout helpers floor with integer math', () => {
    expect(walkAwayPayoutAt(7, 1333)).toBe(Math.floor((7 * REFUND) / 1000) + Math.floor((7 * 1333 * KEEP) / 1_000_000))
    expect(walkAwayPartsAt(1_000_000_000, 2000, 300, 500)).toEqual({ refund: 300_000_000, fromEarned: 1_000_000_000, total: 1_300_000_000 })
    expect(walkAwayPayoutAt(1, 0)).toBe(0)
  })

  it('a 1-coin bet cannot walk away for 0 coins', () => {
    const tiny = scriptedFight([1, 2], [4, 5], [], DUMMY, 1)
    rollExchange(tiny)
    expect(currentWalkAwayPayout(tiny)).toBe(0)
    expect(canWalkAway(tiny)).toBe(false)
  })

  it('walking always pays at least the loss refund, whatever upgrades are owned', () => {
    const builds: UpgradeId[][] = [[], ['insurance'], ['escapeRope'], ['insurance', 'escapeRope'], ['finisher', 'insurance']]
    for (const b of builds) {
      const m = computeMods(b)
      for (const bet of [1, 4, 25, 100, 1000]) {
        expect(walkAwayPayoutAt(bet, 0, m.walkAwayRefundMilli, m.walkAwayKeepMilli)).toBeGreaterThanOrEqual(
          lossPayoutAt(bet, m.lossRefundMilli),
        )
      }
    }
  })

  it('beats fighting on at low HP against a healthy enemy at every level, by more the deeper you go', () => {
    const ratio: number[] = []
    for (let level = 1; level <= 3; level++) {
      let walk = 0
      let fightOn = 0
      let n = 0
      for (let s = 1; s <= 3000; s++) {
        const index = (level - 1) * 5 + (s % 5)
        const f = createSimFight(s, index, 1000, computeMods(priorityBuild(s, index)), generateEnemy(s, index))
        let at: number | null = null
        while (f.status === 'active') {
          rollExchange(f)
          const healthyEnemy = f.enemyHp * 100 >= f.enemyMaxHp * 70
          if (f.status === 'active' && at === null && healthyEnemy && f.playerHp * 100 <= f.playerMaxHp * 30) at = currentWalkAwayPayout(f)
        }
        if (at === null) continue
        expect(at).toBeGreaterThanOrEqual(Math.floor((1000 * REFUND) / 1000))
        walk += at
        fightOn += fightPayout(f)
        n++
      }
      expect(n).toBeGreaterThan(300)
      expect(walk).toBeGreaterThan(fightOn)
      ratio.push(walk / fightOn)
    }
    expect(ratio[2]).toBeGreaterThan(1.3)
    expect(ratio[2]).toBeGreaterThan(ratio[0] as number)
  })

  it('loses to fighting on when healthy after the first exchange', () => {
    let walk = 0
    let fightOn = 0
    let n = 0
    for (let s = 1; s <= 4000; s++) {
      const index = s % 10
      const f = createSimFight(s, index, 1000, computeMods(priorityBuild(s, index)), generateEnemy(s, index))
      rollExchange(f)
      if (f.status !== 'active' || f.playerHp * 100 < f.playerMaxHp * 70) continue
      walk += currentWalkAwayPayout(f)
      n++
      while (f.status === 'active') {
        const view = { playerHp: f.playerHp, playerMaxHp: f.playerMaxHp, enemyHp: f.enemyHp, enemyMaxHp: f.enemyMaxHp, isBoss: f.isBoss }
        if (walkByRule('lowHp', view)) f.status = 'walkedAway'
        else rollExchange(f)
      }
      fightOn += fightPayout(f)
    }
    expect(n).toBeGreaterThan(1500)
    expect(walk).toBeLessThan(fightOn * 0.85)
  })
})

describe('upgrades', () => {
  it('copies beyond the cap have no effect', () => {
    expect(computeMods(['weightedDice', 'weightedDice']).minFace).toBe(2)
    expect(computeMods(Array.from({ length: 6 }, () => 'sharpBlade' as const)).damageBonus).toBe(
      CONFIG.upgradeMaxCopies.sharpBlade * CONFIG.upgradeEffects.sharpBladeDamage,
    )
    expect(computeMods(['escapeRope', 'escapeRope']).walkAwayRefundMilli).toBe(REFUND + CONFIG.upgradeEffects.escapeRopeRefundMilli)
    expect(computeMods(['insurance', 'insurance']).lossRefundMilli).toBe(CONFIG.upgradeEffects.insuranceRefundMilli)
    expect(CONFIG.upgradeMaxCopies.insurance * CONFIG.upgradeEffects.insuranceRefundMilli).toBeLessThan(REFUND)
  })

  it('there are at least 18 upgrades with readable text and a cap', () => {
    expect(UPGRADE_IDS.length).toBeGreaterThanOrEqual(18)
    for (const id of UPGRADE_IDS) {
      const u = getUpgrade(id)
      expect(u.name.length).toBeGreaterThan(0)
      expect(u.description.length).toBeGreaterThan(0)
      expect(u.description.includes('\n')).toBe(false)
      expect(u.maxCopies).toBe(CONFIG.upgradeMaxCopies[id])
    }
  })

  it('Weighted Dice, Sharp Blade, Second Wind, Vitality, Shield, Loaded Dice', () => {
    const wd = rollExchange(scriptedFight([1, 1], [1, 1], ['weightedDice']))
    expect(wd?.playerFaces).toEqual([2, 2])
    expect(wd?.weightedDiceClamps).toBe(2)
    expect(ids(wd?.upgradeTriggers ?? [])).toContain('weightedDice')
    const sb = rollExchange(scriptedFight([6, 5], [2, 3], ['sharpBlade']))
    expect(sb?.damageDealt).toBe(7)
    expect(sb?.sharpBladeBonus).toBe(1)
    const sw = scriptedFight([1, 2, 6], [3, 3], ['secondWind'])
    const r1 = rollExchange(sw)
    expect(r1?.rerolled).toBe(true)
    expect(r1?.playerFaces).toEqual([6, 2])
    expect(scriptedFight([], [], ['vitality']).playerHp).toBe(CONFIG.playerBaseHp + CONFIG.upgradeEffects.vitalityHp)
    const sh = rollExchange(scriptedFight([1, 2], [5, 6], ['shield']))
    expect(sh?.blocked).toBe(CONFIG.upgradeEffects.shieldBlockAmount)
    expect(sh?.blockedBy).toBe('shield')
    expect(sh?.damageTaken).toBe(8 - CONFIG.upgradeEffects.shieldBlockAmount)
    const ld = rollExchange(scriptedFight([4, 6], [1, 2], ['loadedDice'], { ...DUMMY, maxHp: 50 }))
    expect(ld?.playerCritSource).toBe('loadedDice')
    expect(ld?.damageDealt).toBe(14)
  })

  it('Escape Rope raises the walk-away refund share', () => {
    const f = scriptedFight([6, 5], [2, 3], ['escapeRope'])
    rollExchange(f)
    const parts = currentWalkAwayParts(f)
    expect(parts.refund).toBe(Math.floor((100 * (REFUND + CONFIG.upgradeEffects.escapeRopeRefundMilli)) / 1000))
    f.status = 'walkedAway'
    expect(ids(resultTriggers(f))).toEqual(['escapeRope'])
  })

  it('Insurance, Finisher, Intimidate, Vampire Fang, Thick Skin', () => {
    const ins = scriptedFight([1, 3], [5, 5], ['insurance'])
    rollExchange(ins)
    expect(fightPayout(ins)).toBe(Math.floor((100 * CONFIG.upgradeEffects.insuranceRefundMilli) / 1000))
    const fin = scriptedFight([4, 4], [1, 2], ['finisher'])
    rollExchange(fin)
    expect(fin.multiplierMilli).toBe(KO + CONFIG.upgradeEffects.finisherKoBonusMilli)
    const int = scriptedFight([6, 5], [2, 3], ['intimidate'])
    expect(int.enemyMaxHp).toBe(8)
    const vamp = scriptedFight([1, 2, 6, 5], [4, 5, 1, 3], ['vampire'])
    rollExchange(vamp)
    expect(rollExchange(vamp)?.healed).toBe(Math.min(CONFIG.upgradeEffects.vampireHeal, 6))
    const ts = rollExchange(scriptedFight([1, 2], [4, 5], ['thickSkin']))
    expect(ts?.damageTaken).toBe(5)
    expect(ts?.thickSkinReduced).toBe(1)
    expect(rollExchange(scriptedFight([2, 3], [1, 5], ['thickSkin']))?.damageTaken).toBe(1)
  })

  it('Tie Breaker, First Blood, Iron Guard, Combo, Riposte, Bloodlust', () => {
    const tie = rollExchange(scriptedFight([3, 4], [4, 3], ['tieBreaker']))
    expect(tie?.winner).toBe('player')
    expect(tie?.tieBreak).toBe(true)
    expect(tie?.damageDealt).toBe(CONFIG.upgradeEffects.tieBreakerDamage)
    expect(rollExchange(scriptedFight([3, 4], [4, 3], ['tieBreaker'], { ...DUMMY, trait: 'lucky' }))?.winner).toBe('player')

    const fb = scriptedFight([6, 5, 5, 4], [2, 3, 1, 2], ['firstBlood'], { ...DUMMY, maxHp: 50 })
    expect(rollExchange(fb)?.playerCritSource).toBe('firstBlood')
    expect(fb.enemyHp).toBe(50 - 12)
    expect(rollExchange(fb)?.playerCrit).toBe(false)

    const ig = rollExchange(scriptedFight([1, 2], [5, 5], ['ironGuard']))
    expect(ig?.enemyCrit).toBe(true)
    expect(ig?.enemyCritFactor).toBe(1)
    expect(ig?.ironGuardReduced).toBe(7)
    expect(ig?.damageTaken).toBe(7)
    const igSavage = rollExchange(scriptedFight([1, 2], [3, 3], ['ironGuard'], { ...DUMMY, trait: 'savage' }))
    expect(igSavage?.enemyCritFactor).toBe(CONFIG.traitSavageCritFactor - 1)

    const combo = scriptedFight([6, 5, 5, 4], [2, 3, 1, 2], ['combo'], { ...DUMMY, maxHp: 50 })
    expect(rollExchange(combo)?.playerCrit).toBe(false)
    const c2 = rollExchange(combo)
    expect(c2?.playerCritSource).toBe('combo')
    expect(c2?.playerCritFactor).toBe(CONFIG.upgradeEffects.comboCritFactor)
    expect(c2?.damageDealt).toBe(6 * CONFIG.upgradeEffects.comboCritFactor)

    const rip = rollExchange(scriptedFight([2, 3], [3, 4], ['riposte']))
    expect(rip?.winner).toBe('enemy')
    expect(rip?.riposteDamage).toBe(CONFIG.upgradeEffects.riposteDamage)
    expect(rip?.enemyHpAfter).toBe(10 - CONFIG.upgradeEffects.riposteDamage)
    expect(rollExchange(scriptedFight([1, 2], [5, 6], ['riposte']))?.riposteDamage).toBe(0)

    const bl = scriptedFight([6, 5, 4, 3], [2, 3, 1, 2], ['bloodlust'], { ...DUMMY, maxHp: 12 })
    expect(rollExchange(bl)?.bloodlustBonus).toBe(0)
    const b2 = rollExchange(bl)
    expect(b2?.bloodlustBonus).toBe(CONFIG.upgradeEffects.bloodlustDamage)
    expect(bl.status).toBe('won')
  })

  it('every upgrade reports a trigger in a scripted fight (start, exchange or result)', () => {
    const seen = new Set<UpgradeId>()
    const collect = (f: ReturnType<typeof scriptedFight>): void => {
      for (const t of f.startTriggers) seen.add(t.id)
      for (const x of f.exchanges) for (const t of x.upgradeTriggers) seen.add(t.id)
      for (const t of resultTriggers(f)) seen.add(t.id)
      for (const t of [...f.startTriggers, ...f.exchanges.flatMap((x) => x.upgradeTriggers), ...resultTriggers(f)]) {
        expect(t.text.length).toBeGreaterThan(0)
      }
    }
    const run = (p: number[], e: number[], up: UpgradeId[], enemy: EnemyDef = DUMMY, walk = false): void => {
      const f = scriptedFight(p, e, up, enemy)
      while (f.status === 'active' && f.exchanges.length * 2 < e.length) rollExchange(f)
      if (walk && f.status === 'active') f.status = 'walkedAway'
      collect(f)
    }
    run([1, 1], [1, 1], ['weightedDice'])
    run([6, 5], [2, 3], ['sharpBlade'])
    run([1, 2, 6], [3, 3], ['secondWind'])
    run([6, 5], [2, 3], ['vitality'])
    run([1, 2], [5, 6], ['shield'])
    run([4, 6], [1, 2], ['loadedDice'], { ...DUMMY, maxHp: 50 })
    run([6, 5], [2, 3], ['escapeRope'], DUMMY, true)
    run([1, 3], [5, 5], ['insurance'])
    run([4, 4], [1, 2], ['finisher'])
    run([6, 5], [2, 3], ['intimidate'])
    run([1, 2, 6, 5], [4, 5, 1, 3], ['vampire'])
    run([1, 2], [4, 5], ['thickSkin'])
    run([3, 4], [4, 3], ['tieBreaker'])
    run([6, 5], [2, 3], ['firstBlood'], { ...DUMMY, maxHp: 50 })
    run([1, 2], [5, 5], ['ironGuard'])
    run([6, 5, 5, 4], [2, 3, 1, 2], ['combo'], { ...DUMMY, maxHp: 50 })
    run([2, 3], [3, 4], ['riposte'])
    run([6, 5, 4, 3], [2, 3, 1, 2], ['bloodlust'], { ...DUMMY, maxHp: 12 })
    expect([...seen].sort()).toEqual([...UPGRADE_IDS].sort())
  })

  it('the game copies result triggers into lastResult', () => {
    const g = findSeed((game) => {
      playFight(game, 10)
      if (game.state.lastResult?.outcome !== 'won') return false
      game.dispatch({ type: 'continue' })
      const offers = game.state.shopOffers
      const i = offers.findIndex((o) => o.id === 'finisher')
      if (i < 0) return false
      game.dispatch({ type: 'pickUpgrade', index: i })
      playFight(game, 10)
      return game.state.lastResult?.outcome === 'won'
    })
    expect(ids(g.state.lastResult?.upgradeTriggers ?? [])).toContain('finisher')
  })
})

describe('shop', () => {
  it('the seeded order is a permutation and offers are its first useful entries', () => {
    const order = shopOrderForFight(7, 3)
    expect([...order].sort()).toEqual([...UPGRADE_IDS].sort())
    expect(shopOffersForFight(7, 3)).toEqual(order.slice(0, CONFIG.shopOfferCount))
    const owned: UpgradeId[] = [order[0] as UpgradeId, order[0] as UpgradeId, order[0] as UpgradeId]
    expect(shopOffersForFight(7, 3, owned)).toEqual(order.filter((id) => isUseful(owned, id)).slice(0, CONFIG.shopOfferCount))
  })

  it('offers only upgrades that still have an effect, and may show fewer than three', () => {
    const owned: UpgradeId[] = []
    for (const id of UPGRADE_IDS) for (let i = 0; i < CONFIG.upgradeMaxCopies[id]; i++) owned.push(id)
    const keep = shopOrderForFight(11, 0).slice(0, 2)
    const offers = shopOffersForFight(11, 0, owned.filter((id) => !keep.includes(id)))
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
        for (const o of st.shopOffers) expect(isUseful(owned, o.id)).toBe(true)
        checked++
        if (st.shopOffers.length > 0) g.dispatch({ type: 'pickUpgrade', index: pickIndex(st.shopOffers) })
        else g.dispatch({ type: 'skip' })
      } else if (st.phase === 'bet') g.dispatch({ type: 'bet', amount: st.minBet })
      else if (st.phase === 'fight') g.dispatch({ type: 'roll' })
      else g.dispatch({ type: 'continue' })
    }
    expect(checked).toBeGreaterThan(3)
  })

  it('skip takes nothing and pays nothing', () => {
    const g = createGame(4, 1000)
    playFight(g, 100)
    g.dispatch({ type: 'continue' })
    const bankroll = g.state.bankroll
    expect(g.dispatch({ type: 'skip' })).toBe(true)
    expect(g.state.bankroll).toBe(bankroll)
    expect(g.state.upgrades.length).toBe(0)
    expect(g.state.phase).toBe('bet')
  })
})

describe('failed checkpoint fee', () => {
  it('withholds the fee percent, flooring the amount returned', () => {
    const pct = CONFIG.failedCheckpointFeePercent
    for (const b of [0, 1, 9, 10, 11, 100, 105, 1000, 123457]) {
      expect(b - failedCheckpointFee(b)).toBe(Math.floor((b * (100 - pct)) / 100))
    }
    expect(failedCheckpointFee(1)).toBe(1)
    expect(failedCheckpointFee(105)).toBe(11)
  })

  it('a boss loss at 0 coins ends as a failed checkpoint with nothing returned', () => {
    const g = findSeed((game) => {
      playToBoss(game, (x) => x.state.minBet)
      if (game.state.phase !== 'bet' || !game.state.isBossFight) return false
      playFight(game, game.state.maxBet)
      return game.state.lastResult?.outcome === 'lost' && game.state.bankroll === 0
    })
    g.dispatch({ type: 'continue' })
    expect(g.state.gameOverReason).toBe('checkpoint')
    expect(g.state.cashOut).toBe(0)
    expect(g.state.cashOutFee).toBe(0)
  })
})

describe('leave fee', () => {
  it('withholds the leave fee percent, flooring the amount returned', () => {
    const pct = CONFIG.leaveFeePercent
    expect(pct).toBe(5)
    for (const b of [0, 1, 19, 20, 21, 100, 105, 1000, 123457]) {
      expect(b - leaveFee(b)).toBe(Math.floor((b * (100 - pct)) / 100))
    }
    expect(leaveFee(1)).toBe(1)
    expect(leaveFee(105)).toBe(6)
    expect(leaveFee(1000)).toBe(50)
  })
})

describe('run layer', () => {
  it('a stage is four normal fights and a boss', () => {
    const g = createGame(11)
    for (let k = 0; k < CONFIG.fightsPerStage; k++) {
      expect(g.state.fightNumberInStage).toBe(k + 1)
      const boss = k === CONFIG.fightsPerStage - 1
      expect(g.state.isBossFight).toBe(boss)
      g.dispatch({ type: 'bet', amount: g.state.minBet })
      expect(g.state.fight?.fullKoMultiplier).toBe((boss ? BOSS_KO : KO) / 1000)
      rollUntilDone(g)
      g.dispatch({ type: 'continue' })
      if (g.state.phase === 'shop') g.dispatch({ type: 'skip' })
    }
  })

  it('walkAway through the game banks the exact advertised payout and its two parts', () => {
    const g = findSeed((game) => {
      game.dispatch({ type: 'bet', amount: 20 })
      game.dispatch({ type: 'roll' })
      return game.state.fight?.canWalkAway === true && (game.state.fight?.multiplierMilli ?? 0) > 0
    })
    const f = g.state.fight
    if (!f) throw new Error('no fight')
    const bankroll = g.state.bankroll
    expect(f.walkAwayRefund).toBe(Math.floor((20 * REFUND) / 1000))
    expect(f.walkAwayFromEarned).toBe(Math.floor((20 * f.multiplierMilli * KEEP) / 1_000_000))
    expect(f.walkAwayPayout).toBe(f.walkAwayRefund + f.walkAwayFromEarned)
    expect(f.walkAwayRefundPercent).toBe(REFUND / 10)
    expect(f.walkAwayKeep).toBe(KEEP / 1000)
    expect(g.dispatch({ type: 'walkAway' })).toBe(true)
    expect(g.state.bankroll).toBe(bankroll + f.walkAwayPayout)
    expect(g.state.lastResult).toEqual({
      outcome: 'walkedAway',
      isBoss: false,
      level: 1,
      bet: 20,
      multiplier: f.multiplier,
      multiplierMilli: f.multiplierMilli,
      payout: f.walkAwayPayout,
      rolls: 1,
      walkAwayRefund: f.walkAwayRefund,
      walkAwayFromEarned: f.walkAwayFromEarned,
      upgradeTriggers: [],
    })
  })

  it('a KO pays bet x level KO multiplier; a loss pays 0', () => {
    const g = firstFightOutcome('won', 10)
    expect(g.state.lastResult?.payout).toBe(Math.floor((10 * KO) / 1000))
    const l = firstFightOutcome('lost', 30)
    expect(l.state.lastResult?.payout).toBe(0)
    expect(l.state.bankroll).toBe(70)
  })

  it('the checkpoint runs after the boss; passing offers leave or continue', () => {
    const g = reachCheckpoint(true)
    const s = g.state
    expect(s.lastCheckpoint?.outcome).toBe('passed')
    expect(s.lastCheckpoint?.target).toBe(targetForStage(1, 100))
    expect(s.stage).toBe(2)
    expect(s.target).toBe(targetForStage(2, s.bankroll))
    expect(s.leaveFeePercent).toBe(CONFIG.leaveFeePercent)
    expect(s.leaveFee).toBe(leaveFee(s.bankroll))
    const leave = clone(g)
    expect(leave.dispatch({ type: 'leave' })).toBe(true)
    expect(leave.state.gameOverReason).toBe('left')
    expect(leave.state.cashOut).toBe(s.bankroll - leaveFee(s.bankroll))
    expect(leave.state.cashOutFee).toBe(leaveFee(s.bankroll))
    expect(leave.state.leaveFee).toBe(0)
    expect(g.dispatch({ type: 'continue' })).toBe(true)
    expect(g.state.phase).toBe('shop')
  })

  it('a failed checkpoint ends the run and returns the bankroll minus the fee', () => {
    const g = reachCheckpoint(false)
    const b = g.state.bankroll
    expect(g.state.gameOverReason).toBe('checkpoint')
    expect(g.state.cashOut).toBe(b - failedCheckpointFee(b))
  })

  it('running out of coins ends the run as broke even with upgrades owned', () => {
    const g = findSeed((game) => {
      playFight(game, 10)
      if (game.state.lastResult?.outcome !== 'won') return false
      game.dispatch({ type: 'continue' })
      if (game.state.shopOffers.length === 0) return false
      game.dispatch({ type: 'pickUpgrade', index: 0 })
      playFight(game, game.state.maxBet)
      const after: Game['state'] = game.state
      return after.lastResult?.outcome === 'lost' && after.bankroll === 0
    })
    expect(g.state.upgrades.length).toBe(1)
    g.dispatch({ type: 'continue' })
    expect(g.state.phase).toBe('gameover')
    expect(g.state.gameOverReason).toBe('broke')
    expect(g.state.cashOut).toBe(0)
    expect(g.state.cashOutFee).toBe(0)
  })

  it('the allIn bot goes broke often and never cashes anything', () => {
    let broke = 0
    for (let seed = 1; seed <= 200; seed++) {
      const r = playRun(seed, BOTS.allIn as (typeof BOTS)[string])
      if (r.reason === 'broke') {
        broke++
        expect(r.cashOut).toBe(0)
      }
    }
    expect(broke).toBeGreaterThan(100)
  })

  it('run summary fields track wagers and payouts', () => {
    const r = playRun(77, BOTS.sensible as (typeof BOTS)[string])
    const s = r.game.state
    expect(s.totalWagered).toBe(r.perFight.reduce((a, f) => a + f.bet, 0))
    expect(s.totalPaidOut).toBe(r.perFight.reduce((a, f) => a + f.payout, 0))
    expect(s.cashOut).not.toBeNull()
  })

  it('fight state exposes everything the UI needs', () => {
    const g = createGame(21)
    g.dispatch({ type: 'bet', amount: 40 })
    const f = g.state.fight
    if (!f) throw new Error('no fight')
    expect(f.level).toBe(1)
    expect(f.enemy.archetype).toBe(archetypeOf(f.enemy.name))
    expect(f.player.diceText).toBe('2d6')
    expect(f.player.maxFace).toBe(f.enemy.trait === 'cursed' ? CONFIG.traitCursedMaxFace : 6)
    expect(f.player.walkAwayRefundPercent).toBe(REFUND / 10)
    expect(f.koPayout).toBe(Math.floor((40 * KO) / 1000))
    expect(f.startTriggers).toEqual([])
    expect(f.walkAwayPayout).toBe(Math.floor((40 * REFUND) / 1000))
    expect(f.canWalkAway).toBe(false)
    g.dispatch({ type: 'roll' })
    expect(g.state.fight?.exchanges.length).toBe(1)
  })
})

describe('enemies', () => {
  it('stage and boss slot derive from the fight index', () => {
    expect([0, 4, 5, 9, 10].map(stageOfFight)).toEqual([1, 1, 2, 2, 3])
    expect([0, 3, 4, 8, 9, 14].map(isBossFight)).toEqual([false, false, true, false, true, true])
  })

  it('has at least 16 normal names, 12 boss names, 10 normal traits and 6 boss traits', () => {
    expect(new Set(CONFIG.enemyNames).size).toBeGreaterThanOrEqual(16)
    expect(new Set(CONFIG.bossNames).size).toBeGreaterThanOrEqual(12)
    expect(NORMAL_TRAITS.length).toBeGreaterThanOrEqual(10)
    expect(BOSS_TRAITS.length).toBeGreaterThanOrEqual(6)
  })

  it('every name has an archetype; the original roster keeps its UI archetype', () => {
    const valid: Archetype[] = ['humanoid', 'beast', 'blob', 'skeleton', 'golem', 'caster', 'other']
    for (const n of [...CONFIG.enemyNames, ...CONFIG.bossNames]) {
      expect(n in CONFIG.archetypes).toBe(true)
      expect(valid).toContain(archetypeOf(n))
    }
    const legacy: Record<string, Archetype> = {
      Goblin: 'humanoid',
      'Rat King': 'beast',
      Bandit: 'humanoid',
      Skeleton: 'skeleton',
      Slime: 'blob',
      Orc: 'humanoid',
      Cultist: 'caster',
      Wolf: 'beast',
      Troll: 'golem',
      Ghoul: 'humanoid',
      'Goblin Warlord': 'humanoid',
      'Bone Tyrant': 'skeleton',
      'The Hollow King': 'skeleton',
      'Mire Hydra': 'beast',
      'Iron Golem': 'golem',
      'Witch of Ash': 'caster',
      'Dread Knight': 'humanoid',
      'Ogre Chieftain': 'humanoid',
    }
    for (const [n, a] of Object.entries(legacy)) expect(archetypeOf(n)).toBe(a)
    expect(archetypeOf('Nobody')).toBe('other')
  })

  it('bosses use their own names and traits and have more HP', () => {
    let bossHp = 0
    let normalHp = 0
    for (let s = 1; s <= 300; s++) {
      const b = generateEnemy(s, 4)
      const n = generateEnemy(s, 3)
      expect(CONFIG.bossNames).toContain(b.name)
      expect(CONFIG.enemyNames).toContain(n.name)
      expect(BOSS_TRAITS).toContain(b.trait)
      expect(NORMAL_TRAITS).toContain(n.trait)
      expect(b.archetype).toBe(archetypeOf(b.name))
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

  it('deeper levels field fewer plain enemies', () => {
    const plainShare = (level: number): number => {
      let plain = 0
      for (let s = 1; s <= 2000; s++) if (generateEnemy(s, (level - 1) * 5).trait === 'plain') plain++
      return plain / 2000
    }
    expect(plainShare(1)).toBeGreaterThan(plainShare(5) + 0.1)
  })

  it('targets grow from the bankroll the stage is entered with', () => {
    expect(targetForStage(1, 100)).toBe(Math.floor((100 * (100 + L1.targetGrowthPercent)) / 100))
    expect(targetForStage(1, 5)).toBe(6)
    const g = levelDef(3).targetGrowthPercent
    expect(targetForStage(3, 1000)).toBe(Math.floor((1000 * (100 + g)) / 100))
  })
})
