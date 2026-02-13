/**
 * <peer-instance> — custom element encapsulant un pair P2P complet.
 *
 * Chaque instance possède son propre PeerTransport + P2PSync,
 * ses propres sessions, contrôles et log.
 *
 * Attributs :
 *   name    — label affiché ("Pair A", "Pair B")
 *   pseudo  — pseudo par défaut
 *
 * Événement émis :
 *   'id-ready' — detail: { id } — PeerJS ID prêt, l'autre instance peut s'y connecter
 */

import { NetworkManager, PeerTransport, P2PSync, createAuthMessage, verifyHash } from '../../src/index.js';

const PASSWORD = 'test';
const APP_ID = `pacpam-test-${Date.now()}`;

const TEMPLATE = `
<style>
  :host { display: block; }
  .header { font-size: 13px; font-weight: 600; margin-bottom: 6px; display: flex; gap: 8px; align-items: center; }
  .role-badge { font-size: 10px; padding: 1px 6px; border-radius: 3px; display: none; }
  .role-badge.host { display: inline; background: #1a2e1a; border: 1px solid #a9dc76; color: #a9dc76; }
  .role-badge.guest { display: inline; background: #2e2a1a; border: 1px solid #ffd866; color: #ffd866; }
  .row { display: flex; gap: 6px; margin-bottom: 6px; align-items: center; }
  input { background: #16213e; border: 1px solid #444; color: #e0e0e0; padding: 3px 6px;
          font-family: monospace; font-size: 12px; width: 140px; }
  button { background: #0f3460; border: 1px solid #555; color: #e0e0e0; padding: 3px 10px;
           cursor: pointer; font-family: monospace; font-size: 12px; }
  button:hover { background: #1a4f8a; }
  button:disabled { opacity: 0.3; cursor: default; }

  .info { font-size: 11px; color: #888; margin-bottom: 6px; }
  .info strong { color: #f8f8f2; }
  .state-idle { color: #888; }
  .state-connecting { color: #ffd866; }
  .state-connected { color: #a9dc76; }
  .state-disconnected { color: #ff6188; }
  .guard-half_open { color: #ffd866; }
  .guard-closed { color: #a9dc76; }
  .guard-open { color: #ff6188; }

  .sessions { font-size: 11px; color: #888; margin-bottom: 6px; }
  .sessions strong { color: #f8f8f2; }

  .counter { font-size: 28px; text-align: center; padding: 8px; color: #7fdbca; }

  .messages { height: 80px; overflow-y: auto; font-size: 11px; line-height: 1.5;
              background: #0d1117; padding: 4px; border: 1px solid #333; margin-bottom: 6px; }
  .messages div { color: #c9d1d9; }

  .log { height: 120px; overflow-y: auto; font-size: 11px; line-height: 1.5;
         background: #0d1117; padding: 4px; border: 1px solid #333; }
  .log div { color: #8b949e; }
  .log div.data-a { color: #78dce8; }
  .log div.data-b { color: #ab9df2; }

  .section-title { font-size: 11px; color: #c792ea; margin: 8px 0 4px; text-transform: uppercase; }
</style>

<div class="header"><span id="name"></span><span class="role-badge" id="role-badge"></span></div>

<div class="row">
    <input id="pseudo" placeholder="Pseudo">
    <button id="btn-init">Init</button>
    <button id="btn-connect" disabled>Connecter</button>
    <button id="btn-disconnect" disabled>Déconnecter</button>
</div>

<div class="info">
    <span>ID : <strong id="my-id">—</strong></span> ·
    <span>Rôle : <strong id="role">—</strong></span> ·
    <span>État : <strong id="state" class="state-idle">idle</strong></span> ·
    <span>Sync : <strong id="sync-state" class="state-idle">IDLE</strong></span> ·
    <span>Guard : <strong id="guard-state" class="state-idle">—</strong></span>
</div>

<div class="sessions">Sessions : <span id="sessions-list">—</span></div>

<div class="row" style="margin-top:4px">
    <span class="section-title" style="margin:0">Compteur (centralisé) · <span id="counter-fps">fps=0</span></span>
    <span class="counter" id="counter-value" style="padding:0 8px">0</span>
    <button id="btn-dec" disabled>−1</button>
    <button id="btn-inc" disabled>+1</button>
    <button id="btn-broadcast" disabled>Diffuser</button>
    <button id="btn-toggle-fps" disabled>fps 0→5</button>
</div>

<div class="section-title">Statut (indépendant, fps=0)</div>
<div class="messages" id="messages"></div>
<div class="row">
    <input id="msg-input" placeholder="Message…" disabled>
    <button id="btn-send-msg" disabled>Envoyer</button>
</div>

<div class="row" style="margin-top:4px">
    <span class="section-title" style="margin:0">Présence · <span id="presence-status">—</span></span>
    <span class="info" style="margin:0">Pair : <strong id="remote-presence">—</strong></span>
    <input id="presence-input" placeholder="ex: frappe, absent…" disabled>
    <button id="btn-set-presence" disabled>Définir</button>
</div>
<div class="row">
    <span class="section-title" style="margin:0">Sécurité</span>
    <button id="btn-invalid" disabled>Envoyer invalide</button>
</div>

<div class="section-title">Journal</div>
<div class="log" id="log"></div>
`;

