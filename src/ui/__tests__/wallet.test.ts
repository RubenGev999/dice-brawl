import { describe, expect, it } from 'vitest'
import { createWallet, DEFAULT_WALLET, WALLET_KEY, parseBalance } from '../wallet.ts'
import type { StorageLike } from '../wallet.ts'

function memoryStorage(initial?: string): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>()
  if (initial !== undefined) data.set(WALLET_KEY, initial)
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v)
    },
  }
}

const throwing: StorageLike = {
  getItem() {
    throw new Error('blocked')
  },
  setItem() {
    throw new Error('blocked')
  },
}

describe('wallet', () => {
  it('defaults to 1000 and persists it', () => {
    const st = memoryStorage()
    const w = createWallet(st, 50)
    expect(w.balance()).toBe(DEFAULT_WALLET)
    expect(st.data.get(WALLET_KEY)).toBe('1000')
  })

  it('deducts the buy-in immediately and persists', () => {
    const st = memoryStorage('500')
    const w = createWallet(st, 50)
    expect(w.startRun(100)).toBe(true)
    expect(w.balance()).toBe(400)
    expect(st.data.get(WALLET_KEY)).toBe('400')
    expect(w.runOpen()).toBe(true)
  })

  it('refuses invalid or unaffordable buy-ins and a second open run', () => {
    const w = createWallet(memoryStorage('120'), 50)
    expect(w.startRun(49)).toBe(false)
    expect(w.startRun(250)).toBe(false)
    expect(w.startRun(50.5)).toBe(false)
    expect(w.balance()).toBe(120)
    expect(w.startRun(100)).toBe(true)
    expect(w.startRun(50)).toBe(false)
    expect(w.balance()).toBe(20)
  })

  it('credits the cash-out exactly once', () => {
    const st = memoryStorage('500')
    const w = createWallet(st, 50)
    w.startRun(100)
    expect(w.settleRun(130)).toBe(true)
    expect(w.balance()).toBe(530)
    expect(w.settleRun(130)).toBe(false)
    expect(w.settleRun(130)).toBe(false)
    expect(w.balance()).toBe(530)
    expect(st.data.get(WALLET_KEY)).toBe('530')
    expect(w.runOpen()).toBe(false)
  })

  it('never credits without an open run', () => {
    const w = createWallet(memoryStorage('500'), 50)
    expect(w.settleRun(999)).toBe(false)
    expect(w.balance()).toBe(500)
  })

  it('a zero cash-out closes the run without credit', () => {
    const w = createWallet(memoryStorage('500'), 50)
    w.startRun(100)
    expect(w.settleRun(0)).toBe(true)
    expect(w.balance()).toBe(400)
    expect(w.settleRun(0)).toBe(false)
  })

  it('a reload keeps the deducted buy-in and cannot double credit', () => {
    const st = memoryStorage('500')
    const first = createWallet(st, 50)
    first.startRun(100)
    const second = createWallet(st, 50)
    expect(second.balance()).toBe(400)
    expect(second.settleRun(200)).toBe(false)
    expect(second.balance()).toBe(400)
  })

  it('refills to 1000', () => {
    const st = memoryStorage('10')
    const w = createWallet(st, 50)
    expect(w.canAfford(50)).toBe(false)
    w.refill()
    expect(w.balance()).toBe(1000)
    expect(w.canAfford(50)).toBe(true)
    expect(st.data.get(WALLET_KEY)).toBe('1000')
  })

  it('canAfford respects the minimum and the balance', () => {
    const w = createWallet(memoryStorage('200'), 50)
    expect(w.canAfford(50)).toBe(true)
    expect(w.canAfford(200)).toBe(true)
    expect(w.canAfford(201)).toBe(false)
    expect(w.canAfford(10)).toBe(false)
  })

  it('a wallet below the minimum buy-in cannot start a run and refills', () => {
    const w = createWallet(memoryStorage('60'), 100)
    expect(w.balance()).toBe(60)
    expect(w.canAfford(100)).toBe(false)
    expect(w.startRun(100)).toBe(false)
    expect(w.startRun(60)).toBe(false)
    expect(w.balance()).toBe(60)
    expect(w.runOpen()).toBe(false)
    w.refill()
    expect(w.canAfford(100)).toBe(true)
    expect(w.startRun(100)).toBe(true)
  })

  it('falls back to the default for corrupted or missing values', () => {
    for (const bad of ['abc', '-5', '1e3', '12.5', '', 'NaN', '99999999999999999999']) {
      expect(createWallet(memoryStorage(bad), 50).balance()).toBe(DEFAULT_WALLET)
    }
    expect(createWallet(null, 50).balance()).toBe(DEFAULT_WALLET)
    expect(parseBalance(null)).toBeNull()
    expect(parseBalance(' 42 ')).toBe(42)
  })

  it('works in memory when storage throws', () => {
    const w = createWallet(throwing, 50)
    expect(w.balance()).toBe(DEFAULT_WALLET)
    expect(w.startRun(250)).toBe(true)
    expect(w.balance()).toBe(750)
    expect(w.settleRun(300)).toBe(true)
    expect(w.balance()).toBe(1050)
    w.refill()
    expect(w.balance()).toBe(1000)
  })

  it('works in memory with no storage at all', () => {
    const w = createWallet(null, 50)
    w.startRun(100)
    w.settleRun(50)
    expect(w.balance()).toBe(950)
  })
})
