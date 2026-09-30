import { CONFIG, createGame } from '../core/index.ts'
import type { ExchangeRecord, FightState, Game, GameState, Phase } from '../core/index.ts'
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
  fightMessage,
  fightTitle,
  formatCoins,
  formatMultiplier,
  formatNet,
  gameOverText,
  gameOverTitle,
  hpPercent,
  hudView,
  leaveFreeLine,
  leaveLabel,
  lobbyState,
  nextTargetLine,
  offerOwnedText,
  outcomeTone,
  parseSeed,
  pawnModel,
  pickBuyIn,
  randomSeed,
  returnRows,
  runStatRows,
  shopNote,
  skipLabel,
  stageNotice,
  targetMet,
  visiblePresets,
  walletLine,
} from './format.ts'
import { createStage } from './arena.ts'
import type { Bar } from './arena.ts'
import { planExchange, rollChip, TIMELINE } from './fighters.ts'
import { browserStorage, createWallet, DEFAULT_WALLET } from './wallet.ts'

const TICK_MS = 1000 / 60
const MAX_FRAME_MS = 250
const CONTINUE_GUARD_MS = 400
const NOTICE_MS = 4500

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

interface Screen {
  update(s: GameState, now: number): void
}

interface Anim {
  readonly prevState: GameState
  readonly prev: FightState
  readonly ex: ExchangeRecord
  readonly start: number
}

type Mode = 'lobby' | 'run'

declare global {
  interface Window {
    __game?: Game
  }
}

