import { cappedParticles } from './effects.ts'

export interface Box {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export interface Fx {
  coinBurst(from: Box, to: Box, count: number): void
  confetti(count: number, bounds: Box): void
  flash(kind: 'boss' | 'stage'): void
  banner(text: string): void
  fly(from: Box, to: Box, label: string): number
  active(): number
  clear(): void
  dispose(): void
}

export interface FxOptions {
  readonly reduced: () => boolean
  readonly factor: () => number
}

const CONFETTI_COLORS = ['#fbbf24', '#38bdf8', '#4ade80', '#f472b6', '#f87171', '#c084fc']

function node(cls: string, text?: string): HTMLElement {
  const el = document.createElement('div')
  el.className = cls
  if (text !== undefined) el.textContent = text
  return el
}

function centerOf(b: Box): { x: number; y: number } {
  return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
}

export function createFx(layer: HTMLElement, options: FxOptions): Fx {
  const running = new Set<Animation>()
  let disposed = false

  function launch(el: HTMLElement, keyframes: Keyframe[], duration: number, delay = 0, easing = 'ease-out'): void {
    if (disposed) return
    layer.append(el)
    let anim: Animation
    try {
      anim = el.animate(keyframes, { duration: Math.max(60, duration), delay, easing, fill: 'both' })
    } catch {
      el.remove()
      return
    }
    running.add(anim)
    const done = (): void => {
      running.delete(anim)
      el.remove()
    }
    anim.onfinish = done
    anim.oncancel = done
  }

  function scaled(ms: number): number {
    return ms * Math.max(0.4, options.factor())
  }

  return {
    coinBurst(from, to, count) {
      const n = cappedParticles(count, running.size)
      if (n <= 0) return
      const end = centerOf(to)
      if (options.reduced()) {
        const coin = node('fx-coin')
        coin.style.left = `${end.x - 8}px`
        coin.style.top = `${end.y - 8}px`
        launch(coin, [{ opacity: 0 }, { opacity: 1, offset: 0.4 }, { opacity: 0 }], 600)
        return
      }
      const start = centerOf(from)
      for (let i = 0; i < n; i++) {
        const coin = node('fx-coin')
        coin.style.left = `${start.x - 8}px`
        coin.style.top = `${start.y - 8}px`
        const spreadX = (Math.random() - 0.5) * 90
        const spreadY = -20 - Math.random() * 60
        const dx = end.x - start.x
        const dy = end.y - start.y
        launch(
          coin,
          [
            { transform: 'translate(0px, 0px) scale(0.4)', opacity: 0 },
            { transform: `translate(${spreadX}px, ${spreadY}px) scale(1)`, opacity: 1, offset: 0.32 },
            { transform: `translate(${dx}px, ${dy}px) scale(0.55)`, opacity: 0.9 },
          ],
          scaled(700 + Math.random() * 260),
          scaled(i * 28),
          'cubic-bezier(0.3, 0.1, 0.4, 1)',
        )
      }
    },
    confetti(count, bounds) {
      if (options.reduced()) return
      const n = cappedParticles(count, running.size)
      for (let i = 0; i < n; i++) {
        const piece = node('fx-confetti')
        const x = bounds.left + Math.random() * bounds.width
        piece.style.left = `${x}px`
        piece.style.top = `${bounds.top - 12}px`
        piece.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length] as string
        const fall = bounds.height * (0.55 + Math.random() * 0.5)
        const drift = (Math.random() - 0.5) * 140
        const spin = 180 + Math.random() * 540
        launch(
          piece,
          [
            { transform: 'translate(0px, 0px) rotate(0deg)', opacity: 1 },
            { transform: `translate(${drift * 0.6}px, ${fall * 0.5}px) rotate(${spin * 0.5}deg)`, opacity: 1, offset: 0.55 },
            { transform: `translate(${drift}px, ${fall}px) rotate(${spin}deg)`, opacity: 0 },
          ],
          scaled(1500 + Math.random() * 900),
          scaled(Math.random() * 350),
          'cubic-bezier(0.2, 0.6, 0.4, 1)',
        )
      }
    },
    flash(kind) {
      const el = node('fx-flash ' + (kind === 'boss' ? 'fx-flash-boss' : 'fx-flash-stage'))
      const peak = options.reduced() ? 0.3 : 0.6
      launch(el, [{ opacity: 0 }, { opacity: peak, offset: 0.18 }, { opacity: 0 }], options.reduced() ? 700 : scaled(650))
    },
    banner(text) {
      const el = node('fx-banner', text)
      el.setAttribute('role', 'status')
      if (options.reduced()) {
        launch(el, [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], scaled(1800))
        return
      }
      launch(
        el,
        [
          { transform: 'translate(-50%, -50%) scale(0.5)', opacity: 0 },
          { transform: 'translate(-50%, -50%) scale(1.12)', opacity: 1, offset: 0.16 },
          { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, offset: 0.24 },
          { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, offset: 0.8 },
          { transform: 'translate(-50%, -60%) scale(1)', opacity: 0 },
        ],
        scaled(1900),
      )
    },
    fly(from, to, label) {
      const duration = options.reduced() ? 0 : scaled(520)
      if (duration === 0) return 0
      const el = node('fx-fly', label)
      el.style.left = `${from.left}px`
      el.style.top = `${from.top}px`
      el.style.width = `${from.width}px`
      const a = centerOf(from)
      const b = centerOf(to)
      launch(
        el,
        [
          { transform: 'translate(0px, 0px) scale(1)', opacity: 1 },
          { transform: `translate(${b.x - a.x}px, ${b.y - a.y}px) scale(0.25)`, opacity: 0.15 },
        ],
        duration,
        0,
        'cubic-bezier(0.5, 0, 0.2, 1)',
      )
      return duration
    },
    active: () => running.size,
    clear() {
      for (const a of [...running]) a.cancel()
      running.clear()
      layer.replaceChildren()
    },
    dispose() {
      disposed = true
      for (const a of [...running]) a.cancel()
      running.clear()
      layer.replaceChildren()
    },
  }
}
