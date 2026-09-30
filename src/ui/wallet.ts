export const WALLET_KEY = 'diceBrawl.wallet.v1'
export const DEFAULT_WALLET = 1000

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface Wallet {
  balance(): number
  canAfford(amount: number): boolean
  runOpen(): boolean
  startRun(buyIn: number): boolean
  resumeRun(runId?: string): boolean
  settleRun(cashOut: number, runId?: string): boolean
  lastSettledId(): string | null
  refill(): void
}

export function parseBalance(raw: string | null): number | null {
  if (raw === null) return null
  const text = raw.trim()
  if (!/^\d{1,15}$/.test(text)) return null
  const n = Number(text)
  return Number.isSafeInteger(n) ? n : null
}

export interface WalletValue {
  readonly balance: number
  readonly settledId: string | null
}

export function parseWalletValue(raw: string | null): WalletValue | null {
  if (raw === null) return null
  const at = raw.indexOf('|')
  if (at === -1) {
    const balance = parseBalance(raw)
    return balance === null ? null : { balance, settledId: null }
  }
  const balance = parseBalance(raw.slice(0, at))
  const id = raw.slice(at + 1).trim()
  if (balance === null) return null
  return { balance, settledId: /^[\w-]{1,64}$/.test(id) ? id : null }
}

export function formatWalletValue(balance: number, settledId: string | null): string {
  return settledId === null ? String(balance) : `${balance}|${settledId}`
}

export function browserStorage(): StorageLike | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function createWallet(storage: StorageLike | null, minBuyIn: number): Wallet {
  let balance = DEFAULT_WALLET
  let openRun = false
  let settledId: string | null = null

  try {
    const stored = storage ? parseWalletValue(storage.getItem(WALLET_KEY)) : null
    if (stored !== null) {
      balance = stored.balance
      settledId = stored.settledId
    }
  } catch {
    balance = DEFAULT_WALLET
  }

  function persist(): void {
    try {
      if (storage) storage.setItem(WALLET_KEY, formatWalletValue(balance, settledId))
    } catch {
      return
    }
  }

  persist()

  return {
    balance: () => balance,
    canAfford: (amount) => Number.isSafeInteger(amount) && amount >= minBuyIn && amount <= balance,
    runOpen: () => openRun,
    startRun(buyIn) {
      if (openRun) return false
      if (!Number.isSafeInteger(buyIn) || buyIn < minBuyIn || buyIn > balance) return false
      balance -= buyIn
      openRun = true
      persist()
      return true
    },
    resumeRun(runId) {
      if (openRun) return false
      if (runId !== undefined && runId === settledId) return false
      openRun = true
      return true
    },
    lastSettledId: () => settledId,
    settleRun(cashOut, runId) {
      if (!openRun) return false
      openRun = false
      if (runId !== undefined) settledId = runId
      if (Number.isSafeInteger(cashOut) && cashOut > 0) balance += cashOut
      persist()
      return true
    },
    refill() {
      balance = DEFAULT_WALLET
      persist()
    },
  }
}
