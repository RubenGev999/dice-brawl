import {
  CONFIG,
  UPGRADE_IDS,
  canWalkAway,
  computeMods,
  createGame,
  createSimFight,
  currentWalkAwayPayout,
  deriveSeed,
  fightPayout,
  generateEnemy,
  getUpgrade,
  hashString,
  isBossFight,
  isUseful,
  koMultiplierMilliForLevel,
  levelDef,
  mulberry32,
  rollExchange,
  shopOffersForFight,
  stageOfFight,
} from '../index.ts'
import type { EnemyDef, FightMods, GameState, SimFight, UpgradeId } from '../index.ts'
import { pickIndex } from './bots.ts'
import type { FightLog, RunStats } from './bots.ts'

const ENV = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}

export const SMART_FULL = Boolean(ENV.SMART_FULL)

export interface SmartSizes {
  readonly slotN: number
  readonly shopN: number
  readonly rollN: number
  readonly gridStep: number
  readonly distStep: number
  readonly betSteps: number
}

export const SMART_SIZES_FAST: SmartSizes = { slotN: 300, shopN: 200, rollN: 100, gridStep: 0.01, distStep: 0.02, betSteps: 200 }
export const SMART_SIZES_FULL: SmartSizes = { slotN: 300, shopN: 300, rollN: 200, gridStep: 0.004, distStep: 0.01, betSteps: 400 }
export const SMART_SIZES: SmartSizes = SMART_FULL ? SMART_SIZES_FULL : SMART_SIZES_FAST

export interface SmartOptions {
  readonly growth: boolean
  readonly sizes: SmartSizes
}

export const SMART_DEFAULT: SmartOptions = { growth: false, sizes: SMART_SIZES }

const BIG = 1_000_000
const SLOT_BASE = 1_000_000_000
const GMAX = 4
const FRACS = [0.04, 0.05, 0.06, 0.07, 0.08, 0.1, 0.12, 0.14, 0.17, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.6, 0.7, 0.85, 1.0]
const FPS = CONFIG.fightsPerStage

interface Dist {
  readonly v: Float64Array
  readonly p: Float64Array
  readonly mean: number
  readonly koRatio: number
}

export interface FightView {
  readonly index: number
  readonly enemy: EnemyDef
  readonly enemyHp: number
  readonly playerHp: number
  readonly shieldsLeft: number
  readonly rerollsLeft: number
  readonly hitsLanded: number
}

function buildKey(b: ReadonlyArray<UpgradeId>): string {
  return [...b].sort().join(',')
}

function aboutToLose(f: SimFight): boolean {
  return f.playerHp * 100 <= f.playerMaxHp * 35 && f.enemyHp * 100 > f.enemyMaxHp * 40
}

function lowHp(f: SimFight): boolean {
  return f.playerHp * 100 <= f.playerMaxHp * 40
}

const CONTINUATIONS: ReadonlyArray<(f: SimFight) => boolean> = [aboutToLose, lowHp]

function finishWith(f: SimFight, walk: (f: SimFight) => boolean): number {
  while (f.status === 'active') {
    if (f.exchanges.length > 0 && walk(f)) f.status = 'walkedAway'
    else rollExchange(f)
  }
  return fightPayout(f) / f.bet
}

function finishHeuristic(f: SimFight): number {
  return finishWith(f, aboutToLose)
}

function meanOf(s: Float64Array): number {
  let m = 0
  for (let i = 0; i < s.length; i++) m += s[i] as number
  return m / s.length
}

function feeKeep(): number {
  return (100 - CONFIG.failedCheckpointFeePercent) / 100
}

function leaveKeep(): number {
  return (100 - CONFIG.leaveFeePercent) / 100
}

function maxFrac(isBoss: boolean): number {
  return (isBoss ? CONFIG.bossMaxBetPercent : CONFIG.maxBetPercent) / 100
}

function viewOfState(st: GameState): FightView {
  const fs = st.fight as NonNullable<GameState['fight']>
  return {
    index: fs.index,
    enemy: {
      name: fs.enemy.name,
      archetype: fs.enemy.archetype,
      isBoss: fs.enemy.isBoss,
      maxHp: fs.enemy.maxHp,
      dice: fs.enemy.dice,
      bonus: fs.enemy.bonus,
      trait: fs.enemy.trait,
    },
    enemyHp: fs.enemy.hp,
    playerHp: fs.player.hp,
    shieldsLeft: fs.player.shieldsLeft,
    rerollsLeft: fs.player.rerollsLeft,
    hitsLanded: fs.player.hitsLanded,
  }
}

function viewOfSim(f: SimFight): FightView {
  return {
    index: f.index,
    enemy: { ...f.enemy, maxHp: f.enemyMaxHp },
    enemyHp: f.enemyHp,
    playerHp: f.playerHp,
    shieldsLeft: f.shieldsLeft,
    rerollsLeft: f.rerollsLeft,
    hitsLanded: f.hitsLanded,
  }
}

