import { describe, expect, it } from 'vitest'
import { CONFIG, UPGRADE_IDS, createStream } from '../index.ts'
import type { UpgradeId } from '../index.ts'
import { BOTS, SENSIBLE, playRun, simFight } from './bots.ts'
import type { BotSpec } from './bots.ts'

const RUNS = 2000
const SENSIBLE_RUNS = 4000
const BUY_INS = [100, 1000]
const LOW_RISK = ['coasting', 'minSkipFail', 'minSkipWalk', 'fixed10']
const GAIN_SAMPLES = 6000
const STAGES = 8
const MIN_STAGE_FIGHTS = 500

function percentile(sorted: number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))
  return sorted[i] as number
}

function fmt(n: number): string {
  return n.toFixed(3)
}

interface RunReport {
  bot: string
  buyIn: number
  runs: number
  clear: number[]
  median: number
  p95: number
  over60: number
  rollsNormal: number
  rollsBoss: number
  stageAll: number[]
  stageNormal: number[]
  stageBoss: number[]
  stageFights: number[]
  cashMean: number
  cashMedian: number
  aboveBuyIn: number
  paidOverWagered: number
  walkShare: number
  brokeShare: number
  pawnShare: number
  checkpointShare: number
}

function runReport(bot: BotSpec, buyIn = 100, runs = RUNS): RunReport {
  const lengths: number[] = []
  const cash: number[] = []
  const cleared = new Array<number>(6).fill(0)
  const zero = () => new Array<number>(STAGES).fill(0)
  const bAll = zero()
  const pAll = zero()
  const bN = zero()
  const pN = zero()
  const bB = zero()
  const pB = zero()
  const fights = zero()
  let wagered = 0
  let paid = 0
  let rollsN = 0
  let nN = 0
  let rollsB = 0
  let nB = 0
  let walks = 0
  let above = 0
  let broke = 0
  let pawned = 0
  let failed = 0
  for (let i = 1; i <= runs; i++) {
    const r = playRun(i * 7919 + 13, bot, buyIn)
    for (const f of r.perFight) {
      const st = Math.floor(f.index / CONFIG.fightsPerStage)
      wagered += f.bet
      paid += f.payout
      if (f.outcome === 'walkedAway') walks++
      if (f.isBoss) {
        rollsB += f.rolls
        nB++
      } else {
        rollsN += f.rolls
        nN++
      }
      if (st >= STAGES) continue
      bAll[st] = (bAll[st] as number) + f.bet
      pAll[st] = (pAll[st] as number) + f.payout
      fights[st] = (fights[st] as number) + 1
      if (f.isBoss) {
        bB[st] = (bB[st] as number) + f.bet
        pB[st] = (pB[st] as number) + f.payout
      } else {
        bN[st] = (bN[st] as number) + f.bet
        pN[st] = (pN[st] as number) + f.payout
      }
    }
    if (r.reason === 'broke') broke++
    if (r.reason === 'checkpoint') failed++
    if (r.game.log.some((e) => e.action.type === 'pawn')) pawned++
    lengths.push(r.fights)
    for (let k = 0; k < cleared.length; k++) if (r.stagesCleared >= k + 1) cleared[k] = (cleared[k] as number) + 1
    cash.push(r.cashOut / buyIn)
    if (r.cashOut > buyIn) above++
  }
  lengths.sort((a, b) => a - b)
  cash.sort((a, b) => a - b)
  const ratio = (p: number[], b: number[]) => b.map((x, i) => (x > 0 ? (p[i] as number) / x : Number.NaN))
  return {
    bot: bot.name,
    buyIn,
    runs,
    clear: cleared.map((c) => c / runs),
    median: percentile(lengths, 50),
    p95: percentile(lengths, 95),
    over60: lengths.filter((l) => l > 60).length / runs,
    rollsNormal: rollsN / Math.max(1, nN),
    rollsBoss: rollsB / Math.max(1, nB),
    stageAll: ratio(pAll, bAll),
    stageNormal: ratio(pN, bN),
    stageBoss: ratio(pB, bB),
    stageFights: fights,
    cashMean: cash.reduce((a, b) => a + b, 0) / runs,
    cashMedian: percentile(cash, 50),
    aboveBuyIn: above / runs,
    paidOverWagered: paid / Math.max(1, wagered),
    walkShare: walks / Math.max(1, nN + nB),
    brokeShare: broke / runs,
    pawnShare: pawned / runs,
    checkpointShare: failed / runs,
  }
}

