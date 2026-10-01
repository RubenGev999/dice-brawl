import { describe, expect, it } from 'vitest'
import { CONFIG, UPGRADE_IDS, createStream, levelInfo } from '../index.ts'
import type { UpgradeId } from '../index.ts'
import { BOTS, SENSIBLE, playRun, priorityBuild, simFight } from './bots.ts'
import type { BotSpec, WalkRule } from './bots.ts'

const FULL = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.BALANCE_FULL
const RUNS = 1500
const SENSIBLE_RUNS = 4000
const FULL_RUNS = 5000
const BUY_INS = [100, 1000]
const BLOCKS: Record<string, number> = { A: 0, B: 50_000_000 }
const LOW_RISK = ['coasting', 'minSkipFail', 'minSkipWalk', 'fixed10']
const WALK_FAMILY = ['sensible', 'sensibleNoWalk', 'lowHpWalk', 'aboutToLose', 'bossEmergency', 'timid']
const LEVEL_SAMPLES = 12000
const GAIN_SAMPLES = 20000
const LEVELS = 8
const MIN_LEVEL_FIGHTS = 2000

function pause(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function percentile(sorted: number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))
  return sorted[i] as number
}

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toFixed(3) : '-'
}

interface RunReport {
  bot: string
  buyIn: number
  runs: number
  clear: number[]
  median: number
  p95: number
  over60: number
  levelReturn: number[]
  levelFights: number[]
  cashMean: number
  cashSe: number
  cashMedian: number
  aboveBuyIn: number
  paidOverWagered: number
  walkShare: number
  brokeShare: number
  checkpointShare: number
}

function runReport(bot: BotSpec, buyIn: number, runs: number, base: number): RunReport {
  const lengths: number[] = []
  const cash: number[] = []
  const cleared = new Array<number>(6).fill(0)
  const bet = new Array<number>(LEVELS).fill(0)
  const pay = new Array<number>(LEVELS).fill(0)
  const fights = new Array<number>(LEVELS).fill(0)
  let wagered = 0
  let paid = 0
  let walks = 0
  let total = 0
  let above = 0
  let broke = 0
  let failed = 0
  for (let i = 1; i <= runs; i++) {
    const r = playRun(base + i * 7919 + 13, bot, buyIn)
    for (const f of r.perFight) {
      const l = Math.floor(f.index / CONFIG.fightsPerStage)
      wagered += f.bet
      paid += f.payout
      total++
      if (f.outcome === 'walkedAway') walks++
      if (l >= LEVELS) continue
      bet[l] = (bet[l] as number) + f.bet
      pay[l] = (pay[l] as number) + f.payout
      fights[l] = (fights[l] as number) + 1
    }
    if (r.reason === 'broke') broke++
    if (r.reason === 'checkpoint') failed++
    lengths.push(r.fights)
    for (let k = 0; k < cleared.length; k++) if (r.stagesCleared >= k + 1) cleared[k] = (cleared[k] as number) + 1
    cash.push(r.cashOut / buyIn)
    if (r.cashOut > buyIn) above++
  }
  lengths.sort((a, b) => a - b)
  const mean = cash.reduce((a, b) => a + b, 0) / runs
  const variance = cash.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, runs - 1)
  cash.sort((a, b) => a - b)
  return {
    bot: bot.name,
    buyIn,
    runs,
    clear: cleared.map((c) => c / runs),
    median: percentile(lengths, 50),
    p95: percentile(lengths, 95),
    over60: lengths.filter((l) => l > 60).length / runs,
    levelReturn: bet.map((b, i) => (b > 0 ? (pay[i] as number) / b : Number.NaN)),
    levelFights: fights,
    cashMean: mean,
    cashSe: Math.sqrt(variance / runs),
    cashMedian: percentile(cash, 50),
    aboveBuyIn: above / runs,
    paidOverWagered: paid / Math.max(1, wagered),
    walkShare: walks / Math.max(1, total),
    brokeShare: broke / runs,
    checkpointShare: failed / runs,
  }
}

async function reportsFor(buyIn: number, base: number, runs: (bot: BotSpec) => number): Promise<Map<string, RunReport>> {
  const out = new Map<string, RunReport>()
  for (const b of Object.values(BOTS)) {
    out.set(b.name, runReport(b, buyIn, runs(b), base))
    await pause()
  }
  return out
}

