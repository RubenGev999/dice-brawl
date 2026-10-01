import { CONFIG, MILLI } from './config.ts'
import type { LevelDef } from './config.ts'
import type { LevelInfo } from './types.ts'

export function levelDef(level: number): LevelDef {
  const table = CONFIG.levels
  const n = table.length
  const l = Math.max(1, Math.floor(level))
  if (l <= n) return table[l - 1] as LevelDef
  const last = table[n - 1] as LevelDef
  const over = l - n
  return {
    ...last,
    enemyBonusMilli: last.enemyBonusMilli + over * CONFIG.levelOverflowBonusMilli,
    enemyHpBonus: last.enemyHpBonus + Math.floor(over / CONFIG.levelOverflowHpEvery),
  }
}

export function koMultiplierMilliForLevel(level: number, isBoss: boolean): number {
  const d = levelDef(level)
  return isBoss ? d.bossFullKoMilli + d.bossKoBonusMilli : d.fullKoMilli + d.koBonusMilli
}

export function enemyBonusMilliFor(level: number, fightInLevel: number): number {
  const d = levelDef(level)
  const base = d.enemyBonusMilli + fightInLevel * CONFIG.enemyBonusStepMilli
  return fightInLevel === CONFIG.fightsPerStage - 1 ? base + d.bossBonusMilli : base
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `${n}` : ''
}

function roundMilli(m: number): number {
  return Math.floor((m + MILLI / 2) / MILLI)
}

function maxWinMilli(level: number): number {
  const ko = BigInt(koMultiplierMilliForLevel(level, false))
  const boss = BigInt(koMultiplierMilliForLevel(level, true))
  const m = BigInt(MILLI)
  let total = m
  for (let i = 0; i < CONFIG.fightsPerStage - 1; i++) total = (total * ko) / m
  total = (total * boss) / m
  return Number(total)
}

export function levelInfo(level: number): LevelInfo {
  const l = Math.max(1, Math.floor(level))
  const d = levelDef(l)
  const ko = koMultiplierMilliForLevel(l, false)
  const boss = koMultiplierMilliForLevel(l, true)
  const normals = CONFIG.fightsPerStage - 1
  const first = enemyBonusMilliFor(l, 0)
  const lastNormal = enemyBonusMilliFor(l, normals - 1)
  const bossBonus = enemyBonusMilliFor(l, normals)
  const avgNormal = Math.floor((first + lastNormal) / 2)
  const dice = `${CONFIG.enemyDice.length}d${CONFIG.enemyDice[0] as number}`
  const hpMin = Math.max(CONFIG.enemyMinHp, CONFIG.enemyBaseHp + d.enemyHpBonus)
  return {
    level: l,
    difficultyLabel: d.label,
    koMultiplier: ko / MILLI,
    koMultiplierMilli: ko,
    bossKoMultiplier: boss / MILLI,
    bossKoMultiplierMilli: boss,
    targetGrowthPercent: d.targetGrowthPercent,
    enemyDiceText: `${dice}${signed(roundMilli(avgNormal))}`,
    bossDiceText: `${dice}${signed(roundMilli(bossBonus))}`,
    enemyBonusMin: Math.floor(first / MILLI),
    enemyBonusMax: Math.ceil(lastNormal / MILLI),
    enemyHpMin: hpMin,
    enemyHpMax: hpMin + CONFIG.enemyHpSpread,
    maxWinPerLevel: maxWinMilli(l) / MILLI,
  }
}
