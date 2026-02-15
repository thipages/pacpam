# Installer un chat P2P

Chat pair-à-pair basé sur pacpam. Un seul fichier HTML, rien à installer côté serveur.

Les messages transitent directement entre navigateurs via WebRTC (chiffré nativement). Le serveur PeerJS public (`0.peerjs.com`) ne sert qu'au rendez-vous initial.

## Installation

Copier le HTML ci-dessous dans un fichier `chat.html`.

> **Aucun serveur requis** — le fichier s'ouvre directement dans le navigateur (`file://`).
>
> **Serveur existant ?** — il suffit de placer le fichier dans le dossier servi (Apache, Nginx…).

Le nom de salon est mémorisé automatiquement pour les prochaines visites.

## Test

1. Ouvrir le fichier dans deux onglets (ou deux navigateurs)
2. Choisir un nom de salon, un pseudo et un mot de passe identiques dans les deux onglets
3. Entrer le pseudo de l'autre pair et cliquer « Connecter »

## Le fichier HTML

```html
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <title>Chat P2P — Pacpam</title>
  <script type="importmap">
    { "imports": { "@thipages/pacpam": "https://esm.sh/@thipages/pacpam@0.11.0" } }
  </script>
  <style>
    :root {
      --bg: #111;
      --surface: #1a1a1a;
      --text: #e0e0e0;
      --muted: #777;
      --border: #333;
      --accent: #4b8df8;
      --danger: #f87171;
      --success: #4ade80;
      --warning: #fbbf24;
      --orange: #fb923c;
      --msg-me: #1e3a5f;
      --msg-peer: #2a2a2a;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      height: 100dvh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    chat-instance {
      display: flex;
      flex-direction: column;
      height: 100dvh;
      position: relative;
    }

    .ci-screen {
      display: none;
      flex: 1;
      flex-direction: column;
      overflow: hidden;
    }

    .ci-screen.ci-active { display: flex; }

    .ci-screen-login {
      justify-content: center;
      align-items: center;
      padding: 24px;
    }

    .ci-login-card {
      width: 100%;
      max-width: 340px;
    }

    .ci-login-card h2,
    .ci-lobby-card h2 {
      font-size: 1.1rem;
      margin-bottom: 20px;
      text-align: center;
    }

    .ci-field {
      margin-bottom: 14px;
    }

    .ci-field label {
      display: block;
      font-size: 0.8rem;
      color: var(--muted);
      margin-bottom: 4px;
    }

    .ci-field input {
      width: 100%;
      padding: 10px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      font-size: 0.95rem;
      outline: none;
      transition: border-color 0.15s;
    }

    .ci-field input:focus {
      border-color: var(--accent);
    }

    .ci-field input:disabled {
      opacity: 0.5;
    }

    .ci-login-error {
      color: var(--danger);
      font-size: 0.8rem;
      margin-top: 10px;
      text-align: center;
      min-height: 1.2em;
    }

    .ci-screen-lobby {
      overflow: hidden;
    }

    .ci-lobby-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      font-size: 0.85rem;
      flex-shrink: 0;
    }

    .ci-lobby-status {
      color: var(--success);
      font-size: 0.8rem;
    }

    .ci-lobby-body {
      flex: 1;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 24px;
    }

    .ci-lobby-card {
      width: 100%;
      max-width: 340px;
    }

    .ci-lobby-pseudo {
      font-size: 0.9rem;
      color: var(--muted);
      margin-bottom: 16px;
      text-align: center;
    }

    .ci-lobby-pseudo strong {
      color: var(--text);
    }

    .ci-btn {
      padding: 10px 20px;
      border: none;
      border-radius: 6px;
      font-size: 0.9rem;
      cursor: pointer;
      transition: opacity 0.15s;
    }

    .ci-btn:disabled { opacity: 0.4; cursor: default; }
    .ci-btn:active:not(:disabled) { opacity: 0.7; }
    .ci-btn-accent { background: var(--accent); color: #fff; }
    .ci-btn-danger { background: var(--danger); color: #fff; }
    .ci-btn-muted { background: var(--border); color: var(--text); }
    .ci-btn-full { width: 100%; margin-top: 6px; }
    .ci-btn-sm { padding: 6px 14px; font-size: 0.8rem; }

    .ci-spinner {
      position: relative;
      min-height: 20px;
    }

    .ci-spinner::after {
      content: '';
      display: block;
      width: 16px;
      height: 16px;
      margin: 0 auto;
      border: 2px solid rgba(255,255,255,0.3);
      border-top-color: #fff;
      border-radius: 50%;
      animation: ci-spin 0.6s linear infinite;
    }

    @keyframes ci-spin { to { transform: rotate(360deg); } }

    .ci-status-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      font-size: 0.85rem;
      flex-shrink: 0;
    }

    .ci-spacer { flex: 1; }

    .ci-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--muted);
      flex-shrink: 0;
    }

    .ci-dot-green { background: var(--success); }
    .ci-dot-orange { background: var(--orange); }
    .ci-dot-yellow { background: var(--warning); animation: ci-pulse 1s infinite; }

    @keyframes ci-pulse { 50% { opacity: 0.4; } }

    .ci-status-text {
      color: var(--muted);
    }

    .ci-latency {
      font-size: 11px;
      color: var(--muted);
      margin-left: 8px;
    }

    .ci-messages-zone {
      flex: 1;
      position: relative;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .ci-messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .ci-msg {
      max-width: 85%;
      padding: 8px 12px;
      border-radius: 12px;
      font-size: 0.9rem;
      line-height: 1.4;
      word-break: break-word;
    }

    .ci-msg-me {
      align-self: flex-end;
      background: var(--msg-me);
      border-bottom-right-radius: 4px;
    }

    .ci-msg-peer {
      align-self: flex-start;
      background: var(--msg-peer);
      border-bottom-left-radius: 4px;
    }

    .ci-msg-name {
      display: block;
      font-size: 0.7rem;
      color: var(--muted);
      margin-bottom: 2px;
    }

    .ci-msg-text {
      display: block;
    }

    .ci-msg-time {
      display: block;
      font-size: 0.65rem;
      color: var(--muted);
      margin-top: 2px;
      text-align: right;
    }

    .ci-input-bar {
      display: flex;
      gap: 8px;
      padding: 10px 12px;
      border-top: 1px solid var(--border);
      background: var(--surface);
      flex-shrink: 0;
    }

    .ci-input-bar input {
      flex: 1;
      padding: 10px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 20px;
      color: var(--text);
      font-size: 0.9rem;
      outline: none;
    }

    .ci-input-bar input:focus {
      border-color: var(--accent);
    }

    .ci-input-bar input:disabled {
      opacity: 0.4;
    }

    .ci-btn-send {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      border: none;
      background: var(--accent);
      color: #fff;
      font-size: 1.1rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .ci-btn-send:disabled { opacity: 0.3; cursor: default; }

    .ci-overlay-absent {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(0,0,0,0.6);
      color: var(--orange);
      padding: 8px 20px;
      border-radius: 8px;
      font-size: 0.85rem;
      pointer-events: none;
    }

    .ci-overlay-reconnect {
      position: absolute;
      inset: 0;
      background: rgba(0,0,0,0.75);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10;
    }

    .ci-overlay-content {
      text-align: center;
      padding: 24px;
    }

    .ci-overlay-content p {
      margin-bottom: 16px;
      font-size: 0.95rem;
    }

    .ci-overlay-actions {
      display: flex;
      gap: 10px;
      justify-content: center;
    }

    .ci-toast-zone {
      position: absolute;
      bottom: 70px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      z-index: 20;
      pointer-events: none;
    }

    .ci-toast {
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 6px 16px;
      border-radius: 20px;
      font-size: 0.8rem;
      opacity: 0;
      transform: translateY(8px);
      transition: opacity 0.3s, transform 0.3s;
    }

    .ci-toast-visible {
      opacity: 1;
      transform: translateY(0);
    }

    .ci-hidden { display: none !important; }
  </style>
</head>
<body>
  <script type="module">
    import {
      P2PSync,
      createAuthMessage,
      verifyHash,
      registerMessageSchemas
    } from '@thipages/pacpam'

    const STORAGE_KEY = 'pacpam-chat-salon'

    // --- Schéma de validation ---

    registerMessageSchemas({
      chat: {
        required: ['text'],
        fields: {
          text: { type: 'string', maxLength: 500 },
          from: { type: 'string', maxLength: 20 }
        }
      }
    })

    // --- Chat handler ---

    function createChatHandler(callbacks) {
      return {
        ctrl: null,
        onStart(ctrl) {
          this.ctrl = ctrl
          callbacks.onReady?.()
        },
        onEnd() {
          this.ctrl = null
          callbacks.onEnded?.()
        },
        onMessage(payload) {
          callbacks.onMessage?.(payload)
        },
        send(text, from) {
          this.ctrl?.sendMessage({ text, from })
        }
      }
    }

    // --- Chat controller ---

    class ChatController {
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
      #appId = null

      get myPseudo() { return this.#myPseudo }
      get remotePseudo() { return this.#remotePseudo }
      get transportId() { return this.#sync?.myId ?? null }

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

      #setScreen(id, pending = false) {
        this.#screenId = id
        this.#pending = pending
        this.#emit('screen', id, pending)
      }

      submit(pseudo, pwd, appId) {
        this.#myPseudo = pseudo
        this.#password = pwd
        this.#appId = appId
        this.#setScreen('IDENTITY', true)

        this.#sync = new P2PSync({ network: { debug: false }, guardTimeout: 5000 })

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

      async #handleAuth(data) {
        const authMsg = await createAuthMessage(this.#password, this.#myPseudo)
        if (verifyHash(authMsg.hash, data.hash)) {
          this.#sync.authSuccess()
        } else {
          this.#sync.authFailed()
        }
      }

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

      #cleanup() {
        this.#sync?.disconnect()
        this.#sync = null
        this.#chatHandler = null
        this.#disconnectCause = null
      }
    }

    // --- Web Component ---

    const TEMPLATE = `
    <div class="ci-screen ci-screen-login ci-active" data-screen="login">
      <div class="ci-login-card">
        <h2>Connexion</h2>
        <div class="ci-field">
          <label>Salon</label>
          <input data-ref="salon" placeholder="ex: equipe-projet-alpha" maxlength="30" autocomplete="off">
        </div>
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
        <span data-ref="latencyText" class="ci-latency"></span>
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
      #ctrl = new ChatController()
      #lastError = null
      #refs = {}

      connectedCallback() {
        this.innerHTML = TEMPLATE
        this.#cacheRefs()
        this.#bindUI()
        this.#bindController()

        try {
          const saved = localStorage.getItem(STORAGE_KEY)
          if (saved) this.#refs.salon.value = saved
        } catch {}

      }

      #cacheRefs() {
        for (const el of this.querySelectorAll('[data-ref]')) {
          this.#refs[el.dataset.ref] = el
        }
      }

      #bindUI() {
        const submit = () => {
          const salon = this.#refs.salon.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
          if (salon.length < 3) {
            this.#refs.loginError.textContent = 'Salon : 3 caractères minimum (lettres, chiffres, tirets)'
            return
          }
          const pseudo = this.#refs.pseudo.value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '')
          if (pseudo.length < 3) {
            this.#refs.loginError.textContent = 'Pseudo : 3 caractères minimum'
            return
          }
          this.#refs.loginError.textContent = ''
          try { localStorage.setItem(STORAGE_KEY, salon) } catch {}
          this.#ctrl.submit(pseudo, this.#refs.password.value, `pacpam-${salon}`)
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

        const send = () => {
          const text = this.#refs.msgInput.value.trim()
          if (!text) return
          this.#ctrl.send(text)
          this.#refs.msgInput.value = ''
          this.#refs.msgInput.focus()
        }

        this.#refs.btnJoin.addEventListener('click', submit)
        this.#refs.salon.addEventListener('keydown', e => { if (e.key === 'Enter') submit() })
        this.#refs.pseudo.addEventListener('keydown', e => { if (e.key === 'Enter') submit() })
        this.#refs.password.addEventListener('keydown', e => { if (e.key === 'Enter') submit() })
        this.#refs.btnLeave.addEventListener('click', () => this.#ctrl.exit())
        this.#refs.btnConnect.addEventListener('click', connect)
        this.#refs.remotePseudo.addEventListener('keydown', e => { if (e.key === 'Enter') connect() })
        this.#refs.btnQuit.addEventListener('click', () => this.#ctrl.exit())
        this.#refs.btnSend.addEventListener('click', send)
        this.#refs.msgInput.addEventListener('keydown', e => { if (e.key === 'Enter') send() })
      }

      #bindController() {
        this.#ctrl.on('screen', (id, pending) => this.#render(id, pending))
        this.#ctrl.on('error', (message) => { this.#lastError = message })
        this.#ctrl.on('guard', (state) => this.#updateGuard(state))
        this.#ctrl.on('latency', (ms) => { this.#refs.latencyText.textContent = `${ms}ms` })
        this.#ctrl.on('message', (type, text, name) => this.#addMessage(type, text, name))
        this.#ctrl.on('toast', (text) => this.#showToast(text))
      }

      #render(id, pending) {
        switch (id) {
          case 'IDENTITY':
            this.#showScreen('login')
            if (pending) {
              this.#refs.salon.disabled = true
              this.#refs.pseudo.disabled = true
              this.#refs.password.disabled = true
              this.#refs.btnJoin.disabled = true
              this.#refs.btnJoin.textContent = ''
              this.#refs.btnJoin.classList.add('ci-spinner')
            } else {
              this.#refs.salon.disabled = false
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
            this.#showScreen('chat')
            this.#refs.overlayReconnect.classList.add('ci-hidden')
            this.#refs.msgInput.disabled = false
            this.#refs.btnSend.disabled = false
            break

          case 'SESSION_LOST':
            this.#refs.msgInput.disabled = true
            this.#refs.btnSend.disabled = true
            this.#refs.latencyText.textContent = ''
            if (pending) {
              this.#showOverlay('Reconnexion en cours...', false)
            } else {
              this.#showOverlay('Connexion perdue', true)
            }
            break

          case 'SESSION_PEER_LEFT':
            this.#refs.msgInput.disabled = true
            this.#refs.btnSend.disabled = true
            this.#refs.latencyText.textContent = ''
            this.#showOverlayPeerLeft()
            break
        }
      }

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
        this.#refs.reconnectText.textContent = 'Le pair a quitté la conversation'
        this.#refs.reconnectActions.innerHTML = ''

        const btnBack = document.createElement('button')
        btnBack.className = 'ci-btn ci-btn-accent ci-btn-sm'
        btnBack.textContent = 'Retour'
        btnBack.addEventListener('click', () => this.#ctrl.exit())
        this.#refs.reconnectActions.append(btnBack)
      }

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

      #showScreen(name) {
        for (const s of this.querySelectorAll('.ci-screen')) {
          s.classList.toggle('ci-active', s.dataset.screen === name)
        }
      }
    }

    customElements.define('chat-instance', ChatInstance)

    // --- Lancement ---

    const instance = document.createElement('chat-instance')
    document.body.appendChild(instance)
  </script>
</body>
</html>
```
