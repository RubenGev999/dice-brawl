import { describe, expect, it } from 'vitest'
import { CONFIG, RULES_VERSION, createGame, replay } from '../../core/index.ts'
import type { Game } from '../../core/index.ts'
import {
  LEGACY_RUN_KEY,
  MAX_RESUME_TICKS,
  RUN_KEY,
  clearRun,
  configFingerprint,
  createRunSession,
  discardStored,
  loadRun,
  newRunId,
  parseAction,
  parseRecord,
  rebuildGame,
  resumeStored,
  saveRun,
  settleFinished,
  snapshotRecord,
} from '../runStore.ts'
import type { RunRecord, RunStorage } from '../runStore.ts'
import { WALLET_KEY, createWallet } from '../wallet.ts'

function memory(): RunStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  }
}

const throwing: RunStorage = {
  getItem() {
    throw new Error('blocked')
  },
  setItem() {
    throw new Error('blocked')
  },
  removeItem() {
    throw new Error('blocked')
  },
}

function bot(game: Game, i: number): void {
  for (let t = 0; t < i % 7; t++) game.tick()
  const s = game.state
  switch (s.phase) {
    case 'bet':
      game.dispatch({ type: 'bet', amount: (s.betPresets[i % 3] ?? s.betPresets[0])?.amount ?? 1 })
      break
    case 'fight':
      if (s.fight?.canWalkAway && i % 11 === 0) game.dispatch({ type: 'walkAway' })
      else game.dispatch({ type: 'roll' })
      break
    case 'result':
      game.dispatch({ type: 'continue' })
      break
    case 'checkpoint':
      game.dispatch(i % 3 === 0 ? { type: 'leave' } : { type: 'continue' })
      break
    case 'shop':
      if (s.shopOffers.length > 0 && i % 2 === 0) game.dispatch({ type: 'pickUpgrade', index: i % s.shopOffers.length })
      else game.dispatch({ type: 'skip' })
      break
    case 'gameover':
      break
  }
}

function phaseOf(game: Game): string {
  return game.state.phase
}

function driveTo(game: Game, from: number, to: number): number {
  let i = from
  while (i < to && game.state.phase !== 'gameover') {
    bot(game, i)
    i += 1
  }
  return i
}

