import { CONFIG, createGame } from '../core/index.ts'
import type { Action, ExchangeRecord, FightState, Game, GameState, Phase } from '../core/index.ts'
import {
  buyInChoices,
  chargesText,
  checkpointHeadline,
  checkpointNet,
  chipModels,
  chipSignature,
  coinsText,
  continueLabel,
  critText,
  enemyTraitLine,
  enrageNote,
  exchangeOutcome,
  exchangeTone,
  feeWarning,
  fightTitle,
  formatCoins,
  formatMultiplier,
  formatNet,
  gameOverText,
  gameOverTitle,
  hpPercent,
  hudView,
  leaveFeeLine,
  leaveNoteLine,
  leaveLabel,
  levelFullProfileLine,
  levelProfileLine,
  levelsBlurb,
  lobbyState,
  maxWinLine,
  nextLevelTitle,
  nextTargetLine,
  offerOwnedText,
  outcomeTone,
  parseSeed,
  pickBuyIn,
  randomSeed,
  returnRows,
  runStatRows,
  skipLabel,
  stageNotice,
  targetMet,
  visiblePresets,
  walkAwayPercents,
  walkAwayRows,
  walletLine,
} from './format.ts'
import { createStage } from './arena.ts'
import type { Bar, Stage } from './arena.ts'
import { planExchange, rollChip, timelineFor } from './fighters.ts'
import { browserStorage, createWallet, DEFAULT_WALLET } from './wallet.ts'
import { animFrame, countDuration, fxFactor, impactGate, retarget, shouldTick, skipClock, tweenAt, tweenValue } from './pacing.ts'
import type { AnimClock, AnimFrame, Tween } from './pacing.ts'
import {
  bossBanner,
  checkpointCountRange,
  coinBurstCount,
  confettiCount,
  exchangeCues,
  fightCelebration,
  transitionCues,
  triggerTags,
} from './effects.ts'
import { createFeedback } from './feedback.ts'
import type { Feedback } from './feedback.ts'
import { createSettingsStore } from './settings.ts'
import type { Settings } from './settings.ts'
import { createRunSession, newRunId, resumeStored, settleFinished } from './runStore.ts'
import type { RunSession, RunStorage } from './runStore.ts'
import { acknowledge, loadTutorial, pickTutorial, progressLabel, refreshText, replayTutorial, saveTutorial, skipTutorial, stillActive } from './tutorial.ts'
import type { TutorialCtx, TutorialView } from './tutorial.ts'
import { createFx } from './fx.ts'

const TICK_MS = 1000 / 60
const MAX_FRAME_MS = 250
const CONTINUE_GUARD_MS = 400
const NOTICE_MS = 3500
const NOTICE_DELAY_MS = 1600
const DELTA_MS = 1500
const LOSS_FX_MS = 900

type Attrs = Record<string, string>

function h(tag: string, cls?: string, text?: string, attrs?: Attrs): HTMLElement {
  const el = document.createElement(tag)
  if (cls) el.className = cls
  if (text !== undefined) el.textContent = text
  if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  return el
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text
}

function setClass(el: HTMLElement, cls: string): void {
  if (el.className !== cls) el.className = cls
}

function button(cls: string, text: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'btn ' + cls
  b.textContent = text
  b.disabled = disabled
  b.addEventListener('click', onClick)
  return b
}

function stackButton(cls: string, main: string, sub: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'btn btn-stack ' + cls
  b.append(h('span', 'stack-main', main), h('span', 'stack-sub', sub))
  b.disabled = disabled
  b.addEventListener('click', onClick)
  return b
}

function row(label: string, value: string, tone?: 'good' | 'bad'): HTMLElement {
  const r = h('div', tone ? `row ${tone}` : 'row')
  r.append(h('span', 'row-label', label), h('span', 'row-value', value))
  return r
}

function rowWithValue(label: string, value: string): { readonly node: HTMLElement; readonly value: HTMLElement } {
  const node = row(label, value)
  return { node, value: node.querySelector('.row-value') as HTMLElement }
}

interface Screen {
  update(s: GameState, now: number): void
  dispose?(): void
}

interface Anim {
  readonly prevState: GameState
  readonly prev: FightState
  readonly next: GameState
  readonly ex: ExchangeRecord
  clock: AnimClock
  frame: AnimFrame
  impacted: boolean
}

type Mode = 'lobby' | 'run'

export interface AppDeps {
  readonly storage?: RunStorage | null
  readonly feedback?: Feedback
}

declare global {
  interface Window {
    __game?: Game
  }
}

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

