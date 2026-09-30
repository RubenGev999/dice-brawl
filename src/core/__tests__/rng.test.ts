import { describe, expect, it } from 'vitest'
import { createStream, mulberry32 } from '../index.ts'
import type { Rng } from '../index.ts'

function take(rng: Rng, n: number): number[] {
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(rng.nextU32())
  return out
}

describe('rng', () => {
  it('same seed and stream give the same sequence', () => {
    expect(take(createStream(42, 'enemy-dice', 3), 50)).toEqual(take(createStream(42, 'enemy-dice', 3), 50))
    expect(take(mulberry32(7), 20)).toEqual(take(mulberry32(7), 20))
  })

  it('different streams, indices and seeds differ', () => {
    const base = take(createStream(42, 'enemy-dice', 3), 20)
    expect(take(createStream(42, 'player-dice', 3), 20)).not.toEqual(base)
    expect(take(createStream(42, 'enemy-dice', 4), 20)).not.toEqual(base)
    expect(take(createStream(43, 'enemy-dice', 3), 20)).not.toEqual(base)
  })

  it('produces values in range', () => {
    const rng = createStream(1, 'x', 0)
    for (let i = 0; i < 1000; i++) {
      const v = rng.int(3, 9)
      expect(v).toBeGreaterThanOrEqual(3)
      expect(v).toBeLessThanOrEqual(9)
      const f = rng.next()
      expect(f).toBeGreaterThanOrEqual(0)
      expect(f).toBeLessThan(1)
    }
  })
})
