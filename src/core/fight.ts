import { CONFIG, MILLI } from './config.ts'
import { stageOfFight } from './enemies.ts'
import type { EnemyDef } from './enemies.ts'
import { createStream } from './rng.ts'
import type { Rng } from './rng.ts'
import type { FightMods } from './upgrades.ts'
import type { ExchangeRecord, FightStatus } from './types.ts'

export interface SimFight {
  readonly index: number
  readonly stage: number
  readonly isBoss: boolean
  readonly bet: number
  readonly mods: FightMods
  readonly enemy: EnemyDef
  readonly enemyMaxHp: number
  readonly fullKoMilli: number
  readonly koBonusMilli: number
  enemyHp: number
  playerHp: number
  shieldsLeft: number
  rerollsLeft: number
  damageDealt: number
  multiplierMilli: number
  status: FightStatus
  exchanges: ReadonlyArray<ExchangeRecord>
  readonly playerRng: Rng
  readonly enemyRng: Rng
}

export function payoutAt(bet: number, multiplierMilli: number): number {
  return Number((BigInt(bet) * BigInt(multiplierMilli)) / BigInt(MILLI))
}

export function walkAwayPayoutAt(bet: number, multiplierMilli: number, keepMilli: number): number {
  return Number((BigInt(bet) * BigInt(multiplierMilli) * BigInt(keepMilli)) / BigInt(MILLI * MILLI))
}

export function lossPayoutAt(bet: number, refundMilli: number): number {
  return payoutAt(bet, refundMilli)
}

export function enemyMaxHpWithMods(enemy: EnemyDef, mods: FightMods): number {
  const cut = Math.floor((enemy.maxHp * mods.enemyHpCutPercent) / 100)
  return Math.max(CONFIG.enemyMinHp, enemy.maxHp - cut)
}

export function fullKoMultiplierMilliFor(isBoss: boolean): number {
  return isBoss ? CONFIG.bossFullKoMultiplierMilli : CONFIG.fullKoMultiplierMilli
}

export function koBonusMilliFor(isBoss: boolean, mods: FightMods): number {
  return (isBoss ? CONFIG.bossKoBonusMilli : CONFIG.koBonusMilli) + mods.koBonusMilli
}

export function damageMultiplierMilli(damageDealt: number, enemyMaxHp: number, fullKoMilli: number): number {
  return Math.floor((Math.min(damageDealt, enemyMaxHp) * fullKoMilli) / enemyMaxHp)
}

export function createSimFight(seed: number, index: number, bet: number, mods: FightMods, enemy: EnemyDef): SimFight {
  const enemyMaxHp = enemyMaxHpWithMods(enemy, mods)
  return {
    index,
    stage: stageOfFight(index),
    isBoss: enemy.isBoss,
    bet,
    mods,
    enemy,
    enemyMaxHp,
    fullKoMilli: fullKoMultiplierMilliFor(enemy.isBoss),
    koBonusMilli: koBonusMilliFor(enemy.isBoss, mods),
    enemyHp: enemyMaxHp,
    playerHp: mods.maxHp,
    shieldsLeft: mods.shields,
    rerollsLeft: mods.rerolls,
    damageDealt: 0,
    multiplierMilli: 0,
    status: 'active',
    exchanges: [],
    playerRng: createStream(seed, 'player-dice', index),
    enemyRng: createStream(seed, 'enemy-dice', index),
  }
}

function sum(faces: ReadonlyArray<number>): number {
  let t = 0
  for (const f of faces) t += f
  return t
}

export function hasDoubles(faces: ReadonlyArray<number>): boolean {
  for (let i = 0; i < faces.length; i++) {
    for (let j = i + 1; j < faces.length; j++) if (faces[i] === faces[j]) return true
  }
  return false
}

function lowestIndex(faces: ReadonlyArray<number>): number {
  let best = 0
  for (let i = 1; i < faces.length; i++) if ((faces[i] as number) < (faces[best] as number)) best = i
  return best
}

export function enemyCurrentBonus(f: SimFight): number {
  const enraged = f.enemy.trait === 'enrage' && f.enemyHp * 2 < f.enemyMaxHp
  return f.enemy.bonus + (enraged ? CONFIG.bossEnrageBonus : 0)
}

function playerCrits(f: SimFight, faces: ReadonlyArray<number>): boolean {
  if (hasDoubles(faces)) return true
  return f.mods.critTotal > 0 && sum(faces) >= f.mods.critTotal
}

function incomingDamage(f: SimFight, diff: number, enemyCritFactor: number): number {
  let raw = diff * enemyCritFactor
  if (f.enemy.trait === 'vicious') raw += CONFIG.traitViciousDamage
  if (f.enemy.trait === 'executioner') raw += CONFIG.bossExecutionerDamage
  return Math.max(1, raw - f.mods.damageReduction)
}

function outgoingDamage(f: SimFight, diff: number, playerCritFactor: number): number {
  let raw = diff * playerCritFactor + f.mods.damageBonus
  if (f.enemy.trait === 'armored') raw = Math.max(1, raw - CONFIG.traitArmorReduction)
  if (f.enemy.trait === 'ironhide') raw = Math.max(1, raw - CONFIG.bossIronhideReduction)
  return raw
}

