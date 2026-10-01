import type { Action, ExchangeRecord, FightStatus, GameState, UpgradeId, UpgradeTrigger } from '../core/index.ts'
import type { Cue } from './feedback.ts'
import { isRiposte } from './format.ts'

export type TagTone = 'good' | 'bad' | 'gold' | 'info'

export type TagSide = 'player' | 'enemy'

export interface UpgradeTag {
  readonly upgrade: UpgradeId
  readonly text: string
  readonly tone: TagTone
  readonly side: TagSide
}

const TRIGGER_STYLE: Readonly<Record<UpgradeId, { readonly tone: TagTone; readonly side: TagSide }>> = {
  weightedDice: { tone: 'info', side: 'player' },
  sharpBlade: { tone: 'gold', side: 'player' },
  secondWind: { tone: 'info', side: 'player' },
  vitality: { tone: 'good', side: 'player' },
  shield: { tone: 'info', side: 'player' },
  loadedDice: { tone: 'gold', side: 'player' },
  escapeRope: { tone: 'info', side: 'player' },
  insurance: { tone: 'good', side: 'player' },
  finisher: { tone: 'gold', side: 'player' },
  intimidate: { tone: 'info', side: 'enemy' },
  vampire: { tone: 'good', side: 'player' },
  thickSkin: { tone: 'info', side: 'player' },
  tieBreaker: { tone: 'gold', side: 'player' },
  firstBlood: { tone: 'gold', side: 'player' },
  ironGuard: { tone: 'info', side: 'player' },
  combo: { tone: 'gold', side: 'player' },
  riposte: { tone: 'gold', side: 'player' },
  bloodlust: { tone: 'gold', side: 'player' },
}

export function triggerTags(triggers: ReadonlyArray<UpgradeTrigger>): UpgradeTag[] {
  return triggers.map((t) => {
    const style = TRIGGER_STYLE[t.id]
    return { upgrade: t.id, text: t.text, tone: style.tone, side: style.side }
  })
}

export function isKnockout(ex: ExchangeRecord): boolean {
  return ex.enemyHpAfter <= 0 && (ex.winner === 'player' || isRiposte(ex))
}

export function exchangeCues(ex: ExchangeRecord, status: FightStatus): Cue[] {
  const cues: Cue[] = []
  const riposte = isRiposte(ex)
  if (ex.damageDealt > 0 && !riposte) cues.push(ex.playerCritFactor > 1 ? 'crit' : 'hitDealt')
  if (ex.damageTaken > 0 || ex.thornDamage > 0) {
    cues.push('hitTaken')
    if (ex.enemyCritFactor > 1) cues.push('crit')
  }
  if (ex.blocked > 0) cues.push('block')
  if (ex.healed > 0) cues.push('heal')
  if (riposte) cues.push('hitDealt')
  if (status === 'won') cues.push('koWin')
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
      return ['coins']
    case 'skip':
      return []
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
