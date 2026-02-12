import { NetworkManager } from '../../src/core/network.js'
import { PeerTransport } from '../../src/sync/transport.js'
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

const APP_ID = 'pacpam-chat-7f3a9c2e1d4b'

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

<div class="ci-screen ci-screen-chat" data-screen="chat">
  <div class="ci-status-bar">
    <span data-ref="dot" class="ci-dot"></span>
    <span data-ref="statusText" class="ci-status-text">Connecté</span>
    <span class="ci-spacer"></span>
    <button data-ref="btnQuit" class="ci-btn ci-btn-danger ci-btn-sm">Quitter</button>
  </div>

  <div class="ci-messages-zone">
    <div data-ref="messages" class="ci-messages"></div>
    <div data-ref="overlayAbsent" class="ci-overlay-absent ci-hidden">
      <span>Pair absent</span>
    </div>
  </div>

  <div data-ref="overlayReconnect" class="ci-overlay-reconnect ci-hidden">
    <div class="ci-overlay-content">
      <p data-ref="reconnectText"></p>
      <div data-ref="reconnectActions" class="ci-overlay-actions"></div>
    </div>
  </div>

  <div class="ci-input-bar">
    <input data-ref="msgInput" placeholder="Message..." autocomplete="off">
    <button data-ref="btnSend" class="ci-btn-send" aria-label="Envoyer">&#9654;</button>
  </div>
</div>

