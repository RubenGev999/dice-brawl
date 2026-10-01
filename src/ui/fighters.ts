import { hashString } from '../core/index.ts'
import type { Archetype, EnemyTraitId, ExchangeRecord, FightStatus } from '../core/index.ts'
import { critText, isRiposte } from './format.ts'

export type BodyTemplate = 'humanoid' | 'beast' | 'blob' | 'skeleton' | 'golem' | 'caster'

export type Accessory =
  | 'club'
  | 'sword'
  | 'dagger'
  | 'staff'
  | 'ears'
  | 'roundEars'
  | 'horns'
  | 'crown'
  | 'helmet'
  | 'bandana'
  | 'eyepatch'
  | 'tusks'
  | 'fangs'
  | 'witchHat'
  | 'cape'
  | 'spikes'
  | 'heads'

export interface Palette {
  readonly body: string
  readonly shade: string
  readonly cloth: string
  readonly accent: string
  readonly eye: string
}

export interface CharacterSpec {
  readonly name: string
  readonly template: BodyTemplate
  readonly palette: Palette
  readonly accessories: ReadonlyArray<Accessory>
  readonly boss: boolean
  readonly scale: number
}

export const TEMPLATES: ReadonlyArray<BodyTemplate> = ['humanoid', 'beast', 'blob', 'skeleton', 'golem', 'caster']

function pal(body: string, shade: string, cloth: string, accent: string, eye: string): Palette {
  return { body, shade, cloth, accent, eye }
}

function spec(name: string, template: BodyTemplate, palette: Palette, accessories: Accessory[], scale: number, boss = false): CharacterSpec {
  return { name, template, palette, accessories, boss, scale }
}

export const HERO: CharacterSpec = spec('You', 'humanoid', pal('#f2c9a0', '#1d4ed8', '#38bdf8', '#ef4444', '#0b1020'), ['cape', 'bandana', 'sword'], 0.9)

export const ROSTER: Readonly<Record<string, CharacterSpec>> = {
  Goblin: spec('Goblin', 'humanoid', pal('#7cc242', '#4d7c0f', '#8b5e34', '#facc15', '#111827'), ['ears', 'dagger'], 0.82),
  'Rat King': spec('Rat King', 'beast', pal('#8b7355', '#5b4630', '#d6b48c', '#f472b6', '#111827'), ['roundEars', 'crown', 'fangs'], 0.9),
  Bandit: spec('Bandit', 'humanoid', pal('#e0ac82', '#3f3f46', '#6b4423', '#dc2626', '#111827'), ['bandana', 'eyepatch', 'dagger'], 0.86),
  Skeleton: spec('Skeleton', 'skeleton', pal('#e8e1cd', '#3b3a36', '#cbc3aa', '#9ca3af', '#22d3ee'), ['sword'], 0.86),
  Slime: spec('Slime', 'blob', pal('#34d399', '#047857', '#a7f3d0', '#10b981', '#064e3b'), [], 0.82),
  Orc: spec('Orc', 'humanoid', pal('#4d7c0f', '#365314', '#78350f', '#a3a3a3', '#fde047'), ['tusks', 'club'], 0.95),
  Cultist: spec('Cultist', 'caster', pal('#a78bfa', '#4c1d95', '#6d28d9', '#f0abfc', '#f0abfc'), ['staff'], 0.86),
  Wolf: spec('Wolf', 'beast', pal('#9ca3af', '#4b5563', '#e5e7eb', '#fbbf24', '#fbbf24'), ['fangs'], 0.9),
  Troll: spec('Troll', 'golem', pal('#84a76b', '#4d6b3c', '#6f8f57', '#facc15', '#fde047'), ['club', 'ears'], 0.98),
  Ghoul: spec('Ghoul', 'humanoid', pal('#9fb8a3', '#5b6b5f', '#4b5563', '#7f1d1d', '#ef4444'), ['fangs', 'ears'], 0.86),
  'Goblin Warlord': spec('Goblin Warlord', 'humanoid', pal('#65a30d', '#3f6212', '#7c2d12', '#dc2626', '#fde047'), ['crown', 'ears', 'sword', 'cape'], 1.08, true),
  'Bone Tyrant': spec('Bone Tyrant', 'skeleton', pal('#f5f0dc', '#44403c', '#d6cfb4', '#b91c1c', '#ef4444'), ['horns', 'club', 'cape'], 1.1, true),
  'The Hollow King': spec('The Hollow King', 'skeleton', pal('#cbd5e1', '#1e1b4b', '#94a3b8', '#7c3aed', '#a78bfa'), ['crown', 'sword', 'cape'], 1.1, true),
  'Mire Hydra': spec('Mire Hydra', 'beast', pal('#0f766e', '#134e4a', '#5eead4', '#bef264', '#fde047'), ['heads', 'horns', 'fangs', 'spikes'], 1.08, true),
  'Iron Golem': spec('Iron Golem', 'golem', pal('#94a3b8', '#475569', '#64748b', '#f97316', '#fb923c'), ['horns', 'spikes'], 1.1, true),
  'Witch of Ash': spec('Witch of Ash', 'caster', pal('#d4d4d8', '#27272a', '#52525b', '#f97316', '#fb923c'), ['witchHat', 'staff'], 1.08, true),
  'Dread Knight': spec('Dread Knight', 'humanoid', pal('#cbd5e1', '#1f2937', '#374151', '#dc2626', '#ef4444'), ['helmet', 'sword', 'cape', 'spikes'], 1.1, true),
  'Ogre Chieftain': spec('Ogre Chieftain', 'humanoid', pal('#d08a5a', '#7c4a26', '#92400e', '#fbbf24', '#111827'), ['horns', 'tusks', 'club', 'cape'], 1.12, true),
}

