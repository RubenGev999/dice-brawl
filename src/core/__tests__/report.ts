import { CONFIG } from '../index.ts'
import { BOTS, playRun } from './bots.ts'
import type { BotSpec, RunStats } from './bots.ts'

export const LEVELS = 8
export const MIN_LEVEL_FIGHTS = 2000
export const BLOCKS: Record<string, number> = { A: 0, B: 50_000_000 }

export type RunFn = (seed: number, buyIn: number) => RunStats

export function blockSeed(base: number, i: number): number {
  return base + i * 7919 + 13
}

export function trimmedMean(sorted: number[], keepPercent: number): number {
  const n = Math.max(1, Math.floor((sorted.length * keepPercent) / 100))
  let t = 0
  for (let i = 0; i < n; i++) t += sorted[i] as number
  return t / n
}

export function pause(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

export function percentile(sorted: number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))
  return sorted[i] as number
}

export function fmt(n: number): string {
  return Number.isFinite(n) ? n.toFixed(3) : '-'
}

export interface RunReport {
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
  cashTrim: number
  aboveBuyIn: number
  paidOverWagered: number
  walkShare: number
  brokeShare: number
  checkpointShare: number
}

export async function runReport(name: string, play: RunFn, buyIn: number, runs: number, base: number): Promise<RunReport> {
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
    if (i % 50 === 0) await pause()
    const r = play(blockSeed(base, i), buyIn)
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
    bot: name,
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
    cashTrim: trimmedMean(cash, 99),
    aboveBuyIn: above / runs,
    paidOverWagered: paid / Math.max(1, wagered),
    walkShare: walks / Math.max(1, total),
    brokeShare: broke / runs,
    checkpointShare: failed / runs,
  }
}

export async function reportsFor(buyIn: number, base: number, runs: (bot: BotSpec) => number): Promise<Map<string, RunReport>> {
  const out = new Map<string, RunReport>()
  for (const b of Object.values(BOTS)) {
    out.set(b.name, await runReport(b.name, (seed, bi) => playRun(seed, b, bi), buyIn, runs(b), base))
  }
  return out
}

export function markdownRows(label: string, reports: Map<string, RunReport>): string {
  const head = '| Bot | Runs | Cash mean | SE | Trimmed 99% | Cash median | P/W | L1 | L2 | L3 | L4 | L5 | Median fights | P95 | >60 | Walk share | Broke | Failed CP | Runs > buy-in |'
  const sep = '|' + '---|'.repeat(19)
  const rows = [...reports.values()].map((r) =>
    [
      r.bot,
      r.runs,
      fmt(r.cashMean),
      fmt(r.cashSe),
      fmt(r.cashTrim),
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

export function levelCurve(r: RunReport): string {
  return r.levelReturn.map((v, i) => ((r.levelFights[i] as number) >= MIN_LEVEL_FIGHTS ? v.toFixed(3) : '-')).join(' ')
}

