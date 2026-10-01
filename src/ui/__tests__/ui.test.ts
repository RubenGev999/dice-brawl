import { describe, expect, it } from 'vitest'
import { CONFIG, createGame, levelInfo } from '../../core/index.ts'
import type { CheckpointResult, ExchangeRecord, Game, GameState, ShopOffer, Upgrade } from '../../core/index.ts'
import { exchange } from './fixtures.ts'
import {
  buyInChoices,
  chargesText,
  checkpointHeadline,
  checkpointNet,
  chipLabel,
  chipModels,
  checkpointMissText,
  chipSignature,
  coinsText,
  continueLabel,
  critText,
  enemyTraitLine,
  enrageNote,
  exchangeOutcome,
  exchangeTone,
  feeWarning,
  fightLabel,
  fightPips,
  fightTitle,
  formatCoins,
  formatMultiplier,
  formatNet,
  gameOverText,
  gameOverTitle,
  groupUpgrades,
  hpPercent,
  hudView,
  leaveFreeLine,
  leaveLabel,
  levelFullProfileLine,
  levelProfileLine,
  levelTitle,
  levelsBlurb,
  lobbyState,
  maxWinLine,
  nextLevelTitle,
  nextTargetLine,
  offerOwnedText,
  outcomeTone,
  parseSeed,
  pickBuyIn,
  pipCells,
  returnRows,
  runStatRows,
  skipLabel,
  stageNotice,
  targetLine,
  targetMet,
  visiblePresets,
  walkAwayPercents,
  walkAwayRows,
  walletLine,
} from '../format.ts'

function ex(over: Partial<ExchangeRecord>): ExchangeRecord {
  return exchange({
    playerFaces: [3, 4],
    enemyFaces: [2, 3],
    playerTotal: 7,
    enemyTotal: 5,
    damageDealt: 2,
    enemyHpAfter: 6,
    multiplierGained: 0,
    multiplierGainedMilli: 0,
    multiplierAfterMilli: 0,
    ...over,
  })
}

function up(id: string, name: string): Upgrade {
  return { id: id as Upgrade['id'], name, description: name + ' desc', maxCopies: 2 }
}

function preset(id: 'low' | 'medium' | 'high' | 'max', label: string, amount: number, isAllIn = false) {
  return { id, label, percent: 0, amount, isAllIn }
}

describe('formatting', () => {
  it('formats coins, multipliers and net', () => {
    expect(formatCoins(1234)).toBe('1,234')
    expect(formatMultiplier(1.8)).toBe('x1.80')
    expect(formatNet(5)).toBe('+5')
    expect(formatNet(-12)).toBe('-12')
    expect(formatNet(0)).toBe('+0')
  })
  it('computes hp percent', () => {
    expect(hpPercent(5, 10)).toBe(50)
    expect(hpPercent(-1, 10)).toBe(0)
    expect(hpPercent(3, 0)).toBe(0)
    expect(hpPercent(30, 10)).toBe(100)
  })
  it('knows pips', () => {
    expect(pipCells(1)).toEqual([4])
    expect(pipCells(6)).toHaveLength(6)
    expect(pipCells(9)).toEqual([])
  })
})

describe('parseSeed', () => {
  it('reads the seed param', () => {
    expect(parseSeed('?seed=123')).toBe(123)
    expect(parseSeed('')).toBeNull()
    expect(parseSeed('?seed=')).toBeNull()
    expect(parseSeed('?seed=abc')).toBeNull()
    expect(parseSeed('?seed=-1')).toBe(4294967295)
    expect(parseSeed('?seed=7.9')).toBe(7)
  })
})

describe('upgrade chips', () => {
  it('groups stacked upgrades in first-seen order', () => {
    const groups = groupUpgrades([up('shield', 'Shield'), up('vitality', 'Vitality'), up('shield', 'Shield')])
    expect(groups.map((g) => chipLabel(g))).toEqual(['Shield x2', 'Vitality'])
    expect(groupUpgrades([])).toEqual([])
  })
})

describe('chip model and signature', () => {
  it('maps upgrades to chips and empty list to nothing', () => {
    const chips = chipModels([up('vitality', 'Vitality'), up('vitality', 'Vitality'), up('rope', 'Escape Rope')])
    expect(chips.map((c) => c.label)).toEqual(['Vitality x2', 'Escape Rope'])
    expect(chipModels([])).toEqual([])
  })

  it('empty signature differs from a populated one and from nothing rendered yet', () => {
    const full = chipSignature(chipModels([up('vitality', 'Vitality')]))
    const empty = chipSignature(chipModels([]))
    expect(empty).not.toBe(full)
    expect(empty).not.toBe('')
    expect(chipSignature(chipModels([up('a', 'A'), up('a', 'A')]))).not.toBe(chipSignature(chipModels([up('a', 'A')])))
  })

  it('a new run after an upgraded run yields a different signature', () => {
    const before = chipSignature(chipModels([up('vitality', 'Vitality'), up('vitality', 'Vitality')]))
    const after = chipSignature(chipModels(createGame(1, CONFIG.minBuyIn).state.upgrades))
    expect(after).not.toBe(before)
    expect(chipModels(createGame(1, CONFIG.minBuyIn).state.upgrades)).toEqual([])
  })
})

