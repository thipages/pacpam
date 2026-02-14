import { NetworkManager } from '../../src/core/network.js'
import { PeerTransport } from '../../src/sync/transport.js'
import { P2PSync } from '../../src/sync/p2p-sync.js'
import { createAuthMessage, verifyHash } from '../../src/core/auth.js'
import { createPongHandler } from './pong-handler.js'

const APP_ID = 'pacpam-pong-8a2b5c1d3e7f'

export class PongController {
  #listeners = {}
  #network = null
  #transport = null
  #sync = null
  #pongHandler = null
  #password = null
  #myPseudo = null
  #remotePseudo = null
  #disconnectCause = null
  #voluntaryDisconnect = false
  #screenId = 'IDENTITY'
  #pending = false
  #isHost = false
  #lastMoveTime = 0
  #gameOverEmitted = false

  // --- Événements ---

  on(event, fn) {
    (this.#listeners[event] ??= []).push(fn)
  }

  off(event, fn) {
    const arr = this.#listeners[event]
    if (!arr) return
    const i = arr.indexOf(fn)
    if (i >= 0) arr.splice(i, 1)
  }

  #emit(event, ...args) {
    const arr = this.#listeners[event]
    if (!arr) return
    for (const fn of arr) fn(...args)
  }

  // --- Propriétés ---

  get screenId() { return this.#screenId }
  get pending() { return this.#pending }
  get myPseudo() { return this.#myPseudo }
  get remotePseudo() { return this.#remotePseudo }
  get transportId() { return this.#transport?.myId ?? null }
  get isHost() { return this.#isHost }

  // --- Point unique écran (invariant 3) ---

  #setScreen(id, pending = false) {
    this.#screenId = id
    this.#pending = pending
    this.#emit('screen', id, pending)
  }

  // --- Actions ---

  submit(pseudo, pwd) {
    this.#myPseudo = pseudo
    this.#password = pwd
    this.#setScreen('IDENTITY', true)

    this.#network = new NetworkManager({ debug: false })
    this.#transport = new PeerTransport(this.#network)

    // CRITICAL : listener inscrit AVANT new P2PSync (ordre d'appel garanti)
    this.#transport.onStateChange((state, tid, from, event) => {
      if (from === 'CONNECTED' && state !== 'CONNECTED') {
        this.#disconnectCause = tid === 'c25' ? 'peer_left' : 'network'
      }
    })

    this.#sync = new P2PSync(this.#transport, { guardTimeout: 5000 })
    this.#wireCallbacks()
    this.#transport.init(pseudo, APP_ID)
    this.#disconnectCause = null
    this.#voluntaryDisconnect = false
  }

  connect(remotePseudo) {
    this.#remotePseudo = remotePseudo
    this.#setScreen('PAIRING', true)
    this.#transport.connect(`${APP_ID}-${remotePseudo}`)
  }

  move(y) {
    if (this.#isHost) {
      this.#pongHandler?.setHostPaddle(y)
    } else {
      const now = performance.now()
      if (now - this.#lastMoveTime < 100) return
      this.#lastMoveTime = now
      this.#pongHandler?.ctrl?.sendAction({ op: 'move', y })
    }
  }

  reconnect() {
    const result = this.#sync.reconnect()
    if (result.ok) {
      this.#setScreen('SESSION_LOST', true)
    }
    return result
  }

  replay() {
    this.#pongHandler?.reset?.()
  }

  backToLobby() {
    const pseudo = this.#myPseudo
    const pwd = this.#password
    this.#voluntaryDisconnect = true
    this.#cleanup()
    this.submit(pseudo, pwd)
  }

  exit() {
    this.#voluntaryDisconnect = true
    this.#cleanup()
    this.#setScreen('IDENTITY')
  }

  // --- Câblage lib ---

  #wireCallbacks() {
    this.#transport.onIdReady = () => {
      this.#setScreen('PAIRING')
      this.#emit('id-ready', this.#transport.myId)
    }

    this.#transport.onAuthRequired = async () => {
      const authMsg = await createAuthMessage(this.#password, this.#myPseudo)
      this.#transport.send(authMsg)
    }

    this.#transport.onData = (data) => {
      if (data.type === 'auth') {
        this.#handleAuth(data)
      }
    }

    this.#transport.onConnected = () => {
      this.#isHost = this.#transport.isHost
      if (!this.#remotePseudo) {
        this.#remotePseudo = this.#transport.remotePeerId?.replace(`${APP_ID}-`, '') ?? null
      }
      if (this.#isHost) {
        this.#createPongSession()
      }
    }

    this.#transport.onError = (err) => {
      if (this.#voluntaryDisconnect) return
      const syncState = this.#sync?.state
      if (!syncState || syncState === 'IDLE') {
        this.#emit('error', 'Erreur de connexion')
        this.#setScreen('IDENTITY')
      } else if (syncState === 'CONNECTING') {
        this.#emit('error', 'Connexion échouée')
        this.#setScreen('PAIRING')
      }
    }

    // --- P2PSync ---

    this.#sync.onStateChange = (state, detail) => {
      if (this.#voluntaryDisconnect) return
      switch (state) {
        case 'CONNECTED':
          this.#setScreen('SESSION')
          this.#emit('toast', 'Connecté !')
          break
        case 'DISCONNECTED':
          if (this.#disconnectCause === 'peer_left') {
            this.#setScreen('SESSION_PEER_LEFT')
          } else {
            this.#setScreen('SESSION_LOST')
          }
          break
        case 'IDLE':
          if (detail.event === 'TRANSPORT_FAILED') {
            this.#emit('error', 'Connexion échouée')
            this.#setScreen('PAIRING')
          }
          break
      }
    }

    this.#sync.onGuardChange = (state) => {
      this.#emit('guard', state)
    }