export class PeerInstance extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.shadowRoot.innerHTML = TEMPLATE;

        const network = new NetworkManager({ debug: false });
        this.transport = new PeerTransport(network);
        this.sync = new P2PSync(this.transport);
        this.peerId = null;
        this.remotePeerId = null;
    }

    connectedCallback() {
        const $ = (sel) => this.shadowRoot.querySelector(sel);

        // Label et pseudo par défaut
        $('#name').textContent = this.getAttribute('name') || 'Pair';
        $('#pseudo').value = this.getAttribute('pseudo') || '';

        // --- Raccourcis DOM ---
        const btnInit = $('#btn-init');
        const btnConnect = $('#btn-connect');
        const btnDisconnect = $('#btn-disconnect');
        const btnInc = $('#btn-inc');
        const btnDec = $('#btn-dec');
        const btnSendMsg = $('#btn-send-msg');
        const btnBroadcast = $('#btn-broadcast');
        const btnToggleFps = $('#btn-toggle-fps');
        const msgInput = $('#msg-input');
        const btnSetPresence = $('#btn-set-presence');
        const presenceInput = $('#presence-input');
        const btnInvalid = $('#btn-invalid');

        // --- État local ---
        const transport = this.transport;
        const sync = this.sync;
        let localCount = 0;
        let counterCtrl = null;
        let statusCtrl = null;

        // --- Helpers ---
        let dataToggle = false;
        const log = (text, isData = false) => {
            const el = document.createElement('div');
            el.textContent = `${new Date().toLocaleTimeString()} ${text}`;
            if (isData) {
                el.className = dataToggle ? 'data-b' : 'data-a';
                dataToggle = !dataToggle;
            }
            $('#log').appendChild(el);
            $('#log').scrollTop = $('#log').scrollHeight;
        };

        const setState = (label, cssClass) => {
            const el = $('#state');
            el.textContent = label;
            el.className = `state-${cssClass}`;
        };

        const setConnectedUI = (connected) => {
            btnDisconnect.disabled = !connected;
        };

        const setSessionUI = (active) => {
            btnInc.disabled = !active;
            btnDec.disabled = !active;
            btnSendMsg.disabled = !active;
            msgInput.disabled = !active;
        };

        const updateSessionsList = () => {
            const items = [];
            for (const [id, session] of this.sync.sessions) {
                items.push(`${id}:${session.state}`);
            }
            $('#sessions-list').textContent = items.length ? items.join(' · ') : '—';
        };

        // --- Handlers de session ---

        const makeCounterHandler = () => {
            return {
                onStart(ctrl) {
                    counterCtrl = ctrl;
                    // Centralisé : seul le guest envoie des actions
                    const canAct = ctrl.mode !== 'centralized' || !transport.isHost;
                    btnInc.disabled = !canAct;
                    btnDec.disabled = !canAct;
                    // Broadcast et toggle fps : hôte uniquement
                    btnBroadcast.disabled = !transport.isHost;
                    btnToggleFps.disabled = !transport.isHost;
                    log(`[counter] onStart (mode=${ctrl.mode}, fps=${ctrl.fps})`);
                },
                onEnd() {
                    counterCtrl = null;
                    setSessionUI(false);
                    btnBroadcast.disabled = true;
                    btnToggleFps.disabled = true;
                    log('[counter] onEnd');
                },
                getLocalState() {
                    return { count: localCount };
                },
                applyRemoteState(state) {
                    if (state?.count !== undefined) {
                        localCount = state.count;
                        $('#counter-value').textContent = localCount;
                    }
                    log(`[counter] ← remoteState count=${state?.count}`, true);
                },
                processAction(action) {
                    if (action?.op === 'increment') localCount++;
                    if (action?.op === 'decrement') localCount--;
                    $('#counter-value').textContent = localCount;
                    log(`[counter] processAction: ${action?.op} → ${localCount}`, true);
                }
            };
        };

        const makeStatusHandler = () => {
            return {
                onStart(ctrl) {
                    statusCtrl = ctrl;
                    btnSendMsg.disabled = false;
                    msgInput.disabled = false;
                    log(`[status] onStart (mode=${ctrl.mode}, fps=${ctrl.fps})`);
                },
                onEnd() {
                    statusCtrl = null;
                    log('[status] onEnd');
                },
                onMessage(payload) {
                    const el = document.createElement('div');
                    el.textContent = `${payload.from ?? '?'}: ${payload.text}`;
                    $('#messages').appendChild(el);
                    $('#messages').scrollTop = $('#messages').scrollHeight;
                    log(`[status] ← message: ${payload.text}`, true);
                }
            };
        };

        // --- Sessions : hôte crée, guest écoute ---

        this.sync.onSessionCreate = (id, config) => {
            log(`[session] onSessionCreate: ${id} (${config.mode}, fps=${config.fps})`);
            if (id === 'counter') return makeCounterHandler();
            if (id === 'status') return makeStatusHandler();
            return null;
        };

        this.sync.onSessionStateChange = (id, state) => {
            log(`[session] ${id} → ${state}`);
            updateSessionsList();
        };

        this.transport.onConnected = (isHost) => {
            $('#role').textContent = isHost ? 'hôte' : 'invité';
            const badge = $('#role-badge');
            badge.textContent = isHost ? 'HÔTE' : 'INVITÉ';
            badge.className = `role-badge ${isHost ? 'host' : 'guest'}`;
            setState('connected', 'connected');
            setConnectedUI(true);
            log(`Connecté (${isHost ? 'hôte' : 'invité'})`);

            // Hôte crée les sessions (P2PSync est déjà CONNECTED à ce stade)
            if (isHost) {
                this.sync.createSession('counter', { mode: 'centralized', fps: 0 }, makeCounterHandler());
                this.sync.createSession('status', { mode: 'independent', fps: 0 }, makeStatusHandler());
            }
        };

        // --- Transport callbacks ---

        this.transport.onIdReady = (id) => {
            this.peerId = id;
            $('#my-id').textContent = id;
            btnConnect.disabled = false;
            log(`ID prêt : ${id}`);
            this.dispatchEvent(new CustomEvent('id-ready', { detail: { id } }));
        };

        this.transport.onError = (err) => log(`[erreur] ${err.message}`);

        this.transport.onDisconnected = () => {
            setState('disconnected', 'disconnected');
            setConnectedUI(false);
            setSessionUI(false);
            log('Déconnecté');
            updateSessionsList();
        };

        // --- Auth ---
        this.transport.onData = async (data) => {
            if (data.type === 'auth') {
                const authMsg = await createAuthMessage(PASSWORD, this.transport.myPseudo);
                if (verifyHash(authMsg.hash, data.hash)) {
                    this.transport.authSuccess();
                    log('Auth OK');
                } else {
                    this.transport.authFailed();
                    log('Auth ÉCHEC');
                }
                return;
            }
            // Les messages _ctrl et _s sont routés par P2PSync via addDataListener
            // Ici on logge seulement les messages non gérés
            if (!data._ctrl && !data._s) {
                log(`← ${data.type} ${JSON.stringify(data.state ?? data.action ?? data.payload ?? '')}`);
            }
        };

        this.transport.onPing = () => {};

        this.transport.onAuthRequired = async () => {
            log('Auth…');
            const authMsg = await createAuthMessage(PASSWORD, this.transport.myPseudo);
            this.transport.send(authMsg);
        };

        // --- SM transitions couche 2 ---
        this.transport.onStateChange((state, tid, from, event) => {
            log(`L2: ${from} → ${state} [${event}] (${tid})`);
            const group = state === 'CONNECTED' ? 'connected' : state === 'IDLE' ? 'idle' : 'connecting';
            setState(`${state}`, group);
        });

        // --- SM P2PSync ---
        this.sync.onStateChange = (state, detail) => {
            log(`Sync: ${detail.from} → ${state} [${detail.event}] (L2: ${detail.layer2Tid ?? '—'} ${detail.layer2Event ?? ''})`);
            const syncEl = $('#sync-state');
            syncEl.textContent = state;
            const cssGroup = state === 'CONNECTED' ? 'connected'
                           : state === 'IDLE' ? 'idle'
                           : state === 'DISCONNECTED' ? 'disconnected'
                           : 'connecting';
            syncEl.className = `state-${cssGroup}`;
            // Contrôles de présence et sécurité
            if (state === 'CONNECTED') {
                btnSetPresence.disabled = false;
                presenceInput.disabled = false;
                btnInvalid.disabled = false;
                $('#presence-status').textContent = 'active (0.5fps)';
            } else {
                btnSetPresence.disabled = true;
                presenceInput.disabled = true;
                btnInvalid.disabled = true;
                $('#presence-status').textContent = '—';
                $('#remote-presence').textContent = '—';
            }
        };

        // --- Guard ---
        this.sync.onGuardChange = (state, detail) => {
            log(`Guard: ${detail.from} → ${state} [${detail.event}]`);
            const guardEl = $('#guard-state');
            guardEl.textContent = state;
            guardEl.className = `guard-${state.toLowerCase()}`;
        };
        this.sync.onPeerAbsent = () => log('⚠ Pair absent (guard OPEN)');
        this.sync.onPeerBack = () => log('✓ Pair de retour (guard HALF_OPEN)');

        // --- Présence ---
        this.sync.onPresence = (presence) => {
            $('#remote-presence').textContent = JSON.stringify(presence);
            log(`[_presence] ← ${JSON.stringify(presence)}`, true);
        };

        this.sync.onPresenceSuspensionChange = (suspended) => {
            $('#presence-status').textContent = suspended ? 'suspendue' : 'active (0.5fps)';
            log(`[_presence] ${suspended ? 'suspendue' : 'reprise'}`);
        };

        this.sync.onPing = (latency) => {
            log(`Ping: ${latency}ms`);
        };

        this.sync.onHandlerError = (sessionId, method, error) => {
            log(`⚠ Handler erreur: ${sessionId}.${method} — ${error.message}`);
        };

        // --- Boutons ---

        btnInit.addEventListener('click', () => {
            const pseudo = $('#pseudo').value.trim();
            if (!pseudo) return;
            this.transport.init(pseudo, APP_ID);
            btnInit.disabled = true;
            log(`Init : ${pseudo}`);
        });

        btnConnect.addEventListener('click', () => {
            if (this.remotePeerId) {
                this.transport.connect(this.remotePeerId);
                log(`Connexion à ${this.remotePeerId}`);
            }
        });

        btnDisconnect.addEventListener('click', () => {
            this.transport.disconnect();
        });

        btnInc.addEventListener('click', () => {
            if (counterCtrl) {
                counterCtrl.sendAction({ op: 'increment' });
                $('#counter-value').textContent = localCount;
            }
        });

        btnDec.addEventListener('click', () => {
            if (counterCtrl) {
                counterCtrl.sendAction({ op: 'decrement' });
                $('#counter-value').textContent = localCount;
            }
        });

        btnBroadcast.addEventListener('click', () => {
            if (counterCtrl) {
                counterCtrl.broadcastState();
                log('[counter] broadcastState envoyé');
            }
        });

        btnToggleFps.addEventListener('click', () => {
            if (counterCtrl) {
                const newFps = counterCtrl.fps === 0 ? 5 : 0;
                counterCtrl.setFps(newFps);
                $('#counter-fps').textContent = `fps=${newFps}`;
                btnToggleFps.textContent = newFps === 0 ? 'fps 0→5' : 'fps 5→0';
                log(`[counter] setFps(${newFps})`);
            }
        });

        btnSendMsg.addEventListener('click', () => {
            const text = msgInput.value.trim();
            if (!text || !statusCtrl) return;
            const pseudo = $('#pseudo').value.trim();
            statusCtrl.sendMessage({ text, from: pseudo });
            // Afficher localement
            const el = document.createElement('div');
            el.textContent = `${pseudo}: ${text}`;
            $('#messages').appendChild(el);
            msgInput.value = '';
        });

        msgInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') btnSendMsg.click();
        });

        btnSetPresence.addEventListener('click', () => {
            const text = presenceInput.value.trim();
            if (!text) return;
            sync.setPresence({ status: text });
            log(`[_presence] setPresence: ${text}`);
        });

        presenceInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') btnSetPresence.click();
        });

        btnInvalid.addEventListener('click', () => {
            // 3 messages invalides pour tester la couche sécurité
            transport.send({ type: 'hackAttempt', data: 'evil' });
            log('[security] envoyé type inconnu: hackAttempt');
            transport.send({ type: '_ctrl', _ctrl: 'unknownCmd' });
            log('[security] envoyé _ctrl inconnu: unknownCmd');
            transport.send({ type: 'fullState' });
            log('[security] envoyé fullState sans state');
        });
    }
}

customElements.define('peer-instance', PeerInstance);