describe('exchange outcome text', () => {
  it('describes each case', () => {
    expect(exchangeOutcome(ex({}))).toBe('You hit for 2')
    expect(exchangeOutcome(ex({ playerCrit: true, playerCritFactor: 2, damageDealt: 4 }))).toBe('CRIT x2! You hit for 4')
    expect(exchangeOutcome(ex({ winner: 'enemy', damageDealt: 0, damageTaken: 6, enemyCrit: true, enemyCritFactor: 3 }))).toBe('CRIT x3! Enemy hits for 6')
    expect(exchangeOutcome(ex({ healed: 2 }))).toBe('You hit for 2 (+2 HP)')
    expect(exchangeOutcome(ex({ winner: 'enemy', damageDealt: 0, damageTaken: 3 }))).toBe('Enemy hits for 3')
    expect(exchangeOutcome(ex({ winner: 'enemy', damageDealt: 0, damageTaken: 0, blocked: 4 }))).toBe('Blocked 4!')
    expect(exchangeOutcome(ex({ winner: 'enemy', damageDealt: 0, damageTaken: 2, blocked: 4 }))).toBe('Enemy hits for 2 (4 blocked)')
    expect(exchangeOutcome(ex({ enemyHealed: 1 }))).toBe('You hit for 2 | Enemy heals 1')
    expect(exchangeOutcome(ex({ winner: 'tie', damageDealt: 0 }))).toBe('Tie')
    expect(exchangeOutcome(ex({ winner: 'tie', damageDealt: 0, enemyHealed: 1 }))).toBe('Tie | Enemy heals 1')
    expect(exchangeOutcome(ex({ winner: 'player', tieBreak: true, damageDealt: 2 }))).toBe('Tie Breaker hits for 2')
    expect(exchangeOutcome(ex({ winner: 'enemy', damageDealt: 1, riposteDamage: 1, damageTaken: 3 }))).toBe('Enemy hits for 3 | Riposte hits for 1')
    expect(exchangeOutcome(ex({ thornDamage: 1 }))).toBe('You hit for 2 | Thorns hurt you for 1')
    expect(exchangeOutcome(ex({ cursedClamps: 1 }))).toBe('You hit for 2 | Cursed: a 6 counts as 5')
    expect(exchangeOutcome(ex({ cursedClamps: 2 }))).toContain('2 sixes count as 5')
    expect(exchangeOutcome(ex({ playerCrit: true, playerCritFactor: 3, playerCritSource: 'combo', damageDealt: 9 }))).toBe('COMBO x3! You hit for 9')
  })
})

describe('crit text, tones and charges', () => {
  it('shows crit factors', () => {
    expect(critText(ex({}))).toBeNull()
    expect(critText(ex({ playerCritFactor: 2 }))).toBe('CRIT x2')
    expect(critText(ex({ enemyCritFactor: 3 }))).toBe('CRIT x3')
    expect(critText(ex({ playerCritFactor: 3, playerCritSource: 'combo' }))).toBe('COMBO x3')
    expect(critText(ex({ playerCritFactor: 2, playerCritSource: 'firstBlood' }))).toBe('FIRST BLOOD x2')
    expect(critText(ex({ playerCritFactor: 2, playerCritSource: 'loadedDice' }))).toBe('LOADED CRIT x2')
    expect(critText(ex({ playerCritFactor: 2, playerCritSource: 'doubles' }))).toBe('CRIT x2')
  })
  it('tones exchanges', () => {
    expect(exchangeTone(ex({}))).toBe('good')
    expect(exchangeTone(ex({ winner: 'enemy', damageTaken: 3 }))).toBe('bad')
    expect(exchangeTone(ex({ winner: 'enemy', damageTaken: 0, blocked: 4 }))).toBe('neutral')
    expect(exchangeTone(ex({ winner: 'tie' }))).toBe('neutral')
    expect(exchangeTone(ex({ winner: 'player', tieBreak: true }))).toBe('good')
    expect(exchangeTone(ex({ winner: 'enemy', damageTaken: 2, riposteDamage: 1, damageDealt: 1 }))).toBe('bad')
  })
  it('notes enrage changes', () => {
    expect(enrageNote(0, 1)).toBe('Enemy enraged: +1 to rolls')
    expect(enrageNote(1, 1)).toBeNull()
    expect(enemyTraitLine({ traitText: 'Enrage', bonus: 0, currentBonus: 0 })).toBe('Enrage')
    expect(enemyTraitLine({ traitText: 'Enrage', bonus: 0, currentBonus: 1 })).toBe('Enrage (rolls +1 now)')
  })
  it('lists charges', () => {
    expect(chargesText({ shieldsLeft: 0, rerollsLeft: 0 })).toBe('No charges')
    expect(chargesText({ shieldsLeft: 2, rerollsLeft: 1 })).toBe('Shield x2 | Reroll x1')
    expect(chargesText({ shieldsLeft: 0, rerollsLeft: 0, maxFace: 6 })).toBe('No charges')
    expect(chargesText({ shieldsLeft: 1, rerollsLeft: 0, maxFace: 5 })).toBe('Shield x1 | Cursed: max face 5')
  })
})

