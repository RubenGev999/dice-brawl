import { CONFIG, MILLI } from './config.ts'
import { stageOfFight } from './enemies.ts'
import type { EnemyDef } from './enemies.ts'
import { levelDef } from './levels.ts'
import { createStream } from './rng.ts'
import type { Rng } from './rng.ts'
import type { FightMods } from './upgrades.ts'
import type { CritSource, ExchangeRecord, FightStatus, UpgradeTrigger } from './types.ts'

export interface SimFight {
  readonly index: number
  readonly stage: number
  readonly level: number
  readonly isBoss: boolean
  readonly bet: number
  readonly mods: FightMods
  readonly enemy: EnemyDef
  readonly enemyMaxHp: number
  readonly playerMaxHp: number
  readonly fullKoMilli: number
  readonly koBonusMilli: number
  readonly startTriggers: ReadonlyArray<UpgradeTrigger>
  enemyHp: number
  playerHp: number
  shieldsLeft: number
  rerollsLeft: number
  hitsLanded: number
  damageDealt: number
  multiplierMilli: number
  status: FightStatus
  exchanges: ReadonlyArray<ExchangeRecord>
  readonly playerRng: Rng
  readonly enemyRng: Rng
}

export interface WalkAwayParts {
  readonly refund: number
  readonly fromEarned: number
  readonly total: number
}

export function payoutAt(bet: number, multiplierMilli: number): number {
  return Number((BigInt(bet) * BigInt(multiplierMilli)) / BigInt(MILLI))
}

export function walkAwayPartsAt(
  bet: number,
  multiplierMilli: number,
  refundMilli: number = CONFIG.walkAwayRefundMilli,
  keepMilli: number = CONFIG.walkAwayKeepMilli,
): WalkAwayParts {
  const refund = payoutAt(bet, refundMilli)
  const fromEarned = Number((BigInt(bet) * BigInt(Math.max(0, multiplierMilli)) * BigInt(keepMilli)) / BigInt(MILLI * MILLI))
  return { refund, fromEarned, total: refund + fromEarned }
}

export function walkAwayPayoutAt(
  bet: number,
  multiplierMilli: number,
  refundMilli: number = CONFIG.walkAwayRefundMilli,
  keepMilli: number = CONFIG.walkAwayKeepMilli,
): number {
  return walkAwayPartsAt(bet, multiplierMilli, refundMilli, keepMilli).total
}

export function lossPayoutAt(bet: number, refundMilli: number): number {
  return payoutAt(bet, refundMilli)
}

export function enemyMaxHpWithMods(enemy: EnemyDef, mods: FightMods): number {
  const cut = Math.floor((enemy.maxHp * mods.enemyHpCutPercent) / 100)
  return Math.max(CONFIG.enemyMinHp, enemy.maxHp - cut)
}

export function fullKoMultiplierMilliFor(isBoss: boolean, level = 1): number {
  const d = levelDef(level)
  return isBoss ? d.bossFullKoMilli : d.fullKoMilli
}

export function koBonusMilliFor(isBoss: boolean, mods: FightMods, level = 1): number {
  const d = levelDef(level)
  return (isBoss ? d.bossKoBonusMilli : d.koBonusMilli) + mods.koBonusMilli
}

export function damageMultiplierMilli(damageDealt: number, enemyMaxHp: number, fullKoMilli: number): number {
  return Math.floor((Math.min(damageDealt, enemyMaxHp) * fullKoMilli) / enemyMaxHp)
}

