/**
 * PeerTransport — adaptateur entre NetworkManager et P2PSync.
 *
 * Expose un contrat transport minimal pour découpler P2PSync
 * des détails de la couche 2 (PeerJS, callbacks NetworkManager).
 */

export class PeerTransport {
  #network;
  #dataListeners = [];
  #pingListeners = [];
  #stateChangeListeners = [];
  #origOnTransition = null;

  constructor(network) {
    this.#network = network;

    // Intercepter les transitions SM couche 2 pour exposer onStateChange
    this.#origOnTransition = network.sm.onTransition;
    network.sm.onTransition = (from, to, event) => {
      const tid = network.sm.states[from]?.on?.[event]?.id ?? '?';
      for (const cb of this.#stateChangeListeners) cb(to, tid, from, event);
      this.#origOnTransition?.(from, to, event);
    };
  }

  // --- Contrat transport ---

  init(pseudo, appId) { this.#network.init(pseudo, appId); }
  connect(peerId)     { this.#network.connectTo(peerId); }
  disconnect()        { this.#network.disconnect(); }

  send(data) { return this.#network.send(data); }

  set onData(cb) {
    // Remplace le listener applicatif (dernier ajouté par l'app)
    this.#dataListeners = this.#dataListeners.filter(l => !l._app);
    if (cb) { cb._app = true; this.#dataListeners.push(cb); }
    this.#syncNetworkOnData();
  }
  get onData() { return this.#dataListeners.find(l => l._app) ?? null; }

  /** Ajoute un listener interne (P2PSync, guard, etc.) */
  addDataListener(cb) {
    this.#dataListeners.push(cb);
    this.#syncNetworkOnData();
  }

  #syncNetworkOnData() {
    if (this.#dataListeners.length > 0) {
      this.#network.onData = (data) => {
        for (const cb of this.#dataListeners) cb(data);
      };
    } else {
      this.#network.onData = null;
    }
  }

  onStateChange(callback) { this.#stateChangeListeners.push(callback); }
  isConnected()           { return this.#network.isConnected(); }
  get isHost()            { return this.#network.isHost; }

  // --- Auth passthrough ---

  authSuccess() { this.#network.authSuccess(); }
  authFailed()  { this.#network.authFailed(); }

  set onAuthRequired(cb)  { this.#network.onAuthRequired = cb; }
  get onAuthRequired()    { return this.#network.onAuthRequired; }

  // --- Identité et callbacks passthrough ---

  set onIdReady(cb)       { this.#network.onIdReady = cb; }
  get onIdReady()         { return this.#network.onIdReady; }

  set onConnected(cb)     { this.#network.onConnected = cb; }
  get onConnected()       { return this.#network.onConnected; }

  set onDisconnected(cb)  { this.#network.onDisconnected = cb; }
  get onDisconnected()    { return this.#network.onDisconnected; }

  set onError(cb)         { this.#network.onError = cb; }
  get onError()           { return this.#network.onError; }

  set onPing(cb) {
    this.#pingListeners = this.#pingListeners.filter(l => !l._app);
    if (cb) { cb._app = true; this.#pingListeners.push(cb); }
    this.#syncNetworkOnPing();
  }
  get onPing() { return this.#pingListeners.find(l => l._app) ?? null; }

  addPingListener(cb) {
    this.#pingListeners.push(cb);
    this.#syncNetworkOnPing();
  }

  #syncNetworkOnPing() {
    if (this.#pingListeners.length > 0) {
      this.#network.onPing = (latency) => {
        for (const cb of this.#pingListeners) cb(latency);
      };
    } else {
      this.#network.onPing = null;
    }
  }

  get myId()              { return this.#network.myId; }
  get myPseudo()          { return this.#network.myPseudo; }

  /** État couche 2 courant */
  get state()             { return this.#network.sm.current; }

  /** PeerId du pair distant connecté (ou null) */
  get remotePeerId()      { return this.#network.connection?.peer ?? null; }

  /** Info circuit breaker d'un pair : { state, nextAttemptTime } ou null */
  circuitBreakerInfo(peerId = this.remotePeerId) {
    if (!peerId) return null;
    const cb = this.#network.circuitBreakers.get(peerId);
    if (!cb) return null;
    return { state: cb.sm.current, nextAttemptTime: cb.nextAttemptTime };
  }
}