describe('screen text', () => {
  it('titles outcomes', () => {
    expect(fightTitle('won')).toBe('Knockout!')
    expect(fightTitle('won', true)).toBe('Boss defeated!')
    expect(fightTitle('lost')).toBe('Knocked out')
    expect(fightTitle('lost', true)).toBe('The boss wins')
    expect(fightTitle('walkedAway')).toBe('Walked away')
    expect(outcomeTone('lost')).toBe('bad')
    expect(outcomeTone('walkedAway')).toBe('good')
  })
  it('explains each game over reason', () => {
    const cp: CheckpointResult = { stage: 1, entryBankroll: 100, target: 107, bankroll: 40, outcome: 'failed' }
    expect(gameOverText('checkpoint', cp, 36, 4, 10)).toContain('107')
    expect(gameOverText('checkpoint', cp, 36, 4, 10)).toContain('10% fee (4 coins) was withheld')
    expect(gameOverText('checkpoint', cp, 36, 4, 10)).toContain('you get back 36')
    expect(gameOverText('checkpoint', cp, 36, 4, 10)).not.toContain('get back 40')
    expect(gameOverText('checkpoint', cp, 0, 0, 10)).toContain('You get back 0 coins')
    expect(gameOverText('checkpoint', null, 9, 1, 10)).toContain('9')
    expect(gameOverText('broke', null, 0, 0, 10)).toContain('ran out of coins')
    expect(gameOverText('broke', null, 0, 0, 10)).toContain('No coins come back')
    expect(gameOverText('broke', null, 0, 0, 10)).not.toContain('pawn')
    expect(gameOverText('left', null, 1234, 0, 10)).toContain('1,234')
    expect(gameOverText('left', null, 1234, 0, 10)).toContain('free')
    expect(gameOverText(null, null)).toBe('The run is over.')
    expect(gameOverTitle('checkpoint')).toBe('Checkpoint failed')
    expect(gameOverTitle('broke')).toBe('Out of coins')
    expect(gameOverTitle('left')).toBe('You left the arena')
  })
  it('words coins in the singular and the plural', () => {
    expect(coinsText(1)).toBe('1 coin')
    expect(coinsText(0)).toBe('0 coins')
    expect(coinsText(2)).toBe('2 coins')
    expect(coinsText(1234)).toBe('1,234 coins')
    expect(leaveLabel(1)).toBe('Leave with 1 coin')
    expect(walletLine(1)).toBe('1 coin')
    expect(skipLabel()).toBe('Skip')
    const cp: CheckpointResult = { stage: 1, entryBankroll: 100, target: 107, bankroll: 10, outcome: 'failed' }
    expect(gameOverText('checkpoint', cp, 9, 1, 10)).toContain('A 10% fee (1 coin) was withheld, so you get back 9 coins.')
    expect(gameOverText('checkpoint', cp, 1, 1, 10)).toContain('you get back 1 coin.')
    expect(gameOverText('checkpoint', cp, 1, 0, 10)).toContain('You get back 1 coin.')
    expect(gameOverText('left', null, 1, 0, 10)).toContain('took all 1 coin.')
  })
  it('explains a failed checkpoint by what happened in the boss fight', () => {
    const cp: CheckpointResult = { stage: 1, entryBankroll: 100, target: 107, bankroll: 104, outcome: 'failed' }
    expect(checkpointMissText(cp, { outcome: 'won', isBoss: true })).toBe('You beat the boss but finished with 104, below the target of 107.')
    expect(checkpointMissText(cp, { outcome: 'lost', isBoss: true })).toBe('The boss knocked you out and you finished with 104, below the target of 107.')
    expect(checkpointMissText(cp, { outcome: 'walkedAway', isBoss: true })).toBe('You walked away from the boss and finished with 104, below the target of 107.')
    expect(checkpointMissText(cp, null)).toBe('You finished with 104, below the target of 107.')
    expect(checkpointMissText(cp, { outcome: 'won', isBoss: false })).toBe('You finished with 104, below the target of 107.')
    expect(checkpointMissText(null, { outcome: 'won', isBoss: true })).toBe('The boss checkpoint was failed.')
    const won = gameOverText('checkpoint', cp, 94, 10, 10, { outcome: 'won', isBoss: true })
    expect(won).toContain('You beat the boss but finished with 104')
    expect(won).not.toContain('knocked you out')
    expect(gameOverText('checkpoint', cp, 94, 10, 10, { outcome: 'lost', isBoss: true })).toContain('The boss knocked you out')
  })
  it('notices only passed checkpoints', () => {
    const base = { entryBankroll: 100, target: 107, bankroll: 110 }
    expect(stageNotice({ lastCheckpoint: null, target: 85 })).toBeNull()
    expect(stageNotice({ lastCheckpoint: { ...base, stage: 1, outcome: 'failed' }, target: 85 })).toBeNull()
    expect(stageNotice({ lastCheckpoint: { ...base, stage: 1, outcome: 'passed' }, target: 1097 })).toBe('Level 1 cleared, new target 1,097')
  })
  it('writes one target line', () => {
    expect(targetLine({ target: 1070 })).toBe('Target 1,070 after the boss')
    expect(targetMet({ bankroll: 107, target: 107 })).toBe(true)
    expect(targetMet({ bankroll: 106, target: 107 })).toBe(false)
  })
  it('writes checkpoint text', () => {
    expect(checkpointHeadline({ stage: 2 })).toBe('Level 2 cleared')
    expect(checkpointNet(130, 100)).toBe('+30 vs your buy-in of 100')
    expect(checkpointNet(80, 100)).toBe('-20 vs your buy-in of 100')
    expect(leaveLabel(1234)).toBe('Leave with 1,234 coins')
    expect(continueLabel(3)).toBe('Continue to level 3')
    expect(nextTargetLine({ stage: 3, target: 500 })).toContain('500')
    expect(nextTargetLine({ stage: 3, target: 500 })).toContain('level 3')
  })
  it('labels fights and pips', () => {
    expect(fightLabel({ fightNumberInStage: 2, fightsPerStage: 5, isBossFight: false })).toBe('Fight 2 of 5')
    expect(fightLabel({ fightNumberInStage: 5, fightsPerStage: 5, isBossFight: true })).toBe('Fight 5 of 5 - Boss')
    const pips = fightPips({ fightInStage: 2, fightsPerStage: 5 })
    expect(pips.map((p) => p.state)).toEqual(['done', 'done', 'current', 'todo', 'todo'])
    expect(pips.map((p) => p.boss)).toEqual([false, false, false, false, true])
  })
  it('shop and wallet text', () => {
    expect(offerOwnedText({ owned: 0, maxCopies: 3 })).toBeNull()
    expect(offerOwnedText({ owned: 2, maxCopies: 3 })).toBe('Owned 2 / 3')
    expect(walletLine(1500)).toBe('1,500 coins')
  })
  it('chooses buy-ins by wallet', () => {
    expect(buyInChoices([50, 100, 250], 120).map((c) => c.affordable)).toEqual([true, true, false])
    expect(pickBuyIn([50, 100, 250, 1000], 1000, 100, null)).toBe(100)
    expect(pickBuyIn([50, 100, 250, 1000], 60, 100, null)).toBe(50)
    expect(pickBuyIn([50, 100, 250, 1000], 40, 100, null)).toBeNull()
    expect(pickBuyIn([50, 100, 250, 1000], 500, 100, 250)).toBe(250)
    expect(pickBuyIn([50, 100, 250, 1000], 200, 100, 250)).toBe(100)
  })
  it('hides presets whose amount repeats an earlier one', () => {
    const p = visiblePresets({ betPresets: [preset('low', 'Low', 5), preset('medium', 'Medium', 5), preset('high', 'High', 5), preset('max', 'All-in', 5, true)] })
    expect(p.map((x) => x.label)).toEqual(['All-in'])
    const q = visiblePresets({ betPresets: [preset('low', 'Low', 5), preset('medium', 'Medium', 10), preset('high', 'High', 10), preset('max', 'Max', 20)] })
    expect(q.map((x) => `${x.label}:${x.amount}`)).toEqual(['Low:5', 'Medium:10', 'Max:20'])
    expect(visiblePresets({ betPresets: [preset('low', 'Low', 0)] })).toEqual([])
  })
  it('never renders presets with amount 0 and marks only the all-in as dangerous', () => {
    const none = visiblePresets({ betPresets: [preset('low', 'Low', 0), preset('medium', 'Medium', 0), preset('high', 'High', 0), preset('max', 'All-in', 0)] })
    expect(none).toEqual([])
    const p = visiblePresets({ betPresets: [preset('low', 'Low', 10), preset('medium', 'Medium', 25), preset('high', 'High', 50), preset('max', 'All-in', 100, true)] })
    expect(p.map((x) => x.allIn)).toEqual([false, false, false, true])
    expect(p[3]?.label).toBe('All-in')
    const tiny = visiblePresets({ betPresets: [preset('low', 'Low', 1), preset('medium', 'Medium', 1), preset('high', 'High', 1), preset('max', 'All-in', 1, true)] })
    expect(tiny.map((x) => `${x.label}:${x.amount}:${x.allIn}`)).toEqual(['All-in:1:true'])
  })
  it('reads the real presets of a new game', () => {
    const p = visiblePresets(createGame(1, 100).state)
    expect(p.map((x) => x.label)).toEqual(['Low', 'Medium', 'High', 'All-in'])
    expect(p.map((x) => x.amount)).toEqual([10, 25, 50, 100])
    expect(p.filter((x) => x.allIn)).toHaveLength(1)
  })
})

