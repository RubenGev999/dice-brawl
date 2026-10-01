export type Phase = 'bet' | 'fight' | 'result' | 'checkpoint' | 'shop' | 'gameover'

export type Action =
  | { type: 'bet'; amount: number }
  | { type: 'roll' }
  | { type: 'walkAway' }
  | { type: 'continue' }
  | { type: 'leave' }
  | { type: 'pickUpgrade'; index: number }
  | { type: 'skip' }

export interface LogEntry {
  readonly tick: number
  readonly action: Action
}

export type UpgradeId =
  | 'weightedDice'
  | 'sharpBlade'
  | 'secondWind'
  | 'vitality'
  | 'shield'
  | 'loadedDice'
  | 'escapeRope'
  | 'insurance'
  | 'finisher'
  | 'intimidate'
  | 'vampire'
  | 'thickSkin'
  | 'tieBreaker'
  | 'firstBlood'
  | 'ironGuard'
  | 'combo'
  | 'riposte'
  | 'bloodlust'

export interface UpgradeDef {
  readonly id: UpgradeId
  readonly name: string
  readonly description: string
  readonly maxCopies: number
}

export type Upgrade = UpgradeDef

export interface ShopOffer extends Upgrade {
  readonly owned: number
}

export interface UpgradeTrigger {
  readonly id: UpgradeId
  readonly text: string
}

export type NormalTraitId =
  | 'plain'
  | 'tough'
  | 'brute'
  | 'armored'
  | 'savage'
  | 'vicious'
  | 'lucky'
  | 'frenzied'
  | 'leech'
  | 'thorny'
  | 'cursed'

export type BossTraitId =
  | 'enrage'
  | 'regenerate'
  | 'ironhide'
  | 'executioner'
  | 'colossus'
  | 'mighty'
  | 'vampiric'
  | 'crusher'

export type EnemyTraitId = NormalTraitId | BossTraitId

export type Archetype = 'humanoid' | 'beast' | 'blob' | 'skeleton' | 'golem' | 'caster' | 'other'

export interface EnemyState {
  readonly name: string
  readonly archetype: Archetype
  readonly isBoss: boolean
  readonly hp: number
  readonly maxHp: number
  readonly dice: ReadonlyArray<number>
  readonly bonus: number
  readonly currentBonus: number
  readonly diceText: string
  readonly trait: EnemyTraitId
  readonly traitText: string
}

export interface PlayerFightState {
  readonly hp: number
  readonly maxHp: number
  readonly dice: ReadonlyArray<number>
  readonly minFace: number
  readonly maxFace: number
  readonly damageBonus: number
  readonly bonus: number
  readonly currentBonus: number
  readonly diceText: string
  readonly shieldsLeft: number
  readonly rerollsLeft: number
  readonly hitsLanded: number
  readonly walkAwayRefundPercent: number
}

export type ExchangeWinner = 'player' | 'enemy' | 'tie'

export type CritSource = 'doubles' | 'loadedDice' | 'combo' | 'firstBlood'

export interface ExchangeRecord {
  readonly index: number
  readonly playerFaces: ReadonlyArray<number>
  readonly playerFacesBeforeReroll: ReadonlyArray<number> | null
  readonly rerolled: boolean
  readonly enemyFaces: ReadonlyArray<number>
  readonly playerTotal: number
  readonly enemyTotal: number
  readonly playerBonusApplied: number
  readonly enemyBonusApplied: number
  readonly winner: ExchangeWinner
  readonly tieBreak: boolean
  readonly playerCrit: boolean
  readonly enemyCrit: boolean
  readonly playerCritFactor: number
  readonly enemyCritFactor: number
  readonly playerCritSource: CritSource | null
  readonly damageDealt: number
  readonly damageTaken: number
  readonly blocked: number
  readonly blockedBy: 'shield' | null
  readonly thickSkinReduced: number
  readonly ironGuardReduced: number
  readonly sharpBladeBonus: number
  readonly bloodlustBonus: number
  readonly weightedDiceClamps: number
  readonly cursedClamps: number
  readonly thornDamage: number
  readonly riposteDamage: number
  readonly healed: number
  readonly enemyHealed: number
  readonly playerHpAfter: number
  readonly enemyHpAfter: number
  readonly multiplierGained: number
  readonly multiplierGainedMilli: number
  readonly multiplierAfterMilli: number
  readonly upgradeTriggers: ReadonlyArray<UpgradeTrigger>
}

