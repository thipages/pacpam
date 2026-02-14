export const DIMS = { W: 600, H: 400, PADDLE_H: 80, PADDLE_W: 10, BALL_R: 6 }

const BALL_SPEED = 300
const MAX_DT = 0.05
const WIN_SCORE = 3

function resetBall() {
  const angle = (Math.random() * 0.8 - 0.4)
  const dir = Math.random() < 0.5 ? 1 : -1
  return {
    x: DIMS.W / 2,
    y: DIMS.H / 2,
    vx: Math.cos(angle) * BALL_SPEED * dir,
    vy: Math.sin(angle) * BALL_SPEED
  }
}

function clampPaddle(y) {
  const half = DIMS.PADDLE_H / 2
  return Math.max(half, Math.min(DIMS.H - half, y))
}

export function createPongHandler(isHost, callbacks) {
  if (isHost) {
    let ctrl = null
    let state = null
    let lastTick = 0

    const initState = () => ({
      ball: resetBall(),
      paddles: { host: DIMS.H / 2, guest: DIMS.H / 2 },
      scores: { host: 0, guest: 0 },
      winner: null
    })

    const tick = () => {
      const now = performance.now()
      const dt = Math.min((now - lastTick) / 1000, MAX_DT)
      lastTick = now

      const b = state.ball

      // Déplacement
      b.x += b.vx * dt
      b.y += b.vy * dt

      // Rebond haut/bas
      if (b.y - DIMS.BALL_R <= 0) {
        b.y = DIMS.BALL_R
        b.vy = Math.abs(b.vy)
      } else if (b.y + DIMS.BALL_R >= DIMS.H) {
        b.y = DIMS.H - DIMS.BALL_R
        b.vy = -Math.abs(b.vy)
      }

      // Collision raquette hôte (gauche)
      const ph = DIMS.PADDLE_H / 2
      if (b.vx < 0 && b.x - DIMS.BALL_R <= DIMS.PADDLE_W &&
          b.y >= state.paddles.host - ph && b.y <= state.paddles.host + ph) {
        b.x = DIMS.PADDLE_W + DIMS.BALL_R
        const offset = (b.y - state.paddles.host) / ph
        const angle = offset * (Math.PI / 4)
        const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy)
        b.vx = Math.cos(angle) * speed
        b.vy = Math.sin(angle) * speed
      }

      // Collision raquette guest (droite)
      if (b.vx > 0 && b.x + DIMS.BALL_R >= DIMS.W - DIMS.PADDLE_W &&
          b.y >= state.paddles.guest - ph && b.y <= state.paddles.guest + ph) {
        b.x = DIMS.W - DIMS.PADDLE_W - DIMS.BALL_R
        const offset = (b.y - state.paddles.guest) / ph
        const angle = offset * (Math.PI / 4)
        const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy)
        b.vx = -Math.cos(angle) * speed
        b.vy = Math.sin(angle) * speed
      }

      // Scoring
      if (b.x < 0) {
        state.scores.guest++
        state.ball = resetBall()
      } else if (b.x > DIMS.W) {
        state.scores.host++
        state.ball = resetBall()
      }

      // Win condition
      if (state.scores.host >= WIN_SCORE || state.scores.guest >= WIN_SCORE) {
        state.winner = state.scores.host >= WIN_SCORE ? 'host' : 'guest'
      }
    }

    return {
      ctrl: null,
      onStart(c) {
        ctrl = c
        this.ctrl = c
        state = initState()
        lastTick = performance.now()
        callbacks.onReady?.()
        callbacks.onState?.(state)
      },
      onEnd() {
        ctrl = null
        this.ctrl = null
        callbacks.onEnded?.()
      },
      processAction({ op, y }) {
        if (op === 'move') state.paddles.guest = clampPaddle(y)
      },
      getLocalState() {
        if (!state.winner) tick()
        callbacks.onState?.(state)
        return state
      },
      setHostPaddle(y) {
        if (state && !state.winner) state.paddles.host = clampPaddle(y)
      },
      reset() {
        state = initState()
        lastTick = performance.now()
        callbacks.onState?.(state)
      }
    }
  }

  // --- Guest handler ---
  return {
    ctrl: null,
    onStart(c) {
      this.ctrl = c
      callbacks.onReady?.()
    },
    onEnd() {
      this.ctrl = null
      callbacks.onEnded?.()
    },
    applyRemoteState(s) {
      callbacks.onState?.(s)
    },
    getLocalState() {
      return undefined
    }
  }
}