function playFight(g: Game): void {
  let guard = 0
  while (g.state.phase === 'fight' && guard++ < 300) {
    expect(g.dispatch({ type: 'roll' })).toBe(true)
    const f = g.state.fight
    const last = f?.exchanges[f.exchanges.length - 1]
    if (!f || !last) throw new Error('no exchange')
    expect(exchangeOutcome(last).length).toBeGreaterThan(0)
    expect(formatMultiplier(f.multiplier)).toMatch(/^x\d+\.\d\d$/)
    expect(formatCoins(f.koPayout)).toMatch(/^[\d,]+$/)
    expect(hpPercent(f.enemy.hp, f.enemy.maxHp)).toBeGreaterThanOrEqual(0)
    expect(chargesText(f.player).length).toBeGreaterThan(0)
    expect(enemyTraitLine(f.enemy).length).toBeGreaterThan(0)
  }
}

function driveToCheckpoint(seed: number): Game | null {
  const g = createGame(seed, 100)
  let guard = 0
  while (g.state.phase !== 'checkpoint' && g.state.phase !== 'gameover' && guard++ < 200) {
    const s: GameState = g.state
    if (s.phase === 'bet') {
      const p = visiblePresets(s)
      const pick = s.isBossFight ? p[p.length - 1] : (p[1] ?? p[0])
      if (!pick) return null
      expect(g.dispatch({ type: 'bet', amount: pick.amount })).toBe(true)
    } else if (s.phase === 'fight') {
      playFight(g)
    } else if (s.phase === 'result') {
      g.dispatch({ type: 'continue' })
    } else if (s.phase === 'shop') {
      g.dispatch(s.shopOffers.length > 0 ? { type: 'pickUpgrade', index: 0 } : { type: 'skip' })
    } else {
      return null
    }
  }
  return g.state.phase === 'checkpoint' ? g : null
}