const GENERIC_PALETTES: ReadonlyArray<Palette> = [
  pal('#f59e0b', '#92400e', '#b45309', '#fde68a', '#111827'),
  pal('#ec4899', '#831843', '#be185d', '#fbcfe8', '#111827'),
  pal('#60a5fa', '#1e3a8a', '#2563eb', '#bfdbfe', '#111827'),
  pal('#a3e635', '#3f6212', '#65a30d', '#ecfccb', '#111827'),
  pal('#c084fc', '#581c87', '#9333ea', '#f3e8ff', '#111827'),
  pal('#2dd4bf', '#134e4a', '#0d9488', '#ccfbf1', '#111827'),
  pal('#fb7185', '#881337', '#e11d48', '#ffe4e6', '#111827'),
  pal('#a8a29e', '#44403c', '#78716c', '#e7e5e4', '#111827'),
  pal('#fdba74', '#9a3412', '#c2410c', '#fed7aa', '#111827'),
  pal('#86efac', '#166534', '#16a34a', '#dcfce7', '#111827'),
  pal('#7dd3fc', '#075985', '#0284c7', '#e0f2fe', '#111827'),
  pal('#d8b4fe', '#6b21a8', '#a855f7', '#fae8ff', '#111827'),
]

const BOSS_PALETTES: ReadonlyArray<Palette> = [
  pal('#7f1d1d', '#450a0a', '#991b1b', '#fca5a5', '#fde047'),
  pal('#1e3a8a', '#172554', '#1d4ed8', '#93c5fd', '#fde047'),
  pal('#14532d', '#052e16', '#166534', '#86efac', '#fde047'),
  pal('#4c1d95', '#2e1065', '#6d28d9', '#c4b5fd', '#fbbf24'),
  pal('#78350f', '#451a03', '#92400e', '#fcd34d', '#fecaca'),
  pal('#831843', '#500724', '#9d174d', '#f9a8d4', '#fde047'),
  pal('#164e63', '#083344', '#0e7490', '#67e8f9', '#fef08a'),
  pal('#3f3f46', '#18181b', '#52525b', '#fb923c', '#ef4444'),
]

const GENERIC_ACCESSORIES: ReadonlyArray<ReadonlyArray<Accessory>> = [
  ['club'],
  ['dagger', 'bandana'],
  ['ears', 'fangs'],
  ['horns'],
  ['sword', 'cape'],
  ['tusks'],
  ['helmet', 'club'],
  ['spikes'],
]

const BOSS_MARKS: ReadonlyArray<Accessory> = ['crown', 'horns']

export function templateFor(archetype: Archetype, name: string): BodyTemplate {
  if (archetype !== 'other') return archetype
  return TEMPLATES[hashString(name) % TEMPLATES.length] as BodyTemplate
}

export function characterFor(name: string, isBoss = false, archetype: Archetype = 'other'): CharacterSpec {
  const known = ROSTER[name]
  if (known) {
    const fitted = archetype !== 'other' && known.template !== archetype ? { ...known, template: archetype } : known
    return fitted.boss === isBoss ? fitted : isBoss ? asBoss(fitted) : { ...fitted, boss: false, scale: 0.9 }
  }
  const h = hashString(name)
  const pool = isBoss ? BOSS_PALETTES : GENERIC_PALETTES
  const base = spec(
    name,
    templateFor(archetype, name),
    pool[(h >>> 9) % pool.length] as Palette,
    [...(GENERIC_ACCESSORIES[(h >>> 13) % GENERIC_ACCESSORIES.length] as ReadonlyArray<Accessory>)],
    0.86,
  )
  return isBoss ? asBoss(base) : base
}