function markdownRows(label: string, reports: Map<string, RunReport>): string {
  const head = '| Bot | Runs | Cash mean | SE | Cash median | P/W | L1 | L2 | L3 | L4 | L5 | Median fights | P95 | >60 | Walk share | Broke | Failed CP | Runs > buy-in |'
  const sep = '|' + '---|'.repeat(18)
  const rows = [...reports.values()].map((r) =>
    [
      r.bot,
      r.runs,
      fmt(r.cashMean),
      fmt(r.cashSe),
      fmt(r.cashMedian),
      fmt(r.paidOverWagered),
      ...r.clear.slice(0, 5).map(fmt),
      r.median,
      r.p95,
      fmt(r.over60),
      fmt(r.walkShare),
      fmt(r.brokeShare),
      fmt(r.checkpointShare),
      fmt(r.aboveBuyIn),
    ].join(' | '),
  )
  return [`### ${label}`, '', head, sep, ...rows.map((r) => `| ${r} |`)].join('\n')
}

function levelCurve(r: RunReport): string {
  return r.levelReturn.map((v, i) => ((r.levelFights[i] as number) >= MIN_LEVEL_FIGHTS ? v.toFixed(3) : '-')).join(' ')
}

const buildCache = new Map<string, UpgradeId[]>()
function cachedBuild(seed: number, size: number): UpgradeId[] {
  const key = `${seed}:${size}`
  let b = buildCache.get(key)
  if (!b) {
    b = priorityBuild(seed, size)
    buildCache.set(key, b)
  }
  return b
}

function levelReturn(level: number, walk: WalkRule, boss: boolean | null = null): number {
  let bet = 0
  let pay = 0
  for (let s = 1; s <= LEVEL_SAMPLES; s++) {
    const slot = boss === null ? s % CONFIG.fightsPerStage : boss ? CONFIG.fightsPerStage - 1 : s % (CONFIG.fightsPerStage - 1)
    const index = (level - 1) * CONFIG.fightsPerStage + slot
    const r = simFight(s * 104729 + 7, index, cachedBuild(s, index), walk)
    bet += r.bet
    pay += r.payout
  }
  return pay / bet
}

function randomBuild(seed: number, n: number): UpgradeId[] {
  const rng = createStream(seed, 'balance-build', n)
  const out: UpgradeId[] = []
  const counts = new Map<UpgradeId, number>()
  while (out.length < n) {
    const id = rng.pick(UPGRADE_IDS)
    const c = counts.get(id) ?? 0
    if (c < CONFIG.upgradeMaxCopies[id]) {
      counts.set(id, c + 1)
      out.push(id)
    }
  }
  return out
}

function stageReturn(stage: number, build: (seed: number) => UpgradeId[]): number {
  let bet = 0
  let pay = 0
  for (let s = 1; s <= GAIN_SAMPLES; s++) {
    const index = (stage - 1) * CONFIG.fightsPerStage + (s % CONFIG.fightsPerStage)
    const r = simFight(s * 104729 + 7, index, build(s), 'aboutToLose')
    bet += r.bet
    pay += r.payout
  }
  return pay / bet
}

async function copyGains(stage: number): Promise<Record<string, number[]>> {
  const base = (seed: number) => randomBuild(seed, (stage - 1) * 4)
  const out: Record<string, number[]> = {}
  for (const id of UPGRADE_IDS) {
    const gains: number[] = []
    const withCopies = (c: number) => (seed: number) => [
      ...base(seed).filter((x) => x !== id),
      ...Array.from({ length: c }, () => id),
    ]
    let prev = stageReturn(stage, withCopies(0))
    for (let c = 1; c <= CONFIG.upgradeMaxCopies[id]; c++) {
      const cur = stageReturn(stage, withCopies(c))
      gains.push(cur - prev)
      prev = cur
    }
    out[id] = gains
    await pause()
  }
  return out
}

const GAIN_FLOOR_EXCEPTIONS: Partial<Record<string, number>> = { vampire: 0.05 }

