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
  settleRun(cashOut: number): boolean
  refill(): void
}

export function parseBalance(raw: string | null): number | null {
  if (raw === null) return null
  const text = raw.trim()
  if (!/^\d{1,15}$/.test(text)) return null
  const n = Number(text)
  return Number.isSafeInteger(n) ? n : null
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

  try {
    const stored = storage ? parseBalance(storage.getItem(WALLET_KEY)) : null
    if (stored !== null) balance = stored
  } catch {
    balance = DEFAULT_WALLET
  }

  function persist(): void {
    try {
      if (storage) storage.setItem(WALLET_KEY, String(balance))
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
    settleRun(cashOut) {
      if (!openRun) return false
      openRun = false
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
