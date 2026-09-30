export interface Rng {
  nextU32(): number
  next(): number
  int(minInclusive: number, maxInclusive: number): number
  pick<T>(items: ReadonlyArray<T>): T
}

export function hashString(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function mix32(x: number): number {
  let z = x >>> 0
  z = Math.imul(z ^ (z >>> 16), 0x7feb352d)
  z = Math.imul(z ^ (z >>> 15), 0x846ca68b)
  z = z ^ (z >>> 16)
  return z >>> 0
}

export function deriveSeed(seed: number, stream: string, index: number): number {
  let h = mix32((seed >>> 0) ^ 0x9e3779b9)
  h = mix32(h ^ hashString(stream))
  h = mix32(h ^ Math.imul((index >>> 0) + 1, 0x85ebca6b))
  return h
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  const nextU32 = (): number => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return (t ^ (t >>> 14)) >>> 0
  }
  const int = (minInclusive: number, maxInclusive: number): number => {
    const span = maxInclusive - minInclusive + 1
    return minInclusive + (nextU32() % span)
  }
  return {
    nextU32,
    next: () => nextU32() / 4294967296,
    int,
    pick: <T>(items: ReadonlyArray<T>): T => items[int(0, items.length - 1)] as T,
  }
}

export function createStream(seed: number, stream: string, index: number): Rng {
  return mulberry32(deriveSeed(seed, stream, index))
}