export type FightStatus = 'active' | 'won' | 'lost' | 'walkedAway'

export interface LevelInfo {
  readonly level: number
  readonly difficultyLabel: string
  readonly koMultiplier: number
  readonly koMultiplierMilli: number
  readonly bossKoMultiplier: number
  readonly bossKoMultiplierMilli: number
  readonly targetGrowthPercent: number
  readonly enemyDiceText: string
  readonly bossDiceText: string
  readonly enemyBonusMin: number
  readonly enemyBonusMax: number
  readonly enemyHpMin: number
  readonly enemyHpMax: number
  readonly maxWinPerLevel: number
}

export interface FightState {
  readonly index: number
  readonly stageOfFight: number
  readonly level: number
  readonly isBoss: boolean
  readonly status: FightStatus
  readonly enemy: EnemyState
  readonly player: PlayerFightState
  readonly bet: number
  readonly multiplier: number
  readonly multiplierMilli: number
  readonly fullKoMultiplier: number
  readonly koBonusMultiplier: number
  readonly potentialPayout: number
  readonly koPayout: number
  readonly walkAwayPayout: number
  readonly walkAwayRefund: number
  readonly walkAwayFromEarned: number
  readonly walkAwayRefundPercent: number
  readonly walkAwayKeep: number
  readonly lossRefund: number
  readonly canWalkAway: boolean
  readonly canRoll: boolean
  readonly startTriggers: ReadonlyArray<UpgradeTrigger>
  readonly exchanges: ReadonlyArray<ExchangeRecord>
}

export type FightOutcome = 'won' | 'lost' | 'walkedAway'

export interface FightResult {
  readonly outcome: FightOutcome
  readonly isBoss: boolean
  readonly level: number
  readonly bet: number
  readonly multiplier: number
  readonly multiplierMilli: number
  readonly payout: number
  readonly rolls: number
  readonly walkAwayRefund: number
  readonly walkAwayFromEarned: number
  readonly upgradeTriggers: ReadonlyArray<UpgradeTrigger>
}

export type CheckpointOutcome = 'passed' | 'failed'

export interface CheckpointResult {
  readonly stage: number
  readonly entryBankroll: number
  readonly target: number
  readonly bankroll: number
  readonly outcome: CheckpointOutcome
}

export type GameOverReason = 'checkpoint' | 'broke' | 'left' | null

export type BetPresetId = 'low' | 'medium' | 'high' | 'max'

export interface BetPreset {
  readonly id: BetPresetId
  readonly label: string
  readonly percent: number
  readonly amount: number
  readonly isAllIn: boolean
}

export interface GameState {
  readonly rulesVersion: string
  readonly seed: number
  readonly buyIn: number
  readonly tick: number
  readonly phase: Phase
  readonly bankroll: number
  readonly bet: number
  readonly minBet: number
  readonly maxBet: number
  readonly betPresets: ReadonlyArray<BetPreset>
  readonly canBet: boolean
  readonly stage: number
  readonly level: number
  readonly levelInfo: LevelInfo
  readonly fightInStage: number
  readonly fightNumberInStage: number
  readonly fightsPerStage: number
  readonly stageEntryBankroll: number
  readonly target: number
  readonly isCheckpointFight: boolean
  readonly isBossFight: boolean
  readonly fightsCompleted: number
  readonly stagesCleared: number
  readonly bossesDefeated: number
  readonly upgrades: ReadonlyArray<Upgrade>
  readonly shopOffers: ReadonlyArray<ShopOffer>
  readonly canLeave: boolean
  readonly lastResult: FightResult | null
  readonly lastCheckpoint: CheckpointResult | null
  readonly gameOverReason: GameOverReason
  readonly cashOut: number | null
  readonly cashOutFee: number | null
  readonly failedCheckpointFeePercent: number
  readonly peakBankroll: number
  readonly totalWagered: number
  readonly totalPaidOut: number
  readonly fight: FightState | null
}

export interface Game {
  readonly state: GameState
  readonly log: ReadonlyArray<LogEntry>
  dispatch(action: Action): boolean
  tick(): void
}