function asBoss(base: CharacterSpec): CharacterSpec {
  const extra = BOSS_MARKS.filter((a) => !base.accessories.includes(a))
  return { ...base, boss: true, scale: 1.1, accessories: [...base.accessories, ...extra.slice(0, 1)] }
}

export function traitMarks(trait: EnemyTraitId): ReadonlyArray<string> {
  switch (trait) {
    case 'tough':
      return ['bulk']
    case 'brute':
      return ['fist']
    case 'armored':
    case 'ironhide':
      return ['plate']
    case 'savage':
      return ['redEyes']
    case 'vicious':
      return ['spikes']
    case 'lucky':
      return ['star']
    case 'enrage':
      return ['rageAura']
    case 'regenerate':
      return ['regenGlow']
    case 'executioner':
      return ['mask']
    case 'frenzied':
      return ['frenzy']
    case 'leech':
      return ['leechMark']
    case 'thorny':
      return ['thorns']
    case 'cursed':
      return ['curse']
    case 'colossus':
      return ['bulk', 'titanCracks']
    case 'mighty':
      return ['band']
    case 'vampiric':
      return ['bloodDrip']
    case 'crusher':
      return ['knuckles']
    case 'plain':
      return []
  }
}

interface Anchors {
  readonly head: { readonly x: number; readonly y: number; readonly r: number }
  readonly hand: { readonly x: number; readonly y: number } | null
  readonly cape: { readonly x: number; readonly y: number } | null
  readonly spikes: ReadonlyArray<readonly [number, number]>
  readonly plate: { readonly x: number; readonly y: number }
}

interface TemplateDef {
  readonly anchors: Anchors
  readonly body: string
}

function eyes(x: number, y: number, gap: number, r: number): string {
  const pupil = (cx: number): string => `<circle class="eye" cx="${cx + r * 0.35}" cy="${y}" r="${r * 0.5}"/>`
  return `<circle class="f-white" cx="${x}" cy="${y}" r="${r}"/><circle class="f-white" cx="${x + gap}" cy="${y}" r="${r}"/>${pupil(x)}${pupil(x + gap)}`
}

function boneLine(x1: number, y1: number, x2: number, y2: number): string {
  return `<path class="bone-under" d="M${x1} ${y1} L${x2} ${y2}"/><path class="bone-line" d="M${x1} ${y1} L${x2} ${y2}"/>`
}

const HUMANOID: TemplateDef = {
  anchors: { head: { x: 72, y: 38, r: 21 }, hand: { x: 118, y: 72 }, cape: { x: 50, y: 58 }, spikes: [[52, 58], [90, 58]], plate: { x: 78, y: 62 } },
  body:
    '<rect class="f-shade o" x="34" y="64" width="14" height="30" rx="7" transform="rotate(14 41 64)"/>' +
    '<rect class="f-shade o" x="52" y="98" width="14" height="28" rx="5"/>' +
    '<rect class="f-shade o" x="76" y="98" width="14" height="28" rx="5"/>' +
    '<rect class="f-ink" x="48" y="120" width="22" height="8" rx="4"/>' +
    '<rect class="f-ink" x="72" y="120" width="22" height="8" rx="4"/>' +
    '<rect class="f-cloth o" x="46" y="56" width="50" height="48" rx="14"/>' +
    '<rect class="f-accent" x="47" y="90" width="48" height="8"/>' +
    '<rect class="f-shade o" x="86" y="66" width="30" height="13" rx="6.5"/>' +
    '<circle class="f-body o" cx="118" cy="72" r="8"/>' +
    '<circle class="f-body o" cx="72" cy="38" r="21"/>' +
    eyes(76, 36, 11, 5.5) +
    '<path class="mouth" d="M78 48 Q85 52 91 47"/>',
}

const BEAST: TemplateDef = {
  anchors: { head: { x: 106, y: 66, r: 17 }, hand: null, cape: null, spikes: [[50, 68], [68, 64], [86, 66]], plate: { x: 80, y: 76 } },
  body:
    '<path class="f-shade o" d="M36 82 Q10 74 16 44 Q30 60 44 74 Z"/>' +
    '<rect class="f-shade o" x="38" y="94" width="13" height="32" rx="5"/>' +
    '<rect class="f-shade o" x="56" y="96" width="13" height="30" rx="5"/>' +
    '<ellipse class="f-body o" cx="70" cy="88" rx="38" ry="24"/>' +
    '<ellipse class="f-cloth" cx="70" cy="101" rx="24" ry="8"/>' +
    '<rect class="f-shade o" x="80" y="96" width="13" height="30" rx="5"/>' +
    '<rect class="f-shade o" x="97" y="94" width="13" height="32" rx="5"/>' +
    '<rect class="f-ink" x="36" y="121" width="17" height="7" rx="3.5"/>' +
    '<rect class="f-ink" x="54" y="121" width="17" height="7" rx="3.5"/>' +
    '<rect class="f-ink" x="78" y="121" width="17" height="7" rx="3.5"/>' +
    '<rect class="f-ink" x="95" y="121" width="17" height="7" rx="3.5"/>' +
    '<path class="f-shade o" d="M96 54 L98 32 L112 50 Z"/>' +
    '<circle class="f-body o" cx="106" cy="66" r="17"/>' +
    '<rect class="f-cloth o" x="112" y="64" width="24" height="16" rx="8"/>' +
    '<circle class="f-ink" cx="134" cy="68" r="3.5"/>' +
    eyes(108, 60, 0, 4.5),
}

