import { describe, expect, it } from 'vitest'
import { RULES_VERSION, createGame, createGameFromLog, generateEnemy, isUseful, replay, shopOffersForFight, shopOrderForFight } from '../index.ts'
import type { Game, UpgradeId } from '../index.ts'

function scriptedRun(seed: number, buyIn: number): Game {
  const game = createGame(seed, buyIn)
  let n = 0
  for (let step = 0; step < 600 && game.state.phase !== 'gameover'; step++) {
    const st = game.state
    for (let i = 0; i < (step * 7) % 5; i++) game.tick()
    if (st.phase === 'bet') {
      game.dispatch({ type: 'bet', amount: st.betPresets[n % 4]?.amount ?? st.minBet })
    } else if (st.phase === 'fight') {
      const f = st.fight
      if (f && f.canWalkAway && f.player.hp <= 2) game.dispatch({ type: 'walkAway' })
      else game.dispatch({ type: 'roll' })
    } else if (st.phase === 'result') {
      n++
      game.dispatch({ type: 'continue' })
    } else if (st.phase === 'checkpoint') {
      game.dispatch({ type: st.stagesCleared >= 2 ? 'leave' : 'continue' })
    } else if (st.phase === 'shop') {
      if (n % 4 === 3 || st.shopOffers.length === 0) game.dispatch({ type: 'skip' })
      else game.dispatch({ type: 'pickUpgrade', index: n % st.shopOffers.length })
    }
  }
  for (let i = 0; i < 3; i++) game.tick()
  return game
}

interface FightTrace {
  enemy: { name: string; archetype: string; isBoss: boolean; dice: ReadonlyArray<number>; bonus: number; trait: string; maxHp: number }
  enemyFaces: ReadonlyArray<ReadonlyArray<number>>
  offers: ReadonlyArray<UpgradeId>
  owned: ReadonlyArray<UpgradeId>
}

function traceRun(
  seed: number,
  bet: (bankroll: number, min: number, max: number) => number,
  pick: (ids: UpgradeId[]) => number,
): FightTrace[] {
  const game = createGame(seed)
  const out: FightTrace[] = []
  for (let guard = 0; guard < 4000 && game.state.phase !== 'gameover' && out.length < 12; guard++) {
    const st = game.state
    if (st.phase === 'bet') {
      game.dispatch({ type: 'bet', amount: bet(st.bankroll, st.minBet, st.maxBet) })
    } else if (st.phase === 'fight') {
      game.dispatch({ type: 'roll' })
    } else if (st.phase === 'result') {
      const f = st.fight
      if (!f) throw new Error('no fight')
      game.dispatch({ type: 'continue' })
      if (game.state.phase === 'checkpoint') game.dispatch({ type: 'continue' })
      out.push({
        enemy: {
          name: f.enemy.name,
          archetype: f.enemy.archetype,
          isBoss: f.enemy.isBoss,
          dice: f.enemy.dice,
          bonus: f.enemy.bonus,
          trait: f.enemy.trait,
          maxHp: f.enemy.maxHp,
        },
        enemyFaces: f.exchanges.map((x) => x.enemyFaces),
        offers: game.state.shopOffers.map((u) => u.id),
        owned: game.state.upgrades.map((u) => u.id),
      })
    } else if (st.phase === 'shop') {
      const ids = st.shopOffers.map((u) => u.id)
      if (ids.length === 0) game.dispatch({ type: 'skip' })
      else game.dispatch({ type: 'pickUpgrade', index: pick(ids) })
    }
  }
  return out
}