<div data-ref="toastZone" class="ci-toast-zone"></div>
`

class ChatInstance extends HTMLElement {
  #network
  #transport
  #sync
  #chatHandler
  #password
  #myPseudo
  #lastDisconnectEvent
  #idReady = false
  #pendingRemotePeerId = null
  #voluntaryDisconnect = false

  connectedCallback() {
    this.innerHTML = TEMPLATE
    this.#cacheRefs()
    this.#bindEvents()

    const pseudo = this.getAttribute('pseudo')
    if (pseudo) this.#refs.pseudo.value = pseudo
  }

  // --- Refs ---

  #refs = {}

  #cacheRefs() {
    for (const el of this.querySelectorAll('[data-ref]')) {
      this.#refs[el.dataset.ref] = el
    }
  }

  // --- Propriété remotePeerId (mode test : cross-wire) ---

  set remotePeerId(id) {
    const pseudo = id.replace(`${APP_ID}-`, '')
    this.#refs.remotePseudo.value = pseudo
  }

  // --- Événements UI ---

  #bindEvents() {
    this.#refs.btnJoin.addEventListener('click', () => this.#join())
    this.#refs.pseudo.addEventListener('keydown', e => { if (e.key === 'Enter') this.#join() })
    this.#refs.password.addEventListener('keydown', e => { if (e.key === 'Enter') this.#join() })
    this.#refs.btnLeave.addEventListener('click', () => this.#leave())
    this.#refs.btnConnect.addEventListener('click', () => this.#connectToPeer())
    this.#refs.remotePseudo.addEventListener('keydown', e => { if (e.key === 'Enter') this.#connectToPeer() })
    this.#refs.btnQuit.addEventListener('click', () => this.#disconnect())
    this.#refs.btnSend.addEventListener('click', () => this.#sendMessage())
    this.#refs.msgInput.addEventListener('keydown', e => { if (e.key === 'Enter') this.#sendMessage() })
  }

  // --- Écran 1 → Écran 2 : Rejoindre (init) ---

  #join() {
    const pseudo = this.#refs.pseudo.value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '')
    if (pseudo.length < 3) {
      this.#refs.loginError.textContent = 'Pseudo : 3 caractères minimum'
      return
    }

    this.#myPseudo = pseudo
    this.#password = this.#refs.password.value
    this.#refs.loginError.textContent = ''

    // Griser le formulaire
    this.#refs.pseudo.disabled = true
    this.#refs.password.disabled = true
    this.#refs.btnJoin.disabled = true
    this.#refs.btnJoin.textContent = ''
    this.#refs.btnJoin.classList.add('ci-spinner')

    this.#network = new NetworkManager({ debug: false })
    this.#transport = new PeerTransport(this.#network)
    this.#sync = new P2PSync(this.#transport, { guardTimeout: 5000 })

    this.#wireCallbacks()
    this.#transport.init(pseudo, APP_ID)
    this.#lastDisconnectEvent = null
    this.#voluntaryDisconnect = false
  }

  // --- Écran 2 : Quitter le serveur ---

  #leave() {
    this.#transport?.disconnect()
    this.#cleanup()
    this.#showScreen('login')
    this.#resetLogin()
  }

  // --- Écran 2 → Écran 3 : Connecter au pair ---

  #connectToPeer() {
    const remotePseudo = this.#refs.remotePseudo.value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '')
    if (!remotePseudo) {
      this.#refs.connectError.textContent = 'Pseudo du pair requis'
      return
    }

    this.#refs.connectError.textContent = ''
    this.#refs.remotePseudo.disabled = true
    this.#refs.btnConnect.disabled = true
    this.#refs.btnConnect.textContent = ''
    this.#refs.btnConnect.classList.add('ci-spinner')
    this.#refs.remotePseudo.dataset.target = remotePseudo

    this.#transport.connect(`${APP_ID}-${remotePseudo}`)
  }

  #wireCallbacks() {
    // --- Transport ---

    this.#transport.onIdReady = () => {
      this.#idReady = true
      this.#refs.lobbyPseudo.textContent = this.#myPseudo
      this.#showScreen('lobby')

      this.dispatchEvent(new CustomEvent('id-ready', {
        detail: { id: this.#transport.myId },
        bubbles: true
      }))

      if (this.#pendingRemotePeerId) {
        this.#refs.remotePseudo.value = this.#pendingRemotePeerId
        this.#pendingRemotePeerId = null
      }
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
      if (this.#transport.isHost) {
        this.#createChatSession()
      }
    }

    this.#transport.onError = (err) => {
      const syncState = this.#sync?.state
      if (!syncState || syncState === 'IDLE') {
        // Erreur avant init réussie
        this.#refs.loginError.textContent = err.message || 'Erreur de connexion'
        this.#resetLogin()
        this.#showScreen('login')
      } else if (syncState === 'CONNECTING') {
        // Erreur pendant la tentative de connexion au pair
        this.#refs.connectError.textContent = err.message || 'Connexion échouée'
        this.#resetLobby()
      }
    }

    // Capturer le dernier événement de déconnexion couche 2
    this.#transport.onStateChange((state, tid, from, event) => {
      if (from === 'CONNECTED' && state !== 'CONNECTED') {
        this.#lastDisconnectEvent = { tid, event }
      }
    })

    // --- P2PSync ---

    this.#sync.onStateChange = (state, detail) => {
      switch (state) {
        case 'CONNECTED':
          this.#showScreen('chat')
          this.#showToast('Connecté !')
          this.#hideOverlayReconnect()
          this.#refs.msgInput.disabled = false
          this.#refs.btnSend.disabled = false
          break

        case 'DISCONNECTED':
          this.#refs.msgInput.disabled = true
          this.#refs.btnSend.disabled = true
          this.#handleDisconnected()
          break

        case 'IDLE':
          if (detail.event === 'TRANSPORT_FAILED') {
            this.#refs.connectError.textContent = 'Connexion échouée'
            this.#resetLobby()
            this.#showScreen('lobby')
          }
          break
      }
    }

    this.#sync.onGuardChange = (state) => {
      this.#updateStatusBar(state)
    }

    this.#sync.onPeerBack = () => {
      this.#showToast('Pair de retour')
    }

    this.#sync.onSessionCreate = (id, config) => {
      if (id === 'chat') {
        return this.#makeChatHandler()
      }
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
        this.#addMessage('peer', payload.text, payload.from)
      }
    })
    this.#chatHandler = handler
    return handler
  }

  // --- Envoi message ---

  #sendMessage() {
    const text = this.#refs.msgInput.value.trim()
    if (!text || !this.#chatHandler) return
    this.#chatHandler.send(text, this.#myPseudo)
    this.#addMessage('me', text)
    this.#refs.msgInput.value = ''
    this.#refs.msgInput.focus()
  }

  // --- Déconnexion ---

  #disconnect() {
    this.#voluntaryDisconnect = true
    this.#transport?.disconnect()
    this.#cleanup()
    this.#showScreen('login')
    this.#resetLogin()
  }

  #handleDisconnected() {
    if (this.#voluntaryDisconnect) return

    const evt = this.#lastDisconnectEvent
    if (evt && evt.tid === 'c25') {
      this.#showOverlayReconnect('Le pair a quitté la conversation', false)
    } else {
      this.#showOverlayReconnect('Connexion perdue', true)
    }
  }

  #cleanup() {
    this.#sync = null
    this.#transport = null
    this.#network = null
    this.#chatHandler = null
    this.#idReady = false
    this.#lastDisconnectEvent = null
  }

  // --- Overlays ---

  #showOverlayReconnect(text, canReconnect) {
    this.#refs.overlayReconnect.classList.remove('ci-hidden')
    this.#refs.reconnectText.textContent = text
    this.#refs.reconnectActions.innerHTML = ''

    if (canReconnect) {
      const btnReconnect = document.createElement('button')
      btnReconnect.className = 'ci-btn ci-btn-accent ci-btn-sm'
      btnReconnect.textContent = 'Reconnecter'
      btnReconnect.addEventListener('click', () => {
        this.#hideOverlayReconnect()
        this.#cleanup()
        this.#showScreen('login')
        this.#resetLogin()
        this.#refs.pseudo.value = this.#myPseudo
        this.#refs.password.value = this.#password
      })

      const btnAbandon = document.createElement('button')
      btnAbandon.className = 'ci-btn ci-btn-muted ci-btn-sm'
      btnAbandon.textContent = 'Abandonner'
      btnAbandon.addEventListener('click', () => {
        this.#hideOverlayReconnect()
        this.#cleanup()
        this.#showScreen('login')
        this.#resetLogin()
      })

      this.#refs.reconnectActions.append(btnReconnect, btnAbandon)
    } else {
      const btnBack = document.createElement('button')
      btnBack.className = 'ci-btn ci-btn-accent ci-btn-sm'
      btnBack.textContent = 'Retour'
      btnBack.addEventListener('click', () => {
        this.#hideOverlayReconnect()
        this.#cleanup()
        this.#showScreen('login')
        this.#resetLogin()
      })
      this.#refs.reconnectActions.append(btnBack)
    }
  }

  #hideOverlayReconnect() {
    this.#refs.overlayReconnect.classList.add('ci-hidden')
  }

  // --- Barre de statut ---

  #updateStatusBar(guardState) {
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
        text.textContent = this.#refs.remotePseudo.dataset.target || 'Pair'
        absent.classList.add('ci-hidden')
        break
      case 'OPEN':
        dot.classList.add('ci-dot-orange')
        text.textContent = 'Pair absent'
        absent.classList.remove('ci-hidden')
        break
    }
  }

  // --- Messages ---

  #addMessage(type, text, name) {
    const el = document.createElement('div')
    el.className = `ci-msg ci-msg-${type}`

    if (name && type === 'peer') {
      const n = document.createElement('span')
      n.className = 'ci-msg-name'
      n.textContent = name
      el.appendChild(n)
    }

    const t = document.createElement('span')
    t.className = 'ci-msg-text'
    t.textContent = text
    el.appendChild(t)

    const ts = document.createElement('span')
    ts.className = 'ci-msg-time'
    ts.textContent = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    el.appendChild(ts)

    this.#refs.messages.appendChild(el)
    this.#refs.messages.scrollTop = this.#refs.messages.scrollHeight
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

  // --- Reset formulaires ---

  #resetLogin() {
    this.#refs.pseudo.disabled = false
    this.#refs.password.disabled = false
    this.#refs.btnJoin.disabled = false
    this.#refs.btnJoin.textContent = 'Rejoindre'
    this.#refs.btnJoin.classList.remove('ci-spinner')
  }

  #resetLobby() {
    this.#refs.remotePseudo.disabled = false
    this.#refs.btnConnect.disabled = false
    this.#refs.btnConnect.textContent = 'Connecter'
    this.#refs.btnConnect.classList.remove('ci-spinner')
  }
}

customElements.define('chat-instance', ChatInstance)
