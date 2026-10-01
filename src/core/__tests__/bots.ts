import {
  canWalkAway,
  computeMods,
  createGame,
  createSimFight,
  fightPayout,
  generateEnemy,
  getUpgrade,
  koMultiplierMilliForLevel,
  rollExchange,
  shopOffersForFight,
} from '../index.ts'
import type { Game, GameState, ShopOffer, SimFight, UpgradeId } from '../index.ts'

export type WalkRule = 'never' | 'emergency' | 'lowHp' | 'aboutToLose' | 'first'
export type BetStyle = 'fixed' | 'bossTarget' | 'bossMax' | 'target' | 'max' | 'firstMax'
export type ShopRule = 'priority' | 'skip'

export interface BotSpec {
  readonly name: string
  readonly betPercent: number
  readonly style: BetStyle
  readonly walk: WalkRule
  readonly targetWalk: boolean
  readonly shop: ShopRule
  readonly leaveAfterStage: number | null
}

export const WALK_SETTINGS = { bossHpAtMost: 1, lowHpPercent: 40, aboutToLoseHpPercent: 35, aboutToLoseEnemyPercent: 40 }

export const SENSIBLE: BotSpec = {
  name: 'sensible',
  betPercent: 25,
  style: 'target',
  walk: 'aboutToLose',
  targetWalk: true,
  shop: 'priority',
  leaveAfterStage: null,
}

export const BOTS: Readonly<Record<string, BotSpec>> = {
  sensible: SENSIBLE,
  sensibleNoWalk: { ...SENSIBLE, name: 'sensibleNoWalk', walk: 'never', targetWalk: false },
  lowHpWalk: { ...SENSIBLE, name: 'lowHpWalk', walk: 'lowHp', targetWalk: false },
  aboutToLose: { ...SENSIBLE, name: 'aboutToLose', walk: 'aboutToLose', targetWalk: false },
  bossEmergency: { ...SENSIBLE, name: 'bossEmergency', walk: 'emergency' },
  fixedMedium: { ...SENSIBLE, name: 'fixedMedium', style: 'fixed' },
  fixed20: { ...SENSIBLE, name: 'fixed20', betPercent: 20, style: 'fixed' },
  bossTarget: { ...SENSIBLE, name: 'bossTarget', style: 'bossTarget' },
  minBossMax: { ...SENSIBLE, name: 'minBossMax', betPercent: 0, style: 'bossMax' },
  minBossMaxLeave1: { ...SENSIBLE, name: 'minBossMaxLeave1', betPercent: 0, style: 'bossMax', leaveAfterStage: 1 },
  minSkipWalk: { ...SENSIBLE, name: 'minSkipWalk', betPercent: 0, style: 'fixed', shop: 'skip' },
  allIn: { ...SENSIBLE, name: 'allIn', betPercent: 100, style: 'max', walk: 'never', targetWalk: false },
  allInWalk: { ...SENSIBLE, name: 'allInWalk', betPercent: 100, style: 'max', walk: 'aboutToLose', targetWalk: false },
  timid: { ...SENSIBLE, name: 'timid', walk: 'first' },
  coasting: { ...SENSIBLE, name: 'coasting', betPercent: 0, style: 'fixed' },
  minSkipFail: { ...SENSIBLE, name: 'minSkipFail', betPercent: 0, style: 'fixed', walk: 'never', targetWalk: false, shop: 'skip' },
  leave1: { ...SENSIBLE, name: 'leave1', leaveAfterStage: 1 },
  leave2: { ...SENSIBLE, name: 'leave2', leaveAfterStage: 2 },
  leave3: { ...SENSIBLE, name: 'leave3', leaveAfterStage: 3 },
  firstAllIn: { ...SENSIBLE, name: 'firstAllIn', betPercent: 0, style: 'firstMax' },
  firstAllInLeave1: { ...SENSIBLE, name: 'firstAllInLeave1', betPercent: 0, style: 'firstMax', leaveAfterStage: 1 },
  fixed10: { ...SENSIBLE, name: 'fixed10', betPercent: 10, style: 'fixed' },
  fixed50: { ...SENSIBLE, name: 'fixed50', betPercent: 50, style: 'fixed' },
}

export const UPGRADE_PRIORITY: ReadonlyArray<UpgradeId> = [
  'weightedDice',
  'sharpBlade',
  'thickSkin',
  'bloodlust',
  'shield',
  'intimidate',
  'vitality',
  'firstBlood',
  'secondWind',
  'combo',
  'finisher',
  'vampire',
  'riposte',
  'ironGuard',
  'loadedDice',
  'tieBreaker',
  'escapeRope',
  'insurance',
]

export function pickIndex(offers: ReadonlyArray<ShopOffer>): number {
  let best = 0
  let bestRank = Number.POSITIVE_INFINITY
  offers.forEach((o, i) => {
    const r = UPGRADE_PRIORITY.indexOf(o.id)
    if (r < bestRank) {
      bestRank = r
      best = i
    }
  })
  return best
}

export interface WalkView {
  readonly playerHp: number
  readonly playerMaxHp: number
  readonly enemyHp: number
  readonly enemyMaxHp: number
  readonly isBoss: boolean
}

export function walkByRule(rule: WalkRule, v: WalkView): boolean {
  switch (rule) {
    case 'never':
      return false
    case 'first':
      return true
    case 'emergency':
      return v.isBoss && v.playerHp <= WALK_SETTINGS.bossHpAtMost
    case 'lowHp':
      return v.playerHp * 100 <= v.playerMaxHp * WALK_SETTINGS.lowHpPercent
    case 'aboutToLose':
      return (
        v.playerHp * 100 <= v.playerMaxHp * WALK_SETTINGS.aboutToLoseHpPercent &&
        v.enemyHp * 100 > v.enemyMaxHp * WALK_SETTINGS.aboutToLoseEnemyPercent
      )
  }
}

