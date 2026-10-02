import { describe, expect, it } from 'vitest'
import { CONFIG } from '../index.ts'
import { BOTS, playRun } from './bots.ts'
import type { BotSpec } from './bots.ts'
import { BLOCKS, fmt, markdownRows, pause, runReport } from './report.ts'
import type { RunReport } from './report.ts'
import { SMART_FULL, SMART_SIZES, SmartBot } from './smartBot.ts'

export const SMART_RUNS = SMART_FULL ? 3000 : 1000
export const SMART_SLOT_SAMPLES = SMART_FULL ? 2000 : 200
export const SMART_SLOT_LEVELS = SMART_FULL ? 5 : 3
export const SMART_LIMIT = 0.98
export const SMART_TIMEOUT = SMART_FULL ? 4 * 3600000 : 600000
const COMPARE = ['leave1', 'firstAllInLeave1', 'coasting', 'sensible']

export function smartSuite(block: string, withSlotTable: boolean): void {
  describe(`smart bot, seed block ${block}`, () => {
    const bot = new SmartBot()
    for (const buyIn of [100, 1000]) {
      it(
        `${SMART_RUNS} smart runs at buy-in ${buyIn} cash out less than ${SMART_LIMIT} of the buy-in on average`,
        async () => {
          const base = BLOCKS[block] as number
          const r: RunReport = await runReport('smart', (seed, b) => bot.playRun(seed, b), buyIn, SMART_RUNS, base)
          const reports = new Map<string, RunReport>([['smart', r]])
          for (const name of COMPARE) {
            const spec = BOTS[name] as BotSpec
            reports.set(name, await runReport(name, (seed, b) => playRun(seed, spec, b), buyIn, SMART_RUNS, base))
          }
          console.log(`smart bot sizes ${JSON.stringify(SMART_SIZES)}`)
          console.log(markdownRows(`Smart bot, block ${block}, buy-in ${buyIn}, ${SMART_RUNS} runs`, reports))
          expect(r.cashMean).toBeLessThan(SMART_LIMIT)
          expect(r.over60).toBeLessThan(0.02)
          expect(r.cashMean).toBeGreaterThan((reports.get('leave1') as RunReport).cashMean)
        },
        SMART_TIMEOUT,
      )
    }
    if (withSlotTable) {
      it(
        `prints the per-slot fixed-bet return table (smart shop + Monte Carlo walking, ${SMART_SLOT_SAMPLES} samples per slot)`,
        async () => {
          await pause()
          const r = bot.slotReturns(SMART_SLOT_LEVELS, SMART_SLOT_SAMPLES, BLOCKS[block] as number)
          const n = CONFIG.fightsPerStage
          const rows = ['| Level | Slot 1 | Slot 2 | Slot 3 | Slot 4 | Boss | Mean |', '|---|---|---|---|---|---|---|']
          for (let l = 0; l < SMART_SLOT_LEVELS; l++) {
            const row = r.slice(l * n, l * n + n)
            rows.push(`| ${l + 1} | ${row.map(fmt).join(' | ')} | ${fmt(row.reduce((a, b) => a + b, 0) / n)} |`)
          }
          console.log(`per-slot fixed-bet return, block ${block}, ${SMART_SLOT_SAMPLES} samples per slot (SE about ${fmt(0.8 / Math.sqrt(SMART_SLOT_SAMPLES))})`)
          console.log(rows.join('\n'))
          const first3 = r.slice(0, 3 * n)
          expect(first3.reduce((a, b) => a + b, 0) / first3.length).toBeLessThan(1.0)
          for (let l = 0; l < SMART_SLOT_LEVELS; l++) {
            const row = r.slice(l * n, l * n + n)
            expect(row.reduce((a, b) => a + b, 0) / n).toBeLessThan(1.05)
          }
        },
        SMART_TIMEOUT,
      )
    }
  })
}