function stageRow(values: number[], fights: number[]): string {
  return values.map((v, i) => ((fights[i] as number) >= MIN_STAGE_FIGHTS ? v.toFixed(2) : '-')).join(' ')
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
    const r = simFight(s * 104729 + 7, index, build(s))
    bet += r.bet
    pay += r.payout
  }
  return pay / bet
}

function copyGains(stage: number): Record<string, number[]> {
  const baseSize = (stage - 1) * 4
  const base = (seed: number) => randomBuild(seed, baseSize)
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
  }
  return out
}

function tableRow(r: RunReport): Record<string, string | number> {
  return {
    'P/W': fmt(r.paidOverWagered),
    S1: fmt(r.clear[0] as number),
    S2: fmt(r.clear[1] as number),
    S3: fmt(r.clear[2] as number),
    S4: fmt(r.clear[3] as number),
    S5: fmt(r.clear[4] as number),
    median: r.median,
    p95: r.p95,
    '>60': fmt(r.over60),
    rolls: `${r.rollsNormal.toFixed(2)}/${r.rollsBoss.toFixed(2)}`,
    walks: fmt(r.walkShare),
    cashMean: fmt(r.cashMean),
    cashMedian: fmt(r.cashMedian),
    '>buyIn': fmt(r.aboveBuyIn),
    failedCp: fmt(r.checkpointShare),
    broke: fmt(r.brokeShare),
    pawned: fmt(r.pawnShare),
  }
}