export function startApp(root: HTMLElement, deps: AppDeps = {}): () => void {
  const storage: RunStorage | null = deps.storage === undefined ? browserStorage() : deps.storage
  const wallet = createWallet(storage, CONFIG.minBuyIn)
  const settings = createSettingsStore(storage)
  const feedback: Feedback = deps.feedback ?? createFeedback(undefined, settings.get())
  const reducedQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
  const reduced = (): boolean => reducedQuery !== null && reducedQuery.matches
  const disposers: Array<() => void> = []
  const timers = new Set<number>()
  let disposed = false
  let rafId = 0

  let game: Game | null = null
  let session: RunSession | null = null
  let runSettled = true
  let mode: Mode = 'lobby'
  let seed = 0
  let pendingSeed = 0
  let runId = 0
  let lobbyRev = 0
  let selectedBuyIn: number | null = null
  let resetArmed = false
  let anim: Anim | null = null
  let noticeText = ''
  let noticeFrom = 0
  let noticeUntil = 0
  let lobbyNote = ''
  let activeStage: Stage | null = null
  let suppressFx = false
  let tut = loadTutorial(storage)
  let tutView: TutorialView | null = null
  let tutKey = ''

  function later(fn: () => void, ms: number): void {
    const id = window.setTimeout(() => {
      timers.delete(id)
      fn()
    }, ms)
    timers.add(id)
  }

  root.innerHTML = ''
  const shell = h('div', 'shell')
  const hud = h('header', 'hud')
  const stats = h('div', 'stats')
  const bankBox = h('div', 'stat')
  const bankValue = h('div', 'stat-value', '-')
  const bankDelta = h('div', 'stat-delta')
  bankDelta.hidden = true
  bankBox.append(h('div', 'stat-label', 'Bankroll'), bankValue, bankDelta)
  stats.append(bankBox)
  const statEls = {
    bankroll: bankValue,
    bet: stat(stats, 'Bet'),
  }
  const hudGear = gearButton()
  stats.append(hudGear)
  const levelEl = h('div', 'level-line')
  const progress = h('div', 'progress', undefined, { 'data-tut': 'progress' })
  const pipsEl = h('div', 'fight-pips')
  const pipEls: HTMLElement[] = []
  for (let i = 0; i < CONFIG.fightsPerStage; i++) {
    const p = h('span', 'fpip')
    pipEls.push(p)
    pipsEl.append(p)
  }
  const fightText = h('div', 'fight-text')
  progress.append(pipsEl, fightText)
  const targetEl = h('div', 'target-line')
  const chips = h('div', 'chips', undefined, { 'aria-label': 'Owned upgrades' })
  const notice = h('div', 'notice', undefined, { role: 'status' })
  notice.hidden = true
  hud.append(stats, levelEl, progress, targetEl, chips)
  const play = h('main', 'play')
  const screenEl = h('div', 'screen')
  const seedTag = h('div', 'seed')
  play.append(screenEl, notice, seedTag)
  const actions = h('footer', 'actions')
  shell.append(hud, play, actions)
  const fxLayer = h('div', 'fx-layer', undefined, { 'aria-hidden': 'true' })
  const tutLayer = h('div', 'tut-layer')
  const modalLayer = h('div', 'modal-layer')
  root.append(shell, fxLayer, tutLayer, modalLayer)

  const fx = createFx(fxLayer, { reduced, factor: () => (settings.get().fast ? 0.5 : 1) })

  let screenKey = ''
  let screen: Screen | null = null
  let screenBornAt = 0
  let chipKey: string | null = null
  let chipsSeeded = false
  let knownChips = new Set<string>()
  let chipDelayMs = 0
  let spaceDown = false
  let bank: Tween | null = null
  let bankShown = 0
  let bankSeeded = false
  let deltaUntil = 0

  function stat(parent: HTMLElement, label: string): HTMLElement {
    const box = h('div', 'stat')
    const v = h('div', 'stat-value', '-')
    box.append(h('div', 'stat-label', label), v)
    parent.append(box)
    return v
  }

  function gearButton(): HTMLButtonElement {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'gear'
    b.setAttribute('aria-label', 'Settings')
    b.setAttribute('aria-haspopup', 'dialog')
    b.append(h('span', 'gear-icon', undefined, { 'aria-hidden': 'true' }))
    b.addEventListener('click', () => openSettings(b))
    return b
  }

  function applySettings(s: Settings): void {
    feedback.setSound(s.sound)
    feedback.setVibration(s.vibration)
  }
  applySettings(settings.get())
  disposers.push(settings.subscribe(applySettings))

  let settingsEl: HTMLElement | null = null
  let settingsOpener: HTMLElement | null = null

  function closeSettings(): void {
    if (!settingsEl) return
    settingsEl.remove()
    settingsEl = null
    modalLayer.classList.remove('modal-open')
    const opener = settingsOpener
    settingsOpener = null
    if (opener && opener.isConnected) opener.focus()
  }

  function openSettings(opener: HTMLElement): void {
    if (settingsEl) return
    feedback.unlock()
    settingsOpener = opener
    const back = h('div', 'modal-back')
    const panel = h('div', 'modal', undefined, { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'settings-title' })
    panel.append(h('h2', 'card-title', 'Settings', { id: 'settings-title' }))
    const defs: ReadonlyArray<readonly [keyof Settings, string]> = [
      ['fast', 'Fast mode'],
      ['sound', 'Sound'],
      ['vibration', 'Vibration'],
    ]
    for (const [key, label] of defs) {
      const sw = document.createElement('button')
      sw.type = 'button'
      sw.className = 'switch'
      sw.setAttribute('role', 'switch')
      const name = h('span', 'switch-name', label)
      const state = h('span', 'switch-state')
      sw.append(name, state)
      const refresh = (): void => {
        const on = settings.get()[key]
        sw.setAttribute('aria-checked', on ? 'true' : 'false')
        setText(state, on ? 'On' : 'Off')
        sw.classList.toggle('switch-on', on)
      }
      refresh()
      sw.addEventListener('click', () => {
        const on = !settings.get()[key]
        const patch: Partial<Settings> = key === 'fast' ? { fast: on } : key === 'sound' ? { sound: on } : { vibration: on }
        settings.set(patch)
        refresh()
        if (on && key === 'vibration') feedback.play('hitDealt')
        if (on && key === 'sound') feedback.play('coins')
      })
      panel.append(sw)
    }
    panel.append(
      button('btn-secondary', 'Replay tutorial', () => {
        tut = replayTutorial()
        tutView = null
        tutKey = ''
        saveTutorial(storage, tut)
        closeSettings()
      }),
    )
    panel.append(button('btn-primary', 'Close', closeSettings))
    back.addEventListener('click', closeSettings)
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeSettings()
        return
      }
      if (e.key !== 'Tab') return
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)]
      const first = items[0]
      const last = items[items.length - 1]
      if (!first || !last) return
      const active = document.activeElement
      if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    })
    const wrap = h('div', 'modal-wrap')
    wrap.append(back, panel)
    settingsEl = wrap
    modalLayer.append(wrap)
    modalLayer.classList.add('modal-open')
    const firstControl = panel.querySelector<HTMLElement>(FOCUSABLE)
    if (firstControl) firstControl.focus()
  }

  function writeSeedUrl(value: number): void {
    seedTag.textContent = `seed ${value}`
    try {
      const url = new URL(window.location.href)
      url.searchParams.set('seed', String(value))
      window.history.replaceState(null, '', url)
    } catch {
      return
    }
  }

  function resetRunVisuals(): void {
    screen?.dispose?.()
    activeStage = null
    anim = null
    noticeText = ''
    noticeFrom = 0
    noticeUntil = 0
    screenKey = ''
    chipKey = null
    chipsSeeded = false
    knownChips = new Set<string>()
    chipDelayMs = 0
    bank = null
    bankSeeded = false
    deltaUntil = 0
    bankDelta.hidden = true
    screen = null
    spaceDown = false
    tutView = null
    tutKey = ''
    fx.clear()
    shell.classList.remove('fx-loss')
    for (const id of timers) window.clearTimeout(id)
    timers.clear()
    chips.replaceChildren()
    notice.hidden = true
  }

  function goLobby(nextSeed: number): void {
    mode = 'lobby'
    pendingSeed = nextSeed >>> 0
    resetArmed = false
    resetRunVisuals()
    hud.hidden = true
    seedTag.hidden = false
    writeSeedUrl(pendingSeed)
  }

  function settleIfOver(): void {
    const g = game
    if (!g || runSettled) return
    if (settleFinished(storage, wallet, g, session ? session.id : '') !== 'running') runSettled = true
  }

  function persistRun(): void {
    if (game && session && !runSettled) session.save(game)
  }

  function beginRunView(): void {
    resetRunVisuals()
    mode = 'run'
    hud.hidden = false
    seedTag.hidden = false
    writeSeedUrl(seed)
  }

  function startRun(): void {
    if (selectedBuyIn === null) return
    const buyIn = selectedBuyIn
    if (!wallet.startRun(buyIn)) {
      lobbyRev += 1
      return
    }
    seed = pendingSeed >>> 0
    runId += 1
    lobbyNote = ''
    game = createGame(seed, buyIn)
    window.__game = game
    session = createRunSession(storage, newRunId(Date.now(), seed))
    runSettled = false
    persistRun()
    beginRunView()
  }

  function tryResume(): boolean {
    const outcome = resumeStored(storage, wallet)
    if (outcome.kind === 'none') return false
    if (outcome.kind === 'discarded') {
      lobbyNote = outcome.note
      return false
    }
    game = outcome.game
    window.__game = game
    seed = outcome.record.seed
    runId += 1
    session = createRunSession(storage, outcome.record.id)
    runSettled = false
    beginRunView()
    suppressFx = true
    settleIfOver()
    return true
  }

  function reduceCountDur(delta: number): number {
    return countDuration(delta, settings.get().fast, reduced())
  }

  function updateBank(target: number, now: number): void {
    if (!bankSeeded) {
      bankSeeded = true
      bank = { from: target, to: target, start: now, duration: 0 }
      bankShown = target
    } else if (!bank || bank.to !== target) {
      const from = bankShown
      bank = retarget(bank, from, target, now, reduceCountDur(target - from))
      const diff = target - from
      if (diff !== 0) {
        bankDelta.textContent = diff > 0 ? `+${formatCoins(diff)}` : `-${formatCoins(-diff)}`
        bankDelta.className = 'stat-delta ' + (diff > 0 ? 'delta-up' : 'delta-down')
        bankDelta.hidden = false
        deltaUntil = now + DELTA_MS
      }
    }
    const t = bank as Tween
    bankShown = tweenAt(t, now)
    setText(bankValue, formatCoins(bankShown))
    if (!bankDelta.hidden && now >= deltaUntil) bankDelta.hidden = true
  }

  function updateHud(v: GameState, now: number): void {
    updateBank(v.bankroll, now)
    setText(statEls.bet, v.bet > 0 && v.phase !== 'bet' && v.phase !== 'shop' && v.phase !== 'checkpoint' ? formatCoins(v.bet) : '-')
    const hv = hudView(v)
    const met = hv.met
    setText(levelEl, hv.level)
    const moving = bank !== null && bankShown !== bank.to
    const dir = moving && bank ? (bank.to > bank.from ? ' bank-up' : ' bank-down') : ''
    setClass(statEls.bankroll, 'stat-value ' + (met ? 'good' : 'short') + dir)
    hv.pips.forEach((p, i) => {
      const el = pipEls[i]
      if (el) setClass(el, `fpip fpip-${p.state}${p.boss ? ' fpip-boss' : ''}`)
    })
    setText(fightText, hv.fightText)
    setClass(fightText, 'fight-text' + (hv.boss ? ' fight-text-boss' : ''))
    setText(targetEl, hv.targetText)
    setClass(targetEl, 'target-line ' + (met ? 'target-met' : 'target-short'))
    const models = chipModels(v.upgrades)
    const key = chipSignature(models)
    if (key !== chipKey) {
      chipKey = key
      chips.replaceChildren()
      if (models.length === 0) chips.append(h('span', 'chip chip-empty', 'no upgrades'))
      for (const m of models) {
        const fresh = chipsSeeded && !knownChips.has(m.id)
        const chip = h('span', 'chip' + (fresh ? ' chip-new' : ''), m.label, { title: m.title, 'data-upgrade': m.id })
        if (fresh && chipDelayMs > 0) chip.style.animationDelay = `${chipDelayMs}ms`
        chips.append(chip)
      }
      knownChips = new Set(models.map((m) => m.id))
      chipsSeeded = true
      chipDelayMs = 0
    }
    const showNotice = noticeText !== '' && now >= noticeFrom && now < noticeUntil
    if (showNotice) setText(notice, noticeText)
    notice.hidden = !showNotice
  }

  function flashChip(id: string): void {
    const el = chips.querySelector<HTMLElement>(`[data-upgrade="${id}"]`)
    if (!el) return
    el.classList.remove('chip-flash')
    void el.offsetWidth
    el.classList.add('chip-flash')
  }

  function buildScreen(view: GameState, dp: Phase): Screen {
    screen?.dispose?.()
    activeStage = null
    screenEl.replaceChildren()
    actions.replaceChildren()
    screenEl.className = 'screen screen-' + dp
    switch (dp) {
      case 'bet':
        return buildBet(view)
      case 'fight':
        return buildFight(view)
      case 'result':
        return buildResult(view)
      case 'checkpoint':
        return buildCheckpoint(view)
      case 'shop':
        return buildShop(view)
      case 'gameover':
        return buildGameover(view)
    }
  }

  function centered(card: HTMLElement): void {
    const wrap = h('div', 'center')
    wrap.append(card)
    screenEl.append(wrap)
  }

  function buildLobby(): Screen {
    screen?.dispose?.()
    screenEl.replaceChildren()
    actions.replaceChildren()
    screenEl.className = 'screen screen-lobby'
    actions.classList.add('actions-col')
    const card = h('div', 'card')
    const head = h('div', 'card-head')
    head.append(h('h2', 'card-title', 'Dice Brawl'), gearButton())
    card.append(head)
    card.append(h('div', 'card-sub', 'Your wallet'))
    card.append(h('div', 'wallet-balance', walletLine(wallet.balance())))
    if (lobbyNote) card.append(h('div', 'fee-note', lobbyNote, { role: 'status' }))
    const canPlay = lobbyState(wallet.balance(), CONFIG.buyInPresets, CONFIG.minBuyIn) === 'play'
    selectedBuyIn = pickBuyIn(CONFIG.buyInPresets, wallet.balance(), CONFIG.defaultBuyIn, selectedBuyIn)
    if (canPlay) {
      card.append(h('h3', 'card-title small neutral', 'Choose your buy-in'))
      const grid = h('div', 'bet-grid', undefined, { 'data-tut': 'buyin' })
      for (const c of buyInChoices(CONFIG.buyInPresets, wallet.balance())) {
        const selected = c.amount === selectedBuyIn
        const b = button('btn-choice' + (selected ? ' selected' : ''), formatCoins(c.amount), () => {
          selectedBuyIn = c.amount
          lobbyRev += 1
        }, !c.affordable)
        b.setAttribute('aria-pressed', selected ? 'true' : 'false')
        grid.append(b)
      }
      card.append(grid)
      card.append(h('div', 'card-sub', 'Your buy-in is your starting bankroll. Clear each level boss to keep going, or leave with your coins.'))
      card.append(h('div', 'card-sub levels-note', levelsBlurb()))
    } else {
      card.append(h('div', 'card-sub reason', `You need at least ${coinsText(CONFIG.minBuyIn)} to start a run.`))
      card.append(button('btn-warn btn-wide', 'Refill wallet', () => {
        wallet.refill()
        lobbyRev += 1
      }))
    }
    const armed = resetArmed
    card.append(button('btn-link', armed ? `Tap again to reset wallet to ${coinsText(DEFAULT_WALLET)}` : 'Reset wallet', () => {
      if (!resetArmed) {
        resetArmed = true
      } else {
        resetArmed = false
        wallet.refill()
      }
      lobbyRev += 1
    }))
    centered(card)
    const label = selectedBuyIn === null ? 'Start run' : `Start run (buy-in ${formatCoins(selectedBuyIn)})`
    actions.append(button('btn-primary btn-big', label, startRun, !canPlay || selectedBuyIn === null))
    return { update() {} }
  }

  function buildBet(s: GameState): Screen {
    const card = h('div', 'card' + (s.isBossFight ? ' card-boss' : ''))
    if (s.isBossFight) card.append(h('div', 'boss-badge', 'BOSS FIGHT'))
    card.append(h('h2', 'card-title', 'Place your bet'))
    card.append(h('div', 'card-sub', `Bankroll ${formatCoins(s.bankroll)} - Min ${formatCoins(s.minBet)} - Max ${formatCoins(s.maxBet)}`))
    card.append(h('div', 'level-profile', levelProfileLine(s.levelInfo, s.isBossFight)))
    if (s.isBossFight) card.append(h('div', 'fee-note', feeWarning(s.failedCheckpointFeePercent)))
    const grid = h('div', 'bet-grid', undefined, { 'data-tut': 'bets' })
    for (const p of visiblePresets(s)) {
      const b = stackButton(p.allIn ? 'btn-danger btn-allin' : 'btn-primary', p.label, formatCoins(p.amount), () => act({ type: 'bet', amount: p.amount }), !s.canBet)
      b.setAttribute('aria-label', `${p.label} bet, ${coinsText(p.amount)}`)
      grid.append(b)
    }
    card.append(grid)
    centered(card)
    return { update() {} }
  }

  function enemyBox(): DOMRect | null {
    const el = screenEl.querySelector('.fcol-enemy .fig-host')
    return el ? el.getBoundingClientRect() : null
  }

  function bankBoxRect(): DOMRect {
    return bankValue.getBoundingClientRect()
  }

  function buildFight(view: GameState): Screen {
    const first = view.fight
    const wrap = h('div', 'fight')

    const enemyCard = h('div', 'fcard enemy-card')
    const enemyName = h('div', 'fname')
    const bossBadge = h('span', 'boss-badge', 'BOSS')
    const nameRow = h('div', 'fname-row')
    nameRow.append(enemyName, bossBadge)
    const enemyTrait = h('div', 'ftrait')
    const enemyDice = h('div', 'fdice')
    const enemyHead = h('div', 'fhead')
    const enemyInfo = h('div', 'finfo')
    enemyInfo.append(nameRow, enemyTrait)
    enemyHead.append(enemyInfo, enemyDice)
    const feeNote = h('div', 'fee-note')
    enemyCard.append(enemyHead, feeNote)

    const playerCard = h('div', 'fcard player-card')
    const playerName = h('div', 'fname', 'You')
    const playerCharges = h('div', 'ftrait')
    const playerDice = h('div', 'fdice')
    const playerHead = h('div', 'fhead')
    const playerInfo = h('div', 'finfo')
    playerInfo.append(playerName, playerCharges)
    playerHead.append(playerInfo, playerDice)
    playerCard.append(playerHead)

    const stage = createStage(first ? first.enemy.name : '', first ? first.enemy.archetype : 'other', first ? first.isBoss : false, first ? first.enemy.trait : 'plain')
    activeStage = stage
    stage.root.addEventListener('pointerdown', skipAnim)
    const outcome = h('div', 'outcome', 'Tap ROLL to attack', { role: 'status', 'aria-live': 'polite' })

    wrap.append(enemyCard, stage.root, outcome, playerCard)
    screenEl.append(wrap)

    const rollBtn = button('btn-primary btn-fight', 'ROLL', doRoll)
    rollBtn.setAttribute('data-tut', 'roll')
    const walkBtn = document.createElement('button')
    walkBtn.type = 'button'
    walkBtn.className = 'btn btn-cash btn-fight'
    walkBtn.setAttribute('data-tut', 'walk')
    const walkLabel = h('span', 'cash-label', 'WALK AWAY')
    const walkAmount = h('span', 'cash-amount', '')
    walkBtn.append(walkLabel, walkAmount)
    walkBtn.addEventListener('click', doWalk)
    actions.append(rollBtn, walkBtn)

    let playing: Anim | null = null
    let rollKey = ''
    let intro = false
    const introSuppressed = suppressFx

    function setBar(bar: Bar, hp: number, max: number): void {
      const w = `${hpPercent(hp, max)}%`
      if (bar.fill.style.width !== w) bar.fill.style.width = w
      setText(bar.text, `${hp} / ${max} HP`)
    }

    return {
      dispose() {
        stage.root.removeEventListener('pointerdown', skipAnim)
        stage.destroy()
        if (activeStage === stage) activeStage = null
      },
      update(s) {
        const f = s.fight
        if (!f) return
        if (!intro) {
          intro = true
          if (!introSuppressed) {
            for (const t of triggerTags(f.startTriggers)) {
              stage.tag(t.side, t.text, t.tone)
              flashChip(t.upgrade)
            }
          }
        }
        const a = anim
        if (a !== playing) {
          if (a) {
            stage.begin(planExchange(a.ex, f.status, a.clock.timeline))
            rollKey = ''
          } else {
            stage.finish()
          }
          playing = a
        }
        if (a) stage.advance(a.frame.elapsed)
        const settled = a === null || a.frame.elapsed >= a.clock.timeline.impactAt
        const shown: FightState = a === null || settled ? f : a.prev
        setText(enemyName, f.enemy.name)
        bossBadge.hidden = !f.isBoss
        feeNote.hidden = !f.isBoss
        setText(feeNote, feeWarning(s.failedCheckpointFeePercent))
        setClass(enemyCard, 'fcard enemy-card' + (f.isBoss ? ' boss-card' : ''))
        setText(enemyTrait, enemyTraitLine(shown.enemy))
        setText(enemyDice, f.enemy.diceText)
        setText(playerDice, f.player.diceText)
        setText(playerCharges, chargesText(shown.player))
        setBar(stage.bars.enemy, shown.enemy.hp, shown.enemy.maxHp)
        setBar(stage.bars.player, shown.player.hp, shown.player.maxHp)
        stage.setEnraged(shown.enemy.currentBonus > shown.enemy.bonus)
        setText(stage.mult, formatMultiplier(shown.multiplier))
        setText(stage.ko, `KO pays ${coinsText(f.koPayout)}`)
        const locked = a !== null
        rollBtn.disabled = locked || !f.canRoll
        walkBtn.disabled = locked || !f.canWalkAway
        setText(walkAmount, `+${formatCoins(shown.walkAwayPayout)}`)
        walkBtn.setAttribute('aria-label', `Walk away and take ${coinsText(shown.walkAwayPayout)}`)

        const ex = a ? a.ex : f.exchanges.length > 0 ? (f.exchanges[f.exchanges.length - 1] as ExchangeRecord) : null
        if (!ex) {
          setText(outcome, f.isBoss ? 'Boss fight - tap ROLL' : 'Tap ROLL to attack')
          setClass(outcome, 'outcome')
          return
        }
        if (!settled) {
          setText(outcome, 'Rolling...')
          setClass(outcome, 'outcome')
          return
        }
        const key = `${f.index}|${ex.index}`
        if (key !== rollKey) {
          rollKey = key
          stage.setRoll('enemy', rollChip(ex.enemyFaces, null, ex.enemyTotal, ex.enemyBonusApplied), ex.winner === 'enemy' ? 'win' : ex.winner === 'tie' ? 'tie' : 'lose')
          stage.setRoll('player', rollChip(ex.playerFaces, ex.playerFacesBeforeReroll, ex.playerTotal, ex.playerBonusApplied), ex.winner === 'player' ? 'win' : ex.winner === 'tie' ? 'tie' : 'lose')
        }
        let line = exchangeOutcome(ex)
        if (ex.rerolled) line += ' (rerolled)'
        if (a) {
          const enrage = enrageNote(a.prev.enemy.currentBonus, f.enemy.currentBonus)
          if (enrage) line += ' | ' + enrage
        }
        setText(outcome, line)
        setClass(outcome, 'outcome outcome-' + exchangeTone(ex) + (critText(ex) ? ' outcome-crit' : ''))
      },
    }
  }

  function buildResult(s: GameState): Screen {
    const r = s.lastResult
    const card = h('div', 'card' + (r?.isBoss ? ' card-boss' : '') + (r ? ` result-${outcomeTone(r.outcome)}` : ''))
    let payoutRow: { node: HTMLElement; value: HTMLElement } | null = null
    let netRow: { node: HTMLElement; value: HTMLElement } | null = null
    let tags: string[] = []
    if (r) {
      const net = r.payout - r.bet
      if (r.isBoss) card.append(h('div', 'boss-badge', 'BOSS'))
      card.append(h('h2', `card-title outcome-${r.outcome}`, fightTitle(r.outcome, r.isBoss)))
      const rows = h('div', 'rows')
      rows.append(row('Multiplier', formatMultiplier(r.multiplier)))
      rows.append(row('Bet', formatCoins(r.bet)))
      const walk = walkAwayPercents(s.fight)
      for (const w of walkAwayRows(r, walk.refund, walk.keep)) rows.append(row(w.label, w.value))
      payoutRow = rowWithValue('Payout', formatCoins(0))
      rows.append(payoutRow.node)
      netRow = rowWithValue('Net', formatNet(-r.bet))
      netRow.node.className = 'row ' + (net >= 0 ? 'good' : 'bad')
      rows.append(netRow.node)
      rows.append(row('Rolls', String(r.rolls)))
      card.append(rows)
      for (const t of triggerTags(r.upgradeTriggers)) {
        card.append(h('div', 'result-tag', t.text))
        tags.push(t.upgrade)
      }
      if (r.isBoss) {
        const met = targetMet(s)
        card.append(h('div', 'card-sub checkpoint-note ' + (met ? 'good-text' : 'bad-text'), `Checkpoint: you have ${formatCoins(s.bankroll)}, target ${formatCoins(s.target)}`))
      }
    }
    centered(card)
    actions.append(button('btn-primary btn-big', 'CONTINUE', doContinue))
    const quietResult = suppressFx
    let startAt = -1
    let lastTick = -1e9
    let flashed = false
    return {
      update(_s, now) {
        if (!r || !payoutRow || !netRow) return
        if (startAt < 0) startAt = now
        if (!flashed) {
          flashed = true
          for (const id of tags) flashChip(id)
        }
        const dur = quietResult ? 0 : reduceCountDur(r.payout)
        const value = tweenValue(0, r.payout, now - startAt, dur)
        setText(payoutRow.value, formatCoins(value))
        setText(netRow.value, formatNet(value - r.bet))
        if (value < r.payout && shouldTick(lastTick, now, 55)) {
          lastTick = now
          feedback.play('tick')
        }
      },
      dispose() {
        tags = []
      },
    }
  }

  function shellBounds(): { left: number; top: number; width: number; height: number } {
    const b = shell.getBoundingClientRect()
    return { left: b.left, top: b.top, width: b.width, height: b.height }
  }

  function buildCheckpoint(s: GameState): Screen {
    const card = h('div', 'card card-boss')
    card.append(h('div', 'boss-badge', 'CHECKPOINT'))
    card.append(h('h2', 'card-title outcome-won', checkpointHeadline(s.lastCheckpoint)))
    const rows = h('div', 'rows')
    const range = s.lastCheckpoint ? checkpointCountRange(s.lastCheckpoint, s.bankroll) : { from: s.bankroll, to: s.bankroll }
    const bankRow = rowWithValue('Bankroll', formatCoins(range.from))
    rows.append(bankRow.node)
    rows.append(row('Buy-in', formatCoins(s.buyIn)))
    card.append(rows)
    card.append(h('div', 'net-line ' + (s.bankroll >= s.buyIn ? 'good-text' : 'bad-text'), 'Net so far ' + checkpointNet(s.bankroll, s.buyIn)))
    card.append(h('div', 'card-sub free-note', leaveNoteLine(s.leaveFee, s.leaveFeePercent)))
    const next = h('div', 'next-level')
    next.append(h('div', 'next-level-title', nextLevelTitle(s.levelInfo)), h('div', 'level-profile', levelFullProfileLine(s.levelInfo)), h('div', 'level-profile level-maxwin', maxWinLine(s.levelInfo)))
    card.append(next)
    card.append(h('div', 'card-sub checkpoint-note', nextTargetLine(s)))
    centered(card)
    actions.classList.add('actions-col')
    actions.append(h('div', 'leave-fee-line', leaveFeeLine(s.leaveFee, s.leaveFeePercent)))
    actions.append(button('btn-cash btn-big btn-flat', leaveLabel(s.bankroll, s.leaveFee), doLeave, !s.canLeave))
    actions.append(button('btn-primary btn-big', continueLabel(s.stage), doContinue))
    const quiet = suppressFx
    if (!quiet) {
      fx.flash('stage')
      fx.confetti(confettiCount(), shellBounds())
      fx.banner('LEVEL CLEARED')
    }
    let startAt = -1
    let lastTick = -1e9
    return {
      update(_s, now) {
        if (startAt < 0) startAt = now
        const dur = quiet ? 0 : reduceCountDur(range.to - range.from) + 300
        const value = tweenValue(range.from, range.to, now - startAt, dur)
        setText(bankRow.value, formatCoins(value))
        if (value < range.to && shouldTick(lastTick, now, 55)) {
          lastTick = now
          feedback.play('tick')
        }
      },
    }
  }

  function buildShop(s: GameState): Screen {
    const card = h('div', 'card')
    card.append(h('h2', 'card-title', s.shopOffers.length > 0 ? 'Pick an upgrade' : 'Nothing new to offer'))
    if (s.shopOffers.length === 0) card.append(h('div', 'card-sub', 'You already own everything on offer.'))
    const offers = h('div', 'offers', undefined, { 'data-tut': 'offers' })
    s.shopOffers.forEach((u, i) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'btn offer'
      const head = h('span', 'offer-head')
      head.append(h('span', 'offer-name', u.name))
      const owned = offerOwnedText(u)
      if (owned) head.append(h('span', 'offer-owned', owned))
      b.append(head, h('span', 'offer-desc', u.description))
      b.addEventListener('click', () => {
        const from = b.getBoundingClientRect()
        const chipsBox = chips.getBoundingClientRect()
        const target = { left: chipsBox.left, top: chipsBox.top, width: chipsBox.width, height: chipsBox.height }
        if (!act({ type: 'pickUpgrade', index: i })) return
        chipDelayMs = fx.fly({ left: from.left, top: from.top, width: from.width, height: Math.min(from.height, 56) }, target, u.name)
      })
      offers.append(b)
    })
    card.append(offers)
    centered(card)
    const skip = button('btn-secondary btn-big', skipLabel(), () => act({ type: 'skip' }))
    actions.append(skip)
    return { update() {} }
  }

  function buildGameover(s: GameState): Screen {
    const cashOut = s.cashOut ?? 0
    const net = cashOut - s.buyIn
    const card = h('div', 'card card-over')
    card.append(h('div', 'run-badge', 'RUN OVER'))
    card.append(h('h2', 'card-title ' + (net >= 0 ? 'outcome-won' : 'outcome-lost'), gameOverTitle(s.gameOverReason)))
    card.append(h('div', 'card-sub reason', gameOverText(s.gameOverReason, s.lastCheckpoint, s.cashOut, s.cashOutFee, s.gameOverReason === 'left' ? s.leaveFeePercent : s.failedCheckpointFeePercent, s.lastResult)))
    const rows = h('div', 'rows rows-compact')
    for (const r of returnRows(s)) rows.append(row(r.label, r.value, r.tone))
    rows.append(row('Wallet now', walletLine(wallet.balance())))
    card.append(rows)
    const statRows = h('div', 'rows rows-compact rows-minor')
    for (const r of runStatRows(s)) statRows.append(row(r.label, r.value, r.tone))
    card.append(statRows)
    centered(card)
    actions.classList.add('actions-col')
    actions.append(button('btn-primary btn-big', 'Back to lobby', () => goLobby(randomSeed())))
    actions.append(button('btn-secondary', 'Retry same seed', () => goLobby(seed)))
    return { update() {} }
  }

  function act(action: Action): boolean {
    const g = game
    if (!g) return false
    if (!g.dispatch(action)) return false
    const next = g.state
    persistRun()
    for (const c of transitionCues(next, action)) feedback.play(c)
    settleIfOver()
    return true
  }

  function fireImpact(a: Anim): void {
    const f = a.next.fight
    if (!f) return
    for (const c of exchangeCues(a.ex, f.status)) feedback.play(c)
    for (const t of triggerTags(a.ex.upgradeTriggers)) {
      activeStage?.tag(t.side, t.text, t.tone)
      flashChip(t.upgrade)
    }
    const kind = fightCelebration(f.status, f.isBoss)
    if (kind === 'ko' || kind === 'boss') {
      const from = enemyBox()
      if (from) fx.coinBurst(from, bankBoxRect(), coinBurstCount(kind))
      if (kind === 'boss') fx.flash('boss')
      const text = bossBanner(kind)
      if (text) fx.banner(text)
    } else if (kind === 'loss') {
      shell.classList.add('fx-loss')
      later(() => shell.classList.remove('fx-loss'), LOSS_FX_MS)
    }
  }

  function doRoll(): void {
    if (anim || !game) return
    const before = game.state
    if (before.phase !== 'fight' || !before.fight || !before.fight.canRoll) return
    const timeline = timelineFor(settings.get().fast)
    shell.style.setProperty('--fx', String(fxFactor(timeline)))
    if (!act({ type: 'roll' })) return
    const next = game.state
    const f = next.fight
    const ex = f ? f.exchanges[f.exchanges.length - 1] : undefined
    if (!ex) return
    const clock: AnimClock = { start: performance.now(), timeline, skipped: false }
    anim = { prevState: before, prev: before.fight, next, ex, clock, frame: animFrame(clock, clock.start), impacted: false }
  }

  function skipAnim(): void {
    const a = anim
    if (!a || a.clock.skipped) return
    a.clock = skipClock(a.clock)
  }

  function doWalk(): void {
    if (anim || !game) return
    act({ type: 'walkAway' })
  }

  function guardOpen(): boolean {
    return performance.now() - screenBornAt >= CONTINUE_GUARD_MS
  }

  function doContinue(): void {
    if (anim || !game || !guardOpen()) return
    const wasBoss = game.state.phase === 'result' && game.state.lastResult?.isBoss === true
    if (!act({ type: 'continue' })) return
    if (wasBoss) {
      const n = stageNotice(game.state)
      if (n) {
        noticeText = n
        noticeFrom = performance.now() + NOTICE_DELAY_MS
        noticeUntil = noticeFrom + NOTICE_MS
      }
    }
  }

  function doLeave(): void {
    if (anim || !game || !guardOpen()) return
    act({ type: 'leave' })
  }

  function keyFor(v: GameState, dp: Phase): string {
    const bank2 = dp === 'bet' || dp === 'gameover' || dp === 'checkpoint' ? v.bankroll : 0
    const wal = dp === 'gameover' ? wallet.balance() : 0
    return `${runId}|${dp}|${v.seed}|${v.fightsCompleted}|${v.stage}|${bank2}|${wal}|${v.upgrades.length}|${v.shopOffers.map((o) => o.id).join(',')}|${v.canBet}`
  }

  function tutorialCtx(): TutorialCtx {
    if (mode === 'lobby' || !game) return { mode: 'lobby', state: null }
    return { mode: 'run', state: anim ? anim.prevState : game.state }
  }

  function hideTutorial(): void {
    if (tutLayer.childElementCount > 0) tutLayer.replaceChildren()
    tutKey = ''
  }

  function endTutorialView(): void {
    if (tutView) {
      tut = acknowledge(tut, tutView)
      saveTutorial(storage, tut)
    }
    tutView = null
    hideTutorial()
  }

  function updateTutorial(): void {
    if (settingsEl) {
      hideTutorial()
      return
    }
    const ctx = tutorialCtx()
    if (tutView && !stillActive(tutView, ctx)) endTutorialView()
    if (!tutView) tutView = pickTutorial(tut, ctx)
    const v = tutView
    if (!v) {
      hideTutorial()
      return
    }
    const text = refreshText(v, ctx)
    const key = `${v.id}|${text}`
    if (key !== tutKey) {
      tutKey = key
      tutLayer.replaceChildren()
      const ring = h('div', 'tut-ring')
      const bubble = h('div', 'tut-bubble', undefined, { role: 'dialog', 'aria-label': 'Tutorial', 'aria-live': 'polite' })
      bubble.append(h('div', 'tut-step', progressLabel(v)), h('div', 'tut-text', text))
      const btns = h('div', 'tut-actions')
      btns.append(
        button('btn-primary tut-btn', v.kind === 'step' ? 'Got it' : 'OK', () => {
          endTutorialView()
        }),
        button('btn-link tut-btn', 'Skip tutorial', () => {
          tut = skipTutorial(tut)
          saveTutorial(storage, tut)
          tutView = null
          hideTutorial()
        }),
      )
      bubble.append(btns)
      tutLayer.append(ring, bubble)
    }
    const ring = tutLayer.querySelector<HTMLElement>('.tut-ring')
    const bubble = tutLayer.querySelector<HTMLElement>('.tut-bubble')
    if (!ring || !bubble) return
    const target = document.querySelector<HTMLElement>(`[data-tut="${v.target}"]`)
    const shellRect = shell.getBoundingClientRect()
    const vh = window.innerHeight
    const width = Math.min(shellRect.width - 24, 330)
    bubble.style.width = `${width}px`
    const bh = bubble.offsetHeight
    let left = shellRect.left + (shellRect.width - width) / 2
    let top = Math.max(12, vh * 0.3)
    const tr = target && target.isConnected ? target.getBoundingClientRect() : null
    if (tr && tr.width > 0 && tr.height > 0) {
      ring.hidden = false
      ring.style.transform = `translate(${tr.left - 4}px, ${tr.top - 4}px)`
      ring.style.width = `${tr.width + 8}px`
      ring.style.height = `${tr.height + 8}px`
      const below = tr.bottom + 12
      const above = tr.top - bh - 12
      top = below + bh <= vh - 8 && (tr.top < vh / 2 || above < 8) ? below : Math.max(8, above)
      const bar = actions.getBoundingClientRect()
      if (ctx.mode === 'run' && ctx.state !== null && ctx.state.phase === 'fight' && bar.height > 0) top = Math.max(8, bar.top - bh - 8)
      left = Math.min(Math.max(shellRect.left + 12, tr.left + tr.width / 2 - width / 2), shellRect.right - width - 12)
    } else {
      ring.hidden = true
    }
    bubble.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`
  }

  function onKeyDown(e: KeyboardEvent): void {
    feedback.unlock()
    if (e.code !== 'Space') return
    if (settingsEl) return
    const t = e.target
    if (t instanceof HTMLElement && t.closest('.tut-bubble')) return
    e.preventDefault()
    if (e.repeat || spaceDown) return
    spaceDown = true
    if (mode !== 'run' || !game) return
    if (anim) {
      skipAnim()
      return
    }
    const dp: Phase = game.state.phase
    if (dp === 'fight') doRoll()
    else if (dp === 'result' || dp === 'checkpoint') doContinue()
  }

  function onKeyUp(e: KeyboardEvent): void {
    if (e.code !== 'Space') return
    if (settingsEl) return
    e.preventDefault()
    spaceDown = false
  }

  function onBlur(): void {
    spaceDown = false
  }

  function onRootPointer(): void {
    feedback.unlock()
  }

  function onRootClick(e: Event): void {
    const t = e.target
    if (t instanceof Element && t.closest('button:not(:disabled)')) feedback.play('tap')
  }

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)
  root.addEventListener('pointerdown', onRootPointer, true)
  root.addEventListener('click', onRootClick, true)
  disposers.push(() => {
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', onBlur)
    root.removeEventListener('pointerdown', onRootPointer, true)
    root.removeEventListener('click', onRootClick, true)
  })

  const initial = parseSeed(window.location.search)
  goLobby(initial ?? randomSeed())
  tryResume()

  let last = performance.now()
  let acc = 0

  function step(now: number): void {
    const dtMs = Math.min(now - last, MAX_FRAME_MS)
    last = now
    acc += dtMs
    hud.hidden = mode === 'lobby'
    if (mode === 'lobby' || !game) {
      acc = 0
      const key = `lobby|${lobbyRev}|${wallet.balance()}`
      if (key !== screenKey) {
        screenKey = key
        screenBornAt = now
        actions.classList.remove('actions-col')
        screen = buildLobby()
      }
      notice.hidden = true
      updateTutorial()
      return
    }
    while (acc >= TICK_MS) {
      game.tick()
      acc -= TICK_MS
    }
    if (anim) {
      anim.frame = animFrame(anim.clock, now)
      const gate = impactGate(anim.frame, anim.impacted)
      if (gate.fire) {
        anim.impacted = true
        fireImpact(anim)
      }
    }
    settleIfOver()
    const s = game.state
    const view = anim ? anim.prevState : s
    const dp: Phase = view.phase
    const key = keyFor(view, dp)
    if (key !== screenKey) {
      screenKey = key
      screenBornAt = now
      actions.classList.remove('actions-col')
      screen = buildScreen(view, dp)
      suppressFx = false
    }
    hud.hidden = dp === 'gameover'
    seedTag.hidden = dp === 'gameover'
    updateHud(view, now)
    screen?.update(s, now)
    if (anim && anim.frame.done) anim = null
    updateTutorial()
  }

  function frame(now: number): void {
    if (disposed) return
    try {
      step(now)
    } finally {
      if (!disposed) rafId = requestAnimationFrame(frame)
    }
  }
  rafId = requestAnimationFrame(frame)

  return () => {
    disposed = true
    cancelAnimationFrame(rafId)
    for (const d of disposers) d()
    disposers.length = 0
    for (const id of timers) window.clearTimeout(id)
    timers.clear()
    closeSettings()
    screen?.dispose?.()
    screen = null
    activeStage = null
    fx.dispose()
    feedback.dispose()
    root.replaceChildren()
  }
}
