import { CONFIG, MILLI } from './config.ts'
import type { Upgrade, UpgradeDef, UpgradeId } from './types.ts'

const e = CONFIG.upgradeEffects

function x(milli: number): string {
  return `${milli / MILLI}x`
}

function pct(milli: number): string {
  return `${Math.round(milli / 10)}%`
}

function capText(id: UpgradeId): string {
  const n = CONFIG.upgradeMaxCopies[id]
  return n <= 1 ? ' Max 1 copy.' : ` Stacks up to ${n}.`
}

function describe(id: UpgradeId): string {
  switch (id) {
    case 'weightedDice':
      return `Your dice never roll below ${1 + e.weightedDiceMinFaceStep}.`
    case 'sharpBlade':
      return `Your hits deal +${e.sharpBladeDamage} damage.`
    case 'secondWind':
      return `Once per fight per copy, a losing roll rerolls your lowest die and keeps the better.`
    case 'vitality':
      return `+${e.vitalityHp} max HP.`
    case 'shield':
      return `The first hit you take each fight deals ${e.shieldBlockAmount} less damage (one more hit per extra copy).`
    case 'loadedDice':
      return `Winning rolls that total ${e.loadedDiceCritTotal} or more also crit, not just doubles.`
    case 'escapeRope':
      return `When a hit would knock you out, you escape with the walk-away payout instead.`
    case 'insurance':
      return `Get ${pct(e.insuranceRefundMilli)} of your bet back when you lose a fight.`
    case 'finisher':
      return `Knockouts pay +${x(e.finisherKoBonusMilli)} more.`
    case 'intimidate':
      return `Enemies start with ${e.intimidateEnemyHpPercent}% less HP.`
    case 'vampire':
      return `Heal ${e.vampireHeal} HP whenever you land a hit.`
    case 'thickSkin':
      return `Take ${e.thickSkinReduction} less damage from every hit (min 1).`
  }
}

const NAMES: Readonly<Record<UpgradeId, string>> = {
  weightedDice: 'Weighted Dice',
  sharpBlade: 'Sharp Blade',
  secondWind: 'Second Wind',
  vitality: 'Vitality',
  shield: 'Shield',
  loadedDice: 'Loaded Dice',
  escapeRope: 'Escape Rope',
  insurance: 'Insurance',
  finisher: 'Finisher',
  intimidate: 'Intimidate',
  vampire: 'Vampire Fang',
  thickSkin: 'Thick Skin',
}

export const UPGRADE_IDS: ReadonlyArray<UpgradeId> = [
  'weightedDice',
  'sharpBlade',
  'secondWind',
  'vitality',
  'shield',
  'loadedDice',
  'escapeRope',
  'insurance',
  'finisher',
  'intimidate',
  'vampire',
  'thickSkin',
]

export function upgradeDef(id: UpgradeId): UpgradeDef {
  return {
    id,
    name: NAMES[id],
    description: `${describe(id)}${capText(id)}`,
    maxCopies: CONFIG.upgradeMaxCopies[id],
  }
}

export const UPGRADES: ReadonlyArray<UpgradeDef> = UPGRADE_IDS.map(upgradeDef)

export function skipPawnValue(buyIn: number): number {
  return Math.max(1, Math.floor((buyIn * CONFIG.skipPawnPermilleOfBuyIn) / 1000))
}

export function getUpgrade(id: UpgradeId, buyIn: number = CONFIG.defaultBuyIn): Upgrade {
  if (!UPGRADE_IDS.includes(id)) throw new Error(`Unknown upgrade ${id}`)
  return { ...upgradeDef(id), pawnValue: skipPawnValue(buyIn) }
}

export function countOwned(owned: ReadonlyArray<UpgradeId>, id: UpgradeId): number {
  let n = 0
  for (const o of owned) if (o === id) n++
  return n
}

export function isUseful(owned: ReadonlyArray<UpgradeId>, id: UpgradeId): boolean {
  return countOwned(owned, id) < CONFIG.upgradeMaxCopies[id]
}

export interface FightMods {
  readonly maxHp: number
  readonly dice: ReadonlyArray<number>
  readonly minFace: number
  readonly damageBonus: number
  readonly bonus: number
  readonly rerolls: number
  readonly shields: number
  readonly shieldBlock: number
  readonly critFactor: number
  readonly critTotal: number
  readonly walkAwayKeepMilli: number
  readonly escapeRope: boolean
  readonly lossRefundMilli: number
  readonly koBonusMilli: number
  readonly enemyHpCutPercent: number
  readonly healOnHit: number
  readonly damageReduction: number
}

export function computeMods(owned: ReadonlyArray<UpgradeId>): FightMods {
  const count = (id: UpgradeId): number => Math.min(CONFIG.upgradeMaxCopies[id], countOwned(owned, id))
  return {
    maxHp: CONFIG.playerBaseHp + count('vitality') * e.vitalityHp,
    dice: CONFIG.playerBaseDice,
    minFace: 1 + count('weightedDice') * e.weightedDiceMinFaceStep,
    damageBonus: count('sharpBlade') * e.sharpBladeDamage,
    bonus: CONFIG.playerBaseBonus,
    rerolls: count('secondWind') * e.secondWindRerolls,
    shields: count('shield'),
    shieldBlock: e.shieldBlockAmount,
    critFactor: CONFIG.critFactor,
    critTotal: count('loadedDice') > 0 ? e.loadedDiceCritTotal : 0,
    walkAwayKeepMilli: CONFIG.walkAwayKeepMilli,
    escapeRope: count('escapeRope') > 0,
    lossRefundMilli: count('insurance') * e.insuranceRefundMilli,
    koBonusMilli: count('finisher') * e.finisherKoBonusMilli,
    enemyHpCutPercent: count('intimidate') * e.intimidateEnemyHpPercent,
    healOnHit: count('vampire') * e.vampireHeal,
    damageReduction: count('thickSkin') * e.thickSkinReduction,
  }
}
