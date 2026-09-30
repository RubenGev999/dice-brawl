import { CONFIG, MILLI } from './config.ts'
import { diceText, generateEnemy, isBossFight, traitText } from './enemies.ts'
import {
  canWalkAway,
  createSimFight,
  currentWalkAwayPayout,
  enemyCurrentBonus,
  fightPayout,
  lossPayoutAt,
  payoutAt,
  rollExchange,
} from './fight.ts'
import type { SimFight } from './fight.ts'
import { createStream } from './rng.ts'
import { computeMods, countOwned, getUpgrade, isUseful, skipPawnValue, UPGRADE_IDS } from './upgrades.ts'
import type {
  Action,
  BetPreset,
  CheckpointResult,
  FightResult,
  FightState,
  Game,
  GameOverReason,
  GameState,
  LogEntry,
  Phase,
  ShopOffer,
  UpgradeId,
} from './types.ts'

interface Internal {
  seed: number
  buyIn: number
  tick: number
  phase: Phase
  bankroll: number
  bet: number
  stage: number
  fightInStage: number
  fightsCompleted: number
  stagesCleared: number
  bossesDefeated: number
  stageEntryBankroll: number
  target: number
  upgrades: UpgradeId[]
  shopOffers: UpgradeId[]
  lastResult: FightResult | null
  lastCheckpoint: CheckpointResult | null
  gameOverReason: GameOverReason
  cashOut: number | null
  cashOutFee: number | null
  peakBankroll: number
  totalWagered: number
  totalPaidOut: number
  fight: SimFight | null
}

export function isValidBuyIn(buyIn: number): boolean {
  return Number.isSafeInteger(buyIn) && buyIn >= CONFIG.minBuyIn
}

export function targetGrowthPercentForStage(stage: number): number {
  return CONFIG.targetGrowthPercent + (stage - 1) * CONFIG.targetGrowthPerStagePercent
}

export function targetFloorForStage(stage: number, buyIn: number): number {
  if (CONFIG.targetFloorFirstPermilleOfBuyIn <= 0) return 0
  let t = Math.floor((buyIn * CONFIG.targetFloorFirstPermilleOfBuyIn) / 1000)
  for (let i = 1; i < stage; i++) t = Math.floor((t * CONFIG.targetFloorGrowthPercent) / 100)
  return t
}

export function targetForStage(stage: number, entryBankroll: number, buyIn: number = CONFIG.defaultBuyIn): number {
  const g = targetGrowthPercentForStage(stage)
  const relative = g <= -100 ? 0 : Math.max(entryBankroll + 1, Math.floor((entryBankroll * (100 + g)) / 100))
  return Math.max(1, relative, targetFloorForStage(stage, buyIn))
}

export function failedCheckpointFee(bankroll: number): number {
  const b = Math.max(0, Math.floor(bankroll))
  return b - Math.floor((b * (100 - CONFIG.failedCheckpointFeePercent)) / 100)
}

export function minBetFor(bankroll: number): number {
  return Math.max(1, Math.ceil((bankroll * CONFIG.minBetPercent) / 100))
}

export function maxBetFor(bankroll: number, isBoss: boolean): number {
  const pct = isBoss ? CONFIG.bossMaxBetPercent : CONFIG.maxBetPercent
  return Math.min(bankroll, Math.max(minBetFor(bankroll), Math.floor((bankroll * pct) / 100)))
}

export function clampBet(amount: number, bankroll: number, isBoss: boolean): number {
  const a = Math.floor(amount)
  return Math.max(minBetFor(bankroll), Math.min(maxBetFor(bankroll, isBoss), a))
}

export function shopOrderForFight(seed: number, fightIndex: number): UpgradeId[] {
  const rng = createStream(seed, 'shop', fightIndex)
  const ids = [...UPGRADE_IDS]
  for (let i = ids.length - 1; i > 0; i--) {
    const j = rng.int(0, i)
    const tmp = ids[i] as UpgradeId
    ids[i] = ids[j] as UpgradeId
    ids[j] = tmp
  }
  return ids
}