function findCheckpointGame(): Game {
  for (let seed = 1; seed < 400; seed++) {
    const g = driveToCheckpoint(seed)
    if (g) return g
  }
  throw new Error('no seed reached a checkpoint')
}

describe('fee and fee rows text', () => {
  const base = { failedCheckpointFeePercent: 10, buyIn: 100 }
  const cp: CheckpointResult = { stage: 1, entryBankroll: 100, target: 107, bankroll: 95, outcome: 'failed' }
  it('writes the fee warning and the free-leave line', () => {
    expect(feeWarning(10)).toBe('Miss the target and 10% of your coins are withheld')
    expect(feeWarning(15)).toContain('15%')
    expect(leaveFreeLine().toLowerCase()).toContain('free')
  })
  it('lists a failed checkpoint with bankroll, fee, returned coins and net', () => {
    const rows = returnRows({ ...base, gameOverReason: 'checkpoint', cashOut: 86, cashOutFee: 10, lastCheckpoint: { ...cp, bankroll: 96 } })
    expect(rows.map((r) => `${r.label}=${r.value}`)).toEqual([
      'Bankroll at the end=96',
      'Fee withheld (10%)=-10',
      'Coins returned=86',
      'Buy-in=100',
      'Net vs buy-in=-14',
    ])
    expect(rows[1]?.tone).toBe('bad')
    expect(rows[4]?.tone).toBe('bad')
  })
  it('a failed checkpoint with nothing left shows no fee', () => {
    const rows = returnRows({ ...base, gameOverReason: 'checkpoint', cashOut: 0, cashOutFee: 0, lastCheckpoint: { ...cp, bankroll: 0 } })
    expect(rows.map((r) => r.value)).toEqual(['0', '0', '0', '100', '-100'])
    expect(rows[1]?.tone).toBeUndefined()
  })
  it('left and broke have no fee row', () => {
    const left = returnRows({ ...base, gameOverReason: 'left', cashOut: 184, cashOutFee: 0, lastCheckpoint: { ...cp, outcome: 'passed', bankroll: 184 } })
    expect(left.map((r) => r.label)).toEqual(['Coins returned', 'Buy-in', 'Net vs buy-in'])
    expect(left[2]?.value).toBe('+84')
    expect(left[2]?.tone).toBe('good')
    const broke = returnRows({ ...base, gameOverReason: 'broke', cashOut: 0, cashOutFee: 0, lastCheckpoint: null })
    expect(broke.map((r) => r.label)).toEqual(['Coins returned', 'Buy-in', 'Net vs buy-in'])
    expect(broke[0]?.value).toBe('0')
    expect(broke[2]?.value).toBe('-100')
  })
  it('lists run stats', () => {
    const rows = runStatRows({ fightsCompleted: 5, stagesCleared: 1, bossesDefeated: 1, peakBankroll: 1200, totalWagered: 100, totalPaidOut: 184, seed: 3 })
    expect(rows.map((r) => r.label)).toEqual(['Fights', 'Levels cleared', 'Bosses defeated', 'Peak bankroll', 'Total wagered', 'Total paid out', 'Seed'])
    expect(rows[3]?.value).toBe('1,200')
  })
  it('wallets below the minimum buy-in lead to the refill state', () => {
    expect(lobbyState(60, CONFIG.buyInPresets, CONFIG.minBuyIn)).toBe('refill')
    expect(lobbyState(99, CONFIG.buyInPresets, CONFIG.minBuyIn)).toBe('refill')
    expect(lobbyState(0, CONFIG.buyInPresets, CONFIG.minBuyIn)).toBe('refill')
    expect(lobbyState(100, CONFIG.buyInPresets, CONFIG.minBuyIn)).toBe('play')
    expect(lobbyState(1000, CONFIG.buyInPresets, CONFIG.minBuyIn)).toBe('play')
    expect(pickBuyIn(CONFIG.buyInPresets, 60, CONFIG.defaultBuyIn, null)).toBeNull()
  })
  it('builds the hud for a cleared checkpoint and an ordinary fight', () => {
    const passed: CheckpointResult = { stage: 2, entryBankroll: 100, target: 107, bankroll: 120, outcome: 'passed' }
    const shared = { level: 3, levelInfo: levelInfo(3), fightInStage: 0, fightsPerStage: 5, fightNumberInStage: 1, isBossFight: false, target: 128, bankroll: 120, lastCheckpoint: passed }
    const cleared = hudView({ ...shared, phase: 'checkpoint' })
    expect(cleared.level).toBe('Level 2 - Normal')
    expect(cleared.fightText).toBe('Level 2 cleared')
    expect(cleared.targetText).toBe('Target 107 reached')
    expect(cleared.pips.every((p) => p.state === 'done')).toBe(true)
    expect(cleared.met).toBe(true)
    const next = hudView({ ...shared, phase: 'bet' })
    expect(next.level).toBe('Level 3 - Tricky')
    expect(next.fightText).toBe('Fight 1 of 5')
    expect(next.targetText).toBe('Target 128 after the boss')
    expect(next.met).toBe(false)
  })
})

