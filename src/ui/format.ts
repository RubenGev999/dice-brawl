import { levelDef } from '../core/index.ts'
import type {
  BetPreset,
  CheckpointResult,
  EnemyState,
  ExchangeRecord,
  FightOutcome,
  FightResult,
  FightState,
  GameOverReason,
  GameState,
  LevelInfo,
  PlayerFightState,
  ShopOffer,
  Upgrade,
} from '../core/index.ts'

export function formatMultiplier(m: number): string {
  return 'x' + m.toFixed(2)
}

export function formatCoins(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

export function formatNet(n: number): string {
  return (n >= 0 ? '+' : '-') + formatCoins(Math.abs(n))
}

export function parseSeed(search: string): number | null {
  const raw = new URLSearchParams(search).get('seed')
  if (raw === null || raw.trim() === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  return Math.floor(n) >>> 0
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 4294967296) >>> 0
}

export interface UpgradeGroup {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly count: number
}

export function groupUpgrades(upgrades: ReadonlyArray<Upgrade>): UpgradeGroup[] {
  const map = new Map<string, { id: string; name: string; description: string; count: number }>()
  for (const u of upgrades) {
    const g = map.get(u.id)
    if (g) g.count += 1
    else map.set(u.id, { id: u.id, name: u.name, description: u.description, count: 1 })
  }
  return [...map.values()]
}

export function chipLabel(g: UpgradeGroup): string {
  return g.count > 1 ? `${g.name} x${g.count}` : g.name
}

export interface ChipModel {
  readonly id: string
  readonly label: string
  readonly title: string
}

export function chipModels(upgrades: ReadonlyArray<Upgrade>): ChipModel[] {
  return groupUpgrades(upgrades).map((g) => ({ id: g.id, label: chipLabel(g), title: g.description }))
}

export function chipSignature(chips: ReadonlyArray<ChipModel>): string {
  return `chips:${chips.length}:` + chips.map((c) => `${c.label}${c.title}`).join('')
}

export function hpPercent(hp: number, maxHp: number): number {
  if (maxHp <= 0) return 0
  return Math.max(0, Math.min(100, (hp / maxHp) * 100))
}

export function critText(ex: Pick<ExchangeRecord, 'playerCritFactor' | 'enemyCritFactor'> & Partial<Pick<ExchangeRecord, 'playerCritSource'>>): string | null {
  if (ex.playerCritFactor > 1) {
    const f = ex.playerCritFactor
    switch (ex.playerCritSource) {
      case 'combo':
        return `COMBO x${f}`
      case 'firstBlood':
        return `FIRST BLOOD x${f}`
      case 'loadedDice':
        return `LOADED CRIT x${f}`
      case 'doubles':
      case null:
      case undefined:
        return `CRIT x${f}`
    }
  }
  if (ex.enemyCritFactor > 1) return `CRIT x${ex.enemyCritFactor}`
  return null
}

export function isRiposte(ex: Pick<ExchangeRecord, 'winner' | 'riposteDamage'>): boolean {
  return ex.winner === 'enemy' && ex.riposteDamage > 0
}

export function exchangeOutcome(ex: ExchangeRecord): string {
  const parts: string[] = []
  const crit = critText(ex)
  if (ex.winner === 'tie') {
    parts.push('Tie')
  } else if (ex.winner === 'player' && ex.tieBreak) {
    parts.push(`Tie Breaker hits for ${ex.damageDealt}`)
  } else if (ex.winner === 'player') {
    let text = (crit ? crit + '! ' : '') + `You hit for ${ex.damageDealt}`
    if (ex.healed > 0) text += ` (+${ex.healed} HP)`
    parts.push(text)
  } else if (ex.damageTaken <= 0 && ex.blocked > 0) {
    parts.push(`Blocked ${ex.blocked}!`)
  } else {
    let text = (crit ? crit + '! ' : '') + `Enemy hits for ${ex.damageTaken}`
    if (ex.blocked > 0) text += ` (${ex.blocked} blocked)`
    parts.push(text)
  }
  if (isRiposte(ex)) parts.push(`Riposte hits for ${ex.riposteDamage}`)
  if (ex.thornDamage > 0) parts.push(`Thorns hurt you for ${ex.thornDamage}`)
  if (ex.enemyHealed > 0) parts.push(`Enemy heals ${ex.enemyHealed}`)
  if (ex.cursedClamps > 0) parts.push(ex.cursedClamps === 1 ? 'Cursed: a 6 counts as 5' : `Cursed: ${ex.cursedClamps} sixes count as 5`)
  return parts.join(' | ')
}

export function exchangeTone(ex: ExchangeRecord): 'good' | 'bad' | 'neutral' {
  if (ex.winner === 'player') return 'good'
  if (ex.winner === 'enemy' && ex.damageTaken > 0) return 'bad'
  return 'neutral'
}

export function enrageNote(before: number, after: number): string | null {
  if (after > before) return `Enemy enraged: +${after - before} to rolls`
  if (after < before) return `Enemy calms: ${after - before} to rolls`
  return null
}

export function enemyTraitLine(enemy: Pick<EnemyState, 'traitText' | 'bonus' | 'currentBonus'>): string {
  if (enemy.currentBonus !== enemy.bonus) {
    const sign = enemy.currentBonus >= 0 ? '+' : ''
    return `${enemy.traitText} (rolls ${sign}${enemy.currentBonus} now)`
  }
  return enemy.traitText
}

export function chargesText(p: Pick<PlayerFightState, 'shieldsLeft' | 'rerollsLeft'> & Partial<Pick<PlayerFightState, 'maxFace'>>): string {
  const out: string[] = []
  if (p.shieldsLeft > 0) out.push(`Shield x${p.shieldsLeft}`)
  if (p.rerollsLeft > 0) out.push(`Reroll x${p.rerollsLeft}`)
  if (p.maxFace !== undefined && p.maxFace < 6) out.push(`Cursed: max face ${p.maxFace}`)
  return out.length > 0 ? out.join(' | ') : 'No charges'
}

export function fightTitle(outcome: FightOutcome, isBoss = false): string {
  switch (outcome) {
    case 'won':
      return isBoss ? 'Boss defeated!' : 'Knockout!'
    case 'lost':
      return isBoss ? 'The boss wins' : 'Knocked out'
    case 'walkedAway':
      return 'Walked away'
  }
}

export function outcomeTone(outcome: FightOutcome): 'good' | 'bad' {
  return outcome === 'lost' ? 'bad' : 'good'
}

export function checkpointHeadline(cp: Pick<CheckpointResult, 'stage'> | null): string {
  return cp ? `Level ${cp.stage} cleared` : 'Level cleared'
}

export function checkpointNet(bankroll: number, buyIn: number): string {
  return `${formatNet(bankroll - buyIn)} vs your buy-in of ${formatCoins(buyIn)}`
}

export function leaveLabel(bankroll: number): string {
  return `Leave with ${coinsText(bankroll)}`
}

export function continueLabel(nextLevel: number): string {
  return `Continue to level ${nextLevel}`
}

export function nextTargetLine(state: Pick<GameState, 'stage' | 'target'>): string {
  return `Reach ${formatCoins(state.target)} after the level ${state.stage} boss or the run ends there.`
}

export function stageNotice(state: Pick<GameState, 'lastCheckpoint' | 'target'>): string | null {
  const cp = state.lastCheckpoint
  if (!cp || cp.outcome !== 'passed') return null
  return `${checkpointHeadline(cp)}, new target ${formatCoins(state.target)}`
}

export function gameOverTitle(reason: GameOverReason): string {
  if (reason === 'left') return 'You left the arena'
  if (reason === 'broke') return 'Out of coins'
  if (reason === 'checkpoint') return 'Checkpoint failed'
  return 'Run over'
}

export function checkpointMissText(checkpoint: CheckpointResult | null, lastResult: Pick<FightResult, 'outcome' | 'isBoss'> | null = null): string {
  if (!checkpoint) return 'The boss checkpoint was failed.'
  const tail = `finished with ${formatCoins(checkpoint.bankroll)}, below the target of ${formatCoins(checkpoint.target)}`
  if (!lastResult || !lastResult.isBoss) return `You ${tail}.`
  switch (lastResult.outcome) {
    case 'won':
      return `You beat the boss but ${tail}.`
    case 'lost':
      return `The boss knocked you out and you ${tail}.`
    case 'walkedAway':
      return `You walked away from the boss and ${tail}.`
  }
}

export function gameOverText(
  reason: GameOverReason,
  checkpoint: CheckpointResult | null,
  cashOut: number | null = null,
  fee: number | null = null,
  feePercent: number | null = null,
  lastResult: Pick<FightResult, 'outcome' | 'isBoss'> | null = null,
): string {
  if (reason === 'checkpoint') {
    const head = checkpointMissText(checkpoint, lastResult)
    if (fee !== null && fee > 0 && cashOut !== null) {
      const share = feePercent === null ? 'A fee' : `A ${feePercent}% fee`
      return `${head} ${share} (${coinsText(fee)}) was withheld, so you get back ${coinsText(cashOut)}.`
    }
    if (cashOut !== null) return `${head} You get back ${coinsText(cashOut)}.`
    return head
  }
  if (reason === 'broke') return 'You ran out of coins. No coins come back from this run.'
  if (reason === 'left') {
    return cashOut === null ? 'You left after a cleared level. Leaving is free.' : `You left after a cleared level and took all ${coinsText(cashOut)}. Leaving is free.`
  }
  return 'The run is over.'
}

export interface SummaryRow {
  readonly label: string
  readonly value: string
  readonly tone?: 'good' | 'bad'
}

export function returnRows(
  s: Pick<GameState, 'gameOverReason' | 'cashOut' | 'cashOutFee' | 'failedCheckpointFeePercent' | 'buyIn' | 'lastCheckpoint'>,
): SummaryRow[] {
  const cashOut = s.cashOut ?? 0
  const fee = s.cashOutFee ?? 0
  const net = cashOut - s.buyIn
  const rows: SummaryRow[] = []
  if (s.gameOverReason === 'checkpoint') {
    const bankroll = s.lastCheckpoint ? s.lastCheckpoint.bankroll : cashOut + fee
    rows.push({ label: 'Bankroll at the end', value: formatCoins(bankroll) })
    rows.push({ label: `Fee withheld (${s.failedCheckpointFeePercent}%)`, value: fee > 0 ? `-${formatCoins(fee)}` : '0', tone: fee > 0 ? 'bad' : undefined })
  }
  rows.push({ label: 'Coins returned', value: formatCoins(cashOut) })
  rows.push({ label: 'Buy-in', value: formatCoins(s.buyIn) })
  rows.push({ label: 'Net vs buy-in', value: formatNet(net), tone: net >= 0 ? 'good' : 'bad' })
  return rows
}

export function runStatRows(s: Pick<GameState, 'fightsCompleted' | 'stagesCleared' | 'bossesDefeated' | 'peakBankroll' | 'totalWagered' | 'totalPaidOut' | 'seed'>): SummaryRow[] {
  return [
    { label: 'Fights', value: String(s.fightsCompleted) },
    { label: 'Levels cleared', value: String(s.stagesCleared) },
    { label: 'Bosses defeated', value: String(s.bossesDefeated) },
    { label: 'Peak bankroll', value: formatCoins(s.peakBankroll) },
    { label: 'Total wagered', value: formatCoins(s.totalWagered) },
    { label: 'Total paid out', value: formatCoins(s.totalPaidOut) },
    { label: 'Seed', value: String(s.seed) },
  ]
}

export function feeWarning(percent: number): string {
  return `Miss the target and ${percent}% of your coins are withheld`
}

export function leaveFreeLine(): string {
  return 'Leaving now is free. Continue only if you want to risk the next level.'
}

export type LobbyState = 'play' | 'refill'

export function lobbyState(balance: number, presets: ReadonlyArray<number>, minBuyIn: number): LobbyState {
  return presets.some((p) => p >= minBuyIn && p <= balance) ? 'play' : 'refill'
}

export interface HudView {
  readonly level: string
  readonly pips: Pip[]
  readonly fightText: string
  readonly boss: boolean
  readonly targetText: string
  readonly met: boolean
}

export function levelTitle(level: number, label: string): string {
  return `Level ${level} - ${label}`
}

export function hudView(
  s: Pick<GameState, 'phase' | 'level' | 'levelInfo' | 'fightInStage' | 'fightsPerStage' | 'fightNumberInStage' | 'isBossFight' | 'target' | 'bankroll' | 'lastCheckpoint'>,
): HudView {
  const cp = s.lastCheckpoint
  if (s.phase === 'checkpoint' && cp && cp.outcome === 'passed') {
    return {
      level: levelTitle(cp.stage, levelDef(cp.stage).label),
      pips: fightPips({ fightInStage: s.fightsPerStage, fightsPerStage: s.fightsPerStage }),
      fightText: `Level ${cp.stage} cleared`,
      boss: false,
      targetText: `Target ${formatCoins(cp.target)} reached`,
      met: true,
    }
  }
  return {
    level: levelTitle(s.level, s.levelInfo.difficultyLabel),
    pips: fightPips(s),
    fightText: fightLabel(s),
    boss: s.isBossFight,
    targetText: targetLine(s),
    met: targetMet(s),
  }
}

type ProfileInfo = Pick<LevelInfo, 'enemyDiceText' | 'bossDiceText' | 'koMultiplier' | 'bossKoMultiplier' | 'targetGrowthPercent'>

export function levelProfileLine(info: ProfileInfo, boss = false): string {
  const who = boss ? `Boss ${info.bossDiceText}` : `Enemies ${info.enemyDiceText}`
  const ko = boss ? info.bossKoMultiplier : info.koMultiplier
  return `${who} | Knockout ${formatMultiplier(ko)} | Target +${info.targetGrowthPercent}%`
}

export function levelFullProfileLine(info: ProfileInfo): string {
  return `Enemies ${info.enemyDiceText}, boss ${info.bossDiceText} | Knockout ${formatMultiplier(info.koMultiplier)}, boss ${formatMultiplier(info.bossKoMultiplier)} | Target +${info.targetGrowthPercent}%`
}

export function maxWinLine(info: Pick<LevelInfo, 'maxWinPerLevel'>): string {
  return `Max win this level: ${formatMultiplier(info.maxWinPerLevel)} your bankroll`
}

export function nextLevelTitle(info: Pick<LevelInfo, 'level' | 'difficultyLabel'>): string {
  return `Next: ${levelTitle(info.level, info.difficultyLabel)}`
}

export function levelsBlurb(): string {
  return 'Levels start easy and get harder and richer: tougher enemies, but bigger knockout payouts.'
}

export function walkAwayPercents(fight: Pick<FightState, 'walkAwayRefundPercent' | 'walkAwayKeep'> | null): { readonly refund: number | null; readonly keep: number | null } {
  return fight ? { refund: fight.walkAwayRefundPercent, keep: Math.round(fight.walkAwayKeep * 100) } : { refund: null, keep: null }
}

export function walkAwayRows(
  r: Pick<FightResult, 'outcome' | 'walkAwayRefund' | 'walkAwayFromEarned'>,
  refundPercent: number | null,
  keepPercent: number | null,
): SummaryRow[] {
  if (r.outcome !== 'walkedAway') return []
  const refundLabel = refundPercent === null ? 'Bet refund' : `Bet refund (${refundPercent}%)`
  const earnedLabel = keepPercent === null ? 'Share of earned payout' : `Share of earned payout (${keepPercent}%)`
  return [
    { label: refundLabel, value: formatCoins(r.walkAwayRefund) },
    { label: earnedLabel, value: formatCoins(r.walkAwayFromEarned) },
  ]
}

export function targetLine(state: Pick<GameState, 'target'>): string {
  return `Target ${formatCoins(state.target)} after the boss`
}

export function targetMet(state: Pick<GameState, 'bankroll' | 'target'>): boolean {
  return state.bankroll >= state.target
}

export type PipState = 'done' | 'current' | 'todo'

export interface Pip {
  readonly state: PipState
  readonly boss: boolean
}

export function fightPips(state: Pick<GameState, 'fightInStage' | 'fightsPerStage'>): Pip[] {
  const out: Pip[] = []
  for (let i = 0; i < state.fightsPerStage; i++) {
    const st: PipState = i < state.fightInStage ? 'done' : i === state.fightInStage ? 'current' : 'todo'
    out.push({ state: st, boss: i === state.fightsPerStage - 1 })
  }
  return out
}

export function fightLabel(state: Pick<GameState, 'fightNumberInStage' | 'fightsPerStage' | 'isBossFight'>): string {
  const base = `Fight ${state.fightNumberInStage} of ${state.fightsPerStage}`
  return state.isBossFight ? `${base} - Boss` : base
}

export interface PresetView {
  readonly id: BetPreset['id']
  readonly label: string
  readonly amount: number
  readonly allIn: boolean
}

export function visiblePresets(state: Pick<GameState, 'betPresets'>): PresetView[] {
  const out: PresetView[] = []
  for (const p of state.betPresets) {
    if (p.amount <= 0) continue
    const view: PresetView = { id: p.id, label: p.label, amount: p.amount, allIn: p.isAllIn || p.id === 'max' }
    const at = out.findIndex((o) => o.amount === p.amount)
    if (at === -1) out.push(view)
    else if (view.allIn) out[at] = view
  }
  return out
}

export function offerOwnedText(offer: Pick<ShopOffer, 'owned' | 'maxCopies'>): string | null {
  return offer.owned > 0 ? `Owned ${offer.owned} / ${offer.maxCopies}` : null
}

export function coinsWord(n: number): string {
  return n === 1 ? 'coin' : 'coins'
}

export function coinsText(n: number): string {
  return `${formatCoins(n)} ${coinsWord(n)}`
}

export function skipLabel(): string {
  return 'Skip'
}

export interface BuyInChoice {
  readonly amount: number
  readonly affordable: boolean
}

export function buyInChoices(presets: ReadonlyArray<number>, balance: number): BuyInChoice[] {
  return presets.map((amount) => ({ amount, affordable: amount <= balance }))
}

export function pickBuyIn(presets: ReadonlyArray<number>, balance: number, preferred: number, current: number | null): number | null {
  if (current !== null && presets.includes(current) && current <= balance) return current
  if (presets.includes(preferred) && preferred <= balance) return preferred
  const affordable = presets.filter((p) => p <= balance)
  if (affordable.length === 0) return null
  return Math.max(...affordable)
}

export function walletLine(balance: number): string {
  return coinsText(balance)
}

export function pipCells(face: number): number[] {
  switch (face) {
    case 1:
      return [4]
    case 2:
      return [0, 8]
    case 3:
      return [0, 4, 8]
    case 4:
      return [0, 2, 6, 8]
    case 5:
      return [0, 2, 4, 6, 8]
    case 6:
      return [0, 2, 3, 5, 6, 8]
    default:
      return []
  }
}
