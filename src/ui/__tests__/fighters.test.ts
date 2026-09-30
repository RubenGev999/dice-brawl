import { describe, expect, it } from 'vitest'
import { BOSS_TRAITS, CONFIG, NORMAL_TRAITS } from '../../core/index.ts'
import type { EnemyTraitId, ExchangeRecord } from '../../core/index.ts'
import { HERO, ROSTER, TEMPLATES, TIMELINE, characterFor, characterSvg, planExchange, rollChip, traitMarks } from '../fighters.ts'
import type { PlanStep } from '../fighters.ts'

const ALL_TRAITS: ReadonlyArray<EnemyTraitId> = [...NORMAL_TRAITS, ...BOSS_TRAITS]

function ex(over: Partial<ExchangeRecord> = {}): ExchangeRecord {
  return {
    index: 0,
    playerFaces: [4, 3],
    playerFacesBeforeReroll: null,
    rerolled: false,
    enemyFaces: [2, 1],
    playerTotal: 7,
    enemyTotal: 3,
    winner: 'player',
    playerCrit: false,
    enemyCrit: false,
    playerCritFactor: 1,
    enemyCritFactor: 1,
    damageDealt: 4,
    damageTaken: 0,
    blocked: 0,
    healed: 0,
    enemyHealed: 0,
    escaped: false,
    playerHpAfter: 10,
    enemyHpAfter: 5,
    multiplierGained: 0.1,
    multiplierGainedMilli: 100,
    multiplierAfterMilli: 100,
    ...over,
  }
}

function step<K extends PlanStep['kind']>(plan: PlanStep[], kind: K): Extract<PlanStep, { kind: K }> {
  const found = plan.find((s) => s.kind === kind)
  if (!found) throw new Error(`no ${kind} step`)
  return found as Extract<PlanStep, { kind: K }>
}

describe('character roster', () => {
  it('covers every normal and boss name from the core config', () => {
    for (const name of CONFIG.enemyNames) {
      expect(ROSTER[name], name).toBeDefined()
      const spec = characterFor(name, false)
      expect(spec.name).toBe(name)
      expect(spec.boss).toBe(false)
    }
    for (const name of CONFIG.bossNames) {
      expect(ROSTER[name], name).toBeDefined()
      const spec = characterFor(name, true)
      expect(spec.name).toBe(name)
      expect(spec.boss).toBe(true)
    }
  })

  it('gives every name its own look', () => {
    const looks = new Set<string>()
    for (const name of [...CONFIG.enemyNames, ...CONFIG.bossNames]) {
      const s = characterFor(name, CONFIG.bossNames.includes(name))
      looks.add(JSON.stringify([s.template, s.palette, s.accessories]))
    }
    expect(looks.size).toBe(CONFIG.enemyNames.length + CONFIG.bossNames.length)
  })

  it('uses only known templates and uses every template at least once', () => {
    const used = new Set(Object.values(ROSTER).map((s) => s.template))
    for (const t of used) expect(TEMPLATES).toContain(t)
    expect(used.size).toBe(TEMPLATES.length)
  })

  it('falls back deterministically for unknown names', () => {
    const a = characterFor('Mystery Beast')
    const b = characterFor('Mystery Beast')
    expect(a).toEqual(b)
    expect(characterSvg(a)).toBe(characterSvg(b))
    expect(TEMPLATES).toContain(a.template)
    expect(a.boss).toBe(false)
    const names = ['A', 'Bb', 'Cc c', 'Void Walker', 'Rat', 'Drake', 'Imp', 'Lich']
    const kinds = new Set(names.map((n) => characterFor(n).template + JSON.stringify(characterFor(n).palette)))
    expect(kinds.size).toBeGreaterThan(2)
  })

  it('makes unknown bosses look like bosses', () => {
    const normal = characterFor('Void Walker', false)
    const boss = characterFor('Void Walker', true)
    expect(boss.boss).toBe(true)
    expect(boss.scale).toBeGreaterThan(normal.scale)
    expect(boss.accessories.length).toBeGreaterThan(normal.accessories.length)
    expect(characterSvg(boss)).toContain('aura')
    expect(characterSvg(normal)).not.toContain('aura')
  })

  it('makes boss specs differ from normal ones', () => {
    const normals = CONFIG.enemyNames.map((n) => characterFor(n, false))
    const bosses = CONFIG.bossNames.map((n) => characterFor(n, true))
    const normalBodies = new Set(normals.map((s) => s.palette.body))
    for (const b of bosses) {
      expect(normalBodies.has(b.palette.body), b.name).toBe(false)
      expect(b.scale).toBeGreaterThan(Math.max(...normals.map((n) => n.scale)))
      expect(b.accessories.some((a) => a === 'crown' || a === 'horns' || a === 'helmet' || a === 'witchHat'), b.name).toBe(true)
      expect(characterSvg(b)).toContain('aura')
    }
    for (const n of normals) expect(characterSvg(n)).not.toContain('aura')
  })

  it('builds clean, non-empty svg for every character and trait', () => {
    const specs = [HERO, ...Object.values(ROSTER), characterFor('Unknown Thing'), characterFor('Unknown Thing', true)]
    for (const spec of specs) {
      for (const trait of ALL_TRAITS) {
        const svg = characterSvg(spec, trait)
        expect(svg.length).toBeGreaterThan(200)
        expect(svg.startsWith('<svg')).toBe(true)
        expect(svg.endsWith('</svg>')).toBe(true)
        expect(svg).not.toContain('undefined')
        expect(svg).not.toContain('NaN')
        expect(svg).not.toContain('null')
      }
    }
  })

  it('shows traits on the character', () => {
    expect(traitMarks('armored')).toContain('plate')
    expect(traitMarks('ironhide')).toContain('plate')
    expect(traitMarks('savage')).toContain('redEyes')
    expect(traitMarks('regenerate')).toContain('regenGlow')
    expect(traitMarks('enrage')).toContain('rageAura')
    expect(traitMarks('plain')).toEqual([])
    const spec = characterFor('Orc')
    expect(characterSvg(spec, 'armored')).not.toBe(characterSvg(spec, 'plain'))
    expect(characterSvg(spec, 'regenerate')).toContain('glow-regen')
    expect(characterSvg(spec, 'enrage')).toContain('rage-aura')
  })

  it('draws the hero as its own fixed character', () => {
    expect(characterSvg(HERO)).toBe(characterSvg(HERO))
    expect(Object.values(ROSTER).some((s) => s.palette.body === HERO.palette.body)).toBe(false)
  })
})