function playToFailedCheckpoint(seed: number): Game | null {
  const g = createGame(seed, 100)
  let guard = 0
  while (g.state.phase !== 'gameover' && g.state.phase !== 'checkpoint' && guard++ < 300) {
    const s = g.state
    if (s.phase === 'bet') g.dispatch({ type: 'bet', amount: s.minBet })
    else if (s.phase === 'fight') g.dispatch({ type: 'roll' })
    else if (s.phase === 'result') g.dispatch({ type: 'continue' })
    else if (s.phase === 'shop') g.dispatch({ type: 'skip' })
  }
  return g.state.gameOverReason === 'checkpoint' ? g : null
}

describe('helpers against a real failed checkpoint', () => {
  it('shows the net cash-out, the fee and never the pre-fee bankroll as returned', () => {
    let g: Game | null = null
    for (let seed = 1; seed < 200 && !g; seed++) {
      const candidate = playToFailedCheckpoint(seed)
      if (candidate && (candidate.state.cashOutFee ?? 0) > 0) g = candidate
    }
    if (!g) throw new Error('no failed checkpoint found')
    const s = g.state
    const cp = s.lastCheckpoint
    if (!cp) throw new Error('no checkpoint')
    expect(s.phase).toBe('gameover')
    expect(cp.outcome).toBe('failed')
    expect(s.cashOut).toBe(cp.bankroll - (s.cashOutFee ?? 0))
    expect(s.failedCheckpointFeePercent).toBe(CONFIG.failedCheckpointFeePercent)
    const rows = returnRows(s)
    const value = (label: string): string | undefined => rows.find((r) => r.label.startsWith(label))?.value
    expect(value('Bankroll at the end')).toBe(formatCoins(cp.bankroll))
    expect(value('Fee withheld')).toBe(`-${formatCoins(s.cashOutFee ?? 0)}`)
    expect(rows.find((r) => r.label.startsWith('Fee withheld'))?.label).toBe(`Fee withheld (${s.failedCheckpointFeePercent}%)`)
    expect(value('Coins returned')).toBe(formatCoins(s.cashOut ?? 0))
    expect(value('Net vs buy-in')).toBe(formatNet((s.cashOut ?? 0) - s.buyIn))
    const text = gameOverText(s.gameOverReason, s.lastCheckpoint, s.cashOut, s.cashOutFee, s.failedCheckpointFeePercent)
    expect(text).toContain(`get back ${formatCoins(s.cashOut ?? 0)}`)
    expect(text).toContain(`${s.failedCheckpointFeePercent}% fee (${coinsText(s.cashOutFee ?? 0)})`)
    expect(text).not.toContain(`get back ${formatCoins(cp.bankroll)}`)
    expect(feeWarning(s.failedCheckpointFeePercent)).toContain(`${s.failedCheckpointFeePercent}%`)
  })
})