export class SmartBot {
  readonly options: SmartOptions
  private readonly gn: number
  private readonly modsCache = new Map<string, FightMods>()
  private readonly slotCache = new Map<string, Dist>()
  private readonly stageCache = new Map<string, Float64Array>()
  private readonly pathCache = new Map<string, UpgradeId[][]>()
  private readonly contCache = new Map<string, number>()
  private readonly rollCache = new Map<string, Float64Array[]>()

  constructor(options: SmartOptions = SMART_DEFAULT) {
    this.options = options
    this.gn = Math.round(GMAX / options.sizes.gridStep) + 1
  }

  private mods(build: ReadonlyArray<UpgradeId>): FightMods {
    const k = buildKey(build)
    let m = this.modsCache.get(k)
    if (!m) {
      m = computeMods(build)
      this.modsCache.set(k, m)
    }
    return m
  }

  slotDist(index: number, build: ReadonlyArray<UpgradeId>, set = 0): Dist {
    const key = `${set}|${index}|${buildKey(build)}`
    const hit = this.slotCache.get(key)
    if (hit) return hit
    const n = set === 0 ? this.options.sizes.slotN : this.options.sizes.shopN
    const step = this.options.sizes.distStep
    const mods = this.mods(build)
    const counts = new Map<number, number>()
    let sum = 0
    for (let i = 0; i < n; i++) {
      const s = (SLOT_BASE + set * 300_000_000 + index * 100_003 + i * 7919) >>> 0
      const r = finishHeuristic(createSimFight(s, index, BIG, mods, generateEnemy(s, index)))
      sum += r
      const b = Math.round(r / step)
      counts.set(b, (counts.get(b) ?? 0) + 1)
    }
    const keys = [...counts.keys()].sort((a, b) => a - b)
    const d: Dist = {
      v: Float64Array.from(keys.map((k) => k * step)),
      p: Float64Array.from(keys.map((k) => (counts.get(k) as number) / n)),
      mean: sum / n,
      koRatio: (koMultiplierMilliForLevel(stageOfFight(index), isBossFight(index)) + mods.koBonusMilli) / 1000,
    }
    this.slotCache.set(key, d)
    return d
  }

  private interp(V: Float64Array, b: number): number {
    if (b <= 0) return 0
    const last = this.gn - 1
    if (b >= GMAX) return (V[last] as number) * (b / GMAX)
    const x = b / this.options.sizes.gridStep
    const i = Math.min(last - 1, Math.floor(x))
    const t = x - i
    return (V[i] as number) * (1 - t) + (V[i + 1] as number) * t
  }

  private terminal(b: number, cont: number): number {
    return b >= 1 ? b * cont : b * feeKeep()
  }

  private stage(d: Dist, isBoss: boolean, next: (x: number) => number): Float64Array {
    const V = new Float64Array(this.gn)
    const lo = CONFIG.minBetPercent / 100
    const hi = maxFrac(isBoss)
    for (let g = 1; g < this.gn; g++) {
      const b = g * this.options.sizes.gridStep
      const cands = FRACS.filter((f) => f >= lo && f <= hi)
      cands.push(lo, hi)
      if (b < 1) {
        const f0 = (1 - b) / (b * (d.koRatio - 1))
        for (const m of [1, 1.03, 1.1, 1.25]) cands.push(f0 * m)
      }
      let best = Number.NEGATIVE_INFINITY
      for (const f of cands) {
        if (f < lo || f > hi) continue
        const keep = b * (1 - f)
        const bet = b * f
        let e = 0
        for (let i = 0; i < d.v.length; i++) e += (d.p[i] as number) * next(keep + bet * (d.v[i] as number))
        if (e > best) best = e
      }
      V[g] = best
    }
    return V
  }

  private suffix(level: number, j: number, builds: ReadonlyArray<ReadonlyArray<UpgradeId>>, cont: number): Float64Array {
    const parts: string[] = []
    for (let t = j; t < FPS; t++) parts.push(buildKey(builds[t] as ReadonlyArray<UpgradeId>))
    const key = `${level}|${j}|${cont.toFixed(5)}|${parts.join('/')}`
    const hit = this.stageCache.get(key)
    if (hit) return hit
    const index = (level - 1) * FPS + j
    const isBoss = j === FPS - 1
    const next =
      isBoss
        ? (x: number) => this.terminal(x, cont)
        : ((V: Float64Array) => (x: number) => this.interp(V, x))(this.suffix(level, j + 1, builds, cont))
    const V = this.stage(this.slotDist(index, builds[j] as ReadonlyArray<UpgradeId>), isBoss, next)
    this.stageCache.set(key, V)
    return V
  }

