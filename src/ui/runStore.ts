import { CONFIG, createGame, hashString } from '../core/index.ts'
import type { Action, Game, LogEntry, Phase } from '../core/index.ts'
import type { StorageLike } from './wallet.ts'

export const RUN_KEY = 'diceBrawl.run.v1'
export const RUN_VERSION = 1
export const MAX_RESUME_TICKS = 20_000_000
export const MAX_LOG_ENTRIES = 20_000

export interface RunStorage extends StorageLike {
  removeItem?(key: string): void
}

export interface RunCheck {
  readonly phase: Phase
  readonly bankroll: number
  readonly fightsCompleted: number
  readonly stage: number
}

export interface RunRecord {
  readonly v: number
  readonly id: string
  readonly seed: number
  readonly buyIn: number
  readonly cfg: string
  readonly log: ReadonlyArray<LogEntry>
  readonly tick: number
  readonly check: RunCheck
}

export type LoadResult =
  | { readonly kind: 'none' }
  | { readonly kind: 'ok'; readonly record: RunRecord }
  | { readonly kind: 'corrupt'; readonly buyIn: number | null }

export function configFingerprint(): string {
  return hashString(JSON.stringify(CONFIG)).toString(36)
}

export function newRunId(nowMs: number, salt: number): string {
  return `${Math.floor(nowMs).toString(36)}-${(salt >>> 0).toString(36)}`
}

export function snapshotRecord(id: string, game: Game): RunRecord {
  const s = game.state
  return {
    v: RUN_VERSION,
    id,
    seed: s.seed,
    buyIn: s.buyIn,
    cfg: configFingerprint(),
    log: game.log.map((e) => ({ tick: e.tick, action: { ...e.action } })),
    tick: s.tick,
    check: { phase: s.phase, bankroll: s.bankroll, fightsCompleted: s.fightsCompleted, stage: s.stage },
  }
}

export function saveRun(storage: RunStorage | null, record: RunRecord): boolean {
  try {
    if (!storage) return false
    storage.setItem(RUN_KEY, JSON.stringify(record))
    return true
  } catch {
    return false
  }
}

export function clearRun(storage: RunStorage | null): boolean {
  try {
    if (!storage) return false
    if (typeof storage.removeItem === 'function') storage.removeItem(RUN_KEY)
    else storage.setItem(RUN_KEY, '')
    return true
  } catch {
    return false
  }
}

function isInt(n: unknown, min = 0): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= min
}

export function parseAction(raw: unknown): Action | null {
  if (typeof raw !== 'object' || raw === null) return null
  const a = raw as Record<string, unknown>
  switch (a.type) {
    case 'bet':
      return typeof a.amount === 'number' && Number.isFinite(a.amount) ? { type: 'bet', amount: a.amount } : null
    case 'pickUpgrade':
      return isInt(a.index) ? { type: 'pickUpgrade', index: a.index } : null
    case 'pawn':
      return isInt(a.index) ? { type: 'pawn', index: a.index } : null
    case 'roll':
    case 'walkAway':
    case 'continue':
    case 'leave':
    case 'skip':
      return { type: a.type }
    default:
      return null
  }
}

const PHASES: ReadonlyArray<string> = ['bet', 'fight', 'result', 'checkpoint', 'shop', 'gameover']

export function parseRecord(raw: unknown): RunRecord | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (r.v !== RUN_VERSION || typeof r.id !== 'string' || r.id === '' || typeof r.cfg !== 'string') return null
  if (!isInt(r.seed) || !isInt(r.buyIn, 1) || !isInt(r.tick)) return null
  if (!Array.isArray(r.log) || r.log.length > MAX_LOG_ENTRIES) return null
  const log: LogEntry[] = []
  let last = 0
  for (const e of r.log as unknown[]) {
    if (typeof e !== 'object' || e === null) return null
    const entry = e as Record<string, unknown>
    if (!isInt(entry.tick) || entry.tick < last || entry.tick > r.tick) return null
    const action = parseAction(entry.action)
    if (!action) return null
    last = entry.tick
    log.push({ tick: entry.tick, action })
  }
  const c = r.check as Record<string, unknown> | null | undefined
  if (typeof c !== 'object' || c === null) return null
  if (typeof c.phase !== 'string' || !PHASES.includes(c.phase)) return null
  if (!isInt(c.bankroll) || !isInt(c.fightsCompleted) || !isInt(c.stage, 1)) return null
  return {
    v: RUN_VERSION,
    id: r.id,
    seed: r.seed,
    buyIn: r.buyIn,
    cfg: r.cfg,
    log,
    tick: r.tick,
    check: { phase: c.phase as Phase, bankroll: c.bankroll, fightsCompleted: c.fightsCompleted, stage: c.stage },
  }
}

