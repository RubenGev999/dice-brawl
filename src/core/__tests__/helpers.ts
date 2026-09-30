import { computeMods, createGame, createSimFight } from '../index.ts'
import type { EnemyDef, Game, Rng, SimFight, UpgradeId } from '../index.ts'

export function scriptedRng(values: number[]): Rng {
  const queue = [...values]
  const int = (min: number, max: number): number => {
    const v = queue.shift()
    if (v === undefined) throw new Error('scripted rng exhausted')
    return Math.max(min, Math.min(max, v))
  }
  return {
    nextU32: () => 0,
    next: () => 0,
    int,
    pick: <T>(items: ReadonlyArray<T>): T => items[0] as T,
  }
}

export const DUMMY: EnemyDef = { name: 'Dummy', isBoss: false, maxHp: 10, dice: [6, 6], bonus: 0, trait: 'plain' }

export const BOSS_DUMMY: EnemyDef = { name: 'Boss Dummy', isBoss: true, maxHp: 10, dice: [6, 6], bonus: 0, trait: 'enrage' }

export function scriptedFight(
  playerFaces: number[],
  enemyFaces: number[],
  upgrades: UpgradeId[] = [],
  enemy: EnemyDef = DUMMY,
  bet = 100,
): SimFight {
  const base = createSimFight(1, enemy.isBoss ? 4 : 0, bet, computeMods(upgrades), enemy)
  return { ...base, playerRng: scriptedRng(playerFaces), enemyRng: scriptedRng(enemyFaces) }
}

export function rollUntilDone(game: Game): void {
  for (let i = 0; i < 300 && game.state.phase === 'fight'; i++) game.dispatch({ type: 'roll' })
}

export function findSeed(predicate: (game: Game) => boolean, buyIn = 100, from = 1, to = 20000): Game {
  for (let seed = from; seed < to; seed++) {
    const game = createGame(seed, buyIn)
    if (predicate(game)) return game
  }
  throw new Error('no seed matched')
}

export function playFight(game: Game, amount: number): void {
  game.dispatch({ type: 'bet', amount })
  rollUntilDone(game)
}

export function playToBoss(game: Game, amount: (game: Game) => number): void {
  for (let k = 0; k < 4 && game.state.phase !== 'gameover'; k++) {
    if (game.state.canPawn) game.dispatch({ type: 'pawn', index: 0 })
    playFight(game, amount(game))
    game.dispatch({ type: 'continue' })
    if (game.state.phase === 'shop') game.dispatch({ type: 'skip' })
  }
}
