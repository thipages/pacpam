/**
 * P2PSync — façade de synchronisation P2P.
 *
 * - SM propre (IDLE / CONNECTING / CONNECTED / DISCONNECTED)
 * - Guard présence (HALF_OPEN / CLOSED / OPEN) actif en CONNECTED
 * - Sessions multiplexées avec protocole _ctrl
 *
 * Usage :
 *   const sync = new P2PSync(transport);
 *   sync.onStateChange = (state, detail) => { … };
 *   sync.createSession('counter', { mode: 'centralized', fps: 0 }, handler);
 */

import { StateRunner } from '../core/state-runner.js';
import { p2pSyncStates, p2pSyncInitial } from './p2p-sync-states.js';
import { guardStates, guardInitial } from './guard-states.js';
import { Session, SessionCtrl } from './session.js';

const DEFAULT_GUARD_TIMEOUT = 5000;

export class P2PSync {
  #guard = null;
  #guardTimer = null;
  #guardTimeoutMs;
  #pendingSessions = [];  // sessions à (re)créer quand CONNECTED

  constructor(transport, options = {}) {
    this.transport = transport;
    this.sm = new StateRunner(p2pSyncStates, p2pSyncInitial);
    this.#guardTimeoutMs = options.guardTimeout ?? DEFAULT_GUARD_TIMEOUT;

    // Registre de sessions
    this.sessions = new Map(); // id → Session

    // Callbacks publics
    this.onStateChange = null;
    this.onGuardChange = null;
    this.onPeerAbsent = null;
    this.onPeerBack = null;
    this.onSessionCreate = null;  // guest : (id, config) => handler
    this.onSessionStateChange = null; // (sessionId, state) => void

    // Câbler la SM P2PSync
    this.sm.onTransition = (from, to, event) => {
      this.onStateChange?.(to, { from, to, event, layer2State: transport.state });
      if (to === 'CONNECTED') {
        this.#startGuard();
        this.#onSyncConnected();
      }
      if (from === 'CONNECTED' && to !== 'CONNECTED') {
        this.#stopGuard();
        this.#onSyncDisconnected();
      }
    };

    // Projection couche 2 → P2PSync
    this.#previousLayer2 = null;
    transport.onStateChange((state, tid, fromL2, eventL2) => {
      this.#mapTransportState(state, fromL2);
      this.#previousLayer2 = state;
    });

    // Routage des données entrantes
    transport.addDataListener((data) => {
      this.feedGuard();
      this.#routeMessage(data);
    });

    // Ping/pong → guard
    transport.addPingListener(() => this.feedGuard());
  }

  // --- Sessions ---

  /**
   * Crée une session (côté hôte).
   * @param {string} id - identifiant unique de la session
   * @param {{ mode: string, fps: number }} config
   * @param {Object} handler - duck typing : onStart, onEnd, getLocalState, applyRemoteState, processAction, onMessage
   */
  createSession(id, config, handler) {
    const session = new Session(id, config.mode, config.fps ?? 0, handler);
    this.sessions.set(id, session);

    // Si déjà connecté, démarrer immédiatement
    if (this.sm.is('CONNECTED')) {
      this.#initiateSession(session);
    } else {
      // Stocker pour création à la connexion
      this.#pendingSessions.push({ id, config, handler });
    }
  }

  /** Retourne le SessionCtrl d'une session */
  getSession(id) {
    return this.sessions.get(id)?.ctrl ?? null;
  }

  /** Termine une session (côté hôte) */
  endSession(id) {
    const session = this.sessions.get(id);
    if (!session) return;
    this.#sendCtrl({ _ctrl: 'sessionEnd', id });
    this.#destroySession(session);
  }

