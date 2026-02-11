/**
 * Session — cycle de vie d'une session multiplexée.
 * SessionCtrl — contrôleur exposé aux handlers et à l'application.
 */

import { StateRunner } from '../core/state-runner.js';

// --- SM Session ---

const sessionStates = {
  IDLE: {
    on: { CREATE: { id: 's1', target: 'CONNECTING' } }
  },
  CONNECTING: {
    on: {
      READY: { id: 's2', target: 'CONNECTED' },
      END:   { id: 's4', target: 'DISCONNECTED' }
    }
  },
  CONNECTED: {
    on: { END: { id: 's3', target: 'DISCONNECTED' } }
  },
  DISCONNECTED: {}
};

export class Session {
  constructor(id, mode, fps, handler) {
    this.id = id;
    this.mode = mode;       // 'centralized' | 'independent'
    this.fps = fps;
    this.handler = handler;
    this.ctrl = null;       // SessionCtrl, assigné après création
    this.sm = new StateRunner(sessionStates, 'IDLE');
    this.syncInterval = null;
  }

  get state() { return this.sm.current; }
}

export class SessionCtrl {
  #session;
  #sendFn;
  #isHost;
  #onFpsChange;

  /**
   * @param {Session} session
   * @param {Function} sendFn - (data) => void — envoie un message via P2PSync
   * @param {boolean} isHost
   * @param {Function} onFpsChange - (session, newFps) => void — notifie P2PSync du changement
   */
  constructor(session, sendFn, isHost, onFpsChange) {
    this.#session = session;
    this.#sendFn = sendFn;
    this.#isHost = isHost;
    this.#onFpsChange = onFpsChange;
  }

  get id()    { return this.#session.id; }
  get mode()  { return this.#session.mode; }
  get fps()   { return this.#session.fps; }
  get state() { return this.#session.state; }

  /** Changer le fps (hôte uniquement) */
  setFps(n) {
    if (!this.#isHost) {
      console.warn(`[Session:${this.id}] setFps refusé : guest`);
      return;
    }
    this.#session.fps = n;
    this.#onFpsChange(this.#session, n);
  }

  /** Diffuser l'état courant (centralisé: hôte envoie fullState, indépendant: les deux envoient localState) */
  broadcastState() {
    const handler = this.#session.handler;
    if (!handler?.getLocalState) return;
    const state = handler.getLocalState();
    if (this.#session.mode === 'centralized' && this.#isHost) {
      this.#sendFn({ _s: this.id, type: 'fullState', state });
    } else if (this.#session.mode === 'independent') {
      this.#sendFn({ _s: this.id, type: 'localState', state });
    }
  }

  /** Envoyer une action à l'hôte (centralisé, guest uniquement) */
  sendAction(action) {
    if (this.#session.mode !== 'centralized') {
      console.warn(`[Session:${this.id}] sendAction refusé : mode ${this.#session.mode}`);
      return;
    }
    if (this.#isHost) {
      console.warn(`[Session:${this.id}] sendAction refusé : hôte`);
      return;
    }
    // Prédiction locale
    this.#session.handler?.processAction?.(action);
    this.#sendFn({ _s: this.id, type: 'action', action });
  }

  /** Envoyer un message (indépendant uniquement) */
  sendMessage(payload) {
    if (this.#session.mode !== 'independent') {
      console.warn(`[Session:${this.id}] sendMessage refusé : mode ${this.#session.mode}`);
      return;
    }
    this.#sendFn({ _s: this.id, type: 'message', payload });
  }
}