describe('determinism', () => {
  it('scripted run played twice gives deep-equal states and logs', () => {
    for (const [seed, buyIn] of [
      [1, 100],
      [99, 500],
      [123456, 1000],
    ] as const) {
      const a = scriptedRun(seed, buyIn)
      const b = scriptedRun(seed, buyIn)
      expect(a.state).toEqual(b.state)
      expect(a.log).toEqual(b.log)
      expect(a.log.length).toBeGreaterThan(5)
    }
  })

  it('replay(seed, buyIn, log, ticks) reproduces the live final state', () => {
    for (const [seed, buyIn] of [
      [1, 100],
      [99, 250],
      [123456, 100],
      [777, 1000],
    ] as const) {
      const live = scriptedRun(seed, buyIn)
      expect(replay(seed, buyIn, live.log, live.state.tick)).toEqual(live.state)
    }
  })

  it('createGameFromLog returns a live game equal to replay and to the original', () => {
    for (const [seed, buyIn] of [
      [1, 100],
      [42, 250],
      [777, 1000],
    ] as const) {
      const live = scriptedRun(seed, buyIn)
      const resumed = createGameFromLog(seed, buyIn, live.log, live.state.tick)
      expect(resumed.state).toEqual(live.state)
      expect(resumed.state).toEqual(replay(seed, buyIn, live.log, live.state.tick))
      expect(resumed.log).toEqual(live.log)
      expect(resumed.state.rulesVersion).toBe(RULES_VERSION)
    }
  })

  it('createGameFromLog resumes mid-fight and keeps playing identically', () => {
    const live = createGame(5, 250)
    live.dispatch({ type: 'bet', amount: 30 })
    live.tick()
    live.dispatch({ type: 'roll' })
    const resumed = createGameFromLog(5, 250, live.log, live.state.tick)
    expect(resumed.state).toEqual(live.state)
    for (const g of [live, resumed]) {
      for (let i = 0; i < 50 && g.state.phase === 'fight'; i++) g.dispatch({ type: 'roll' })
    }
    expect(resumed.state).toEqual(live.state)
    expect(resumed.log).toEqual(live.log)
  })

  it('createGameFromLog throws on a rejected or out-of-order entry', () => {
    expect(() => createGameFromLog(1, 100, [{ tick: 0, action: { type: 'roll' } }])).toThrow()
    expect(() =>
      createGameFromLog(1, 100, [
        { tick: 3, action: { type: 'bet', amount: 10 } },
        { tick: 1, action: { type: 'roll' } },
      ]),
    ).toThrow()
    expect(createGameFromLog(1, 100, []).state).toEqual(createGame(1, 100).state)
    expect(createGameFromLog(1, 100, [], 7).state.tick).toBe(7)
  })

  it('replay without totalTicks stops at the last logged tick', () => {
    const live = scriptedRun(5, 100)
    const lastTick = live.log[live.log.length - 1]?.tick ?? 0
    expect(replay(5, 100, live.log).tick).toBe(lastTick)
  })

  it('replay reproduces a state captured mid-fight', () => {
    const game = createGame(5, 250)
    game.dispatch({ type: 'bet', amount: 20 })
    game.tick()
    game.dispatch({ type: 'roll' })
    game.tick()
    game.tick()
    if (game.state.phase === 'fight') game.dispatch({ type: 'roll' })
    expect(replay(5, 250, game.log, game.state.tick)).toEqual(game.state)
  })

  it('invalid actions are not logged', () => {
    const game = createGame(8)
    expect(game.dispatch({ type: 'roll' })).toBe(false)
    expect(game.dispatch({ type: 'continue' })).toBe(false)
    expect(game.dispatch({ type: 'leave' })).toBe(false)
    expect(game.log).toEqual([])
    game.tick()
    game.dispatch({ type: 'bet', amount: 10 })
    expect(game.log).toEqual([{ tick: 1, action: { type: 'bet', amount: 10 } }])
  })

  it('enemies, enemy dice and the seeded shop order for fight k ignore bets and upgrade choices', () => {
    const avoid = (ids: UpgradeId[], from: 'first' | 'last'): number => {
      const order = ids.map((_, i) => i)
      if (from === 'last') order.reverse()
      return order.find((j) => ids[j] !== 'intimidate') ?? 0
    }
    let compared = 0
    for (const seed of [3, 42, 1001, 65535, 7, 99, 12345, 31337]) {
      const a = traceRun(seed, (_, min) => min, (ids) => avoid(ids, 'first'))
      const b = traceRun(seed, (_, __, max) => max, (ids) => avoid(ids, 'last'))
      const n = Math.min(a.length, b.length)
      for (let k = 0; k < n; k++) {
        const ta = a[k] as FightTrace
        const tb = b[k] as FightTrace
        expect(ta.enemy).toEqual(tb.enemy)
        const m = Math.min(ta.enemyFaces.length, tb.enemyFaces.length)
        expect(ta.enemyFaces.slice(0, m)).toEqual(tb.enemyFaces.slice(0, m))
        const e = generateEnemy(seed, k)
        expect(ta.enemy).toEqual({
          name: e.name,
          archetype: e.archetype,
          isBoss: e.isBoss,
          dice: e.dice,
          bonus: e.bonus,
          trait: e.trait,
          maxHp: e.maxHp,
        })
        for (const t of [ta, tb]) {
          if (t.offers.length === 0) continue
          const order = shopOrderForFight(seed, k)
          const ownedBefore = t.owned
          expect(t.offers).toEqual(order.filter((id) => isUseful(ownedBefore, id)).slice(0, 3))
          expect(t.offers).toEqual(shopOffersForFight(seed, k, ownedBefore))
        }
        compared++
      }
    }
    expect(compared).toBeGreaterThan(8)
  })

  it('the seeded shop order depends only on (seed, fight index)', () => {
    for (const seed of [1, 7, 99]) {
      for (let k = 0; k < 20; k++) {
        expect(shopOrderForFight(seed, k)).toEqual(shopOrderForFight(seed, k))
        const owned: UpgradeId[] = shopOrderForFight(seed, k).slice(0, 2)
        expect(shopOffersForFight(seed, k, owned)).toEqual(
          shopOrderForFight(seed, k).filter((id) => isUseful(owned, id)).slice(0, 3),
        )
      }
    }
  })

  it('the same seed gives the same enemy and order; different seeds differ', () => {
    expect(generateEnemy(7, 4)).toEqual(generateEnemy(7, 4))
    expect(shopOrderForFight(7, 4)).toEqual(shopOrderForFight(7, 4))
    const names = new Set<string>()
    const orders = new Set<string>()
    for (let s = 1; s <= 30; s++) {
      names.add(JSON.stringify(generateEnemy(s, 0)))
      orders.add(shopOrderForFight(s, 0).join())
    }
    expect(names.size).toBeGreaterThan(5)
    expect(orders.size).toBeGreaterThan(5)
  })
})