const BLOB: TemplateDef = {
  anchors: { head: { x: 72, y: 72, r: 20 }, hand: null, cape: null, spikes: [[50, 66], [70, 58], [90, 66]], plate: { x: 76, y: 86 } },
  body:
    '<path class="f-body o" d="M24 126 Q18 70 70 56 Q122 70 116 126 Q94 133 70 128 Q46 133 24 126 Z"/>' +
    '<ellipse class="f-cloth" cx="50" cy="78" rx="11" ry="6" opacity="0.55" transform="rotate(-25 50 78)"/>' +
    '<ellipse class="f-shade" cx="76" cy="108" rx="20" ry="9" opacity="0.45"/>' +
    '<circle class="f-cloth" cx="42" cy="106" r="4" opacity="0.7"/>' +
    '<circle class="f-cloth" cx="100" cy="112" r="3" opacity="0.7"/>' +
    eyes(76, 90, 16, 7) +
    '<path class="mouth" d="M82 104 Q90 111 100 104"/>',
}

const SKELETON: TemplateDef = {
  anchors: { head: { x: 72, y: 36, r: 19 }, hand: { x: 114, y: 74 }, cape: { x: 54, y: 58 }, spikes: [[54, 58], [88, 58]], plate: { x: 74, y: 60 } },
  body:
    boneLine(60, 100, 58, 124) +
    boneLine(82, 100, 84, 124) +
    '<rect class="f-ink" x="50" y="120" width="20" height="8" rx="4"/>' +
    '<rect class="f-ink" x="74" y="120" width="20" height="8" rx="4"/>' +
    boneLine(50, 66, 36, 84) +
    '<rect class="f-shade o" x="50" y="56" width="40" height="40" rx="10"/>' +
    '<rect class="f-body" x="54" y="62" width="32" height="5" rx="2.5"/>' +
    '<rect class="f-body" x="54" y="72" width="32" height="5" rx="2.5"/>' +
    '<rect class="f-body" x="54" y="82" width="32" height="5" rx="2.5"/>' +
    '<rect class="f-body o" x="52" y="92" width="36" height="12" rx="6"/>' +
    boneLine(88, 66, 112, 74) +
    '<circle class="f-body o" cx="114" cy="74" r="7"/>' +
    '<circle class="f-body o" cx="72" cy="36" r="19"/>' +
    '<rect class="f-body o" x="62" y="46" width="22" height="10" rx="4"/>' +
    '<circle class="f-ink" cx="76" cy="34" r="5.5"/><circle class="f-ink" cx="87" cy="34" r="5.5"/>' +
    '<circle class="eye" cx="77" cy="35" r="2.2"/><circle class="eye" cx="88" cy="35" r="2.2"/>' +
    '<path class="mouth" d="M66 51 L84 51 M70 47 L70 55 M75 47 L75 55 M80 47 L80 55"/>',
}

const GOLEM: TemplateDef = {
  anchors: { head: { x: 77, y: 36, r: 16 }, hand: { x: 126, y: 76 }, cape: { x: 44, y: 52 }, spikes: [[44, 52], [70, 48], [98, 52]], plate: { x: 72, y: 58 } },
  body:
    '<rect class="f-shade o" x="16" y="66" width="22" height="36" rx="8"/>' +
    '<rect class="f-shade o" x="46" y="98" width="22" height="28" rx="6"/>' +
    '<rect class="f-shade o" x="76" y="98" width="22" height="28" rx="6"/>' +
    '<rect class="f-cloth o" x="36" y="50" width="70" height="54" rx="12"/>' +
    '<rect class="f-shade" x="46" y="60" width="20" height="16" rx="4" opacity="0.55"/>' +
    '<path class="crack" d="M60 56 L54 72 L62 80 L56 98"/>' +
    '<circle class="f-accent o" cx="86" cy="80" r="8"/>' +
    '<rect class="f-shade o" x="96" y="64" width="26" height="22" rx="8"/>' +
    '<rect class="f-body o" x="112" y="60" width="26" height="32" rx="9"/>' +
    '<rect class="f-body o" x="60" y="24" width="36" height="30" rx="8"/>' +
    '<rect class="eye" x="68" y="34" width="9" height="6" rx="2"/><rect class="eye" x="82" y="34" width="9" height="6" rx="2"/>' +
    '<path class="mouth" d="M68 46 L90 46"/>',
}

