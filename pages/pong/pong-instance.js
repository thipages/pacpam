import { PongController } from './pong-controller.js'
import { DIMS } from './pong-handler.js'

const TEMPLATE = `
<div class="ci-screen ci-screen-login ci-active" data-screen="login">
  <div class="ci-login-card">
    <h2>Connexion</h2>
    <div class="ci-field">
      <label>Pseudo</label>
      <input data-ref="pseudo" placeholder="3+ caractères" maxlength="10" autocomplete="off">
    </div>
    <div class="ci-field">
      <label>Mot de passe</label>
      <input data-ref="password" type="password" placeholder="identique pour les deux pairs">
    </div>
    <button data-ref="btnJoin" class="ci-btn ci-btn-accent ci-btn-full">Rejoindre</button>
    <p data-ref="loginError" class="ci-login-error"></p>
  </div>
</div>

<div class="ci-screen ci-screen-lobby" data-screen="lobby">
  <div class="ci-lobby-header">
    <span data-ref="lobbyStatus" class="ci-lobby-status">Connecté au serveur</span>
    <span class="ci-spacer"></span>
    <button data-ref="btnLeave" class="ci-btn ci-btn-muted ci-btn-sm">Quitter</button>
  </div>
  <div class="ci-lobby-body">
    <div class="ci-lobby-card">
      <p class="ci-lobby-pseudo">Pseudo : <strong data-ref="lobbyPseudo"></strong></p>
      <div class="ci-field">
        <label>Pseudo du pair distant</label>
        <input data-ref="remotePseudo" placeholder="pseudo de l'autre pair" autocomplete="off">
      </div>
      <button data-ref="btnConnect" class="ci-btn ci-btn-accent ci-btn-full">Connecter</button>
      <p data-ref="connectError" class="ci-login-error"></p>
    </div>
  </div>
</div>

<div class="ci-screen ci-screen-game" data-screen="game">
  <div class="ci-status-bar">
    <span data-ref="dot" class="ci-dot"></span>
    <span data-ref="statusText" class="ci-status-text">Connecté</span>
    <span data-ref="latencyText" class="ci-latency"></span>
    <span class="ci-spacer"></span>
    <button data-ref="btnQuit" class="ci-btn ci-btn-danger ci-btn-sm">Quitter</button>
  </div>

  <div class="ci-game-zone">
    <canvas data-ref="canvas" width="${DIMS.W}" height="${DIMS.H}"></canvas>
    <div data-ref="overlayAbsent" class="ci-overlay-absent ci-hidden">
      <span>Pair absent</span>
    </div>
  </div>

  <div data-ref="overlayGameOver" class="ci-overlay-reconnect ci-hidden">
    <div class="ci-overlay-content">
      <p data-ref="gameOverText" class="ci-gameover-title"></p>
      <p data-ref="gameOverScore" class="ci-gameover-score"></p>
      <div data-ref="gameOverActions" class="ci-overlay-actions ci-gameover-actions"></div>
    </div>
  </div>

  <div data-ref="overlayReconnect" class="ci-overlay-reconnect ci-hidden">
    <div class="ci-overlay-content">
      <p data-ref="reconnectText"></p>
      <div data-ref="reconnectActions" class="ci-overlay-actions"></div>
    </div>
  </div>
</div>

<div data-ref="toastZone" class="ci-toast-zone"></div>
`

class PongInstance extends HTMLElement {
  #ctrl = new PongController()
  #lastError = null
  #refs = {}
  #ctx = null
  #paddleY = DIMS.H / 2
  #keyDir = 0
  #keyRaf = null

  connectedCallback() {
    this.innerHTML = TEMPLATE
    this.#cacheRefs()
    this.#ctx = this.#refs.canvas.getContext('2d')
    this.#bindUI()
    this.#bindController()

    const appId = this.getAttribute('app-id')
    if (appId) this.#ctrl.appId = appId

    const pseudo = this.getAttribute('pseudo')
    if (pseudo) this.#refs.pseudo.value = pseudo
  }

  // --- Refs ---