describe('run persistence and resume', () => {
  it('rebuilds a partly played run exactly and continues like an uninterrupted game', () => {
    const phases = new Set<string>()
    for (const seed of [1, 2, 3, 5, 8, 13, 21, 34]) {
      for (const cut of [0, 1, 3, 6, 10, 17, 30, 55]) {
        const interrupted = createGame(seed, 500)
        const reference = createGame(seed, 500)
        const at = driveTo(interrupted, 0, cut)
        driveTo(reference, 0, cut)
        phases.add(interrupted.state.phase)
        const st = memory()
        expect(saveRun(st, snapshotRecord('run-a', interrupted))).toBe(true)
        const loaded = loadRun(st)
        expect(loaded.kind).toBe('ok')
        if (loaded.kind !== 'ok') return
        const resumed = rebuildGame(loaded.record)
        expect(resumed).not.toBeNull()
        if (!resumed) return
        expect(resumed.state).toEqual(interrupted.state)
        expect(resumed.state).toEqual(replay(seed, 500, loaded.record.log, loaded.record.tick))
        expect(resumed.log).toEqual(interrupted.log)
        driveTo(resumed, at, 400)
        driveTo(reference, at, 400)
        expect(resumed.state).toEqual(reference.state)
        expect(resumed.log).toEqual(reference.log)
      }
    }
    expect(phases.size).toBeGreaterThanOrEqual(4)
  })

  it('stores the last tick even when time passed after the last action', () => {
    const game = createGame(4, 100)
    game.dispatch({ type: 'bet', amount: 20 })
    for (let i = 0; i < 500; i++) game.tick()
    const rec = snapshotRecord('x', game)
    expect(rec.tick).toBe(500)
    const rebuilt = rebuildGame(rec)
    expect(rebuilt?.state.tick).toBe(500)
    expect(rebuilt?.state).toEqual(game.state)
  })

  it('rebuilds a long-running run quickly', () => {
    const game = createGame(4, 100)
    game.dispatch({ type: 'bet', amount: 20 })
    for (let i = 0; i < 200_000; i++) game.tick()
    game.dispatch({ type: 'roll' })
    const rec = snapshotRecord('long', game)
    const t0 = performance.now()
    const rebuilt = rebuildGame(rec)
    const ms = performance.now() - t0
    expect(rebuilt?.state).toEqual(game.state)
    expect(ms).toBeLessThan(3000)
  })

  it('rejects a run saved under another rules version', () => {
    const game = createGame(4, 100)
    game.dispatch({ type: 'bet', amount: 20 })
    const rec = snapshotRecord('x', game)
    expect(rec.rules).toBe(RULES_VERSION)
    expect(rebuildGame(rec)).not.toBeNull()
    expect(rebuildGame({ ...rec, rules: '1.0.0-old' })).toBeNull()
    expect(parseRecord({ ...rec, rules: 5 })).toBeNull()
  })

  it('returns null instead of throwing when the replay throws', () => {
    const game = createGame(4, 100)
    driveTo(game, 0, 5)
    const rec = snapshotRecord('x', game)
    const rejected: RunRecord = { ...rec, log: [{ tick: 0, action: { type: 'pickUpgrade', index: 0 } }, ...rec.log] }
    expect(() => rebuildGame(rejected)).not.toThrow()
    expect(rebuildGame(rejected)).toBeNull()
    const old: RunRecord = { ...rec, log: [{ tick: 0, action: { type: 'bet', amount: 10 } }, { tick: 0, action: { type: 'roll' } }, { tick: 1, action: { type: 'walkAway' } }] }
    expect(() => rebuildGame(old)).not.toThrow()
  })

  it('rejects a run whose config fingerprint changed', () => {
    const game = createGame(4, 100)
    game.dispatch({ type: 'bet', amount: 20 })
    const rec = snapshotRecord('x', game)
    expect(rec.cfg).toBe(configFingerprint())
    expect(rebuildGame({ ...rec, cfg: 'other' })).toBeNull()
  })

  it('rejects a run whose replay disagrees with the stored checksum', () => {
    const game = createGame(4, 100)
    driveTo(game, 0, 8)
    const rec = snapshotRecord('x', game)
    expect(rebuildGame({ ...rec, check: { ...rec.check, bankroll: rec.check.bankroll + 1 } })).toBeNull()
    expect(rebuildGame({ ...rec, check: { ...rec.check, phase: rec.check.phase === 'bet' ? 'shop' : 'bet' } })).toBeNull()
  })

  it('rejects a log that no longer replays', () => {
    const game = createGame(4, 100)
    driveTo(game, 0, 5)
    const rec = snapshotRecord('x', game)
    const broken: RunRecord = { ...rec, log: [{ tick: 0, action: { type: 'continue' } }, ...rec.log] }
    expect(rebuildGame(broken)).toBeNull()
    const tooFar: RunRecord = { ...rec, tick: MAX_RESUME_TICKS + 1 }
    expect(rebuildGame(tooFar)).toBeNull()
    expect(rebuildGame({ ...rec, buyIn: 3 })).toBeNull()
  })

  it('validates the stored shape', () => {
    const game = createGame(4, 100)
    driveTo(game, 0, 5)
    const rec = snapshotRecord('x', game)
    expect(parseRecord(JSON.parse(JSON.stringify(rec)))).toEqual(rec)
    expect(parseRecord(null)).toBeNull()
    expect(parseRecord({ ...rec, v: 99 })).toBeNull()
    expect(parseRecord({ ...rec, id: '' })).toBeNull()
    expect(parseRecord({ ...rec, seed: 'a' })).toBeNull()
    expect(parseRecord({ ...rec, buyIn: 0 })).toBeNull()
    expect(parseRecord({ ...rec, log: 'x' })).toBeNull()
    expect(parseRecord({ ...rec, log: [{ tick: 5, action: { type: 'roll' } }, { tick: 2, action: { type: 'roll' } }] })).toBeNull()
    expect(parseRecord({ ...rec, log: [{ tick: rec.tick + 1, action: { type: 'roll' } }] })).toBeNull()
    expect(parseRecord({ ...rec, log: [{ tick: 0, action: { type: 'hack' } }] })).toBeNull()
    expect(parseRecord({ ...rec, check: { ...rec.check, phase: 'nope' } })).toBeNull()
    expect(parseRecord({ ...rec, check: null })).toBeNull()
  })

  it('parses only well-formed actions', () => {
    expect(parseAction({ type: 'bet', amount: 12 })).toEqual({ type: 'bet', amount: 12 })
    expect(parseAction({ type: 'bet', amount: 'x' })).toBeNull()
    expect(parseAction({ type: 'bet', amount: Infinity })).toBeNull()
    expect(parseAction({ type: 'pickUpgrade', index: 2 })).toEqual({ type: 'pickUpgrade', index: 2 })
    expect(parseAction({ type: 'pickUpgrade', index: -1 })).toBeNull()
    expect(parseAction({ type: 'pawn', index: 0 })).toBeNull()
    expect(parseAction({ type: 'roll', extra: 1 })).toEqual({ type: 'roll' })
    expect(parseAction('roll')).toBeNull()
  })

  it('uses a versioned key and survives throwing storage', () => {
    expect(RUN_KEY).toMatch(/\.v\d+$/)
    const game = createGame(4, 100)
    const rec = snapshotRecord('x', game)
    expect(saveRun(throwing, rec)).toBe(false)
    expect(saveRun(null, rec)).toBe(false)
    expect(loadRun(throwing)).toEqual({ kind: 'none' })
    expect(loadRun(null)).toEqual({ kind: 'none' })
    expect(clearRun(throwing)).toBe(false)
    const session = createRunSession(throwing, 'x')
    expect(session.save(game)).toBe(false)
    expect(session.clear()).toBe(false)
  })

  it('clears with removeItem or an empty value', () => {
    const st = memory()
    saveRun(st, snapshotRecord('x', createGame(4, 100)))
    expect(loadRun(st).kind).toBe('ok')
    expect(clearRun(st)).toBe(true)
    expect(loadRun(st)).toEqual({ kind: 'none' })
    let blank: string | null = 'something'
    const noRemove: RunStorage = {
      getItem: (k) => (k === RUN_KEY ? blank : null),
      setItem: (_k, v) => {
        blank = v
      },
    }
    expect(clearRun(noRemove)).toBe(true)
    expect(loadRun(noRemove)).toEqual({ kind: 'none' })
  })

  it('reports corrupt data with a recoverable buy-in when there is one', () => {
    const st = memory()
    st.setItem(RUN_KEY, '{not json')
    expect(loadRun(st)).toEqual({ kind: 'corrupt', buyIn: null })
    st.setItem(RUN_KEY, JSON.stringify({ v: 1, buyIn: 250, garbage: true }))
    expect(loadRun(st)).toEqual({ kind: 'corrupt', buyIn: 250 })
    st.setItem(RUN_KEY, JSON.stringify({ v: 1, buyIn: 'lots' }))
    expect(loadRun(st)).toEqual({ kind: 'corrupt', buyIn: null })
    st.setItem(RUN_KEY, JSON.stringify([1, 2, 3]))
    expect(loadRun(st)).toEqual({ kind: 'corrupt', buyIn: null })
  })

  it('makes distinct run ids', () => {
    expect(newRunId(1000, 1)).not.toBe(newRunId(1000, 2))
    expect(newRunId(1000, 1)).not.toBe(newRunId(1001, 1))
  })
})