const CASTER: TemplateDef = {
  anchors: { head: { x: 74, y: 32, r: 20 }, hand: { x: 112, y: 76 }, cape: { x: 52, y: 58 }, spikes: [[56, 56], [88, 56]], plate: { x: 76, y: 62 } },
  body:
    '<path class="f-shade o" d="M52 62 L32 92 L44 100 L60 78 Z"/>' +
    '<path class="f-cloth o" d="M50 58 Q70 50 92 58 L108 126 Q70 134 34 126 Z"/>' +
    '<path class="f-accent" d="M35 117 Q70 127 107 117 L108 126 Q70 134 34 126 Z"/>' +
    '<rect class="f-accent" x="52" y="86" width="40" height="6" rx="3"/>' +
    '<path class="f-shade o" d="M88 64 L112 70 L108 86 L84 80 Z"/>' +
    '<circle class="f-body o" cx="112" cy="76" r="7"/>' +
    '<path class="f-shade o" d="M50 44 Q50 14 74 14 Q98 14 98 44 Q98 60 86 62 L62 62 Q50 60 50 44 Z"/>' +
    '<ellipse class="f-ink" cx="78" cy="42" rx="14" ry="15"/>' +
    '<circle class="eye" cx="74" cy="42" r="3.2"/><circle class="eye" cx="85" cy="42" r="3.2"/>',
}

const DEFS: Readonly<Record<BodyTemplate, TemplateDef>> = {
  humanoid: HUMANOID,
  beast: BEAST,
  blob: BLOB,
  skeleton: SKELETON,
  golem: GOLEM,
  caster: CASTER,
}

const HEAD_PARTS: Readonly<Partial<Record<Accessory, string>>> = {
  ears: '<path class="f-body o" d="M-17 -6 L-38 -14 L-20 8 Z"/><path class="f-body o" d="M15 -10 L36 -20 L20 6 Z"/>',
  roundEars: '<circle class="f-cloth o" cx="-8" cy="-18" r="9"/><circle class="f-cloth o" cx="10" cy="-20" r="9"/>',
  horns: '<path class="f-bone o" d="M-10 -16 Q-18 -32 -30 -34 Q-22 -22 -18 -6 Z"/><path class="f-bone o" d="M10 -16 Q18 -32 30 -34 Q22 -22 18 -6 Z"/>',
  crown: '<path class="f-gold o" d="M-16 -13 L-13 -32 L-5 -22 L2 -36 L9 -22 L15 -32 L19 -13 Z"/>',
  helmet:
    '<path class="f-steel o" d="M-23 6 A23 23 0 0 1 23 6 Z"/><rect class="f-steel o" x="8" y="-4" width="6" height="18" rx="2"/><path class="f-accent o" d="M-4 -22 Q-16 -42 10 -38 Q0 -30 6 -21 Z"/>',
  bandana: '<path class="f-accent o" d="M-22 -6 Q0 -18 22 -6 L22 2 Q0 -10 -22 2 Z"/><path class="f-accent o" d="M-22 -2 L-36 5 L-24 9 Z"/>',
  eyepatch: '<path class="strap" d="M-21 -10 L21 6"/><circle class="f-ink" cx="6" cy="-2" r="6"/>',
  tusks: '<path class="f-bone o" d="M6 8 L3 22 L12 10 Z"/><path class="f-bone o" d="M17 8 L18 21 L23 8 Z"/>',
  fangs: '<path class="f-white o-thin" d="M6 10 L5 19 L11 11 Z"/><path class="f-white o-thin" d="M15 10 L15 19 L20 10 Z"/>',
  witchHat:
    '<path class="f-hat o" d="M-14 -20 L6 -58 L20 -20 Z"/><ellipse class="f-hat o" cx="0" cy="-18" rx="32" ry="7"/><rect class="f-accent" x="-13" y="-27" width="30" height="6"/>',
}

const HAND_PARTS: Readonly<Partial<Record<Accessory, string>>> = {
  club: '<path class="f-wood o" d="M-4 6 L-7 -22 Q-9 -42 4 -44 Q17 -42 13 -22 L9 6 Z"/>',
  sword: '<rect class="f-ink" x="-9" y="-3" width="18" height="6" rx="2"/><path class="f-steel o" d="M-5 -3 L0 -56 L5 -3 Z"/>',
  dagger: '<rect class="f-ink" x="-6" y="-3" width="12" height="5" rx="2"/><path class="f-steel o" d="M-3.5 -3 L0 -32 L3.5 -3 Z"/>',
  staff: '<rect class="f-wood o" x="-2.5" y="-72" width="5" height="104" rx="2.5"/><circle class="f-accent o" cx="0" cy="-76" r="8"/>',
}