describe('helpers against a real out-of-coins game', () => {
  it('shows the broke game over with nothing returned', () => {
    let g: Game | null = null
    for (let seed = 1; seed < 100 && !g; seed++) {
      const c = createGame(seed, 100)
      c.dispatch({ type: 'bet', amount: c.state.maxBet })
      let guard = 0
      while (c.state.phase === 'fight' && guard++ < 100) c.dispatch({ type: 'roll' })
      if (c.state.bankroll === 0) {
        c.dispatch({ type: 'continue' })
        if (c.state.gameOverReason === 'broke') g = c
      }
    }
    if (!g) throw new Error('no broke run found')
    const s = g.state
    expect(s.cashOut).toBe(0)
    expect(s.cashOutFee).toBe(0)
    expect(returnRows(s).map((r) => r.value)).toEqual(['0', '100', '-100'])
    expect(gameOverText(s.gameOverReason, s.lastCheckpoint, s.cashOut, s.cashOutFee, s.failedCheckpointFeePercent)).toContain('No coins come back')
  })
})

describe('helpers accept real game state', () => {
  it('drives bet, rolls, result and shop', () => {
    const g = createGame(7, 100)
    expect(visiblePresets(g.state).length).toBeGreaterThan(1)
    expect(targetLine(g.state)).toBe('Target 104 after the boss')
    expect(fightLabel(g.state)).toBe('Fight 1 of 5')
    expect(g.dispatch({ type: 'bet', amount: g.state.minBet })).toBe(true)
    playFight(g)
    expect(g.state.phase).toBe('result')
    const r = g.state.lastResult
    if (!r) throw new Error('no result')
    expect(fightTitle(r.outcome, r.isBoss).length).toBeGreaterThan(0)
    expect(formatNet(r.payout - r.bet)).toMatch(/^[+-][\d,]+$/)
    g.dispatch({ type: 'continue' })
    expect(g.state.phase).toBe('shop')
    const offer: ShopOffer | undefined = g.state.shopOffers[0]
    expect(offer).toBeDefined()
    if (offer) expect(offerOwnedText(offer)).toBeNull()
    g.dispatch({ type: 'pickUpgrade', index: 0 })
    expect(groupUpgrades(g.state.upgrades).map(chipLabel)).toEqual([g.state.upgrades[0]?.name])
    expect(g.state.phase).toBe('bet')
    expect(stageNotice(g.state)).toBeNull()
  })

  it('plays a whole level, checks the checkpoint text and leaves', () => {
    const g = findCheckpointGame()
    const s = g.state
    expect(s.phase).toBe('checkpoint')
    expect(s.canLeave).toBe(true)
    expect(s.lastCheckpoint?.outcome).toBe('passed')
    expect(s.lastResult?.isBoss).toBe(true)
    expect(checkpointHeadline(s.lastCheckpoint)).toBe('Level 1 cleared')
    expect(stageNotice(s)).toBe(`Level 1 cleared, new target ${formatCoins(s.target)}`)
    expect(leaveLabel(s.bankroll)).toBe(`Leave with ${coinsText(s.bankroll)}`)
    expect(continueLabel(s.stage)).toBe('Continue to level 2')
    expect(nextTargetLine(s)).toContain(formatCoins(s.target))
    expect(checkpointNet(s.bankroll, s.buyIn)).toMatch(/^[+-][\d,]+ vs your buy-in of 100$/)
    expect(targetLine(s)).toBe(`Target ${formatCoins(s.target)} after the boss`)
    expect(fightPips(s).map((p) => p.state)).toEqual(['current', 'todo', 'todo', 'todo', 'todo'])
    expect(g.dispatch({ type: 'bet', amount: 5 })).toBe(false)
    const bank = s.bankroll
    expect(g.dispatch({ type: 'leave' })).toBe(true)
    const end = g.state
    expect(end.phase).toBe('gameover')
    expect(end.gameOverReason).toBe('left')
    expect(end.cashOut).toBe(bank)
    expect(end.stagesCleared).toBe(1)
    expect(end.bossesDefeated).toBeGreaterThanOrEqual(0)
    expect(gameOverText(end.gameOverReason, end.lastCheckpoint, end.cashOut)).toContain(formatCoins(bank))
    expect(gameOverTitle(end.gameOverReason)).toBe('You left the arena')
    expect(formatNet((end.cashOut ?? 0) - end.buyIn)).toMatch(/^[+-][\d,]+$/)
    expect(end.peakBankroll).toBeGreaterThanOrEqual(bank)
    expect(CONFIG.buyInPresets).toContain(end.buyIn)
  })

  it('continue after the checkpoint opens the shop and starts level 2', () => {
    const g = findCheckpointGame()
    expect(g.dispatch({ type: 'continue' })).toBe(true)
    expect(g.state.phase).toBe('shop')
    expect(g.state.stage).toBe(2)
    expect(fightLabel(g.state)).toBe('Fight 1 of 5')
  })
})