describe('balance simulation', () => {
  it(
    'level curve: return per fight declines smoothly and stays below 1.0; max win grows',
    async () => {
      const rows: string[] = [
        '| Level | Label | Enemy | Boss | Enemy HP | KO | Boss KO | Target | Best walker | Never walk | Walk first | Max win/fight | Max win/level |',
        '|' + '---|'.repeat(13),
      ]
      const best: number[] = []
      for (let level = 1; level <= LEVELS; level++) {
        const info = levelInfo(level)
        const about = levelReturn(level, 'aboutToLose')
        const low = levelReturn(level, 'lowHp')
        const never = levelReturn(level, 'never')
        const first = levelReturn(level, 'first')
        const b = Math.max(about, low, never)
        best.push(b)
        await pause()
        rows.push(
          `| ${level} | ${info.difficultyLabel} | ${info.enemyDiceText} | ${info.bossDiceText} | ${info.enemyHpMin}-${info.enemyHpMax} | ${info.koMultiplier}x | ${info.bossKoMultiplier}x | +${info.targetGrowthPercent}% | ${fmt(b)} | ${fmt(never)} | ${fmt(first)} | ${(info.bossKoMultiplierMilli + CONFIG.upgradeMaxCopies.finisher * CONFIG.upgradeEffects.finisherKoBonusMilli) / 1000}x | ${info.maxWinPerLevel.toFixed(2)}x |`,
        )
        expect(first).toBeLessThan(b - 0.25)
      }
      console.log('level table (return per fight, priority build of one upgrade per fight, best of never/lowHp/aboutToLose walk rules)')
      console.log(rows.join('\n'))
      for (let i = 0; i < best.length; i++) {
        expect(best[i]).toBeLessThan(1.0)
        if (i > 0) {
          expect(Math.abs((best[i] as number) - (best[i - 1] as number))).toBeLessThanOrEqual(0.12)
          expect(best[i]).toBeLessThanOrEqual((best[i - 1] as number) + 0.01)
        }
      }
      expect(best[0]).toBeGreaterThanOrEqual(0.9)
      expect(best[LEVELS - 1]).toBeLessThan((best[0] as number) - 0.04)
      for (let level = 2; level <= LEVELS; level++) {
        expect(levelInfo(level).maxWinPerLevel).toBeGreaterThan(levelInfo(level - 1).maxWinPerLevel)
        expect(levelInfo(level).bossKoMultiplierMilli).toBeGreaterThan(levelInfo(level - 1).bossKoMultiplierMilli)
      }
    },
    600000,
  )

  it(
    'per-copy upgrade gains at levels 1 and 2 sit in the +0.06 to +0.18 band (documented exceptions only)',
    async () => {
      const gains1 = await copyGains(1)
      const gains2 = await copyGains(2)
      const rows = ['| id | Cap | Level 1 gain per copy | Level 2 gain per copy |', '|---|---|---|---|']
      for (const id of UPGRADE_IDS) {
        rows.push(
          `| \`${id}\` | ${CONFIG.upgradeMaxCopies[id]} | ${(gains1[id] as number[]).map((g) => `+${fmt(g)}`).join(' / ')} | ${(gains2[id] as number[]).map((g) => `+${fmt(g)}`).join(' / ')} |`,
        )
      }
      console.log('per-copy upgrade gain in return per fight (copy n given n-1 copies; level 2 on a random 4-upgrade base)')
      console.log(rows.join('\n'))
      for (const id of UPGRADE_IDS) {
        for (const g of [...(gains1[id] as number[]), ...(gains2[id] as number[])]) {
          expect(g).toBeGreaterThanOrEqual(GAIN_FLOOR_EXCEPTIONS[id] ?? 0.06)
          expect(g).toBeLessThanOrEqual(0.18)
        }
      }
    },
    600000,
  )

  it(
    'full runs on seed block A land the balance targets at buy-in 100 and 1000',
    async () => {
      const byBuyIn = new Map<number, Map<string, RunReport>>()
      for (const buyIn of BUY_INS) {
        const reports = await reportsFor(buyIn, BLOCKS.A as number, (b) => (b.name === 'sensible' ? SENSIBLE_RUNS : RUNS))
        byBuyIn.set(buyIn, reports)
        console.log(markdownRows(`Block A (small), buy-in ${buyIn}`, reports))
      }
      const get = (name: string, buyIn = 100): RunReport => (byBuyIn.get(buyIn) as Map<string, RunReport>).get(name) as RunReport
      for (const buyIn of BUY_INS) {
        const s = get('sensible', buyIn)
        console.log(`sensible return per fight by level at buy-in ${buyIn} (levels with < ${MIN_LEVEL_FIGHTS} fights shown as -): ${levelCurve(s)}`)
      }

      for (const buyIn of BUY_INS) {
        const all = [...(byBuyIn.get(buyIn) as Map<string, RunReport>).values()]
        const s = get('sensible', buyIn)
        expect(s.clear[0]).toBeGreaterThanOrEqual(0.6)
        expect(s.clear[0]).toBeLessThanOrEqual(0.75)
        expect(s.clear[2]).toBeGreaterThanOrEqual(0.25)
        expect(s.clear[2]).toBeLessThanOrEqual(0.4)
        expect(s.clear[4]).toBeGreaterThanOrEqual(0.08)
        expect(s.clear[4]).toBeLessThanOrEqual(0.18)
        expect(s.median).toBeGreaterThanOrEqual(10)
        expect(s.median).toBeLessThanOrEqual(20)
        for (const r of all) {
          expect(r.over60).toBeLessThan(0.02)
          expect(r.cashMean).toBeLessThan(1.0)
        }
        const best = Math.max(...all.map((r) => r.cashMean))
        expect(best).toBeGreaterThanOrEqual(0.9)
        expect(best).toBeLessThanOrEqual(0.97)
        const lowRisk = Math.max(...LOW_RISK.map((n) => get(n, buyIn).cashMean))
        expect(lowRisk).toBeLessThan(0.9)
        expect(lowRisk).toBeLessThan(best)
        expect(get('leave1', buyIn).cashMean).toBeGreaterThan(lowRisk)

        const valid = s.levelReturn.filter((_, i) => (s.levelFights[i] as number) >= MIN_LEVEL_FIGHTS)
        expect(valid.length).toBeGreaterThanOrEqual(4)
        for (let i = 0; i < valid.length; i++) {
          expect(valid[i]).toBeLessThan(1.0)
          if (i > 0) expect(Math.abs((valid[i] as number) - (valid[i - 1] as number))).toBeLessThanOrEqual(0.12)
        }

        expect(get('lowHpWalk', buyIn).cashMean).toBeGreaterThan(get('sensibleNoWalk', buyIn).cashMean)
        const timid = get('timid', buyIn)
        for (const r of all) if (r.bot !== 'timid') expect(timid.paidOverWagered).toBeLessThan(r.paidOverWagered)
        for (const n of WALK_FAMILY) if (n !== 'timid') expect(timid.cashMean).toBeLessThan(get(n, buyIn).cashMean - 0.15)
        expect(get('allIn', buyIn).brokeShare).toBeGreaterThan(0.5)
      }
      const s100 = get('sensible', 100)
      const s1000 = get('sensible', 1000)
      expect(Math.abs((s100.clear[0] as number) - (s1000.clear[0] as number))).toBeLessThanOrEqual(0.07)
      expect(Math.abs(s100.cashMean - s1000.cashMean)).toBeLessThanOrEqual(0.05)
    },
    600000,
  )

  for (const block of ['A', 'B']) {
    for (const buyIn of BUY_INS) {
      it.skipIf(!FULL)(
        `large simulation: ${FULL_RUNS} runs per bot, seed block ${block}, buy-in ${buyIn} (BALANCE_FULL=1)`,
        async () => {
          const reports = await reportsFor(buyIn, BLOCKS[block] as number, () => FULL_RUNS)
          console.log(markdownRows(`Block ${block}, buy-in ${buyIn}, ${FULL_RUNS} runs per bot`, reports))
          console.log(`sensible return per fight by level, block ${block}, buy-in ${buyIn}: ${levelCurve(reports.get('sensible') as RunReport)}`)
          for (const r of reports.values()) {
            expect(r.cashMean).toBeLessThan(1.0)
            expect(r.over60).toBeLessThan(0.02)
          }
        },
        600000,
      )
    }
  }

  it('the sensible bot is the Medium preset with the about-to-lose exit', () => {
    expect(SENSIBLE.betPercent).toBe(CONFIG.betPresetPercents.medium)
    expect(SENSIBLE.walk).toBe('aboutToLose')
  })
})