export function loadRun(storage: RunStorage | null): LoadResult {
  let raw: string | null
  try {
    raw = storage ? storage.getItem(RUN_KEY) : null
  } catch {
    return { kind: 'none' }
  }
  if (raw === null || raw === '') return { kind: 'none' }
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return { kind: 'corrupt', buyIn: null }
  }
  const record = parseRecord(data)
  if (record) return { kind: 'ok', record }
  const maybe = typeof data === 'object' && data !== null ? (data as Record<string, unknown>).buyIn : null
  return { kind: 'corrupt', buyIn: isInt(maybe, CONFIG.minBuyIn) ? maybe : null }
}

export function rebuildGame(record: RunRecord): Game | null {
  if (record.cfg !== configFingerprint()) return null
  if (record.tick > MAX_RESUME_TICKS) return null
  let game: Game
  try {
    game = createGame(record.seed, record.buyIn)
  } catch {
    return null
  }
  let now = 0
  try {
    for (const entry of record.log) {
      while (now < entry.tick) {
        game.tick()
        now += 1
      }
      if (!game.dispatch(entry.action)) return null
    }
    while (now < record.tick) {
      game.tick()
      now += 1
    }
  } catch {
    return null
  }
  const s = game.state
  const c = record.check
  if (s.phase !== c.phase || s.bankroll !== c.bankroll || s.fightsCompleted !== c.fightsCompleted || s.stage !== c.stage) return null
  return game
}

export interface RunSession {
  readonly id: string
  save(game: Game): boolean
  clear(): boolean
}

export function createRunSession(storage: RunStorage | null, id: string): RunSession {
  return {
    id,
    save: (game) => saveRun(storage, snapshotRecord(id, game)),
    clear: () => clearRun(storage),
  }
}

export interface WalletPort {
  resumeRun(runId?: string): boolean
  settleRun(cashOut: number, runId?: string): boolean
  runOpen(): boolean
}

export type ResumeOutcome =
  | { readonly kind: 'none' }
  | { readonly kind: 'resumed'; readonly game: Game; readonly record: RunRecord }
  | { readonly kind: 'discarded'; readonly refunded: number | null; readonly note: string }

export function discardStored(storage: RunStorage | null, wallet: WalletPort, buyIn: number | null, runId?: string): ResumeOutcome {
  clearRun(storage)
  if (buyIn !== null && wallet.resumeRun(runId)) {
    wallet.settleRun(buyIn, runId)
    return { kind: 'discarded', refunded: buyIn, note: `Your saved run could not be restored, so ${buyIn.toLocaleString('en-US')} coins were returned to your wallet.` }
  }
  return { kind: 'discarded', refunded: null, note: 'A saved run could not be restored and was discarded.' }
}

export function resumeStored(storage: RunStorage | null, wallet: WalletPort): ResumeOutcome {
  const loaded = loadRun(storage)
  if (loaded.kind === 'none') return { kind: 'none' }
  if (loaded.kind === 'corrupt') return discardStored(storage, wallet, loaded.buyIn)
  const game = rebuildGame(loaded.record)
  if (!game) return discardStored(storage, wallet, loaded.record.buyIn, loaded.record.id)
  if (!wallet.resumeRun(loaded.record.id)) {
    clearRun(storage)
    return { kind: 'none' }
  }
  return { kind: 'resumed', game, record: loaded.record }
}

export type SettleOutcome = 'running' | 'credited' | 'already'

export function settleFinished(storage: RunStorage | null, wallet: WalletPort, game: Game, runId: string): SettleOutcome {
  const s = game.state
  if (s.phase !== 'gameover') return 'running'
  const credited = wallet.runOpen() ? wallet.settleRun(s.cashOut ?? 0, runId) : false
  clearRun(storage)
  return credited ? 'credited' : 'already'
}