    this.#sync.onPeerBack = () => {
      this.#emit('toast', 'Pair de retour')
    }

    this.#sync.onPing = (latency) => {
      this.#emit('latency', latency)
    }

    this.#sync.onHandlerError = (sessionId, method, error) => {
      console.error(`[pong] Handler erreur ${sessionId}.${method}:`, error)
    }

    this.#sync.onSessionCreate = (id, config) => {
      if (id === 'pong') return this.#makePongHandler(false)
      return null
    }
  }

  // --- Auth ---

  async #handleAuth(data) {
    const authMsg = await createAuthMessage(this.#password, this.#myPseudo)
    if (verifyHash(authMsg.hash, data.hash)) {
      this.#transport.authSuccess()
    } else {
      this.#transport.authFailed()
    }
  }

  // --- Session pong ---

  #createPongSession() {
    const handler = this.#makePongHandler(true)
    this.#sync.createSession('pong', { mode: 'centralized', fps: 30 }, handler)
  }

  #makePongHandler(isHost) {
    const handler = createPongHandler(isHost, {
      onReady: () => { this.#pongHandler = handler },
      onEnded: () => { this.#pongHandler = null },
      onState: (state) => {
        this.#emit('gamestate', state)
        if (state.winner && !this.#gameOverEmitted) {
          this.#gameOverEmitted = true
          const iWon = (state.winner === 'host') === this.#isHost
          this.#emit('gameover', iWon, state.scores)
        }
        if (!state.winner && this.#gameOverEmitted) {
          this.#gameOverEmitted = false
          this.#emit('gameresume')
        }
      }
    })
    this.#pongHandler = handler
    return handler
  }

  // --- Cleanup ---

  #cleanup() {
    this.#transport?.disconnect()
    this.#sync = null
    this.#transport = null
    this.#network = null
    this.#pongHandler = null
    this.#disconnectCause = null
    this.#isHost = false
    this.#gameOverEmitted = false
  }
}