function spikeTriangle(x: number, y: number, cls: string): string {
  return `<path class="${cls} o" d="M${x - 6} ${y + 5} L${x} ${y - 15} L${x + 6} ${y + 5} Z"/>`
}

function headGroup(a: Anchors, inner: string): string {
  const k = a.head.r / 21
  return `<g transform="translate(${a.head.x} ${a.head.y}) scale(${k})">${inner}</g>`
}

function handGroup(a: Anchors, inner: string, tilt: number): string {
  if (!a.hand) return ''
  return `<g transform="translate(${a.hand.x} ${a.hand.y}) rotate(${tilt})">${inner}</g>`
}

function hydraHeads(): string {
  const neck = (d: string): string => `<path class="neck-under" d="${d}"/><path class="neck" d="${d}"/>`
  const head = (x: number, y: number): string =>
    `<circle class="f-body o" cx="${x}" cy="${y}" r="11"/>${eyes(x + 1, y - 2, 0, 3.6)}<path class="f-shade o" d="M${x - 8} ${y - 8} L${x - 10} ${y - 18} L${x - 2} ${y - 10} Z"/>`
  return neck('M84 74 Q60 36 82 20') + head(84, 20) + neck('M96 78 Q112 44 120 28') + head(122, 26)
}

export function characterSvg(character: CharacterSpec, trait: EnemyTraitId = 'plain'): string {
  const def = DEFS[character.template]
  const a = def.anchors
  const has = (acc: Accessory): boolean => character.accessories.includes(acc)
  const marks = traitMarks(trait)
  const p = character.palette
  const vars = `--body:${p.body};--shade:${p.shade};--cloth:${p.cloth};--accent:${p.accent};--eye:${p.eye}`
  const scale = character.scale * (marks.includes('bulk') ? 1.1 : 1)
  const back: string[] = []
  if (character.boss) back.push('<ellipse class="aura" cx="70" cy="80" rx="60" ry="56"/><ellipse class="aura aura-2" cx="70" cy="80" rx="46" ry="44"/>')
  if (marks.includes('regenGlow')) back.push('<ellipse class="glow-regen" cx="70" cy="84" rx="52" ry="50"/>')
  if (marks.includes('rageAura')) back.push('<ellipse class="rage-aura" cx="70" cy="84" rx="54" ry="52"/>')
  const inner: string[] = []
  if (has('cape') && a.cape) inner.push(`<path class="f-cape o" d="M${a.cape.x} ${a.cape.y} L${a.cape.x - 26} ${a.cape.y + 66} L${a.cape.x + 22} ${a.cape.y + 60} Z"/>`)
  if (has('heads') && character.template === 'beast') inner.push(hydraHeads())
  inner.push(def.body)
  if (has('spikes') || marks.includes('spikes')) {
    const cls = has('spikes') ? 'f-bone' : 'f-steel'
    for (const [x, y] of a.spikes) inner.push(spikeTriangle(x, y, cls))
  }
  if (marks.includes('plate')) {
    const q = a.plate
    inner.push(`<path class="f-steel o" d="M${q.x} ${q.y} L${q.x + 26} ${q.y} L${q.x + 26} ${q.y + 20} Q${q.x + 13} ${q.y + 34} ${q.x} ${q.y + 20} Z"/><circle class="f-ink" cx="${q.x + 13}" cy="${q.y + 10}" r="2.5"/>`)
  }
  const anchor = a.hand ?? a.plate
  if (marks.includes('leechMark')) {
    const q = a.plate
    inner.push(`<path d="M${q.x + 4} ${q.y + 4} q6 -8 12 0 t12 0" fill="none" stroke="#14532d" stroke-width="6" stroke-linecap="round"/><circle cx="${q.x + 28}" cy="${q.y + 4}" r="3" fill="#bef264"/>`)
  }
  if (marks.includes('thorns')) {
    const q = a.plate
    for (let i = 0; i < 4; i++) {
      const x = q.x - 6 + i * 12
      inner.push(`<path d="M${x - 4} ${q.y + 22} L${x} ${q.y + 6} L${x + 4} ${q.y + 22} Z" fill="#65a30d" stroke="#1a2e05" stroke-width="2"/>`)
    }
  }
  if (marks.includes('titanCracks')) {
    const q = a.plate
    inner.push(`<path d="M${q.x} ${q.y - 8} l8 12 l-6 8 l10 12 M${q.x + 22} ${q.y - 4} l-6 10 l8 6" fill="none" stroke="#0f172a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`)
  }
  if (marks.includes('band')) {
    const q = a.plate
    inner.push(`<rect x="${q.x - 6}" y="${q.y + 6}" width="38" height="8" rx="3" fill="#facc15" stroke="#713f12" stroke-width="2"/><rect x="${q.x + 7}" y="${q.y + 4}" width="12" height="12" rx="3" fill="#ef4444" stroke="#713f12" stroke-width="2"/>`)
  }
  if (marks.includes('knuckles')) {
    inner.push(`<circle cx="${anchor.x}" cy="${anchor.y}" r="13" fill="#94a3b8" stroke="#0f172a" stroke-width="3"/>` + [-7, 0, 7].map((d) => `<path d="M${anchor.x + d - 3} ${anchor.y - 10} L${anchor.x + d} ${anchor.y - 20} L${anchor.x + d + 3} ${anchor.y - 10} Z" fill="#e2e8f0" stroke="#0f172a" stroke-width="1.5"/>`).join(''))
  }
  if (marks.includes('fist') && a.hand) inner.push(`<circle class="f-body o" cx="${a.hand.x}" cy="${a.hand.y}" r="11"/>`)
  const headParts: string[] = []
  for (const acc of character.accessories) {
    const part = HEAD_PARTS[acc]
    if (part) headParts.push(part)
  }
  if (marks.includes('mask')) headParts.push('<rect class="f-ink" x="-22" y="-9" width="44" height="10" rx="3"/><rect class="rage-eye" x="-6" y="-6" width="6" height="3"/><rect class="rage-eye" x="8" y="-6" width="6" height="3"/>')
  if (marks.includes('frenzy')) headParts.push('<path d="M-22 -28 L-8 -16 M22 -28 L8 -16 M-4 -34 L0 -22 L4 -34" fill="none" stroke="#ef4444" stroke-width="4" stroke-linecap="round"/>')
  if (marks.includes('curse')) headParts.push('<circle cx="0" cy="-34" r="11" fill="none" stroke="#a855f7" stroke-width="3"/><path d="M-6 -40 L6 -28 M6 -40 L-6 -28" stroke="#a855f7" stroke-width="3" stroke-linecap="round"/>')
  if (marks.includes('bloodDrip')) headParts.push('<path d="M-8 10 q0 10 3 14 q3 -4 3 -14 Z M10 10 q0 8 2.5 11 q2.5 -3 2.5 -11 Z" fill="#dc2626" stroke="#450a0a" stroke-width="1.5"/>')
  if (marks.includes('star')) headParts.push('<path class="f-gold o" d="M0 -46 L4 -37 L14 -36 L6 -30 L9 -20 L0 -26 L-9 -20 L-6 -30 L-14 -36 L-4 -37 Z"/>')
  if (headParts.length > 0) inner.push(headGroup(a, headParts.join('')))
  for (const acc of character.accessories) {
    const part = HAND_PARTS[acc]
    if (part) inner.push(handGroup(a, part, acc === 'staff' ? 4 : 18))
  }
  return (
    `<svg class="fig-svg" viewBox="-6 -16 152 158" style="${vars}" aria-hidden="true" focusable="false">` +
    '<ellipse class="f-shadow" cx="70" cy="130" rx="38" ry="6"/>' +
    back.join('') +
    `<g transform="translate(70 128) scale(${scale}) translate(-70 -128)">${inner.join('')}</g>` +
    '</svg>'
  )
}