function simView(f: SimFight): WalkView {
  return { playerHp: f.playerHp, playerMaxHp: f.playerMaxHp, enemyHp: f.enemyHp, enemyMaxHp: f.enemyMaxHp, isBoss: f.isBoss }
}

export function koNetMilli(level: number, isBoss: boolean): number {
  return koMultiplierMilliForLevel(level, isBoss) - 1000
}

export function wantsWalk(bot: BotSpec, st: GameState): boolean {
  const f = st.fight
  if (!f || !f.canWalkAway) return false
  const view: WalkView = {
    playerHp: f.player.hp,
    playerMaxHp: f.player.maxHp,
    enemyHp: f.enemy.hp,
    enemyMaxHp: f.enemy.maxHp,
    isBoss: f.isBoss,
  }
  if (walkByRule(bot.walk, view)) return true
  return bot.targetWalk && f.isBoss && st.bankroll < st.target && st.bankroll + f.walkAwayPayout >= st.target
}

export function betFor(bot: BotSpec, st: GameState): number {
  const b = st.bankroll
  const share = Math.floor((b * bot.betPercent) / 100)
  if (bot.style === 'max' || (bot.style === 'bossMax' && st.isBossFight)) return st.maxBet
  if (bot.style === 'firstMax' && st.fightsCompleted === 0) return st.maxBet
  if (bot.style === 'bossMax') return share
  if (bot.style === 'fixed' || (bot.style === 'bossTarget' && !st.isBossFight)) return share
  if (b >= st.target) return st.isBossFight ? Math.max(st.minBet, Math.min(share, b - st.target)) : st.minBet
  const normalsLeft = st.isBossFight ? 0 : st.fightsPerStage - 1 - st.fightInStage
  const reach = st.isBossFight ? koNetMilli(st.level, true) : normalsLeft * koNetMilli(st.level, false) + koNetMilli(st.level, true)
  return Math.max(share, Math.ceil(((st.target - b) * 1000) / reach))
}

export interface FightLog {
  readonly index: number
  readonly isBoss: boolean
  readonly bet: number
  readonly payout: number
  readonly rolls: number
  readonly outcome: string
}

export interface RunStats {
  readonly perFight: FightLog[]
  readonly fights: number
  readonly stagesCleared: number
  readonly cashOut: number
  readonly buyIn: number
  readonly reason: string
  readonly game: Game
}

export function playRun(seed: number, bot: BotSpec, buyIn = 100, maxFights = 400): RunStats {
  const game = createGame(seed, buyIn)
  const perFight: FightLog[] = []
  for (let guard = 0; guard < 200000; guard++) {
    const st = game.state
    if (st.phase === 'gameover' || st.fightsCompleted >= maxFights) break
    if (st.phase === 'bet') {
      game.dispatch({ type: 'bet', amount: betFor(bot, st) })
    } else if (st.phase === 'fight') {
      game.dispatch({ type: wantsWalk(bot, st) ? 'walkAway' : 'roll' })
    } else if (st.phase === 'result') {
      const r = st.lastResult
      if (r) {
        perFight.push({
          index: st.fightsCompleted - 1,
          isBoss: r.isBoss,
          bet: r.bet,
          payout: r.payout,
          rolls: r.rolls,
          outcome: r.outcome,
        })
      }
      game.dispatch({ type: 'continue' })
    } else if (st.phase === 'checkpoint') {
      const leave = bot.leaveAfterStage !== null && st.stagesCleared >= bot.leaveAfterStage
      game.dispatch({ type: leave ? 'leave' : 'continue' })
    } else if (st.phase === 'shop') {
      if (bot.shop === 'skip' || st.shopOffers.length === 0) game.dispatch({ type: 'skip' })
      else game.dispatch({ type: 'pickUpgrade', index: pickIndex(st.shopOffers) })
    }
  }
  const st = game.state
  return {
    perFight,
    fights: st.fightsCompleted,
    stagesCleared: st.stagesCleared,
    cashOut: st.cashOut ?? st.bankroll,
    buyIn,
    reason: st.gameOverReason ?? 'cap',
    game,
  }
}

export interface FightSample {
  readonly bet: number
  readonly payout: number
  readonly rolls: number
  readonly won: boolean
  readonly walked: boolean
  readonly lowHpSeen: boolean
}

export function simFight(
  seed: number,
  index: number,
  upgrades: ReadonlyArray<UpgradeId>,
  walk: WalkRule = 'aboutToLose',
  bet = 1000,
): FightSample {
  const mods = computeMods(upgrades)
  const f = createSimFight(seed, index, bet, mods, generateEnemy(seed, index))
  let lowHpSeen = false
  while (f.status === 'active') {
    if (canWalkAway(f) && walkByRule('lowHp', simView(f))) lowHpSeen = true
    if (canWalkAway(f) && walkByRule(walk, simView(f))) f.status = 'walkedAway'
    else rollExchange(f)
  }
  return {
    bet,
    payout: fightPayout(f),
    rolls: f.exchanges.length,
    won: f.status === 'won',
    walked: f.status === 'walkedAway',
    lowHpSeen,
  }
}

export function priorityBuild(seed: number, size: number): UpgradeId[] {
  const owned: UpgradeId[] = []
  for (let k = 0; owned.length < size && k < 400; k++) {
    const offers = shopOffersForFight(seed, k, owned)
    if (offers.length === 0) break
    const shown = offers.map((id) => ({ ...getUpgrade(id), owned: 0 }))
    owned.push(offers[pickIndex(shown)] as UpgradeId)
  }
  return owned
}
