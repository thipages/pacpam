import { P2PSync } from '../../src/sync/p2p-sync.js'
import { createAuthMessage, verifyHash } from '../../src/core/auth.js'
import { registerMessageSchemas } from '../../src/security/message-validator.js'
import { createChatHandler } from './chat-handler.js'

registerMessageSchemas({
  chat: {
    required: ['text'],
    fields: {
      text: { type: 'string', maxLength: 500 },
      from: { type: 'string', maxLength: 20 }
    }
  }
})

const DEFAULT_APP_ID = 'pacpam-chat-7f3a9c2e1d4b'

export class ChatController {
  #listeners = {}
  #sync = null
  #chatHandler = null
  #password = null
  #myPseudo = null
  #remotePseudo = null
  #disconnectCause = null
  #voluntaryDisconnect = false
  #screenId = 'IDENTITY'
  #pending = false
  #appId = DEFAULT_APP_ID

  get appId() { return this.#appId }
  set appId(id) { this.#appId = id }

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
  get transportId() { return this.#sync?.myId ?? null }

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

    this.#sync = new P2PSync({ network: { debug: false }, guardTimeout: 5000 })

    // Listener L2 pour diagnostic disconnectCause
    this.#sync.transport.onStateChange((state, tid, from, event) => {
      if (from === 'CONNECTED' && state !== 'CONNECTED') {
        this.#disconnectCause = tid === 'c25' ? 'peer_left' : 'network'
      }
    })

    this.#wireCallbacks()
    this.#sync.init(pseudo, this.#appId)
    this.#disconnectCause = null
    this.#voluntaryDisconnect = false
  }

  connect(remotePseudo) {
    this.#remotePseudo = remotePseudo
    this.#setScreen('PAIRING', true)
    this.#sync.connect(`${this.#appId}-${remotePseudo}`)
  }

  send(text) {
    if (!text || !this.#chatHandler) return
    this.#chatHandler.send(text, this.#myPseudo)
    this.#emit('message', 'me', text, null)
  }

  reconnect() {
    const result = this.#sync.reconnect()
    if (result.ok) {
      this.#setScreen('SESSION_LOST', true)
    }
    return result
  }

  exit() {
    this.#voluntaryDisconnect = true
    this.#cleanup()
    this.#setScreen('IDENTITY')
  }

  // --- Câblage lib ---

  #wireCallbacks() {
    this.#sync.onIdReady = () => {
      this.#setScreen('PAIRING')
      this.#emit('id-ready', this.#sync.myId)
    }

    this.#sync.onAuthRequired = async () => {
      const authMsg = await createAuthMessage(this.#password, this.#myPseudo)
      this.#sync.send(authMsg)
    }

    this.#sync.onData = (data) => {
      if (data.type === 'auth') {
        this.#handleAuth(data)
      }
    }

    this.#sync.onConnected = () => {
      if (!this.#remotePseudo) {
        this.#remotePseudo = this.#sync.remotePeerId?.replace(`${this.#appId}-`, '') ?? null
      }
      if (this.#sync.isHost) {
        this.#createChatSession()
      }
    }

    this.#sync.onError = (err) => {
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
      console.error(`[chat] Handler erreur ${sessionId}.${method}:`, error)
    }

    this.#sync.onSessionCreate = (id, config) => {
      if (id === 'chat') return this.#makeChatHandler()
      return null
    }
  }

  // --- Auth ---

  async #handleAuth(data) {
    const authMsg = await createAuthMessage(this.#password, this.#myPseudo)
    if (verifyHash(authMsg.hash, data.hash)) {
      this.#sync.authSuccess()
    } else {
      this.#sync.authFailed()
    }
  }

  // --- Session chat ---

  #createChatSession() {
    const handler = this.#makeChatHandler()
    this.#sync.createSession('chat', { mode: 'independent', fps: 0 }, handler)
  }

  #makeChatHandler() {
    const handler = createChatHandler({
      onReady: () => { this.#chatHandler = handler },
      onEnded: () => { this.#chatHandler = null },
      onMessage: (payload) => {
        this.#emit('message', 'peer', payload.text, payload.from)
      }
    })
    this.#chatHandler = handler
    return handler
  }

  // --- Cleanup ---

  #cleanup() {
    this.#sync?.disconnect()
    this.#sync = null
    this.#chatHandler = null
    this.#disconnectCause = null
  }
}