  #cacheRefs() {
    for (const el of this.querySelectorAll('[data-ref]')) {
      this.#refs[el.dataset.ref] = el
    }
  }

  // --- Propriété remotePeerId (mode test : cross-wire) ---

  set remotePeerId(id) {
    const pseudo = id.replace(`${this.#ctrl.appId}-`, '')
    this.#refs.remotePseudo.value = pseudo
  }

  // --- Bind UI → controller ---

  #bindUI() {
    const submit = () => {
      const pseudo = this.#refs.pseudo.value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '')
      if (pseudo.length < 3) {
        this.#refs.loginError.textContent = 'Pseudo : 3 caractères minimum'
        return
      }
      this.#refs.loginError.textContent = ''
      this.#ctrl.submit(pseudo, this.#refs.password.value)
    }

    const connect = () => {
      const remotePseudo = this.#refs.remotePseudo.value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '')
      if (!remotePseudo) {
        this.#refs.connectError.textContent = 'Pseudo du pair requis'
        return
      }
      this.#refs.connectError.textContent = ''
      this.#ctrl.connect(remotePseudo)
    }

    this.#refs.btnJoin.addEventListener('click', submit)
    this.#refs.pseudo.addEventListener('keydown', e => { if (e.key === 'Enter') submit() })
    this.#refs.password.addEventListener('keydown', e => { if (e.key === 'Enter') submit() })
    this.#refs.btnLeave.addEventListener('click', () => this.#ctrl.exit())
    this.#refs.btnConnect.addEventListener('click', connect)
    this.#refs.remotePseudo.addEventListener('keydown', e => { if (e.key === 'Enter') connect() })
    this.#refs.btnQuit.addEventListener('click', () => this.#ctrl.exit())

    // Canvas input : mousemove + touchmove
    const canvas = this.#refs.canvas
    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect()
      this.#paddleY = ((e.clientY - rect.top) / rect.height) * DIMS.H
      this.#ctrl.move(this.#paddleY)
    })
    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault()
      const touch = e.touches[0]
      const rect = canvas.getBoundingClientRect()
      this.#paddleY = ((touch.clientY - rect.top) / rect.height) * DIMS.H
      this.#ctrl.move(this.#paddleY)
    }, { passive: false })

    // Keyboard input : flèches haut/bas
    const KEY_SPEED = 400
    const keyLoop = (prevTime) => {
      this.#keyRaf = requestAnimationFrame((now) => {
        if (this.#keyDir === 0) { this.#keyRaf = null; return }
        const dt = (now - prevTime) / 1000
        this.#paddleY = Math.max(0, Math.min(DIMS.H, this.#paddleY + this.#keyDir * KEY_SPEED * dt))
        this.#ctrl.move(this.#paddleY)
        keyLoop(now)
      })
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault()
        const dir = e.key === 'ArrowUp' ? -1 : 1
        if (this.#keyDir !== dir) {
          this.#keyDir = dir
          if (!this.#keyRaf) keyLoop(performance.now())
        }
      }
    })

    document.addEventListener('keyup', (e) => {
      if (e.key === 'ArrowUp' && this.#keyDir === -1) this.#keyDir = 0
      if (e.key === 'ArrowDown' && this.#keyDir === 1) this.#keyDir = 0
    })
  }

  // --- Bind controller → render ---

  #bindController() {
    this.#ctrl.on('screen', (id, pending) => this.#render(id, pending))
    this.#ctrl.on('error', (message) => { this.#lastError = message })
    this.#ctrl.on('guard', (state) => this.#updateGuard(state))
    this.#ctrl.on('latency', (ms) => { this.#refs.latencyText.textContent = `${ms}ms` })
    this.#ctrl.on('gamestate', (state) => this.#drawGame(state))
    this.#ctrl.on('gameover', (iWon, scores) => this.#showGameOver(iWon, scores))
    this.#ctrl.on('gameresume', () => this.#refs.overlayGameOver.classList.add('ci-hidden'))
    this.#ctrl.on('toast', (text) => this.#showToast(text))
    this.#ctrl.on('id-ready', (transportId) => {
      this.dispatchEvent(new CustomEvent('id-ready', {
        detail: { id: transportId },
        bubbles: true
      }))
    })
  }

  // --- Render (auto-suffisant sur id + pending) ---

  #render(id, pending) {
    switch (id) {
      case 'IDENTITY':
        this.#showScreen('login')
        if (pending) {
          this.#refs.pseudo.disabled = true
          this.#refs.password.disabled = true
          this.#refs.btnJoin.disabled = true
          this.#refs.btnJoin.textContent = ''
          this.#refs.btnJoin.classList.add('ci-spinner')
        } else {
          this.#refs.pseudo.disabled = false
          this.#refs.password.disabled = false
          this.#refs.btnJoin.disabled = false
          this.#refs.btnJoin.textContent = 'Rejoindre'
          this.#refs.btnJoin.classList.remove('ci-spinner')
          if (this.#lastError) {
            this.#refs.loginError.textContent = this.#lastError
            this.#lastError = null
          }
        }
        break

      case 'PAIRING':
        this.#showScreen('lobby')
        this.#refs.lobbyPseudo.textContent = this.#ctrl.myPseudo
        if (pending) {
          this.#refs.remotePseudo.disabled = true
          this.#refs.btnConnect.disabled = true
          this.#refs.btnConnect.textContent = ''
          this.#refs.btnConnect.classList.add('ci-spinner')
        } else {
          this.#refs.remotePseudo.disabled = false
          this.#refs.btnConnect.disabled = false
          this.#refs.btnConnect.textContent = 'Connecter'
          this.#refs.btnConnect.classList.remove('ci-spinner')
          if (this.#lastError) {
            this.#refs.connectError.textContent = this.#lastError
            this.#lastError = null
          }
        }
        break

      case 'SESSION':
        this.#showScreen('game')
        this.#refs.overlayReconnect.classList.add('ci-hidden')
        this.#refs.overlayGameOver.classList.add('ci-hidden')
        break

      case 'SESSION_LOST':
        this.#refs.latencyText.textContent = ''
        if (pending) {
          this.#showOverlay('Reconnexion en cours...', false)
        } else {
          this.#showOverlay('Connexion perdue', true)
        }
        break

      case 'SESSION_PEER_LEFT':
        this.#refs.latencyText.textContent = ''
        this.#showOverlayPeerLeft()
        break
    }
  }

  // --- Canvas rendering ---

  #drawGame(state) {
    const ctx = this.#ctx
    const W = DIMS.W
    const H = DIMS.H

    // Fond
    ctx.fillStyle = '#111'
    ctx.fillRect(0, 0, W, H)

    // Ligne centrale pointillée
    ctx.strokeStyle = '#333'
    ctx.lineWidth = 2
    ctx.setLineDash([8, 8])
    ctx.beginPath()
    ctx.moveTo(W / 2, 0)
    ctx.lineTo(W / 2, H)
    ctx.stroke()
    ctx.setLineDash([])

    // Raquette hôte (gauche)
    const ph = DIMS.PADDLE_H / 2
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, state.paddles.host - ph, DIMS.PADDLE_W, DIMS.PADDLE_H)

    // Raquette guest (droite)
    ctx.fillRect(W - DIMS.PADDLE_W, state.paddles.guest - ph, DIMS.PADDLE_W, DIMS.PADDLE_H)

    // Balle
    ctx.beginPath()
    ctx.arc(state.ball.x, state.ball.y, DIMS.BALL_R, 0, Math.PI * 2)
    ctx.fill()

    // Scores
    ctx.font = '32px monospace'
    ctx.textAlign = 'center'
    ctx.fillText(state.scores.host, W / 4, 48)
    ctx.fillText(state.scores.guest, (3 * W) / 4, 48)
  }

  // --- Game over ---

  #showGameOver(iWon, scores) {
    this.#refs.overlayGameOver.classList.remove('ci-hidden')
    this.#refs.gameOverText.textContent = iWon ? 'Victoire !' : 'Défaite !'
    this.#refs.gameOverScore.textContent = `${scores.host} - ${scores.guest}`
    this.#refs.gameOverActions.innerHTML = ''

    if (this.#ctrl.isHost) {
      const btnReplay = document.createElement('button')
      btnReplay.className = 'ci-btn ci-btn-accent ci-btn-sm'
      btnReplay.textContent = 'Rejouer'
      btnReplay.addEventListener('click', () => this.#ctrl.replay())
      this.#refs.gameOverActions.append(btnReplay)
    } else {
      const hint = document.createElement('span')
      hint.className = 'ci-gameover-hint'
      hint.textContent = "En attente de l'hôte..."
      this.#refs.gameOverActions.append(hint)
    }

    const btnLobby = document.createElement('button')
    btnLobby.className = 'ci-btn ci-btn-muted ci-btn-sm'
    btnLobby.textContent = 'Retour salon'
    btnLobby.addEventListener('click', () => this.#ctrl.backToLobby())

    const btnQuit = document.createElement('button')
    btnQuit.className = 'ci-btn ci-btn-danger ci-btn-sm'
    btnQuit.textContent = 'Quitter'
    btnQuit.addEventListener('click', () => this.#ctrl.exit())

    this.#refs.gameOverActions.append(btnLobby, btnQuit)
  }

  // --- Overlays ---

  #showOverlay(text, canReconnect) {
    this.#refs.overlayReconnect.classList.remove('ci-hidden')
    this.#refs.reconnectText.textContent = text
    this.#refs.reconnectActions.innerHTML = ''

    if (canReconnect) {
      const btnReconnect = document.createElement('button')
      btnReconnect.className = 'ci-btn ci-btn-accent ci-btn-sm'
      btnReconnect.textContent = 'Reconnecter'
      btnReconnect.addEventListener('click', () => {
        const result = this.#ctrl.reconnect()
        if (!result.ok) {
          if (result.reason === 'circuit_breaker') {
            const secs = Math.ceil(result.retryIn / 1000)
            this.#refs.reconnectText.textContent = `Trop de tentatives — réessayer dans ${secs}s`
          } else {
            const reasons = { no_peer: 'Aucun pair connu', not_disconnected: 'Toujours connecté', transport_not_ready: 'Transport non prêt' }
            this.#refs.reconnectText.textContent = `Impossible : ${reasons[result.reason] ?? result.reason}`
          }
        }
      })

      const btnAbandon = document.createElement('button')
      btnAbandon.className = 'ci-btn ci-btn-muted ci-btn-sm'
      btnAbandon.textContent = 'Abandonner'
      btnAbandon.addEventListener('click', () => this.#ctrl.exit())

      this.#refs.reconnectActions.append(btnReconnect, btnAbandon)
    } else {
      const btnAbandon = document.createElement('button')
      btnAbandon.className = 'ci-btn ci-btn-muted ci-btn-sm'
      btnAbandon.textContent = 'Abandonner'
      btnAbandon.addEventListener('click', () => this.#ctrl.exit())
      this.#refs.reconnectActions.append(btnAbandon)
    }
  }

  #showOverlayPeerLeft() {
    this.#refs.overlayReconnect.classList.remove('ci-hidden')
    this.#refs.reconnectText.textContent = 'Le pair a quitté la partie'
    this.#refs.reconnectActions.innerHTML = ''

    const btnBack = document.createElement('button')
    btnBack.className = 'ci-btn ci-btn-accent ci-btn-sm'
    btnBack.textContent = 'Retour'
    btnBack.addEventListener('click', () => this.#ctrl.exit())
    this.#refs.reconnectActions.append(btnBack)
  }

  // --- Barre de statut (guard) ---

  #updateGuard(guardState) {
    const dot = this.#refs.dot
    const text = this.#refs.statusText
    const absent = this.#refs.overlayAbsent

    dot.className = 'ci-dot'

    switch (guardState) {
      case 'HALF_OPEN':
        dot.classList.add('ci-dot-yellow')
        text.textContent = 'Connecté'
        absent.classList.add('ci-hidden')
        break
      case 'CLOSED':
        dot.classList.add('ci-dot-green')
        text.textContent = this.#ctrl.remotePseudo || 'Pair'
        absent.classList.add('ci-hidden')
        break
      case 'OPEN':
        dot.classList.add('ci-dot-orange')
        text.textContent = 'Pair absent'
        absent.classList.remove('ci-hidden')
        break
    }
  }

  // --- Toast ---

  #showToast(text) {
    const toast = document.createElement('div')
    toast.className = 'ci-toast'
    toast.textContent = text
    this.#refs.toastZone.appendChild(toast)
    setTimeout(() => toast.classList.add('ci-toast-visible'), 10)
    setTimeout(() => {
      toast.classList.remove('ci-toast-visible')
      setTimeout(() => toast.remove(), 300)
    }, 3000)
  }

  // --- Écrans ---

  #showScreen(name) {
    for (const s of this.querySelectorAll('.ci-screen')) {
      s.classList.toggle('ci-active', s.dataset.screen === name)
    }
  }
}

customElements.define('pong-instance', PongInstance)