export function shopOffersForFight(seed: number, fightIndex: number, owned: ReadonlyArray<UpgradeId> = []): UpgradeId[] {
  return shopOrderForFight(seed, fightIndex)
    .filter((id) => isUseful(owned, id))
    .slice(0, CONFIG.shopOfferCount)
}

class GameImpl implements Game {
  private s: Internal
  private entries: LogEntry[] = []
  private cached: GameState | null = null

  constructor(seed: number, buyIn: number) {
    this.s = {
      seed: seed >>> 0,
      buyIn,
      tick: 0,
      phase: 'bet',
      bankroll: buyIn,
      bet: 0,
      stage: 1,
      fightInStage: 0,
      fightsCompleted: 0,
      stagesCleared: 0,
      bossesDefeated: 0,
      stageEntryBankroll: buyIn,
      target: targetForStage(1, buyIn, buyIn),
      upgrades: [],
      shopOffers: [],
      lastResult: null,
      lastCheckpoint: null,
      gameOverReason: null,
      cashOut: null,
      cashOutFee: null,
      peakBankroll: buyIn,
      totalWagered: 0,
      totalPaidOut: 0,
      fight: null,
    }
  }

  get log(): ReadonlyArray<LogEntry> {
    return this.entries
  }

  get state(): GameState {
    if (!this.cached) this.cached = this.buildState()
    return this.cached
  }

  dispatch(action: Action): boolean {
    const ok = this.apply(action)
    if (ok) {
      this.entries.push({ tick: this.s.tick, action: { ...action } })
      this.cached = null
    }
    return ok
  }

  tick(): void {
    this.s.tick += 1
    this.cached = null
  }

  private addCoins(n: number): void {
    this.s.bankroll += n
    if (this.s.bankroll > this.s.peakBankroll) this.s.peakBankroll = this.s.bankroll
  }

  private apply(action: Action): boolean {
    const s = this.s
    switch (action.type) {
      case 'bet': {
        if (s.phase !== 'bet' || s.bankroll < 1) return false
        if (typeof action.amount !== 'number' || !Number.isFinite(action.amount)) return false
        const index = s.fightsCompleted
        const bet = clampBet(action.amount, s.bankroll, isBossFight(index))
        s.bet = bet
        s.bankroll -= bet
        s.totalWagered += bet
        s.fight = createSimFight(s.seed, index, bet, computeMods(s.upgrades), generateEnemy(s.seed, index))
        s.phase = 'fight'
        return true
      }
      case 'roll': {
        const f = s.fight
        if (s.phase !== 'fight' || !f || f.status !== 'active') return false
        rollExchange(f)
        if (f.status !== 'active') this.settle(f)
        return true
      }
      case 'walkAway': {
        const f = s.fight
        if (s.phase !== 'fight' || !f || !canWalkAway(f)) return false
        f.status = 'walkedAway'
        this.settle(f)
        return true
      }
      case 'continue': {
        if (s.phase === 'result') {
          this.afterResult()
          return true
        }
        if (s.phase === 'checkpoint') {
          this.openShop()
          return true
        }
        return false
      }
      case 'leave': {
        if (s.phase !== 'checkpoint') return false
        this.endRun('left', s.bankroll, 0)
        return true
      }
      case 'pickUpgrade': {
        if (s.phase !== 'shop') return false
        if (!Number.isInteger(action.index) || action.index < 0 || action.index >= s.shopOffers.length) return false
        s.upgrades = [...s.upgrades, s.shopOffers[action.index] as UpgradeId]
        s.shopOffers = []
        s.phase = 'bet'
        return true
      }
      case 'skip': {
        if (s.phase !== 'shop') return false
        this.addCoins(skipPawnValue(s.buyIn))
        s.shopOffers = []
        s.phase = 'bet'
        return true
      }
      case 'pawn': {
        if (!this.canPawn()) return false
        if (!Number.isInteger(action.index) || action.index < 0 || action.index >= s.upgrades.length) return false
        s.upgrades = s.upgrades.filter((_, i) => i !== action.index)
        this.addCoins(skipPawnValue(s.buyIn))
        return true
      }
      default:
        return false
    }
  }