export function createSimFight(
  seed: number,
  index: number,
  bet: number,
  mods: FightMods,
  enemy: EnemyDef,
): SimFight {
  const enemyMaxHp = enemyMaxHpWithMods(enemy, mods)
  const level = stageOfFight(index)
  const playerMaxHp = mods.maxHp
  const startTriggers: UpgradeTrigger[] = []
  const extraHp = mods.maxHp - CONFIG.playerBaseHp
  if (extraHp > 0) startTriggers.push({ id: 'vitality', text: `Vitality +${extraHp} HP` })
  if (enemyMaxHp < enemy.maxHp) startTriggers.push({ id: 'intimidate', text: `Intimidate -${enemy.maxHp - enemyMaxHp} enemy HP` })
  return {
    index,
    stage: level,
    level,
    isBoss: enemy.isBoss,
    bet,
    mods,
    enemy,
    enemyMaxHp,
    playerMaxHp,
    fullKoMilli: fullKoMultiplierMilliFor(enemy.isBoss, level),
    koBonusMilli: koBonusMilliFor(enemy.isBoss, mods, level),
    startTriggers,
    enemyHp: enemyMaxHp,
    playerHp: playerMaxHp,
    shieldsLeft: mods.shields,
    rerollsLeft: mods.rerolls,
    hitsLanded: 0,
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
  const low = f.enemyHp * 2 < f.enemyMaxHp
  if (!low) return f.enemy.bonus
  if (f.enemy.trait === 'enrage') return f.enemy.bonus + CONFIG.bossEnrageBonus
  if (f.enemy.trait === 'frenzied') return f.enemy.bonus + CONFIG.traitFrenziedBonus
  return f.enemy.bonus
}

export function playerCurrentBonus(f: SimFight): number {
  return f.mods.bonus
}

export function playerMaxFace(f: SimFight): number {
  return f.enemy.trait === 'cursed' ? CONFIG.traitCursedMaxFace : 6
}

function enemyBaseCritFactor(f: SimFight): number {
  if (f.enemy.trait === 'savage') return CONFIG.traitSavageCritFactor
  if (f.enemy.trait === 'crusher') return CONFIG.bossCrusherCritFactor
  return CONFIG.critFactor
}

function enemyFlatDamage(f: SimFight): number {
  if (f.enemy.trait === 'vicious') return CONFIG.traitViciousDamage
  if (f.enemy.trait === 'executioner') return CONFIG.bossExecutionerDamage
  return 0
}

function enemyHealOnHit(f: SimFight): number {
  if (f.enemy.trait === 'leech') return CONFIG.traitLeechHeal
  if (f.enemy.trait === 'vampiric') return CONFIG.bossVampiricHeal
  return 0
}

function enemyArmor(f: SimFight): number {
  if (f.enemy.trait === 'armored') return CONFIG.traitArmorReduction
  if (f.enemy.trait === 'ironhide') return CONFIG.bossIronhideReduction
  return 0
}

function critSourceFor(f: SimFight, faces: ReadonlyArray<number>, hitNumber: number): CritSource | null {
  if (f.mods.comboEvery > 0 && hitNumber % f.mods.comboEvery === 0) return 'combo'
  if (hasDoubles(faces)) return 'doubles'
  if (f.mods.critTotal > 0 && sum(faces) >= f.mods.critTotal) return 'loadedDice'
  if (f.mods.firstBlood && hitNumber === 1) return 'firstBlood'
  return null
}

const CRIT_TRIGGER: Readonly<Record<CritSource, UpgradeTrigger | null>> = {
  doubles: null,
  loadedDice: { id: 'loadedDice', text: 'Loaded Dice crit' },
  combo: { id: 'combo', text: 'Combo crit' },
  firstBlood: { id: 'firstBlood', text: 'First Blood crit' },
}

export function rollExchange(f: SimFight): ExchangeRecord | null {
  if (f.status !== 'active') return null
  const triggers: UpgradeTrigger[] = []
  const enemyFaces = f.enemy.dice.map((s) => f.enemyRng.int(1, s))
  const maxFace = playerMaxFace(f)
  let clamps = 0
  let clampPips = 0
  let cursed = 0
  const face = (sides: number): number => {
    const raw = f.playerRng.int(1, sides)
    let v = raw
    if (v < f.mods.minFace) {
      clamps++
      clampPips += f.mods.minFace - v
      v = f.mods.minFace
    }
    if (v > maxFace) {
      cursed++
      v = maxFace
    }
    return v
  }
  let playerFaces = f.mods.dice.map(face)
  const enemyBonusApplied = enemyCurrentBonus(f)
  const playerBonusApplied = playerCurrentBonus(f)
  const enemyTotal = sum(enemyFaces) + enemyBonusApplied
  let playerTotal = sum(playerFaces) + playerBonusApplied
  let before: number[] | null = null
  if (playerTotal < enemyTotal && f.rerollsLeft > 0) {
    f.rerollsLeft -= 1
    before = playerFaces
    const i = lowestIndex(playerFaces)
    const fresh = face(f.mods.dice[i] as number)
    playerFaces = playerFaces.map((v, j) => (j === i ? Math.max(v, fresh) : v))
    playerTotal = sum(playerFaces) + playerBonusApplied
  }
  if (clamps > 0) triggers.push({ id: 'weightedDice', text: `Weighted Dice +${clampPips}` })
  if (before !== null) triggers.push({ id: 'secondWind', text: 'Second Wind reroll' })
  const tied = playerTotal === enemyTotal
  const tieBreak = tied && f.mods.tieDamage > 0
  const luckyTie = tied && !tieBreak && f.enemy.trait === 'lucky'
  const winner = playerTotal > enemyTotal || tieBreak ? 'player' : enemyTotal > playerTotal || luckyTie ? 'enemy' : 'tie'
  let playerCritSource: CritSource | null = null
  if (winner === 'player' && !tieBreak) {
    f.hitsLanded += 1
    playerCritSource = critSourceFor(f, playerFaces, f.hitsLanded)
  }
  const playerCrit = playerCritSource !== null
  const enemyCrit = winner === 'enemy' && !luckyTie && hasDoubles(enemyFaces)
  const playerCritFactor = playerCritSource === 'combo' ? f.mods.comboCritFactor : playerCrit ? f.mods.critFactor : 1
  const baseEnemyFactor = enemyCrit ? enemyBaseCritFactor(f) : 1
  const enemyCritFactor = enemyCrit ? Math.max(1, baseEnemyFactor - f.mods.enemyCritStep) : 1
  if (playerCritSource !== null) {
    const t = CRIT_TRIGGER[playerCritSource]
    if (t) triggers.push(t)
  }
  let damageDealt = 0
  let damageTaken = 0
  let blocked = 0
  let thickSkinReduced = 0
  let ironGuardReduced = 0
  let sharpBladeBonus = 0
  let bloodlustBonus = 0
  let thornDamage = 0
  let riposteDamage = 0
  let healed = 0
  let enemyHealed = 0
  if (winner === 'player') {
    let raw: number
    if (tieBreak) {
      raw = f.mods.tieDamage
      triggers.push({ id: 'tieBreaker', text: `Tie Breaker ${f.mods.tieDamage}` })
    } else {
      sharpBladeBonus = f.mods.damageBonus
      bloodlustBonus = f.enemyHp < f.enemyMaxHp ? f.mods.bloodlustDamage : 0
      raw = (playerTotal - enemyTotal) * playerCritFactor + sharpBladeBonus + bloodlustBonus
      const armor = enemyArmor(f)
      if (armor > 0) raw = Math.max(1, raw - armor)
      if (sharpBladeBonus > 0) triggers.push({ id: 'sharpBlade', text: `Sharp Blade +${sharpBladeBonus}` })
      if (bloodlustBonus > 0) triggers.push({ id: 'bloodlust', text: `Bloodlust +${bloodlustBonus}` })
    }
    damageDealt = Math.min(raw, f.enemyHp)
    f.enemyHp -= damageDealt
    f.damageDealt += damageDealt
    if (damageDealt > 0 && !tieBreak) {
      if (f.mods.healOnHit > 0) {
        healed = Math.min(f.mods.healOnHit, f.playerMaxHp - f.playerHp)
        f.playerHp += healed
        if (healed > 0) triggers.push({ id: 'vampire', text: `Vampire +${healed}` })
      }
      if (f.enemy.trait === 'thorny') {
        thornDamage = Math.min(CONFIG.traitThornDamage, Math.max(0, f.playerHp - 1))
        f.playerHp -= thornDamage
      }
    }
  } else if (winner === 'enemy') {
    let raw: number
    if (luckyTie) {
      raw = Math.max(1, CONFIG.traitLuckyTieDamage - f.mods.damageReduction)
      thickSkinReduced = CONFIG.traitLuckyTieDamage - raw
    } else {
      const diff = enemyTotal - playerTotal
      const flat = enemyFlatDamage(f)
      const full = diff * baseEnemyFactor + flat
      const guarded = diff * enemyCritFactor + flat
      ironGuardReduced = full - guarded
      raw = Math.max(1, guarded - f.mods.damageReduction)
      thickSkinReduced = guarded - raw
    }
    if (ironGuardReduced > 0) triggers.push({ id: 'ironGuard', text: `Iron Guard -${ironGuardReduced}` })
    if (thickSkinReduced > 0) triggers.push({ id: 'thickSkin', text: `Thick Skin -${thickSkinReduced}` })
    if (f.shieldsLeft > 0) {
      f.shieldsLeft -= 1
      blocked = Math.min(raw, f.mods.shieldBlock)
      raw -= blocked
      if (blocked > 0) triggers.push({ id: 'shield', text: `Shield -${blocked}` })
    }
    damageTaken = Math.min(raw, f.playerHp)
    f.playerHp -= damageTaken
    const heal = enemyHealOnHit(f)
    if (damageTaken > 0 && heal > 0 && f.enemyHp > 0) {
      const h = Math.min(heal, f.enemyMaxHp - f.enemyHp)
      enemyHealed += h
      f.enemyHp += h
    }
    if (!luckyTie && f.mods.riposteDamage > 0 && f.playerHp > 0 && enemyTotal - playerTotal <= f.mods.riposteMargin) {
      riposteDamage = Math.min(f.mods.riposteDamage, f.enemyHp)
      f.enemyHp -= riposteDamage
      f.damageDealt += riposteDamage
      damageDealt = riposteDamage
      if (riposteDamage > 0) triggers.push({ id: 'riposte', text: `Riposte ${riposteDamage}` })
    }
  }
  if (f.enemy.trait === 'regenerate' && f.enemyHp > 0) {
    const h = Math.min(CONFIG.bossRegenerateHp, f.enemyMaxHp - f.enemyHp)
    enemyHealed += h
    f.enemyHp += h
  }
  const prev = f.multiplierMilli
  let next = damageMultiplierMilli(f.enemyMaxHp - f.enemyHp, f.enemyMaxHp, f.fullKoMilli)
  if (next < 0) next = 0
  if (f.enemyHp <= 0) {
    next += f.koBonusMilli
    f.status = 'won'
    if (f.mods.koBonusMilli > 0) triggers.push({ id: 'finisher', text: `Finisher +${f.mods.koBonusMilli / MILLI}x` })
  } else if (f.playerHp <= 0) {
    f.status = 'lost'
  }
  f.multiplierMilli = next
  const record: ExchangeRecord = {
    index: f.exchanges.length,
    playerFaces,
    playerFacesBeforeReroll: before,
    rerolled: before !== null,
    enemyFaces,
    playerTotal,
    enemyTotal,
    playerBonusApplied,
    enemyBonusApplied,
    winner,
    tieBreak,
    playerCrit,
    enemyCrit,
    playerCritFactor,
    enemyCritFactor,
    playerCritSource,
    damageDealt,
    damageTaken,
    blocked,
    blockedBy: blocked > 0 ? 'shield' : null,
    thickSkinReduced,
    ironGuardReduced,
    sharpBladeBonus,
    bloodlustBonus,
    weightedDiceClamps: clamps,
    cursedClamps: cursed,
    thornDamage,
    riposteDamage,
    healed,
    enemyHealed,
    playerHpAfter: f.playerHp,
    enemyHpAfter: f.enemyHp,
    multiplierGained: (next - prev) / MILLI,
    multiplierGainedMilli: next - prev,
    multiplierAfterMilli: next,
    upgradeTriggers: triggers,
  }
  f.exchanges = [...f.exchanges, record]
  return record
}

export function currentWalkAwayParts(f: SimFight): WalkAwayParts {
  return walkAwayPartsAt(f.bet, f.multiplierMilli, f.mods.walkAwayRefundMilli, f.mods.walkAwayKeepMilli)
}

export function currentWalkAwayPayout(f: SimFight): number {
  return currentWalkAwayParts(f).total
}

export function canWalkAway(f: SimFight): boolean {
  return f.status === 'active' && f.exchanges.length > 0 && currentWalkAwayPayout(f) >= 1
}

export function fightPayout(f: SimFight): number {
  if (f.status === 'won') return payoutAt(f.bet, f.multiplierMilli)
  if (f.status === 'walkedAway') return currentWalkAwayPayout(f)
  if (f.status === 'lost') return lossPayoutAt(f.bet, f.mods.lossRefundMilli)
  return 0
}

export function resultTriggers(f: SimFight): UpgradeTrigger[] {
  const out: UpgradeTrigger[] = []
  if (f.status === 'won' && f.mods.koBonusMilli > 0) {
    out.push({ id: 'finisher', text: `Finisher +${payoutAt(f.bet, f.mods.koBonusMilli)} coins` })
  }
  if (f.status === 'lost' && f.mods.lossRefundMilli > 0) {
    const refund = lossPayoutAt(f.bet, f.mods.lossRefundMilli)
    if (refund > 0) out.push({ id: 'insurance', text: `Insurance +${refund}` })
  }
  if (f.status === 'walkedAway' && f.mods.walkAwayRefundMilli > CONFIG.walkAwayRefundMilli) {
    const extra = payoutAt(f.bet, f.mods.walkAwayRefundMilli) - payoutAt(f.bet, CONFIG.walkAwayRefundMilli)
    if (extra > 0) out.push({ id: 'escapeRope', text: `Escape Rope +${extra}` })
  }
  return out
}