  #initiateSession(session) {
    session.sm.onTransition = (from, to) => {
      this.onSessionStateChange?.(session.id, to);
    };
    session.sm.send('CREATE');
    this.#sendCtrl({ _ctrl: 'sessionCreate', id: session.id, mode: session.mode, fps: session.fps });
  }

  #activateSession(session) {
    const ctrl = new SessionCtrl(
      session,
      (data) => this.transport.send(data),
      this.isHost,
      (s, fps) => this.#onSessionFpsChange(s, fps)
    );
    session.ctrl = ctrl;
    session.sm.send('READY');
    session.handler?.onStart?.(ctrl);
  }

  #destroySession(session) {
    this.#stopSessionSync(session);
    session.sm.send('END');
    session.handler?.onEnd?.();
    this.sessions.delete(session.id);
  }

  #onSyncConnected() {
    // Côté hôte : (re)créer les sessions enregistrées
    if (this.isHost) {
      for (const { id, config, handler } of this.#pendingSessions) {
        if (!this.sessions.has(id)) {
          const session = new Session(id, config.mode, config.fps ?? 0, handler);
          this.sessions.set(id, session);
        }
        this.#initiateSession(this.sessions.get(id));
      }
    }
  }

  #onSyncDisconnected() {
    // Toutes les sessions passent en DISCONNECTED
    for (const session of this.sessions.values()) {
      this.#stopSessionSync(session);
      if (session.state !== 'DISCONNECTED') {
        session.sm.send('END');
        session.handler?.onEnd?.();
      }
    }
    // Conserver les sessions pour reconnexion (hôte les recréera)
    if (this.isHost) {
      // Réinitialiser les SM pour permettre la recréation
      for (const session of this.sessions.values()) {
        session.sm = new StateRunner(session.sm.states, 'IDLE');
      }
    } else {
      this.sessions.clear();
    }
  }

  // --- Boucle sync par session (phase 5, préparé ici) ---

  #startSessionSync(session) {
    if (session.fps <= 0 || session.syncInterval) return;
    const interval = 1000 / session.fps;
    session.syncInterval = setInterval(() => {
      if (session.state !== 'CONNECTED') return;
      const handler = session.handler;
      if (!handler?.getLocalState) return;
      const state = handler.getLocalState();
      if (session.mode === 'centralized' && this.isHost) {
        this.transport.send({ _s: session.id, type: 'fullState', state });
      } else {
        this.transport.send({ _s: session.id, type: 'localState', state });
      }
    }, interval);
  }

  #stopSessionSync(session) {
    if (session.syncInterval) {
      clearInterval(session.syncInterval);
      session.syncInterval = null;
    }
  }

  #onSessionFpsChange(session, fps) {
    this.#sendCtrl({ _ctrl: 'sessionSetFps', id: session.id, fps });
    this.#stopSessionSync(session);
    if (fps > 0) this.#startSessionSync(session);
  }

  // --- Routage des messages ---

  #routeMessage(data) {
    // Messages de contrôle
    if (data._ctrl) {
      this.#handleCtrl(data);
      return;
    }
    // Messages de session
    if (data._s) {
      this.#handleSessionMessage(data);
      return;
    }
    // Messages sans session (legacy / brut) — ignorés en phase 4+
  }

  #sendCtrl(data) {
    const msg = { ...data, type: '_ctrl' };
    const sent = this.transport.send(msg);
    if (!sent) console.warn('[P2PSync] _ctrl non envoyé:', data._ctrl, data.id ?? '');
  }

  #handleCtrl(data) {
    switch (data._ctrl) {
      case 'sessionCreate': {
        // Côté guest : le hôte crée une session
        const handler = this.onSessionCreate?.(data.id, { mode: data.mode, fps: data.fps });
        if (!handler) {
          console.warn(`[P2PSync] Pas de handler pour session ${data.id}`);
          return;
        }
        const session = new Session(data.id, data.mode, data.fps, handler);
        this.sessions.set(data.id, session);
        session.sm.onTransition = (from, to) => {
          this.onSessionStateChange?.(session.id, to);
        };
        session.sm.send('CREATE');
        // Répondre immédiatement
        this.#sendCtrl({ _ctrl: 'sessionReady', id: data.id });
        this.#activateSession(session);
        if (session.fps > 0) this.#startSessionSync(session);
        break;
      }
      case 'sessionReady': {
        // Côté hôte : le guest confirme
        const session = this.sessions.get(data.id);
        if (!session) return;
        this.#activateSession(session);
        if (session.fps > 0) this.#startSessionSync(session);
        break;
      }
      case 'sessionSetFps': {
        const session = this.sessions.get(data.id);
        if (!session) return;
        session.fps = data.fps;
        this.#stopSessionSync(session);
        if (data.fps > 0) this.#startSessionSync(session);
        break;
      }
      case 'sessionEnd': {
        const session = this.sessions.get(data.id);
        if (!session) return;
        this.#destroySession(session);
        break;
      }
    }
  }

  #handleSessionMessage(data) {
    const session = this.sessions.get(data._s);
    if (!session || session.state !== 'CONNECTED') return;

    const handler = session.handler;
    if (!handler) return;

    switch (data.type) {
      case 'action':
        if (session.mode === 'centralized' && this.isHost) {
          handler.processAction?.(data.action);
          // Auto-broadcast après processAction
          if (handler.getLocalState) {
            const state = handler.getLocalState();
            this.transport.send({ _s: session.id, type: 'fullState', state });
          }
        }
        break;
      case 'fullState':
        handler.applyRemoteState?.(data.state);
        break;
      case 'localState':
        handler.applyRemoteState?.(data.state);
        break;
      case 'message':
        handler.onMessage?.(data.payload);
        break;
    }
  }

  // --- Guard présence ---

  #startGuard() {
    this.#guard = new StateRunner(guardStates, guardInitial);
    this.#guard.onTransition = (from, to, event) => {
      this.onGuardChange?.(to, { from, to, event });
      if (to === 'OPEN') this.onPeerAbsent?.();
      if (from === 'OPEN' && to === 'HALF_OPEN') this.onPeerBack?.();
    };
    this.#resetGuardTimer();
  }

  #stopGuard() {
    this.#clearGuardTimer();
    this.#guard = null;
  }

  #resetGuardTimer() {
    this.#clearGuardTimer();
    this.#guardTimer = setTimeout(() => {
      this.#guard?.send('TIMEOUT');
    }, this.#guardTimeoutMs);
  }

  #clearGuardTimer() {
    if (this.#guardTimer) {
      clearTimeout(this.#guardTimer);
      this.#guardTimer = null;
    }
  }

  feedGuard() {
    if (!this.#guard) return;
    this.#guard.send('DATA_RECEIVED');
    this.#resetGuardTimer();
  }

  get guardState() { return this.#guard?.current ?? null; }

  // --- Projection couche 2 → P2PSync ---

  #previousLayer2 = null;

  #mapTransportState(toL2, fromL2) {
    const syncState = this.sm.current;

    if (toL2 === 'CONNECTED' && syncState === 'CONNECTING') {
      this.sm.send('TRANSPORT_CONNECTED');
      return;
    }

    if (fromL2 === 'CONNECTED' && toL2 !== 'CONNECTED' && syncState === 'CONNECTED') {
      this.sm.send('TRANSPORT_LOST');
      if (toL2 === 'IDLE') this.sm.send('RESET');
      return;
    }

    if (fromL2 === 'IDLE' && toL2 !== 'IDLE' && syncState === 'IDLE') {
      this.sm.send('CONNECT');
      return;
    }

    if (toL2 === 'IDLE') {
      if (syncState === 'CONNECTING') this.sm.send('TRANSPORT_FAILED');
      else if (syncState === 'DISCONNECTED') this.sm.send('RESET');
      return;
    }
  }

  get isHost()      { return this.transport.isHost; }
  get state()       { return this.sm.current; }
  get isConnected() { return this.sm.is('CONNECTED'); }
}
