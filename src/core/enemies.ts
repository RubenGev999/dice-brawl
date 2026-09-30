import { CONFIG } from './config.ts'
import { createStream } from './rng.ts'
import type { Rng } from './rng.ts'
import type { BossTraitId, EnemyTraitId, NormalTraitId } from './types.ts'

export interface EnemyDef {
  readonly name: string
  readonly isBoss: boolean
  readonly maxHp: number
  readonly dice: ReadonlyArray<number>
  readonly bonus: number
  readonly trait: EnemyTraitId
}

export const NORMAL_TRAITS: ReadonlyArray<NormalTraitId> = [
  'plain',
  'tough',
  'brute',
  'armored',
  'savage',
  'vicious',
  'lucky',
]

export const BOSS_TRAITS: ReadonlyArray<BossTraitId> = ['enrage', 'regenerate', 'ironhide', 'executioner']

export function stageOfFight(fightIndex: number): number {
  return Math.floor(fightIndex / CONFIG.fightsPerStage) + 1
}

export function isBossFight(fightIndex: number): boolean {
  return fightIndex % CONFIG.fightsPerStage === CONFIG.fightsPerStage - 1
}

export function traitText(trait: EnemyTraitId): string {
  switch (trait) {
    case 'tough':
      return `Tough: ${CONFIG.traitToughHpPercent - 100}% more HP.`
    case 'brute':
      return `Brute: +${CONFIG.traitBruteBonus} to every roll.`
    case 'armored':
      return `Armored: your hits deal ${CONFIG.traitArmorReduction} less damage (min 1).`
    case 'savage':
      return `Savage: its doubles deal x${CONFIG.traitSavageCritFactor} damage.`
    case 'vicious':
      return `Vicious: its hits deal +${CONFIG.traitViciousDamage} damage.`
    case 'lucky':
      return `Lucky: it wins ties, dealing ${CONFIG.traitLuckyTieDamage} damage.`
    case 'enrage':
      return `Enrage: +${CONFIG.bossEnrageBonus} to every roll once below half HP.`
    case 'regenerate':
      return `Regenerate: heals ${CONFIG.bossRegenerateHp} HP after every roll it survives.`
    case 'ironhide':
      return `Ironhide: your hits deal ${CONFIG.bossIronhideReduction} less damage (min 1).`
    case 'executioner':
      return `Executioner: its hits deal +${CONFIG.bossExecutionerDamage} damage.`
    default:
      return 'Plain: no special tricks.'
  }
}

export function diceText(dice: ReadonlyArray<number>, bonus: number): string {
  const counts = new Map<number, number>()
  for (const d of dice) counts.set(d, (counts.get(d) ?? 0) + 1)
  const parts = [...counts.entries()].sort((a, b) => b[0] - a[0]).map(([sides, n]) => `${n}d${sides}`)
  const base = parts.join('+')
  return bonus > 0 ? `${base}+${bonus}` : bonus < 0 ? `${base}${bonus}` : base
}

export function enemyBonusMilliForFight(fightIndex: number): number {
  const k = Math.min(fightIndex, CONFIG.enemyBonusRampFights)
  const late = Math.max(0, fightIndex - CONFIG.enemyBonusRampFights)
  const ramp = k * CONFIG.enemyBonusPerFightMilli - Math.floor((k * k * CONFIG.enemyBonusCurveMicro) / 1000)
  return CONFIG.enemyBaseBonusMilli + ramp + late * CONFIG.enemyBonusLatePerFightMilli
}

export function bossBonusMilliForStage(stage: number): number {
  return CONFIG.bossBonusMilli + (stage - 1) * CONFIG.bossBonusPerStageMilli
}

function pickWeighted<T extends string>(rng: Rng, order: ReadonlyArray<T>, weights: Readonly<Record<T, number>>): T {
  const total = order.reduce((sum, t) => sum + weights[t], 0)
  let roll = rng.int(0, total - 1)
  for (const t of order) {
    if (roll < weights[t]) return t
    roll -= weights[t]
  }
  return order[0] as T
}

export function generateEnemy(seed: number, fightIndex: number): EnemyDef {
  const rng = createStream(seed, 'enemy', fightIndex)
  const boss = isBossFight(fightIndex)
  const name = rng.pick(boss ? CONFIG.bossNames : CONFIG.enemyNames)
  const trait: EnemyTraitId = boss
    ? pickWeighted(rng, BOSS_TRAITS, CONFIG.bossTraitWeights)
    : pickWeighted(rng, NORMAL_TRAITS, CONFIG.enemyTraitWeights)
  let maxHp =
    CONFIG.enemyBaseHp + Math.floor((fightIndex * CONFIG.enemyHpPerFightMilli) / 1000) + rng.int(0, CONFIG.enemyHpSpread)
  if (trait === 'tough') maxHp = Math.floor((maxHp * CONFIG.traitToughHpPercent) / 100)
  if (boss) maxHp += CONFIG.bossExtraHp
  const bonusMilli = enemyBonusMilliForFight(fightIndex) + (boss ? bossBonusMilliForStage(stageOfFight(fightIndex)) : 0)
  const whole = Math.floor(bonusMilli / 1000)
  let bonus = whole + (rng.int(0, 999) < bonusMilli - whole * 1000 ? 1 : 0)
  if (trait === 'brute') bonus += CONFIG.traitBruteBonus
  return { name, isBoss: boss, maxHp: Math.max(CONFIG.enemyMinHp, maxHp), dice: CONFIG.enemyDice, bonus, trait }
}
