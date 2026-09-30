export type Phase = 'bet' | 'fight' | 'result' | 'checkpoint' | 'shop' | 'gameover'

export type Action =
  | { type: 'bet'; amount: number }
  | { type: 'roll' }
  | { type: 'walkAway' }
  | { type: 'continue' }
  | { type: 'leave' }
  | { type: 'pickUpgrade'; index: number }
  | { type: 'skip' }
  | { type: 'pawn'; index: number }

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

export interface UpgradeDef {
  readonly id: UpgradeId
  readonly name: string
  readonly description: string
  readonly maxCopies: number
}

export interface Upgrade extends UpgradeDef {
  readonly pawnValue: number
}

export interface ShopOffer extends Upgrade {
  readonly owned: number
}

export type NormalTraitId = 'plain' | 'tough' | 'brute' | 'armored' | 'savage' | 'vicious' | 'lucky'

export type BossTraitId = 'enrage' | 'regenerate' | 'ironhide' | 'executioner'

export type EnemyTraitId = NormalTraitId | BossTraitId

export interface EnemyState {
  readonly name: string
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
  readonly damageBonus: number
  readonly bonus: number
  readonly diceText: string
  readonly shieldsLeft: number
  readonly rerollsLeft: number
  readonly hasEscapeRope: boolean
}

export type ExchangeWinner = 'player' | 'enemy' | 'tie'

export interface ExchangeRecord {
  readonly index: number
  readonly playerFaces: ReadonlyArray<number>
  readonly playerFacesBeforeReroll: ReadonlyArray<number> | null
  readonly rerolled: boolean
  readonly enemyFaces: ReadonlyArray<number>
  readonly playerTotal: number
  readonly enemyTotal: number
  readonly winner: ExchangeWinner
  readonly playerCrit: boolean
  readonly enemyCrit: boolean
  readonly playerCritFactor: number
  readonly enemyCritFactor: number
  readonly damageDealt: number
  readonly damageTaken: number
  readonly blocked: number
  readonly healed: number
  readonly enemyHealed: number
  readonly escaped: boolean
  readonly playerHpAfter: number
  readonly enemyHpAfter: number
  readonly multiplierGained: number
  readonly multiplierGainedMilli: number
  readonly multiplierAfterMilli: number
}

export type FightStatus = 'active' | 'won' | 'lost' | 'walkedAway' | 'escaped'

export interface FightState {
  readonly index: number
  readonly stageOfFight: number
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
  readonly walkAwayKeep: number
  readonly lossRefund: number
  readonly canWalkAway: boolean
  readonly canRoll: boolean
  readonly exchanges: ReadonlyArray<ExchangeRecord>
}

export type FightOutcome = 'won' | 'lost' | 'walkedAway' | 'escaped'

export interface FightResult {
  readonly outcome: FightOutcome
  readonly isBoss: boolean
  readonly bet: number
  readonly multiplier: number
  readonly multiplierMilli: number
  readonly payout: number
  readonly rolls: number
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
  readonly skipCoins: number
  readonly pawnValue: number
  readonly canPawn: boolean
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