  private endRun(reason: Exclude<GameOverReason, null>, cashOut: number, fee: number): void {
    const s = this.s
    s.phase = 'gameover'
    s.gameOverReason = reason
    s.cashOut = cashOut
    s.cashOutFee = fee
    s.shopOffers = []
  }

  private afterResult(): void {
    const s = this.s
    s.fight = null
    s.fightInStage += 1
    if (s.fightInStage >= CONFIG.fightsPerStage) {
      const passed = s.bankroll >= s.target
      s.lastCheckpoint = {
        stage: s.stage,
        entryBankroll: s.stageEntryBankroll,
        target: s.target,
        bankroll: s.bankroll,
        outcome: passed ? 'passed' : 'failed',
      }
      if (!passed) {
        const fee = failedCheckpointFee(s.bankroll)
        this.endRun('checkpoint', s.bankroll - fee, fee)
        return
      }
      s.stagesCleared += 1
      s.stage += 1
      s.fightInStage = 0
      s.stageEntryBankroll = s.bankroll
      s.target = targetForStage(s.stage, s.bankroll, s.buyIn)
      s.phase = 'checkpoint'
      return
    }
    if (s.bankroll < 1 && s.upgrades.length === 0) {
      this.endRun('broke', 0, 0)
      return
    }
    this.openShop()
  }

  private openShop(): void {
    const s = this.s
    s.shopOffers = shopOffersForFight(s.seed, s.fightsCompleted - 1, s.upgrades)
    s.phase = 'shop'
  }

  private canPawn(): boolean {
    const s = this.s
    return s.phase === 'bet' && s.bankroll < 1 && s.upgrades.length > 0
  }

  private settle(f: SimFight): void {
    const s = this.s
    const payout = fightPayout(f)
    this.addCoins(payout)
    s.totalPaidOut += payout
    s.fightsCompleted += 1
    if (f.isBoss && f.status === 'won') s.bossesDefeated += 1
    s.lastResult = {
      outcome: f.status === 'active' ? 'lost' : f.status,
      isBoss: f.isBoss,
      bet: f.bet,
      multiplier: f.multiplierMilli / MILLI,
      multiplierMilli: f.multiplierMilli,
      payout,
      rolls: f.exchanges.length,
    }
    s.phase = 'result'
  }

  private currentFightIsBoss(): boolean {
    const s = this.s
    if (s.fight) return s.fight.isBoss
    return s.phase === 'bet' && isBossFight(s.fightsCompleted)
  }

  private betPresets(): BetPreset[] {
    const b = this.s.bankroll
    const boss = this.s.fight ? this.s.fight.isBoss : isBossFight(this.s.fightsCompleted)
    const lo = minBetFor(b)
    const hi = maxBetFor(b, boss)
    const p = CONFIG.betPresetPercents
    const make = (id: BetPreset['id'], label: string, percent: number): BetPreset => {
      const amount = b < 1 ? 0 : Math.max(lo, Math.min(hi, Math.floor((b * percent) / 100)))
      return { id, label, percent, amount, isAllIn: b > 0 && amount >= b }
    }
    const maxPct = boss ? CONFIG.bossMaxBetPercent : CONFIG.maxBetPercent
    return [
      make('low', 'Low', p.low),
      make('medium', 'Medium', p.medium),
      make('high', 'High', p.high),
      make('max', maxPct >= 100 ? 'All-in' : 'Max', maxPct),
    ]
  }

