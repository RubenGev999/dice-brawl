import { computeMods, hasDoubles, koBonusMilliFor, MILLI } from '../core/index.ts'
import type { Action, ExchangeRecord, FightResult, FightState, FightStatus, GameState, UpgradeId } from '../core/index.ts'
import type { Cue } from './feedback.ts'

export type Owned = Readonly<Partial<Record<UpgradeId, number>>>

export type TagTone = 'good' | 'bad' | 'gold' | 'info'

export type TagSide = 'player' | 'enemy'

export interface UpgradeTag {
  readonly upgrade: UpgradeId
  readonly text: string
  readonly tone: TagTone
  readonly side: TagSide
}

export function ownedFrom(upgrades: ReadonlyArray<{ readonly id: UpgradeId }>): Owned {
  const out: Partial<Record<UpgradeId, number>> = {}
  for (const u of upgrades) out[u.id] = (out[u.id] ?? 0) + 1
  return out
}

export function ownedIds(owned: Owned): UpgradeId[] {
  const ids: UpgradeId[] = []
  for (const [id, n] of Object.entries(owned) as Array<[UpgradeId, number]>) for (let i = 0; i < n; i++) ids.push(id)
  return ids
}

function has(owned: Owned, id: UpgradeId): boolean {
  return (owned[id] ?? 0) > 0
}

function trimNumber(n: number): string {
  return String(Number(n.toFixed(2)))
}

export function isKnockout(ex: ExchangeRecord): boolean {
  return ex.winner === 'player' && ex.enemyHpAfter <= 0
}

export function finisherBonus(fight: Pick<FightState, 'isBoss' | 'koBonusMultiplier'>): number {
  const base = koBonusMilliFor(fight.isBoss, computeMods([])) / MILLI
  const extra = fight.koBonusMultiplier - base
  return extra > 1e-9 ? extra : 0
}

export function exchangeTags(ex: ExchangeRecord, fight: FightState, owned: Owned): UpgradeTag[] {
  const tags: UpgradeTag[] = []
  if (ex.blocked > 0 && has(owned, 'shield')) tags.push({ upgrade: 'shield', text: `Shield -${ex.blocked}`, tone: 'info', side: 'player' })
  if (ex.rerolled && has(owned, 'secondWind')) tags.push({ upgrade: 'secondWind', text: 'Second Wind', tone: 'info', side: 'player' })
  if (ex.healed > 0 && has(owned, 'vampire')) tags.push({ upgrade: 'vampire', text: `Vampire +${ex.healed}`, tone: 'good', side: 'player' })
  if (ex.winner === 'player' && ex.damageDealt > 0 && fight.player.damageBonus > 0 && has(owned, 'sharpBlade')) {
    const diff = ex.playerTotal - ex.enemyTotal
    if (ex.damageDealt === diff * ex.playerCritFactor + fight.player.damageBonus) {
      tags.push({ upgrade: 'sharpBlade', text: `Sharp Blade +${fight.player.damageBonus}`, tone: 'gold', side: 'player' })
    }
  }
  if (ex.playerCrit && has(owned, 'loadedDice') && !hasDoubles(ex.playerFaces)) {
    tags.push({ upgrade: 'loadedDice', text: 'Loaded Dice crit', tone: 'gold', side: 'player' })
  }
  if (ex.escaped && has(owned, 'escapeRope')) tags.push({ upgrade: 'escapeRope', text: 'Escape Rope!', tone: 'info', side: 'player' })
  if (isKnockout(ex) && has(owned, 'finisher')) {
    const extra = finisherBonus(fight)
    if (extra > 0) tags.push({ upgrade: 'finisher', text: `Finisher +${trimNumber(extra)}x`, tone: 'gold', side: 'player' })
  }
  return tags
}

export function resultTags(result: Pick<FightResult, 'outcome' | 'payout'>, owned: Owned): UpgradeTag[] {
  if (result.outcome === 'lost' && result.payout > 0 && has(owned, 'insurance')) {
    return [{ upgrade: 'insurance', text: `Insurance +${result.payout}`, tone: 'good', side: 'player' }]
  }
  return []
}

export function fightStartTags(fight: Pick<FightState, 'player' | 'exchanges'>, owned: Owned): UpgradeTag[] {
  if (fight.exchanges.length > 0) return []
  const tags: UpgradeTag[] = []
  const base = computeMods([])
  const mods = computeMods(ownedIds(owned))
  const extraHp = fight.player.maxHp - base.maxHp
  if (extraHp > 0 && has(owned, 'vitality')) tags.push({ upgrade: 'vitality', text: `Vitality +${extraHp} HP`, tone: 'good', side: 'player' })
  if (fight.player.minFace > base.minFace && has(owned, 'weightedDice')) {
    tags.push({ upgrade: 'weightedDice', text: `Weighted Dice min ${fight.player.minFace}`, tone: 'info', side: 'player' })
  }
  if (mods.enemyHpCutPercent > 0 && has(owned, 'intimidate')) {
    tags.push({ upgrade: 'intimidate', text: `Intimidate -${mods.enemyHpCutPercent}% HP`, tone: 'info', side: 'enemy' })
  }
  return tags
}

export function exchangeCues(ex: ExchangeRecord, status: FightStatus): Cue[] {
  const cues: Cue[] = []
  if (ex.damageDealt > 0) cues.push(ex.playerCritFactor > 1 ? 'crit' : 'hitDealt')
  if (ex.damageTaken > 0) {
    cues.push('hitTaken')
    if (ex.enemyCritFactor > 1) cues.push('crit')
  }
  if (ex.blocked > 0) cues.push('block')
  if (ex.healed > 0) cues.push('heal')
  if (ex.escaped || status === 'escaped') cues.push('escape')
  else if (status === 'won') cues.push('koWin')
  else if (status === 'lost') cues.push('koLoss')
  return cues
}

export function transitionCues(next: Pick<GameState, 'phase' | 'gameOverReason' | 'fight'>, action: Action): Cue[] {
  switch (action.type) {
    case 'roll':
      return ['roll']
    case 'bet':
      return next.fight && next.fight.isBoss ? ['boss'] : []
    case 'continue':
      if (next.phase === 'checkpoint') return ['stageCleared']
      if (next.phase === 'gameover' && next.gameOverReason === 'checkpoint') return ['failed']
      return []
    case 'pickUpgrade':
      return ['upgrade']
    case 'walkAway':
    case 'leave':
    case 'skip':
    case 'pawn':
      return ['coins']
  }
}

export type Celebration = 'none' | 'ko' | 'boss' | 'loss'

export function fightCelebration(status: FightStatus, isBoss: boolean): Celebration {
  if (status === 'won') return isBoss ? 'boss' : 'ko'
  if (status === 'lost') return 'loss'
  return 'none'
}

export const PARTICLE_CAP = 48

export function coinBurstCount(kind: Celebration): number {
  if (kind === 'boss') return 24
  if (kind === 'ko') return 10
  return 0
}

export function confettiCount(): number {
  return 40
}

export function cappedParticles(requested: number, alreadyActive: number): number {
  return Math.max(0, Math.min(requested, PARTICLE_CAP - alreadyActive))
}

export function bossBanner(kind: Celebration): string | null {
  return kind === 'boss' ? 'BOSS DEFEATED' : null
}

export function checkpointCountRange(cp: { readonly entryBankroll: number }, bankroll: number): { from: number; to: number } {
  return { from: Math.min(cp.entryBankroll, bankroll), to: bankroll }
}