export type Side = 'player' | 'enemy'

export type FloatTone = 'hit' | 'crit' | 'block' | 'heal' | 'info'

export interface FloatSpec {
  readonly target: Side | 'center'
  readonly text: string
  readonly sub: string | null
  readonly tone: FloatTone
}

export type PlanStep =
  | { readonly kind: 'windup'; readonly at: number; readonly sides: ReadonlyArray<Side> }
  | { readonly kind: 'lunge'; readonly at: number; readonly sides: ReadonlyArray<Side>; readonly bounce: boolean }
  | {
      readonly kind: 'impact'
      readonly at: number
      readonly hit: ReadonlyArray<Side>
      readonly block: ReadonlyArray<Side>
      readonly crit: boolean
      readonly shake: boolean
      readonly floats: ReadonlyArray<FloatSpec>
    }
  | { readonly kind: 'ko'; readonly at: number; readonly side: Side }

export interface Timeline {
  readonly windupAt: number
  readonly lungeAt: number
  readonly impactAt: number
  readonly endAt: number
  readonly totalMs: number
}

export const TIMELINE: Timeline = { windupAt: 0, lungeAt: 300, impactAt: 450, endAt: 700, totalMs: 1250 }

export const FAST_TOTAL_MS = 450

export function scaleTimeline(base: Timeline, totalMs: number): Timeline {
  const k = totalMs / base.totalMs
  return {
    windupAt: Math.round(base.windupAt * k),
    lungeAt: Math.round(base.lungeAt * k),
    impactAt: Math.round(base.impactAt * k),
    endAt: Math.round(base.endAt * k),
    totalMs,
  }
}

