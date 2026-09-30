import {
  CONFIG,
  canWalkAway,
  computeMods,
  createGame,
  createSimFight,
  fightPayout,
  generateEnemy,
  getUpgrade,
  rollExchange,
  shopOffersForFight,
} from '../index.ts'
import type { Game, GameState, ShopOffer, SimFight, UpgradeId } from '../index.ts'

export type WalkRule = 'never' | 'emergency' | 'first'
export type BetStyle = 'fixed' | 'bossTarget' | 'bossMax' | 'target' | 'max' | 'firstMax'
export type ShopRule = 'priority' | 'skip'

export interface BotSpec {
  readonly name: string
  readonly betPercent: number
  readonly style: BetStyle
  readonly walk: WalkRule
  readonly shop: ShopRule
  readonly leaveAfterStage: number | null
}

export const WALK_SETTINGS = { bossHpAtMost: 1 }

export const SENSIBLE: BotSpec = {
  name: 'sensible',
  betPercent: 20,
  style: 'target',
  walk: 'emergency',
  shop: 'priority',
  leaveAfterStage: null,
}

export const BOTS: Readonly<Record<string, BotSpec>> = {
  sensible: SENSIBLE,
  fixedMedium: { ...SENSIBLE, name: 'fixedMedium', style: 'fixed' },
  bossTarget: { ...SENSIBLE, name: 'bossTarget', style: 'bossTarget' },
  minBossMax: { ...SENSIBLE, name: 'minBossMax', betPercent: 0, style: 'bossMax' },
  minBossMaxLeave1: { ...SENSIBLE, name: 'minBossMaxLeave1', betPercent: 0, style: 'bossMax', leaveAfterStage: 1 },
  minSkipWalk: { ...SENSIBLE, name: 'minSkipWalk', betPercent: 0, style: 'fixed', shop: 'skip' },
  allIn: { name: 'allIn', betPercent: 100, style: 'max', walk: 'never', shop: 'priority', leaveAfterStage: null },
  timid: { ...SENSIBLE, name: 'timid', walk: 'first' },
  coasting: { ...SENSIBLE, name: 'coasting', betPercent: 0, style: 'fixed' },
  minSkipFail: { name: 'minSkipFail', betPercent: 0, style: 'fixed', walk: 'never', shop: 'skip', leaveAfterStage: null },
  leave1: { ...SENSIBLE, name: 'leave1', leaveAfterStage: 1 },
  leave2: { ...SENSIBLE, name: 'leave2', leaveAfterStage: 2 },
  leave3: { ...SENSIBLE, name: 'leave3', leaveAfterStage: 3 },
  firstAllIn: { ...SENSIBLE, name: 'firstAllIn', betPercent: 0, style: 'firstMax' },
  firstAllInLeave1: { ...SENSIBLE, name: 'firstAllInLeave1', betPercent: 0, style: 'firstMax', leaveAfterStage: 1 },
  fixed10: { ...SENSIBLE, name: 'fixed10', betPercent: 10, style: 'fixed' },
  fixed25: { ...SENSIBLE, name: 'fixed25', betPercent: 25, style: 'fixed' },
  fixed50: { ...SENSIBLE, name: 'fixed50', betPercent: 50, style: 'fixed' },
}

export const UPGRADE_PRIORITY: ReadonlyArray<UpgradeId> = [
  'weightedDice',
  'sharpBlade',
  'thickSkin',
  'shield',
  'intimidate',
  'vampire',
  'secondWind',
  'finisher',
  'vitality',
  'loadedDice',
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

export function emergencyWalk(hp: number, isBoss: boolean): boolean {
  return isBoss && hp <= WALK_SETTINGS.bossHpAtMost
}

function wantsWalkSim(rule: WalkRule, f: SimFight): boolean {
  if (!canWalkAway(f) || rule === 'never') return false
  if (rule === 'first') return true
  return emergencyWalk(f.playerHp, f.isBoss)
}

export function koNetMilli(isBoss: boolean): number {
  return isBoss
    ? CONFIG.bossFullKoMultiplierMilli + CONFIG.bossKoBonusMilli - 1000
    : CONFIG.fullKoMultiplierMilli + CONFIG.koBonusMilli - 1000
}

export function wantsWalk(bot: BotSpec, st: GameState): boolean {
  const f = st.fight
  if (!f || !f.canWalkAway || bot.walk === 'never') return false
  if (bot.walk === 'first') return true
  if (emergencyWalk(f.player.hp, f.isBoss)) return true
  return f.isBoss && st.bankroll < st.target && st.bankroll + f.walkAwayPayout >= st.target
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
  const reach = st.isBossFight ? koNetMilli(true) : normalsLeft * koNetMilli(false) + koNetMilli(true)
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
      if (st.canPawn) game.dispatch({ type: 'pawn', index: 0 })
      else game.dispatch({ type: 'bet', amount: betFor(bot, st) })
    } else if (st.phase === 'fight') {
      const f = st.fight
      const walk = f !== null && f.canWalkAway && wantsWalk(bot, st)
      game.dispatch({ type: walk ? 'walkAway' : 'roll' })
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
}

export function simFight(
  seed: number,
  index: number,
  upgrades: ReadonlyArray<UpgradeId>,
  walk: WalkRule = 'emergency',
  bet = 1000,
): FightSample {
  const mods = computeMods(upgrades)
  const f = createSimFight(seed, index, bet, mods, generateEnemy(seed, index))
  while (f.status === 'active') {
    if (wantsWalkSim(walk, f)) f.status = 'walkedAway'
    else rollExchange(f)
  }
  return { bet, payout: fightPayout(f), rolls: f.exchanges.length, won: f.status === 'won' }
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