  private flat(build: ReadonlyArray<UpgradeId>): UpgradeId[][] {
    return Array.from({ length: FPS }, () => [...build])
  }

  growthPath(level: number, build: ReadonlyArray<UpgradeId>, from: number, pickFirst: boolean): UpgradeId[][] {
    const key = `${level}|${from}|${pickFirst}|${buildKey(build)}`
    const hit = this.pathCache.get(key)
    if (hit) return hit
    const rng = mulberry32(deriveSeed(hashString(buildKey(build)), 'smart-growth', level * 16 + from * 2 + (pickFirst ? 1 : 0)))
    const base = (level - 1) * FPS
    const out: UpgradeId[][] = []
    let cur: UpgradeId[] = [...build]
    for (let j = 0; j < FPS; j++) {
      const shop = j > from || (j === from && pickFirst)
      if (shop) {
        const ids = UPGRADE_IDS.filter((id) => isUseful(cur, id))
        for (let i = ids.length - 1; i > 0; i--) {
          const k = rng.int(0, i)
          const tmp = ids[i] as UpgradeId
          ids[i] = ids[k] as UpgradeId
          ids[k] = tmp
        }
        const offers = ids.slice(0, CONFIG.shopOfferCount)
        if (offers.length > 0) cur = [...cur, this.bestOffer(base + j, offers, cur, base + FPS)]
      }
      out.push(cur)
    }
    this.pathCache.set(key, out)
    return out
  }

  private bestOffer(start: number, offers: ReadonlyArray<UpgradeId>, build: ReadonlyArray<UpgradeId>, end: number): UpgradeId {
    let best = offers[0] as UpgradeId
    let bestGain = Number.NEGATIVE_INFINITY
    for (const o of offers) {
      const nb = [...build, o]
      let g = 0
      for (let k = start; k < end; k++) {
        const w = isBossFight(k) ? 2 : 1
        g += w * (this.slotDist(k, nb, 1).mean - this.slotDist(k, build, 1).mean)
      }
      if (g > bestGain) {
        bestGain = g
        best = o
      }
    }
    return best
  }

  shopPick(nextFight: number, offers: ReadonlyArray<UpgradeId>, build: ReadonlyArray<UpgradeId>): number {
    const best = this.bestOffer(nextFight, offers, build, nextFight + FPS)
    return offers.indexOf(best)
  }

  private builds(level: number, build: ReadonlyArray<UpgradeId>, from: number, pickFirst: boolean): UpgradeId[][] {
    return this.options.growth ? this.growthPath(level, build, from, pickFirst) : this.flat(build)
  }

  levelEntryValue(level: number, build: ReadonlyArray<UpgradeId>): number {
    const key = `${level}|${buildKey(build)}`
    const hit = this.contCache.get(key)
    if (hit !== undefined) return hit
    const g = levelDef(level).targetGrowthPercent
    const b0 = 1 / (1 + g / 100)
    const V = this.suffix(level, 0, this.builds(level, build, 0, true), leaveKeep())
    const c = this.interp(V, b0) / b0
    this.contCache.set(key, c)
    return c
  }

  private rollSamples(view: FightView, build: ReadonlyArray<UpgradeId>): Float64Array[] {
    const e = view.enemy
    const key = [
      isBossFight(view.index) ? 'B' : 'N',
      stageOfFight(view.index),
      e.trait,
      e.bonus,
      view.enemyHp,
      e.maxHp,
      view.playerHp,
      view.shieldsLeft,
      view.rerollsLeft,
      view.hitsLanded,
      buildKey(build),
    ].join('|')
    const hit = this.rollCache.get(key)
    if (hit) return hit
    const n = this.options.sizes.rollN
    const mods: FightMods = { ...this.mods(build), enemyHpCutPercent: 0 }
    const h = hashString(key)
    const out = CONTINUATIONS.map((walk) => {
      const arr = new Float64Array(n)
      for (let i = 0; i < n; i++) {
        const f = createSimFight(deriveSeed(h, 'smart-rollout', i), view.index, BIG, mods, e)
        f.enemyHp = view.enemyHp
        f.playerHp = view.playerHp
        f.shieldsLeft = view.shieldsLeft
        f.rerollsLeft = view.rerollsLeft
        f.hitsLanded = view.hitsLanded
        rollExchange(f)
        arr[i] = finishWith(f, walk)
      }
      return arr
    })
    this.rollCache.set(key, out)
    return out
  }

  mcWalk(view: FightView, build: ReadonlyArray<UpgradeId>, walkRatio: number): boolean {
    return walkRatio > Math.max(...this.rollSamples(view, build).map(meanOf))
  }

