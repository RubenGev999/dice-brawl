import type { EnemyTraitId } from '../core/index.ts'
import { characterFor, characterSvg, HERO } from './fighters.ts'
import type { FloatSpec, PlanStep, RollChip, Side } from './fighters.ts'

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

export interface Bar {
  readonly root: HTMLElement
  readonly fill: HTMLElement
  readonly text: HTMLElement
}

export type RollTone = 'win' | 'lose' | 'tie'

interface SideView {
  readonly col: HTMLElement
  readonly host: HTMLElement
  readonly fighter: HTMLElement
  readonly shake: HTMLElement
  readonly flash: HTMLElement
  readonly shield: HTMLElement
  readonly bar: Bar
  readonly roll: HTMLElement
}

export interface Stage {
  readonly root: HTMLElement
  readonly mult: HTMLElement
  readonly ko: HTMLElement
  readonly bars: Readonly<Record<Side, Bar>>
  begin(steps: ReadonlyArray<PlanStep>): void
  advance(elapsedMs: number): void
  finish(): void
  setRoll(side: Side, chip: RollChip, tone: RollTone): void
  hideRolls(): void
  setEnraged(on: boolean): void
}

function makeBar(cls: string): Bar {
  const root = el('div', 'bar ' + cls)
  const fill = el('div', 'bar-fill')
  const text = el('div', 'bar-text')
  root.append(fill, text)
  return { root, fill, text }
}

function makeSide(side: Side, svg: string, boss: boolean, trait: EnemyTraitId): SideView {
  const col = el('div', `fcol fcol-${side}${boss ? ' fcol-boss' : ''} trait-${trait}`)
  const fighter = el('div', 'fighter')
  const shake = el('div', 'fig-shake')
  const art = el('div', 'fig-art')
  art.innerHTML = svg
  const flash = el('div', 'fig-flash')
  const shield = el('div', 'fig-shield')
  shake.append(art, flash, shield)
  fighter.append(shake)
  const host = el('div', 'fig-host')
  host.append(fighter)
  const info = el('div', 'fig-info')
  const bar = makeBar(side === 'enemy' ? 'bar-enemy' : 'bar-player')
  const roll = el('div', 'roll roll-' + side)
  roll.hidden = true
  info.append(bar.root, roll)
  if (side === 'enemy') col.append(info, host)
  else col.append(host, info)
  return { col, host, fighter, shake, flash, shield, bar, roll }
}

const MOTION_CLASSES = ['fx-windup', 'fx-lunge', 'fx-bounce', 'fx-ko', 'fx-dash']

export function createStage(enemyName: string, isBoss: boolean, trait: EnemyTraitId): Stage {
  const root = el('div', 'stage')
  const money = el('div', 'stage-money')
  const mult = el('div', 'mult', 'x0.00')
  const ko = el('div', 'ko')
  money.append(mult, ko)
  const sides: Record<Side, SideView> = {
    enemy: makeSide('enemy', characterSvg(characterFor(enemyName, isBoss), trait), isBoss, trait),
    player: makeSide('player', characterSvg(HERO), false, 'plain'),
  }
  root.append(money, sides.enemy.col, sides.player.col)

  let steps: ReadonlyArray<PlanStep> = []
  let applied = 0

  function spawn(spec: FloatSpec, slot: number): void {
    const host = spec.target === 'center' ? root : sides[spec.target].host
    const node = el('div', `float float-${spec.tone}${spec.target === 'center' ? ' float-center' : ''}`)
    node.style.setProperty('--slot', String(slot))
    node.append(el('span', 'float-main', spec.text))
    if (spec.sub) node.append(el('span', 'float-sub', spec.sub))
    host.append(node)
    const remove = (): void => node.remove()
    node.addEventListener('animationend', remove)
    window.setTimeout(remove, 1800)
  }

  function apply(step: PlanStep): void {
    switch (step.kind) {
      case 'windup':
        for (const s of step.sides) sides[s].fighter.classList.add('fx-windup')
        break
      case 'lunge':
        for (const s of step.sides) {
          const f = sides[s].fighter
          f.classList.remove('fx-windup')
          f.classList.add('fx-lunge')
          if (step.bounce) f.classList.add('fx-bounce')
        }
        for (const s of ['player', 'enemy'] as const) if (!step.sides.includes(s)) sides[s].fighter.classList.remove('fx-windup')
        break
      case 'impact': {
        for (const s of step.hit) {
          sides[s].shake.classList.add('fx-hit')
          sides[s].flash.classList.add(step.crit ? 'fx-flash-crit' : 'fx-flash')
        }
        for (const s of step.block) sides[s].shield.classList.add('fx-block')
        if (step.shake) root.classList.add('fx-quake')
        const slots: Record<string, number> = {}
        for (const spec of step.floats) {
          const n = slots[spec.target] ?? 0
          slots[spec.target] = n + 1
          spawn(spec, n)
        }
        break
      }
      case 'ko':
        sides[step.side].fighter.classList.remove('fx-lunge', 'fx-bounce')
        sides[step.side].fighter.classList.add('fx-ko')
        break
      case 'dash':
        sides[step.side].fighter.classList.remove('fx-lunge', 'fx-bounce')
        sides[step.side].fighter.classList.add('fx-dash')
        break
    }
  }

  function clearFx(): void {
    for (const s of ['player', 'enemy'] as const) {
      const v = sides[s]
      v.fighter.classList.remove(...MOTION_CLASSES)
      v.shake.classList.remove('fx-hit')
      v.flash.classList.remove('fx-flash', 'fx-flash-crit')
      v.shield.classList.remove('fx-block')
    }
    root.classList.remove('fx-quake')
  }

  function hideRolls(): void {
    for (const s of ['player', 'enemy'] as const) if (!sides[s].roll.hidden) sides[s].roll.hidden = true
  }

  return {
    root,
    mult,
    ko,
    bars: { enemy: sides.enemy.bar, player: sides.player.bar },
    begin(plan) {
      clearFx()
      hideRolls()
      steps = plan
      applied = 0
    },
    advance(elapsedMs) {
      while (applied < steps.length) {
        const step = steps[applied] as PlanStep
        if (step.at > elapsedMs) break
        applied += 1
        apply(step)
      }
    },
    finish() {
      steps = []
      applied = 0
      clearFx()
    },
    setRoll(side, chip, tone) {
      const node = sides[side].roll
      node.replaceChildren()
      node.className = `roll roll-${side} roll-${tone}`
      node.setAttribute('aria-label', chip.text)
      chip.parts.forEach((p, i) => {
        if (i > 0) node.append(el('span', 'roll-op', '+'))
        const die = el('span', p.was === null ? 'roll-die' : 'roll-die roll-rerolled', String(p.face))
        if (p.was !== null) die.append(el('span', 'roll-was', `was ${p.was}`))
        node.append(die)
      })
      if (chip.bonus !== 0) node.append(el('span', 'roll-op', chip.bonus > 0 ? '+' : '-'), el('span', 'roll-bonus', String(Math.abs(chip.bonus))))
      node.append(el('span', 'roll-op', '='), el('span', 'roll-total', String(chip.total)))
      node.hidden = false
    },
    hideRolls,
    setEnraged(on) {
      sides.enemy.col.classList.toggle('enraged', on)
    },
  }
}