export function timelineFor(fast: boolean): Timeline {
  return fast ? scaleTimeline(TIMELINE, FAST_TOTAL_MS) : TIMELINE
}

export function planExchange(ex: ExchangeRecord, end: FightStatus, timeline: Timeline = TIMELINE): PlanStep[] {
  const steps: PlanStep[] = [{ kind: 'windup', at: timeline.windupAt, sides: ['player', 'enemy'] }]
  const tie = ex.winner === 'tie'
  const riposte = isRiposte(ex)
  const lunger: Side[] = tie ? ['player', 'enemy'] : ex.winner === 'player' ? ['player'] : ['enemy']
  steps.push({ kind: 'lunge', at: timeline.lungeAt, sides: lunger, bounce: tie })
  const floats: FloatSpec[] = []
  const hit: Side[] = []
  const block: Side[] = []
  const label = critText(ex)
  if (ex.damageDealt > 0 && !riposte) {
    hit.push('enemy')
    const crit = ex.playerCritFactor > 1
    const sub = crit ? label : ex.tieBreak ? 'Tie Breaker' : null
    floats.push({ target: 'enemy', text: `-${ex.damageDealt}`, sub, tone: crit ? 'crit' : 'hit' })
  }
  if (ex.damageTaken > 0) {
    hit.push('player')
    const crit = ex.enemyCritFactor > 1
    floats.push({ target: 'player', text: `-${ex.damageTaken}`, sub: crit ? label : null, tone: crit ? 'crit' : 'hit' })
  }
  if (ex.thornDamage > 0) {
    if (!hit.includes('player')) hit.push('player')
    floats.push({ target: 'player', text: `-${ex.thornDamage}`, sub: 'Thorns', tone: 'hit' })
  }
  if (ex.blocked > 0) {
    block.push('player')
    floats.push({ target: 'player', text: `Blocked ${ex.blocked}`, sub: null, tone: 'block' })
  }
  if (ex.healed > 0) floats.push({ target: 'player', text: `+${ex.healed}`, sub: null, tone: 'heal' })
  if (ex.enemyHealed > 0) floats.push({ target: 'enemy', text: `+${ex.enemyHealed}`, sub: null, tone: 'heal' })
  if (tie) floats.unshift({ target: 'center', text: 'Tie', sub: null, tone: 'info' })
  const crit = ex.playerCritFactor > 1 || ex.enemyCritFactor > 1
  steps.push({ kind: 'impact', at: timeline.impactAt, hit, block, crit, shake: crit, floats })
  if (riposte) {
    const gap = timeline.endAt - timeline.impactAt
    const counterLunge = timeline.impactAt + Math.round(gap * 0.35)
    const counterImpact = timeline.impactAt + Math.round(gap * 0.6)
    steps.push({ kind: 'lunge', at: counterLunge, sides: ['player'], bounce: false })
    steps.push({
      kind: 'impact',
      at: counterImpact,
      hit: ['enemy'],
      block: [],
      crit: false,
      shake: false,
      floats: [{ target: 'enemy', text: `-${ex.riposteDamage}`, sub: 'Riposte', tone: 'hit' }],
    })
  }
  if (end === 'won') steps.push({ kind: 'ko', at: timeline.endAt, side: 'enemy' })
  else if (end === 'lost') steps.push({ kind: 'ko', at: timeline.endAt, side: 'player' })
  return steps
}

export interface RollPart {
  readonly face: number
  readonly was: number | null
}

export interface RollChip {
  readonly parts: ReadonlyArray<RollPart>
  readonly bonus: number
  readonly total: number
  readonly text: string
}

export function rollChip(faces: ReadonlyArray<number>, before: ReadonlyArray<number> | null, total: number, appliedBonus?: number): RollChip {
  const parts = faces.map((face, i): RollPart => {
    const b = before ? before[i] : undefined
    return { face, was: b !== undefined && b !== face ? b : null }
  })
  const bonus = appliedBonus ?? total - faces.reduce((sum, f) => sum + f, 0)
  let text = parts.map((p) => (p.was === null ? String(p.face) : `${p.face} (was ${p.was})`)).join(' + ')
  if (bonus !== 0) text += bonus > 0 ? ` + ${bonus}` : ` - ${-bonus}`
  text += ` = ${total}`
  return { parts, bonus, total, text }
}
