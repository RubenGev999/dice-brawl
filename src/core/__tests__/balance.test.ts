import { describe, expect, it } from 'vitest'
import { CONFIG, UPGRADE_IDS, createStream, levelInfo } from '../index.ts'
import type { UpgradeId } from '../index.ts'
import { SENSIBLE, priorityBuild, simFight } from './bots.ts'
import type { WalkRule } from './bots.ts'
import { BLOCKS, LEVELS, MIN_LEVEL_FIGHTS, fmt, levelCurve, markdownRows, pause, reportsFor } from './report.ts'
import type { RunReport } from './report.ts'

const FULL = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.BALANCE_FULL
const RUNS = 1500
const SENSIBLE_RUNS = 4000
const FULL_RUNS = 5000
const BUY_INS = [100, 1000]
const LOW_RISK = ['coasting', 'minSkipFail', 'minSkipWalk', 'fixed10']
const CASUAL = ['sensible', 'fixedMedium']
const LEAVERS = ['leave1', 'leave2', 'leave3', 'minBossMaxLeave1', 'firstAllInLeave1']
const WALK_FAMILY = ['sensible', 'sensibleNoWalk', 'lowHpWalk', 'aboutToLose', 'bossEmergency', 'timid']
const LEVEL_SAMPLES = 12000
const GAIN_SAMPLES = 20000

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
    'level curve for the priority build: return per fight stays below 1.0 and never beats level 1 by much; max win grows',
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
        expect(best[i]).toBeLessThanOrEqual((best[0] as number) + 0.03)
      }
      expect(best[0]).toBeGreaterThanOrEqual(0.88)
      expect(best[1]).toBeLessThanOrEqual(best[0] as number)
      expect(best[2]).toBeLessThanOrEqual(best[1] as number)
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
        expect(s.clear[0]).toBeGreaterThanOrEqual(0.55)
        expect(s.clear[0]).toBeLessThanOrEqual(0.75)
        expect(s.clear[2]).toBeGreaterThanOrEqual(0.15)
        expect(s.clear[2]).toBeLessThanOrEqual(0.4)
        expect(s.median).toBeGreaterThanOrEqual(8)
        expect(s.median).toBeLessThanOrEqual(20)
        for (const r of all) {
          expect(r.over60).toBeLessThan(0.02)
          expect(r.cashMean).toBeLessThan(1.0)
        }
        const best = Math.max(...all.map((r) => r.cashMean))
        expect(best).toBeLessThanOrEqual(0.95)
        for (const n of CASUAL) {
          expect(get(n, buyIn).cashMean).toBeGreaterThanOrEqual(0.5)
          expect(get(n, buyIn).cashMean).toBeLessThanOrEqual(0.8)
        }
        const lowRisk = Math.max(...LOW_RISK.map((n) => get(n, buyIn).cashMean))
        expect(lowRisk).toBeLessThan(0.9)
        const stayers = all.filter((r) => !LEAVERS.includes(r.bot)).map((r) => r.cashMean)
        expect(get('leave1', buyIn).cashMean).toBeLessThanOrEqual(Math.max(...stayers) + 0.05)

        const valid = s.levelReturn.filter((_, i) => (s.levelFights[i] as number) >= MIN_LEVEL_FIGHTS)
        expect(valid.length).toBeGreaterThanOrEqual(3)
        for (let i = 0; i < valid.length; i++) {
          expect(valid[i]).toBeLessThan(1.0)
          if (i > 0) expect(valid[i]).toBeLessThanOrEqual((valid[i - 1] as number) + 0.01)
        }

        expect(get('lowHpWalk', buyIn).cashMean).toBeGreaterThan(get('sensibleNoWalk', buyIn).cashMean)
        const timid = get('timid', buyIn)
        for (const r of all) if (r.bot !== 'timid') expect(timid.paidOverWagered).toBeLessThan(r.paidOverWagered)
        for (const n of WALK_FAMILY) if (n !== 'timid') expect(timid.cashMean).toBeLessThan(get(n, buyIn).cashMean - 0.1)
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