  private buildFight(f: SimFight): FightState {
    const m = f.mods
    const active = this.s.phase === 'fight' && f.status === 'active'
    const fullKo = f.fullKoMilli + f.koBonusMilli
    return {
      index: f.index,
      stageOfFight: f.stage,
      isBoss: f.isBoss,
      status: f.status,
      enemy: {
        name: f.enemy.name,
        isBoss: f.enemy.isBoss,
        hp: f.enemyHp,
        maxHp: f.enemyMaxHp,
        dice: f.enemy.dice,
        bonus: f.enemy.bonus,
        currentBonus: enemyCurrentBonus(f),
        diceText: diceText(f.enemy.dice, enemyCurrentBonus(f)),
        trait: f.enemy.trait,
        traitText: traitText(f.enemy.trait),
      },
      player: {
        hp: f.playerHp,
        maxHp: m.maxHp,
        dice: m.dice,
        minFace: m.minFace,
        damageBonus: m.damageBonus,
        bonus: m.bonus,
        diceText: diceText(m.dice, m.bonus),
        shieldsLeft: f.shieldsLeft,
        rerollsLeft: f.rerollsLeft,
        hasEscapeRope: m.escapeRope,
      },
      bet: f.bet,
      multiplier: f.multiplierMilli / MILLI,
      multiplierMilli: f.multiplierMilli,
      fullKoMultiplier: fullKo / MILLI,
      koBonusMultiplier: f.koBonusMilli / MILLI,
      potentialPayout: payoutAt(f.bet, f.multiplierMilli),
      koPayout: payoutAt(f.bet, fullKo),
      walkAwayPayout: currentWalkAwayPayout(f),
      walkAwayKeep: m.walkAwayKeepMilli / MILLI,
      lossRefund: lossPayoutAt(f.bet, m.lossRefundMilli),
      canWalkAway: active && canWalkAway(f),
      canRoll: active,
      exchanges: f.exchanges,
    }
  }

  private buildState(): GameState {
    const s = this.s
    const inFight = s.phase === 'bet' || s.phase === 'fight' || s.phase === 'result'
    const boss = inFight && this.currentFightIsBoss()
    const betting = s.phase === 'bet' && s.bankroll >= 1
    const pawn = skipPawnValue(s.buyIn)
    const offers: ShopOffer[] = s.shopOffers.map((id) => ({ ...getUpgrade(id, s.buyIn), owned: countOwned(s.upgrades, id) }))
    return {
      seed: s.seed,
      buyIn: s.buyIn,
      tick: s.tick,
      phase: s.phase,
      bankroll: s.bankroll,
      bet: s.bet,
      minBet: betting ? minBetFor(s.bankroll) : 0,
      maxBet: betting ? maxBetFor(s.bankroll, boss) : 0,
      betPresets: this.betPresets(),
      canBet: betting,
      stage: s.stage,
      fightInStage: s.fightInStage,
      fightNumberInStage: Math.min(s.fightInStage + 1, CONFIG.fightsPerStage),
      fightsPerStage: CONFIG.fightsPerStage,
      stageEntryBankroll: s.stageEntryBankroll,
      target: s.target,
      isCheckpointFight: boss,
      isBossFight: boss,
      fightsCompleted: s.fightsCompleted,
      stagesCleared: s.stagesCleared,
      bossesDefeated: s.bossesDefeated,
      upgrades: s.upgrades.map((id) => getUpgrade(id, s.buyIn)),
      shopOffers: offers,
      skipCoins: pawn,
      pawnValue: pawn,
      canPawn: this.canPawn(),
      canLeave: s.phase === 'checkpoint',
      lastResult: s.lastResult,
      lastCheckpoint: s.lastCheckpoint,
      gameOverReason: s.gameOverReason,
      cashOut: s.cashOut,
      cashOutFee: s.cashOutFee,
      failedCheckpointFeePercent: CONFIG.failedCheckpointFeePercent,
      peakBankroll: s.peakBankroll,
      totalWagered: s.totalWagered,
      totalPaidOut: s.totalPaidOut,
      fight: s.fight ? this.buildFight(s.fight) : null,
    }
  }
}

export function createGame(seed: number, buyIn: number = CONFIG.defaultBuyIn): Game {
  if (!isValidBuyIn(buyIn)) throw new RangeError(`buyIn must be an integer >= ${CONFIG.minBuyIn}`)
  return new GameImpl(seed, buyIn)
}

export function replay(seed: number, buyIn: number, log: ReadonlyArray<LogEntry>, totalTicks?: number): GameState {
  const game = createGame(seed, buyIn)
  const last = log.length > 0 ? (log[log.length - 1] as LogEntry).tick : 0
  const end = totalTicks ?? last
  let i = 0
  let now = 0
  for (;;) {
    while (i < log.length && (log[i] as LogEntry).tick <= now) {
      const entry = log[i] as LogEntry
      if (entry.tick === now) game.dispatch(entry.action)
      i++
    }
    if (now >= end) break
    game.tick()
    now++
  }
  return game.state
}