describe('exchange animation plan', () => {
  it('orders the steps by time and starts with a wind-up for both sides', () => {
    const plan = planExchange(ex(), 'active')
    const times = plan.map((s) => s.at)
    expect([...times].sort((a, b) => a - b)).toEqual(times)
    expect(plan[0]?.kind).toBe('windup')
    expect(step(plan, 'windup').sides).toEqual(['player', 'enemy'])
    expect(plan.map((s) => s.kind)).toEqual(['windup', 'lunge', 'impact'])
    expect(times[times.length - 1]).toBeLessThan(TIMELINE.totalMs)
  })

  it('plays a hit: the player lunges, the enemy takes the impact', () => {
    const plan = planExchange(ex(), 'active')
    expect(step(plan, 'lunge').sides).toEqual(['player'])
    expect(step(plan, 'lunge').bounce).toBe(false)
    const impact = step(plan, 'impact')
    expect(impact.hit).toEqual(['enemy'])
    expect(impact.block).toEqual([])
    expect(impact.crit).toBe(false)
    expect(impact.shake).toBe(false)
    expect(impact.floats).toEqual([{ target: 'enemy', text: '-4', sub: null, tone: 'hit' }])
  })

  it('plays a taken hit: the enemy lunges, the player takes the impact', () => {
    const plan = planExchange(ex({ winner: 'enemy', damageDealt: 0, damageTaken: 3 }), 'active')
    expect(step(plan, 'lunge').sides).toEqual(['enemy'])
    const impact = step(plan, 'impact')
    expect(impact.hit).toEqual(['player'])
    expect(impact.floats).toEqual([{ target: 'player', text: '-3', sub: null, tone: 'hit' }])
  })

  it('plays a tie: both lunge and bounce, nobody is hit', () => {
    const plan = planExchange(ex({ winner: 'tie', damageDealt: 0, damageTaken: 0 }), 'active')
    const lunge = step(plan, 'lunge')
    expect(lunge.sides).toEqual(['player', 'enemy'])
    expect(lunge.bounce).toBe(true)
    const impact = step(plan, 'impact')
    expect(impact.hit).toEqual([])
    expect(impact.floats.map((f) => f.text)).toEqual(['Tie'])
    expect(impact.floats[0]?.target).toBe('center')
  })

  it('plays a crit with a bigger hit, screen shake and a CRIT label', () => {
    const plan = planExchange(ex({ playerCrit: true, playerCritFactor: 2, damageDealt: 8 }), 'active')
    const impact = step(plan, 'impact')
    expect(impact.crit).toBe(true)
    expect(impact.shake).toBe(true)
    expect(impact.floats).toEqual([{ target: 'enemy', text: '-8', sub: 'CRIT x2', tone: 'crit' }])
    const enemyCrit = planExchange(ex({ winner: 'enemy', enemyCrit: true, enemyCritFactor: 3, damageDealt: 0, damageTaken: 9 }), 'active')
    expect(step(enemyCrit, 'impact').floats).toEqual([{ target: 'player', text: '-9', sub: 'CRIT x3', tone: 'crit' }])
    expect(step(enemyCrit, 'impact').shake).toBe(true)
  })

  it('plays a fully blocked hit as a shield flash without damage', () => {
    const plan = planExchange(ex({ winner: 'enemy', damageDealt: 0, damageTaken: 0, blocked: 2 }), 'active')
    const impact = step(plan, 'impact')
    expect(impact.hit).toEqual([])
    expect(impact.block).toEqual(['player'])
    expect(impact.floats).toEqual([{ target: 'player', text: 'Blocked 2', sub: null, tone: 'block' }])
  })

  it('plays a partly blocked hit with both the shield and the damage', () => {
    const plan = planExchange(ex({ winner: 'enemy', damageDealt: 0, damageTaken: 1, blocked: 2 }), 'active')
    const impact = step(plan, 'impact')
    expect(impact.hit).toEqual(['player'])
    expect(impact.block).toEqual(['player'])
    expect(impact.floats.map((f) => f.text)).toEqual(['-1', 'Blocked 2'])
  })

  it('shows heals in green for the player and for a regenerating enemy', () => {
    const vamp = step(planExchange(ex({ healed: 1 }), 'active'), 'impact')
    expect(vamp.floats).toContainEqual({ target: 'player', text: '+1', sub: null, tone: 'heal' })
    const regen = step(planExchange(ex({ enemyHealed: 2 }), 'active'), 'impact')
    expect(regen.floats).toContainEqual({ target: 'enemy', text: '+2', sub: null, tone: 'heal' })
    const tieRegen = step(planExchange(ex({ winner: 'tie', damageDealt: 0, enemyHealed: 2 }), 'active'), 'impact')
    expect(tieRegen.floats.map((f) => f.text)).toEqual(['Tie', '+2'])
  })

  it('knocks out the enemy when the fight is won', () => {
    const plan = planExchange(ex(), 'won')
    const ko = step(plan, 'ko')
    expect(ko.side).toBe('enemy')
    expect(ko.at).toBeGreaterThan(step(plan, 'impact').at)
    expect(ko.at).toBeLessThan(TIMELINE.totalMs)
    expect(plan.some((s) => s.kind === 'dash')).toBe(false)
  })

  it('knocks out the player when the fight is lost', () => {
    const plan = planExchange(ex({ winner: 'enemy', damageDealt: 0, damageTaken: 10 }), 'lost')
    expect(step(plan, 'ko').side).toBe('player')
    expect(plan.some((s) => s.kind === 'dash')).toBe(false)
  })

  it('sends the hero dashing off when they escape', () => {
    const plan = planExchange(ex({ winner: 'enemy', damageDealt: 0, damageTaken: 10, escaped: true }), 'escaped')
    expect(step(plan, 'dash').side).toBe('player')
    expect(plan.some((s) => s.kind === 'ko')).toBe(false)
    expect(step(plan, 'impact').floats.map((f) => f.text)).toContain('Escaped!')
    const byFlag = planExchange(ex({ escaped: true }), 'active')
    expect(byFlag.some((s) => s.kind === 'dash')).toBe(true)
  })

  it('never plays a knockout for an active fight', () => {
    const plan = planExchange(ex(), 'active')
    expect(plan.some((s) => s.kind === 'ko' || s.kind === 'dash')).toBe(false)
  })

  it('keeps the whole timeline near the old 1.2 s', () => {
    expect(TIMELINE.totalMs).toBeGreaterThanOrEqual(1100)
    expect(TIMELINE.totalMs).toBeLessThanOrEqual(1350)
    expect(TIMELINE.windupAt).toBeLessThan(TIMELINE.lungeAt)
    expect(TIMELINE.lungeAt).toBeLessThan(TIMELINE.impactAt)
    expect(TIMELINE.impactAt).toBeLessThan(TIMELINE.endAt)
    expect(TIMELINE.endAt).toBeLessThan(TIMELINE.totalMs)
  })
})

describe('roll chip', () => {
  it('shows faces, bonus and total', () => {
    const chip = rollChip([4, 3], null, 8)
    expect(chip.text).toBe('4 + 3 + 1 = 8')
    expect(chip.bonus).toBe(1)
    expect(chip.total).toBe(8)
    expect(chip.parts.every((p) => p.was === null)).toBe(true)
  })

  it('omits a zero bonus and shows a negative one', () => {
    expect(rollChip([4, 3], null, 7).text).toBe('4 + 3 = 7')
    expect(rollChip([4, 3], null, 6).text).toBe('4 + 3 - 1 = 6')
  })

  it('marks the rerolled die', () => {
    const chip = rollChip([6, 3], [2, 3], 9)
    expect(chip.parts.map((p) => p.was)).toEqual([2, null])
    expect(chip.text).toBe('6 (was 2) + 3 = 9')
  })
})