describe('balance simulation', () => {
  it(
    'plays full seeded runs per bot and lands the balance targets',
    () => {
      const byBuyIn = new Map<number, Map<string, RunReport>>()
      for (const buyIn of BUY_INS) {
        const reports = Object.values(BOTS).map((b) => runReport(b, buyIn, b.name === 'sensible' ? SENSIBLE_RUNS : RUNS))
        byBuyIn.set(buyIn, new Map(reports.map((r) => [r.bot, r])))
        const runTable: Record<string, Record<string, string | number>> = {}
        for (const r of reports) runTable[`${r.bot} (${r.runs})`] = tableRow(r)
        console.log(`full runs at buy-in ${buyIn}: return (paid/wagered), stage clear rates, run length, rolls normal/boss, house return (cashOut/buyIn), end reasons`)
        console.table(runTable)
      }
      const at = (buyIn: number): Map<string, RunReport> => byBuyIn.get(buyIn) as Map<string, RunReport>
      const get = (name: string, buyIn = 100): RunReport => at(buyIn).get(name) as RunReport
      const sensible = get('sensible')
      const allReports = BUY_INS.flatMap((b) => [...at(b).values()])

      const curve: Record<string, string> = {
        all: stageRow(sensible.stageAll, sensible.stageFights),
        normal: stageRow(sensible.stageNormal, sensible.stageFights),
        boss: stageRow(sensible.stageBoss, sensible.stageFights),
        fights: sensible.stageFights.join(' '),
      }
      console.log('sensible return per fight by stage (stages with fewer than 500 fights shown as -)')
      console.table(curve)

      const sweep: Record<string, string> = {}
      for (const pct of [0, 10, 25, 50, 100]) {
        const r = runReport({ ...SENSIBLE, name: `fixed ${pct}%`, style: 'fixed', betPercent: pct }, 100, 1000)
        sweep[r.bot] = `S1 ${fmt(r.clear[0] as number)} S3 ${fmt(r.clear[2] as number)} cash ${fmt(r.cashMean)}`
      }
      sweep['target-aware (sensible)'] =
        `S1 ${fmt(sensible.clear[0] as number)} S3 ${fmt(sensible.clear[2] as number)} cash ${fmt(sensible.cashMean)}`
      console.log('bet-size sweep (fixed share of bankroll every fight, 1000 runs each)')
      console.table(sweep)

      const invariance: Record<string, Record<string, string>> = {}
      for (const name of ['sensible', 'coasting', 'leave1', 'minSkipFail', 'minBossMaxLeave1', 'firstAllInLeave1']) {
        const row: Record<string, string> = {}
        for (const buyIn of BUY_INS) {
          const r = get(name, buyIn)
          row[`buy-in ${buyIn}`] = `S1 ${fmt(r.clear[0] as number)} S3 ${fmt(r.clear[2] as number)} cash ${fmt(r.cashMean)}`
        }
        invariance[name] = row
      }
      console.log('buy-in invariance')
      console.table(invariance)

      const gainTable: Record<string, Record<string, string>> = {}
      const gains1 = copyGains(1)
      const gains2 = copyGains(2)
      for (const id of UPGRADE_IDS) {
        gainTable[id] = {
          cap: String(CONFIG.upgradeMaxCopies[id]),
          'stage 1': (gains1[id] as number[]).map((g) => `+${fmt(g)}`).join(' / '),
          'stage 2': (gains2[id] as number[]).map((g) => `+${fmt(g)}`).join(' / '),
        }
      }
      console.log('per-copy upgrade gain in return per fight (copy n given n-1 copies; stage 2 on a random 4-upgrade base)')
      console.table(gainTable)

      expect(sensible.clear[0]).toBeGreaterThanOrEqual(0.58)
      expect(sensible.clear[0]).toBeLessThanOrEqual(0.78)
      expect(sensible.clear[2]).toBeGreaterThanOrEqual(0.22)
      expect(sensible.clear[2]).toBeLessThanOrEqual(0.42)
      expect(sensible.clear[4]).toBeGreaterThanOrEqual(0.06)
      expect(sensible.clear[4]).toBeLessThanOrEqual(0.2)
      expect(sensible.median).toBeGreaterThanOrEqual(8)
      expect(sensible.median).toBeLessThanOrEqual(20)
      for (const r of allReports) expect(r.over60).toBeLessThan(0.02)

      expect(sensible.rollsNormal).toBeGreaterThanOrEqual(3)
      expect(sensible.rollsNormal).toBeLessThanOrEqual(6)
      expect(sensible.rollsBoss).toBeGreaterThanOrEqual(5)
      expect(sensible.rollsBoss).toBeLessThanOrEqual(9)
      expect(sensible.rollsBoss).toBeGreaterThan(sensible.rollsNormal)

      const valid = sensible.stageAll.filter((_, i) => (sensible.stageFights[i] as number) >= MIN_STAGE_FIGHTS)
      expect(valid.length).toBeGreaterThanOrEqual(5)
      expect(valid[0]).toBeGreaterThanOrEqual(0.9)
      expect(valid[0]).toBeLessThan(1.0)
      for (let i = 1; i < valid.length; i++) {
        expect(Math.abs((valid[i] as number) - (valid[i - 1] as number))).toBeLessThanOrEqual(0.12)
        expect(valid[i]).toBeLessThanOrEqual((valid[i - 1] as number) + 0.03)
      }
      expect(valid[4]).toBeLessThan((valid[0] as number) - 0.03)

      for (const name of ['timid', 'coasting', 'allIn']) expect(get(name).clear[0]).toBeLessThan(0.25)
      for (const name of ['fixedMedium', 'coasting', 'allIn', 'timid']) {
        expect(sensible.clear[0]).toBeGreaterThan(get(name).clear[0] as number)
      }
      expect(get('timid').paidOverWagered).toBeLessThan(0.5)
      expect(get('timid').cashMean).toBeLessThan(sensible.cashMean)

      for (const r of allReports) expect(r.cashMean).toBeLessThan(1.0)
      for (const buyIn of BUY_INS) {
        const best = Math.max(...[...at(buyIn).values()].map((r) => r.cashMean))
        expect(best).toBeGreaterThanOrEqual(0.9)
        expect(best).toBeLessThanOrEqual(0.97)
        const lowRisk = Math.max(...LOW_RISK.map((n) => get(n, buyIn).cashMean))
        expect(lowRisk).toBeLessThan(0.9)
        expect(lowRisk - get('sensible', buyIn).cashMean).toBeLessThan(0.18)
        expect(get('leave1', buyIn).cashMean).toBeGreaterThan(lowRisk)
      }

      expect(get('allIn').brokeShare).toBeGreaterThan(0.2)
      expect(get('allIn').pawnShare).toBeGreaterThan(0.2)
      expect(get('allIn').cashMean).toBeLessThan(0.05)

      const s100 = get('sensible', 100)
      const s1000 = get('sensible', 1000)
      expect(Math.abs((s100.clear[0] as number) - (s1000.clear[0] as number))).toBeLessThanOrEqual(0.07)
      expect(Math.abs(s100.cashMean - s1000.cashMean)).toBeLessThanOrEqual(0.05)

      for (const id of UPGRADE_IDS) {
        for (const g of gains1[id] as number[]) {
          expect(g).toBeGreaterThanOrEqual(0.06)
          expect(g).toBeLessThanOrEqual(0.18)
        }
        for (const g of gains2[id] as number[]) {
          expect(g).toBeGreaterThanOrEqual(0.03)
          expect(g).toBeLessThanOrEqual(0.18)
        }
      }
    },
    600000,
  )
})