export function startApp(root: HTMLElement): void {
  const wallet = createWallet(browserStorage(), CONFIG.minBuyIn)
  let game: Game | null = null
  let mode: Mode = 'lobby'
  let seed = 0
  let pendingSeed = 0
  let runId = 0
  let lobbyRev = 0
  let selectedBuyIn: number | null = null
  let resetArmed = false
  let anim: Anim | null = null
  let noticeText = ''
  let noticeUntil = 0

  root.innerHTML = ''
  const shell = h('div', 'shell')
  const hud = h('header', 'hud')
  const stats = h('div', 'stats')
  const statEls = {
    bankroll: stat(stats, 'Bankroll'),
    bet: stat(stats, 'Bet'),
    stage: stat(stats, 'Stage'),
  }
  const progress = h('div', 'progress')
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
  const chips = h('div', 'chips')
  const notice = h('div', 'notice')
  notice.hidden = true
  hud.append(stats, progress, targetEl, chips)
  const play = h('main', 'play')
  const screenEl = h('div', 'screen')
  const seedTag = h('div', 'seed')
  play.append(screenEl, notice, seedTag)
  const actions = h('footer', 'actions')
  shell.append(hud, play, actions)
  root.append(shell)

  let screenKey = ''
  let screen: Screen | null = null
  let screenBornAt = 0
  let chipKey: string | null = null
  let spaceDown = false

  function stat(parent: HTMLElement, label: string): HTMLElement {
    const box = h('div', 'stat')
    const v = h('div', 'stat-value', '-')
    box.append(h('div', 'stat-label', label), v)
    parent.append(box)
    return v
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

  function goLobby(nextSeed: number): void {
    mode = 'lobby'
    pendingSeed = nextSeed >>> 0
    anim = null
    noticeText = ''
    noticeUntil = 0
    resetArmed = false
    screenKey = ''
    chipKey = null
    screen = null
    spaceDown = false
    chips.replaceChildren()
    notice.hidden = true
    hud.hidden = true
    seedTag.hidden = false
    writeSeedUrl(pendingSeed)
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
    game = createGame(seed, buyIn)
    window.__game = game
    mode = 'run'
    anim = null
    noticeText = ''
    noticeUntil = 0
    screenKey = ''
    chipKey = null
    screen = null
    spaceDown = false
    hud.hidden = false
    seedTag.hidden = false
    notice.hidden = true
    writeSeedUrl(seed)
  }

  function updateHud(v: GameState, now: number): void {
    setText(statEls.bankroll, formatCoins(v.bankroll))
    setText(statEls.bet, v.bet > 0 && v.phase !== 'bet' && v.phase !== 'shop' && v.phase !== 'checkpoint' ? formatCoins(v.bet) : '-')
    const hv = hudView(v)
    const met = hv.met
    setText(statEls.stage, hv.stage)
    setClass(statEls.bankroll, 'stat-value ' + (met ? 'good' : 'short'))
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
      for (const m of models) chips.append(h('span', 'chip', m.label, { title: m.title }))
    }
    const showNotice = noticeText !== '' && now < noticeUntil
    if (showNotice) setText(notice, noticeText)
    notice.hidden = !showNotice
  }

  function buildScreen(view: GameState, dp: Phase): Screen {
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
    screenEl.replaceChildren()
    actions.replaceChildren()
    screenEl.className = 'screen screen-lobby'
    actions.classList.add('actions-col')
    const card = h('div', 'card')
    card.append(h('h2', 'card-title', 'Dice Brawl'))
    card.append(h('div', 'card-sub', 'Your wallet'))
    card.append(h('div', 'wallet-balance', walletLine(wallet.balance())))
    const canPlay = lobbyState(wallet.balance(), CONFIG.buyInPresets, CONFIG.minBuyIn) === 'play'
    selectedBuyIn = pickBuyIn(CONFIG.buyInPresets, wallet.balance(), CONFIG.defaultBuyIn, selectedBuyIn)
    if (canPlay) {
      card.append(h('h3', 'card-title small neutral', 'Choose your buy-in'))
      const grid = h('div', 'bet-grid')
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
      card.append(h('div', 'card-sub', 'Your buy-in is your starting bankroll. Clear each stage boss to keep going, or leave with your coins.'))
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
    const pawn = pawnModel(s)
    if (pawn) {
      card.append(h('h2', 'card-title', pawn.title))
      card.append(h('div', 'card-sub', pawn.sub))
      for (const item of pawn.items) {
        const r = h('div', 'pawn-row')
        const info = h('div', 'pawn-info')
        info.append(h('div', 'pawn-name', item.name), h('div', 'pawn-desc', item.description))
        r.append(info, button('btn-warn', item.label, () => game?.dispatch({ type: 'pawn', index: item.index })))
        card.append(r)
      }
      centered(card)
      return { update() {} }
    }
    card.append(h('h2', 'card-title', 'Place your bet'))
    card.append(h('div', 'card-sub', `Bankroll ${formatCoins(s.bankroll)} - Min ${formatCoins(s.minBet)} - Max ${formatCoins(s.maxBet)}`))
    if (s.isBossFight) card.append(h('div', 'fee-note', feeWarning(s.failedCheckpointFeePercent)))
    const grid = h('div', 'bet-grid')
    for (const p of visiblePresets(s)) {
      const b = stackButton(p.allIn ? 'btn-danger btn-allin' : 'btn-primary', p.label, formatCoins(p.amount), () => game?.dispatch({ type: 'bet', amount: p.amount }), !s.canBet)
      grid.append(b)
    }
    card.append(grid)
    centered(card)
    return { update() {} }
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

    const stage = createStage(first ? first.enemy.name : '', first ? first.isBoss : false, first ? first.enemy.trait : 'plain')
    const outcome = h('div', 'outcome', 'Tap ROLL to attack')

    wrap.append(enemyCard, stage.root, outcome, playerCard)
    screenEl.append(wrap)

    const rollBtn = button('btn-primary btn-fight', 'ROLL', doRoll)
    const walkBtn = document.createElement('button')
    walkBtn.type = 'button'
    walkBtn.className = 'btn btn-cash btn-fight'
    const walkLabel = h('span', 'cash-label', 'WALK AWAY')
    const walkAmount = h('span', 'cash-amount', '')
    walkBtn.append(walkLabel, walkAmount)
    walkBtn.addEventListener('click', doWalk)
    actions.append(rollBtn, walkBtn)

    let playing: Anim | null = null
    let rollKey = ''

    function setBar(bar: Bar, hp: number, max: number): void {
      const w = `${hpPercent(hp, max)}%`
      if (bar.fill.style.width !== w) bar.fill.style.width = w
      setText(bar.text, `${hp} / ${max} HP`)
    }

    return {
      update(s, now) {
        const f = s.fight
        if (!f) return
        const a = anim
        if (a !== playing) {
          if (a) {
            stage.begin(planExchange(a.ex, f.status))
            rollKey = ''
          } else {
            stage.finish()
          }
          playing = a
        }
        const elapsed = a ? now - a.start : TIMELINE.totalMs
        if (a) stage.advance(elapsed)
        const settled = a === null || elapsed >= TIMELINE.impactAt
        const shown: FightState = settled || a === null ? f : a.prev
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
          stage.setRoll('enemy', rollChip(ex.enemyFaces, null, ex.enemyTotal), ex.winner === 'enemy' ? 'win' : ex.winner === 'tie' ? 'tie' : 'lose')
          stage.setRoll('player', rollChip(ex.playerFaces, ex.playerFacesBeforeReroll, ex.playerTotal), ex.winner === 'player' ? 'win' : ex.winner === 'tie' ? 'tie' : 'lose')
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
    if (r) {
      const net = r.payout - r.bet
      if (r.isBoss) card.append(h('div', 'boss-badge', 'BOSS'))
      card.append(h('h2', `card-title outcome-${r.outcome}`, fightTitle(r.outcome, r.isBoss)))
      const msg = fightMessage(r.outcome)
      if (msg) card.append(h('div', 'card-sub', msg))
      const rows = h('div', 'rows')
      rows.append(row('Multiplier', formatMultiplier(r.multiplier)))
      rows.append(row('Bet', formatCoins(r.bet)))
      rows.append(row('Payout', formatCoins(r.payout)))
      rows.append(row('Net', formatNet(net), net >= 0 ? 'good' : 'bad'))
      rows.append(row('Rolls', String(r.rolls)))
      card.append(rows)
      if (r.isBoss) {
        const met = targetMet(s)
        card.append(h('div', 'card-sub checkpoint-note ' + (met ? 'good-text' : 'bad-text'), `Checkpoint: you have ${formatCoins(s.bankroll)}, target ${formatCoins(s.target)}`))
      }
    }
    centered(card)
    actions.append(button('btn-primary btn-big', 'CONTINUE', doContinue))
    return { update() {} }
  }

  function buildCheckpoint(s: GameState): Screen {
    const card = h('div', 'card card-boss')
    card.append(h('div', 'boss-badge', 'CHECKPOINT'))
    card.append(h('h2', 'card-title outcome-won', checkpointHeadline(s.lastCheckpoint)))
    const rows = h('div', 'rows')
    rows.append(row('Bankroll', formatCoins(s.bankroll)))
    rows.append(row('Buy-in', formatCoins(s.buyIn)))
    card.append(rows)
    card.append(h('div', 'net-line ' + (s.bankroll >= s.buyIn ? 'good-text' : 'bad-text'), 'Net so far ' + checkpointNet(s.bankroll, s.buyIn)))
    card.append(h('div', 'card-sub free-note', leaveFreeLine()))
    card.append(h('div', 'card-sub checkpoint-note', nextTargetLine(s)))
    centered(card)
    actions.classList.add('actions-col')
    actions.append(button('btn-cash btn-big btn-flat', leaveLabel(s.bankroll), doLeave, !s.canLeave))
    actions.append(button('btn-primary btn-big', continueLabel(s.stage), doContinue))
    return { update() {} }
  }

  function buildShop(s: GameState): Screen {
    const card = h('div', 'card')
    card.append(h('h2', 'card-title', s.shopOffers.length > 0 ? 'Pick an upgrade' : 'Nothing new to offer'))
    if (s.shopOffers.length === 0) card.append(h('div', 'card-sub', 'You already own everything on offer.'))
    const zero = shopNote(s)
    if (zero) card.append(h('div', 'fee-note', zero))
    s.shopOffers.forEach((u, i) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'btn offer'
      const head = h('span', 'offer-head')
      head.append(h('span', 'offer-name', u.name))
      const owned = offerOwnedText(u)
      if (owned) head.append(h('span', 'offer-owned', owned))
      b.append(head, h('span', 'offer-desc', u.description))
      b.addEventListener('click', () => game?.dispatch({ type: 'pickUpgrade', index: i }))
      card.append(b)
    })
    centered(card)
    actions.append(button('btn-secondary btn-big', skipLabel(s.skipCoins), () => game?.dispatch({ type: 'skip' })))
    return { update() {} }
  }

  function buildGameover(s: GameState): Screen {
    const cashOut = s.cashOut ?? 0
    const net = cashOut - s.buyIn
    const card = h('div', 'card card-over')
    card.append(h('div', 'run-badge', 'RUN OVER'))
    card.append(h('h2', 'card-title ' + (net >= 0 ? 'outcome-won' : 'outcome-lost'), gameOverTitle(s.gameOverReason)))
    card.append(h('div', 'card-sub reason', gameOverText(s.gameOverReason, s.lastCheckpoint, s.cashOut, s.cashOutFee, s.failedCheckpointFeePercent, s.lastResult)))
    const rows = h('div', 'rows rows-compact')
    for (const r of returnRows(s)) rows.append(row(r.label, r.value, r.tone))
    rows.append(row('Wallet now', walletLine(wallet.balance())))
    card.append(rows)
    const stats = h('div', 'rows rows-compact rows-minor')
    for (const r of runStatRows(s)) stats.append(row(r.label, r.value, r.tone))
    card.append(stats)
    centered(card)
    actions.classList.add('actions-col')
    actions.append(button('btn-primary btn-big', 'Back to lobby', () => goLobby(randomSeed())))
    actions.append(button('btn-secondary', 'Retry same seed', () => goLobby(seed)))
    return { update() {} }
  }

  function doRoll(): void {
    if (anim || !game) return
    const before = game.state
    if (before.phase !== 'fight' || !before.fight || !before.fight.canRoll) return
    if (!game.dispatch({ type: 'roll' })) return
    const f = game.state.fight
    const ex = f ? f.exchanges[f.exchanges.length - 1] : undefined
    if (!ex) return
    anim = { prevState: before, prev: before.fight, ex, start: performance.now() }
  }

  function doWalk(): void {
    if (anim || !game) return
    game.dispatch({ type: 'walkAway' })
  }

  function guardOpen(): boolean {
    return performance.now() - screenBornAt >= CONTINUE_GUARD_MS
  }

  function doContinue(): void {
    if (anim || !game || !guardOpen()) return
    const wasBoss = game.state.phase === 'result' && game.state.lastResult?.isBoss === true
    if (!game.dispatch({ type: 'continue' })) return
    if (wasBoss) {
      const n = stageNotice(game.state)
      if (n) {
        noticeText = n
        noticeUntil = performance.now() + NOTICE_MS
      }
    }
  }

  function doLeave(): void {
    if (anim || !game || !guardOpen()) return
    game.dispatch({ type: 'leave' })
  }

  function keyFor(v: GameState, dp: Phase): string {
    const bank = dp === 'bet' || dp === 'gameover' || dp === 'checkpoint' ? v.bankroll : 0
    const wal = dp === 'gameover' ? wallet.balance() : 0
    return `${runId}|${dp}|${v.seed}|${v.fightsCompleted}|${v.stage}|${bank}|${wal}|${v.upgrades.length}|${v.shopOffers.map((o) => o.id).join(',')}|${v.canPawn}|${v.canBet}`
  }

  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space') return
    e.preventDefault()
    if (e.repeat || spaceDown) return
    spaceDown = true
    if (mode !== 'run' || !game) return
    const dp: Phase = anim ? 'fight' : game.state.phase
    if (dp === 'fight') doRoll()
    else if (dp === 'result' || dp === 'checkpoint') doContinue()
  })
  window.addEventListener('keyup', (e) => {
    if (e.code !== 'Space') return
    e.preventDefault()
    spaceDown = false
  })
  window.addEventListener('blur', () => {
    spaceDown = false
  })

  const initial = parseSeed(window.location.search)
  goLobby(initial ?? randomSeed())

  let last = performance.now()
  let acc = 0
  function frame(now: number): void {
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
      requestAnimationFrame(frame)
      return
    }
    while (acc >= TICK_MS) {
      game.tick()
      acc -= TICK_MS
    }
    if (anim && now - anim.start >= TIMELINE.totalMs) anim = null
    const s = game.state
    if (s.phase === 'gameover') wallet.settleRun(s.cashOut ?? 0)
    const view = anim ? anim.prevState : s
    const dp: Phase = view.phase
    const key = keyFor(view, dp)
    if (key !== screenKey) {
      screenKey = key
      screenBornAt = now
      actions.classList.remove('actions-col')
      screen = buildScreen(view, dp)
    }
    hud.hidden = dp === 'gameover'
    seedTag.hidden = dp === 'gameover'
    updateHud(view, now)
    screen?.update(s, now)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}
