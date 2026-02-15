import { NetworkManager } from '../../src/core/network.js';
import { createAuthMessage, verifyHash } from '../../src/core/auth.js';

export class Chat {
  #peerId;
  #appId;
  #network;
  #password;

  constructor(peerId, appId, password, { debug = false, networkOptions = {} } = {}) {
    this.#peerId = peerId;
    this.#appId = appId;
    this.#password = password;

    this.#network = new NetworkManager({ debug, ...networkOptions });

    // Callbacks pour l'UI
    this.onStateChange = null;
    this.onMessage = null;
    this.onError = null;

    // Chaîner onTransition : NetworkManager d'abord, puis notre callback
    const internal = this.#network.sm.onTransition;
    this.#network.sm.onTransition = (from, to, event) => {
      internal?.(from, to, event);
      this.onStateChange?.(from, to, event);
    };

    this.#wireCallbacks();
  }

  start() {
    if (!this.onStateChange) console.warn('[Chat] onStateChange non défini avant start()');
    if (!this.onMessage) console.warn('[Chat] onMessage non défini avant start()');
    if (!this.onError) console.warn('[Chat] onError non défini avant start()');

    this.#network.init(this.#peerId, this.#appId);
  }

  connectTo(remotePeerId) {
    this.#network.connectTo(`${this.#appId}-${remotePeerId}`);
  }

  send(data) {
    this.#network.send(data);
  }

  disconnect() {
    this.#network.disconnect();
  }

  get peerId() {
    return this.#peerId;
  }

  get state() {
    return this.#network.sm.current;
  }

  get isHost() {
    return this.#network.isHost;
  }

  get cbState() {
    for (const cb of this.#network.circuitBreakers.values()) {
      return cb.sm.current;
    }
    // Pas de CB (invité) = pas d'échecs enregistrés = équivalent CLOSED
    return 'CLOSED';
  }

  // --- Privé ---

  #wireCallbacks() {
    const net = this.#network;

    net.onAuthRequired = async () => {
      const authMsg = await createAuthMessage(this.#password, this.#peerId);
      net.send(authMsg);
    };

    net.onData = (data) => {
      if (data.type === 'auth') {
        this.#handleAuth(data);
      } else {
        this.onMessage?.(data);
      }
    };

    net.onError = (err) => this.onError?.(err);
  }

  async #handleAuth(data) {
    const authMsg = await createAuthMessage(this.#password, this.#peerId);
    if (verifyHash(authMsg.hash, data.hash)) {
      this.#network.authSuccess();
    } else {
      this.#network.authFailed();
    }
  }
}