  playRun(seed: number, buyIn = 100, maxFights = 400): RunStats {
    const game = createGame(seed, buyIn)
    const build: UpgradeId[] = []
    const perFight: FightLog[] = []
    let cont = 1
    let contLevel = -1
    let nextValue: (coins: number) => number = (c) => c
    for (let guard = 0; guard < 100000; guard++) {
      const st = game.state
      if (st.phase === 'gameover' || st.fightsCompleted >= maxFights) break
      if (st.phase === 'bet') {
        const k = st.fightsCompleted
        const j = k % FPS
        const level = st.level
        const B = st.bankroll
        const T = st.target
        if (contLevel !== level) {
          cont = Math.max(leaveKeep(), this.levelEntryValue(level + 1, build))
          contLevel = level
        }
        if (j === FPS - 1) {
          const c = cont
          nextValue = (coins) => (coins >= T ? coins * c : Math.floor(coins * feeKeep()))
        } else {
          const V = this.suffix(level, j + 1, this.builds(level, build, j, false), cont)
          nextValue = (coins) => this.interp(V, coins / T) * T
        }
        const d = this.slotDist(k, build)
        const cands = new Set<number>()
        const step = Math.max(1, Math.floor(B / this.options.sizes.betSteps))
        for (let x = st.minBet; x <= st.maxBet; x += step) cands.add(x)
        cands.add(st.maxBet)
        if (B < T) {
          const x0 = Math.ceil((T - B) / (d.koRatio - 1))
          for (let dx = -3; dx <= 3; dx++) cands.add(Math.min(st.maxBet, Math.max(st.minBet, x0 + dx)))
        }
        let best = st.minBet
        let bestE = Number.NEGATIVE_INFINITY
        for (const x of cands) {
          let e = 0
          for (let i = 0; i < d.v.length; i++) e += (d.p[i] as number) * nextValue(B - x + Math.floor(x * (d.v[i] as number)))
          if (e > bestE + 1e-9) {
            bestE = e
            best = x
          }
        }
        game.dispatch({ type: 'bet', amount: best })
      } else if (st.phase === 'fight') {
        const f = st.fight as NonNullable<GameState['fight']>
        let walk = false
        if (f.canWalkAway) {
          const B = st.bankroll
          let eRoll = Number.NEGATIVE_INFINITY
          for (const s of this.rollSamples(viewOfState(st), build)) {
            let e = 0
            for (let i = 0; i < s.length; i++) e += nextValue(B + Math.floor(f.bet * (s[i] as number)))
            eRoll = Math.max(eRoll, e / s.length)
          }
          walk = nextValue(B + f.walkAwayPayout) > eRoll
        }
        game.dispatch({ type: walk ? 'walkAway' : 'roll' })
      } else if (st.phase === 'result') {
        const r = st.lastResult
        if (r) {
          perFight.push({ index: st.fightsCompleted - 1, isBoss: r.isBoss, bet: r.bet, payout: r.payout, rolls: r.rolls, outcome: r.outcome })
        }
        game.dispatch({ type: 'continue' })
      } else if (st.phase === 'checkpoint') {
        const go = this.levelEntryValue(st.level, build) > leaveKeep()
        game.dispatch({ type: go ? 'continue' : 'leave' })
      } else if (st.phase === 'shop') {
        if (st.shopOffers.length === 0) game.dispatch({ type: 'skip' })
        else {
          const idx = this.shopPick(st.fightsCompleted, st.shopOffers.map((o) => o.id), build)
          build.push((st.shopOffers[idx] as { id: UpgradeId }).id)
          game.dispatch({ type: 'pickUpgrade', index: idx })
        }
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

  slotReturns(levels: number, samples: number, base = 0, smartShop = true, mcWalk = true): number[] {
    const n = levels * FPS
    const pay = new Array<number>(n).fill(0)
    for (let s = 1; s <= samples; s++) {
      const seed = (base + s * 104729 + 7) >>> 0
      const owned: UpgradeId[] = []
      for (let k = 0; k < n; k++) {
        const f = createSimFight(seed, k, BIG, this.mods(owned), generateEnemy(seed, k))
        while (f.status === 'active') {
          let walk = false
          if (canWalkAway(f)) walk = mcWalk ? this.mcWalk(viewOfSim(f), owned, currentWalkAwayPayout(f) / BIG) : aboutToLose(f)
          if (walk) f.status = 'walkedAway'
          else rollExchange(f)
        }
        pay[k] = (pay[k] as number) + fightPayout(f) / BIG
        const offers = shopOffersForFight(seed, k, owned)
        if (offers.length > 0) {
          const idx = smartShop ? this.shopPick(k + 1, offers, owned) : pickIndex(offers.map((id) => ({ ...getUpgrade(id), owned: 0 })))
          owned.push(offers[idx] as UpgradeId)
        }
      }
    }
    return pay.map((p) => p / samples)
  }
}