describe('level text helpers', () => {
  it('titles a level with its label', () => {
    expect(levelTitle(3, 'Tricky')).toBe('Level 3 - Tricky')
    expect(nextLevelTitle(levelInfo(4))).toBe('Next: Level 4 - Hard')
  })

  it('writes a one-line profile from the level info', () => {
    const i = levelInfo(3)
    const line = levelProfileLine(i)
    expect(line).toBe(`Enemies ${i.enemyDiceText} | Knockout ${formatMultiplier(i.koMultiplier)} | Target +${i.targetGrowthPercent}%`)
    expect(line).toContain('2d6+3')
    expect(line).not.toContain('\n')
    const boss = levelProfileLine(i, true)
    expect(boss).toBe(`Boss ${i.bossDiceText} | Knockout ${formatMultiplier(i.bossKoMultiplier)} | Target +${i.targetGrowthPercent}%`)
    expect(boss).not.toBe(line)
  })

  it('writes the full profile and the max win for the next level', () => {
    const i = levelInfo(2)
    const full = levelFullProfileLine(i)
    expect(full).toContain(i.enemyDiceText)
    expect(full).toContain(i.bossDiceText)
    expect(full).toContain(formatMultiplier(i.koMultiplier))
    expect(full).toContain(formatMultiplier(i.bossKoMultiplier))
    expect(maxWinLine(i)).toBe(`Max win this level: ${formatMultiplier(i.maxWinPerLevel)} your bankroll`)
    expect(maxWinLine(levelInfo(4))).not.toBe(maxWinLine(levelInfo(3)))
  })

  it('has a lobby blurb about easier early and harder richer later', () => {
    const t = levelsBlurb().toLowerCase()
    expect(t).toContain('easy')
    expect(t).toContain('harder')
    expect(t).toContain('richer')
  })

  it('shows the next level on a real checkpoint, one level above the cleared one', () => {
    const g = findCheckpointGame()
    const s = g.state
    const cp = s.lastCheckpoint
    expect(cp?.outcome).toBe('passed')
    expect(s.levelInfo.level).toBe((cp?.stage ?? 0) + 1)
    expect(s.level).toBe(s.levelInfo.level)
    expect(nextLevelTitle(s.levelInfo)).toBe(`Next: Level ${s.level} - ${s.levelInfo.difficultyLabel}`)
    expect(hudView(s).level).toBe(`Level ${cp?.stage} - Easy`)
    expect(maxWinLine(s.levelInfo)).toContain(formatMultiplier(s.levelInfo.maxWinPerLevel))
  })

  it('shows the current level in the hud for a fresh run', () => {
    const s = createGame(1, 100).state
    expect(hudView(s).level).toBe('Level 1 - Easy')
    expect(levelProfileLine(s.levelInfo)).toContain(s.levelInfo.enemyDiceText)
  })
})

describe('walk-away breakdown text', () => {
  it('lists the refund and the share of earned payout with their percents', () => {
    const r = { outcome: 'walkedAway', walkAwayRefund: 30, walkAwayFromEarned: 40 } as const
    expect(walkAwayRows(r, 30, 50)).toEqual([
      { label: 'Bet refund (30%)', value: '30' },
      { label: 'Share of earned payout (50%)', value: '40' },
    ])
    expect(walkAwayRows(r, 50, 50)[0]?.label).toBe('Bet refund (50%)')
    expect(walkAwayRows(r, null, null).map((x) => x.label)).toEqual(['Bet refund', 'Share of earned payout'])
  })

  it('shows nothing for other outcomes', () => {
    expect(walkAwayRows({ outcome: 'won', walkAwayRefund: 0, walkAwayFromEarned: 0 }, 30, 50)).toEqual([])
    expect(walkAwayRows({ outcome: 'lost', walkAwayRefund: 0, walkAwayFromEarned: 0 }, 30, 50)).toEqual([])
  })

  it('matches a real walk-away from the core state', () => {
    for (let seed = 1; seed < 300; seed++) {
      const g = createGame(seed, 1000)
      g.dispatch({ type: 'bet', amount: 500 })
      g.dispatch({ type: 'roll' })
      if (g.state.fight?.canWalkAway !== true) continue
      const f = g.state.fight
      expect(g.dispatch({ type: 'walkAway' })).toBe(true)
      const s = g.state
      const r = s.lastResult
      if (!r) throw new Error('no result')
      expect(s.phase).toBe('result')
      const pct = walkAwayPercents(s.fight)
      expect(pct.refund).toBe(f.walkAwayRefundPercent)
      expect(pct.keep).toBe(50)
      const rows = walkAwayRows(r, pct.refund, pct.keep)
      expect(rows.map((x) => x.value)).toEqual([formatCoins(r.walkAwayRefund), formatCoins(r.walkAwayFromEarned)])
      expect(r.walkAwayRefund + r.walkAwayFromEarned).toBe(r.payout)
      expect(rows[0]?.label).toBe(`Bet refund (${f.walkAwayRefundPercent}%)`)
      return
    }
    throw new Error('no walk-away found')
  })

  it('reads no percents without a fight', () => {
    expect(walkAwayPercents(null)).toEqual({ refund: null, keep: null })
  })
})