describe('wallet and run lifecycle', () => {
  function setup(balance = 1000) {
    const st = memory()
    st.setItem(WALLET_KEY, String(balance))
    return st
  }

  function startStored(st: ReturnType<typeof memory>, buyIn: number, seed: number): { wallet: ReturnType<typeof createWallet>; game: Game } {
    const wallet = createWallet(st, CONFIG.minBuyIn)
    expect(wallet.startRun(buyIn)).toBe(true)
    const game = createGame(seed, buyIn)
    saveRun(st, snapshotRecord('run-1', game))
    return { wallet, game }
  }

  function play(game: Game, st: ReturnType<typeof memory>): void {
    let i = 0
    while (phaseOf(game) !== 'gameover' && i < 3000) {
      bot(game, i)
      i += 1
      if (phaseOf(game) !== 'gameover') saveRun(st, snapshotRecord('run-1', game))
    }
  }

  it('resumes an unfinished run with the wallet open and credits the cash-out once', () => {
    const st = setup(1000)
    const { game } = startStored(st, 100, 9)
    driveTo(game, 0, 4)
    saveRun(st, snapshotRecord('run-1', game))

    const reloaded = createWallet(st, CONFIG.minBuyIn)
    expect(reloaded.balance()).toBe(900)
    expect(reloaded.runOpen()).toBe(false)
    const outcome = resumeStored(st, reloaded)
    expect(outcome.kind).toBe('resumed')
    if (outcome.kind !== 'resumed') return
    expect(reloaded.runOpen()).toBe(true)
    expect(outcome.game.state).toEqual(game.state)
    play(outcome.game, st)
    expect(phaseOf(outcome.game)).toBe('gameover')
    const cash = outcome.game.state.cashOut ?? 0
    saveRun(st, snapshotRecord('run-1', outcome.game))
    expect(settleFinished(st, reloaded, outcome.game, 'run-1')).toBe('credited')
    expect(reloaded.balance()).toBe(900 + cash)
    expect(settleFinished(st, reloaded, outcome.game, 'run-1')).toBe('already')
    expect(reloaded.balance()).toBe(900 + cash)
    expect(loadRun(st)).toEqual({ kind: 'none' })
    const again = createWallet(st, CONFIG.minBuyIn)
    expect(resumeStored(st, again)).toEqual({ kind: 'none' })
    expect(again.balance()).toBe(900 + cash)
  })

  it('credits exactly once when the tab reloads on a finished run that was not settled yet', () => {
    const st = setup(1000)
    const { game } = startStored(st, 100, 11)
    play(game, st)
    saveRun(st, snapshotRecord('run-1', game))
    const cash = game.state.cashOut ?? 0

    const first = createWallet(st, CONFIG.minBuyIn)
    const o1 = resumeStored(st, first)
    expect(o1.kind).toBe('resumed')
    if (o1.kind !== 'resumed') return
    expect(phaseOf(o1.game)).toBe('gameover')
    expect(settleFinished(st, first, o1.game, 'run-1')).toBe('credited')
    expect(first.balance()).toBe(900 + cash)

    const second = createWallet(st, CONFIG.minBuyIn)
    expect(resumeStored(st, second)).toEqual({ kind: 'none' })
    expect(second.balance()).toBe(900 + cash)
  })

  it('does not credit twice when a stale record survives a failed clear and the tab reloads', () => {
    const st = setup(1000)
    const { game } = startStored(st, 100, 11)
    play(game, st)
    saveRun(st, snapshotRecord('run-1', game))
    const cash = game.state.cashOut ?? 0
    const wallet = createWallet(st, CONFIG.minBuyIn)
    const o = resumeStored(st, wallet)
    if (o.kind !== 'resumed') throw new Error('expected resume')
    expect(settleFinished(st, wallet, o.game, 'run-1')).toBe('credited')
    expect(wallet.balance()).toBe(900 + cash)
    expect(st.data.get(WALLET_KEY)).toBe(`${900 + cash}|run-1`)

    saveRun(st, snapshotRecord('run-1', game))
    const reloaded = createWallet(st, CONFIG.minBuyIn)
    expect(reloaded.lastSettledId()).toBe('run-1')
    expect(resumeStored(st, reloaded)).toEqual({ kind: 'none' })
    expect(reloaded.balance()).toBe(900 + cash)
    expect(reloaded.runOpen()).toBe(false)
    expect(loadRun(st)).toEqual({ kind: 'none' })
  })

  it('keeps the settled marker across the next run and does not block a new run id', () => {
    const st = setup(1000)
    const { game } = startStored(st, 100, 11)
    play(game, st)
    saveRun(st, snapshotRecord('run-1', game))
    const wallet = createWallet(st, CONFIG.minBuyIn)
    const o = resumeStored(st, wallet)
    if (o.kind !== 'resumed') throw new Error('expected resume')
    settleFinished(st, wallet, o.game, 'run-1')
    const before = wallet.balance()
    expect(wallet.startRun(100)).toBe(true)
    expect(st.data.get(WALLET_KEY)).toBe(`${before - 100}|run-1`)
    expect(wallet.resumeRun('run-2')).toBe(false)
    expect(wallet.settleRun(0, 'run-2')).toBe(true)
    expect(wallet.lastSettledId()).toBe('run-2')
  })

  it('refunds the buy-in exactly once when the stored run no longer replays', () => {
    const st = setup(1000)
    const { game } = startStored(st, 250, 5)
    driveTo(game, 0, 6)
    const rec = snapshotRecord('run-1', game)
    st.setItem(RUN_KEY, JSON.stringify({ ...rec, cfg: 'changed' }))

    const wallet = createWallet(st, CONFIG.minBuyIn)
    expect(wallet.balance()).toBe(750)
    const outcome = resumeStored(st, wallet)
    expect(outcome.kind).toBe('discarded')
    if (outcome.kind !== 'discarded') return
    expect(outcome.refunded).toBe(250)
    expect(outcome.note).toContain('250')
    expect(wallet.balance()).toBe(1000)
    expect(wallet.runOpen()).toBe(false)
    expect(st.data.get(WALLET_KEY)).toBe('1000|run-1')
    expect(loadRun(st)).toEqual({ kind: 'none' })

    const reload = createWallet(st, CONFIG.minBuyIn)
    expect(resumeStored(st, reload)).toEqual({ kind: 'none' })
    expect(reload.balance()).toBe(1000)
  })

  it('refunds when the run data is corrupt but the buy-in is readable, and only discards otherwise', () => {
    const st = setup(600)
    st.setItem(RUN_KEY, JSON.stringify({ v: 1, buyIn: 100, log: 'broken' }))
    const wallet = createWallet(st, CONFIG.minBuyIn)
    const outcome = resumeStored(st, wallet)
    expect(outcome).toMatchObject({ kind: 'discarded', refunded: 100 })
    expect(wallet.balance()).toBe(700)

    st.setItem(RUN_KEY, '{oops')
    const other = createWallet(st, CONFIG.minBuyIn)
    const o2 = resumeStored(st, other)
    expect(o2).toMatchObject({ kind: 'discarded', refunded: null })
    expect(other.balance()).toBe(700)
    expect(loadRun(st)).toEqual({ kind: 'none' })
  })

  it('never refunds twice through repeated discards', () => {
    const st = setup(600)
    const wallet = createWallet(st, CONFIG.minBuyIn)
    expect(discardStored(st, wallet, 100)).toMatchObject({ refunded: 100 })
    expect(wallet.balance()).toBe(700)
    expect(wallet.resumeRun()).toBe(true)
    expect(wallet.resumeRun()).toBe(false)
    wallet.settleRun(0)
  })

  it('discards a save from another rules version and refunds the buy-in with the existing message', () => {
    const st = setup(1000)
    const { game } = startStored(st, 250, 5)
    driveTo(game, 0, 6)
    const rec = snapshotRecord('run-1', game)
    expect(rec.rules).toBe(RULES_VERSION)
    st.setItem(RUN_KEY, JSON.stringify({ ...rec, rules: '1.0.0-old' }))

    const wallet = createWallet(st, CONFIG.minBuyIn)
    expect(wallet.balance()).toBe(750)
    const outcome = resumeStored(st, wallet)
    expect(outcome.kind).toBe('discarded')
    if (outcome.kind !== 'discarded') return
    expect(outcome.refunded).toBe(250)
    expect(outcome.note).toBe('Your saved run could not be restored, so 250 coins were returned to your wallet.')
    expect(wallet.balance()).toBe(1000)
    expect(loadRun(st)).toEqual({ kind: 'none' })
  })

  it('treats a save without a rules version as corrupt and refunds a readable buy-in', () => {
    const st = setup(1000)
    const { game } = startStored(st, 100, 5)
    const rec = snapshotRecord('run-1', game)
    const { rules: _rules, ...withoutRules } = rec
    st.setItem(RUN_KEY, JSON.stringify(withoutRules))
    const wallet = createWallet(st, CONFIG.minBuyIn)
    expect(resumeStored(st, wallet)).toMatchObject({ kind: 'discarded', refunded: 100 })
    expect(wallet.balance()).toBe(1000)
  })

  it('refunds a run stored under the old key version once and removes it', () => {
    const st = setup(1000)
    const wallet0 = createWallet(st, CONFIG.minBuyIn)
    expect(wallet0.startRun(250)).toBe(true)
    st.setItem(LEGACY_RUN_KEY, JSON.stringify({ v: 1, id: 'old-run', buyIn: 250, seed: 1, log: [] }))
    const wallet = createWallet(st, CONFIG.minBuyIn)
    expect(wallet.balance()).toBe(750)
    const outcome = resumeStored(st, wallet)
    expect(outcome).toMatchObject({ kind: 'discarded', refunded: 250 })
    expect(wallet.balance()).toBe(1000)
    expect(st.data.has(LEGACY_RUN_KEY)).toBe(false)
    const reload = createWallet(st, CONFIG.minBuyIn)
    expect(resumeStored(st, reload)).toEqual({ kind: 'none' })
    expect(reload.balance()).toBe(1000)
  })

  it('does not refund twice when the old-key run was already settled', () => {
    const st = setup(1000)
    st.setItem(WALLET_KEY, '1000|old-run')
    st.setItem(LEGACY_RUN_KEY, JSON.stringify({ v: 1, id: 'old-run', buyIn: 250 }))
    const wallet = createWallet(st, CONFIG.minBuyIn)
    const outcome = resumeStored(st, wallet)
    expect(outcome).toMatchObject({ kind: 'discarded', refunded: null })
    expect(wallet.balance()).toBe(1000)
    expect(st.data.has(LEGACY_RUN_KEY)).toBe(false)
  })

  it('does not settle while a run is still going', () => {
    const st = setup(1000)
    const { wallet, game } = startStored(st, 100, 9)
    expect(settleFinished(st, wallet, game, 'run-1')).toBe('running')
    expect(wallet.runOpen()).toBe(true)
    expect(loadRun(st).kind).toBe('ok')
  })
})