export function rollExchange(f: SimFight): ExchangeRecord | null {
  if (f.status !== 'active') return null
  const enemyFaces = f.enemy.dice.map((s) => f.enemyRng.int(1, s))
  const face = (sides: number): number => Math.max(f.mods.minFace, f.playerRng.int(1, sides))
  let playerFaces = f.mods.dice.map(face)
  const enemyTotal = sum(enemyFaces) + enemyCurrentBonus(f)
  let playerTotal = sum(playerFaces) + f.mods.bonus
  let before: number[] | null = null
  if (playerTotal < enemyTotal && f.rerollsLeft > 0) {
    f.rerollsLeft -= 1
    before = playerFaces
    const i = lowestIndex(playerFaces)
    const fresh = face(f.mods.dice[i] as number)
    playerFaces = playerFaces.map((v, j) => (j === i ? Math.max(v, fresh) : v))
    playerTotal = sum(playerFaces) + f.mods.bonus
  }
  const luckyTie = playerTotal === enemyTotal && f.enemy.trait === 'lucky'
  const winner = playerTotal > enemyTotal ? 'player' : enemyTotal > playerTotal || luckyTie ? 'enemy' : 'tie'
  const playerCrit = winner === 'player' && playerCrits(f, playerFaces)
  const enemyCrit = winner === 'enemy' && !luckyTie && hasDoubles(enemyFaces)
  const playerCritFactor = playerCrit ? f.mods.critFactor : 1
  const enemyCritFactor = enemyCrit ? (f.enemy.trait === 'savage' ? CONFIG.traitSavageCritFactor : CONFIG.critFactor) : 1
  let damageDealt = 0
  let damageTaken = 0
  let blocked = 0
  let healed = 0
  let enemyHealed = 0
  let escaped = false
  if (winner === 'player') {
    const raw = outgoingDamage(f, playerTotal - enemyTotal, playerCritFactor)
    damageDealt = Math.min(raw, f.enemyHp)
    f.enemyHp -= damageDealt
    f.damageDealt += damageDealt
    if (damageDealt > 0 && f.mods.healOnHit > 0) {
      healed = Math.min(f.mods.healOnHit, f.mods.maxHp - f.playerHp)
      f.playerHp += healed
    }
  } else if (winner === 'enemy') {
    let raw = luckyTie
      ? Math.max(1, CONFIG.traitLuckyTieDamage - f.mods.damageReduction)
      : incomingDamage(f, enemyTotal - playerTotal, enemyCritFactor)
    if (f.shieldsLeft > 0) {
      f.shieldsLeft -= 1
      blocked = Math.min(raw, f.mods.shieldBlock)
      raw -= blocked
    }
    damageTaken = Math.min(raw, f.playerHp)
    f.playerHp -= damageTaken
  }
  if (f.enemy.trait === 'regenerate' && f.enemyHp > 0) {
    const cap = f.enemyMaxHp - f.enemyHp
    enemyHealed = Math.min(CONFIG.bossRegenerateHp, cap)
    f.enemyHp += enemyHealed
  }
  const prev = f.multiplierMilli
  let next = damageMultiplierMilli(f.enemyMaxHp - f.enemyHp, f.enemyMaxHp, f.fullKoMilli)
  if (next < 0) next = 0
  if (f.enemyHp <= 0) {
    next += f.koBonusMilli
    f.status = 'won'
  } else if (f.playerHp <= 0) {
    f.status = 'lost'
  }
  f.multiplierMilli = next
  if (f.status === 'lost' && f.mods.escapeRope) {
    const esc = currentWalkAwayPayout(f)
    if (esc >= 1 && esc > lossPayoutAt(f.bet, f.mods.lossRefundMilli)) {
      f.status = 'escaped'
      escaped = true
    }
  }
  const record: ExchangeRecord = {
    index: f.exchanges.length,
    playerFaces,
    playerFacesBeforeReroll: before,
    rerolled: before !== null,
    enemyFaces,
    playerTotal,
    enemyTotal,
    winner,
    playerCrit,
    enemyCrit,
    playerCritFactor,
    enemyCritFactor,
    damageDealt,
    damageTaken,
    blocked,
    healed,
    enemyHealed,
    escaped,
    playerHpAfter: f.playerHp,
    enemyHpAfter: f.enemyHp,
    multiplierGained: (next - prev) / MILLI,
    multiplierGainedMilli: next - prev,
    multiplierAfterMilli: next,
  }
  f.exchanges = [...f.exchanges, record]
  return record
}

export function currentWalkAwayPayout(f: SimFight): number {
  return walkAwayPayoutAt(f.bet, f.multiplierMilli, f.mods.walkAwayKeepMilli)
}

export function canWalkAway(f: SimFight): boolean {
  return f.status === 'active' && f.exchanges.length > 0 && currentWalkAwayPayout(f) >= 1
}

export function fightPayout(f: SimFight): number {
  if (f.status === 'won') return payoutAt(f.bet, f.multiplierMilli)
  if (f.status === 'walkedAway' || f.status === 'escaped') return currentWalkAwayPayout(f)
  if (f.status === 'lost') return lossPayoutAt(f.bet, f.mods.lossRefundMilli)
  return 0
}
