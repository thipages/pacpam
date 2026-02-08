/**
 * Gestion de la connexion P2P avec PeerJS
 * Inclut validation des messages et gestion robuste des erreurs
 * Utilise StateRunner + connectionStates comme source de vérité
 */

import { validateMessage, sanitizeString, sanitizeGameState } from '../security/message-validator.js';
import { rateLimiter } from '../security/rate-limiter.js';
import { P2PCircuitBreaker } from '../security/circuit-breaker.js';
import { StateRunner } from './state-runner.js';
import { connectionStates, initial } from './connection-states.js';
import { t } from './locale.js';

const PEER_ERROR_EVENTS = {
  'unavailable-id':  'ID_UNAVAILABLE',
  'peer-unavailable': 'PEER_UNAVAILABLE',
  'network':          'NETWORK_ERROR',
  'disconnected':     'SIGNALING_LOST'
};

export class NetworkManager {
  #activeCircuitBreaker = null;

  constructor(options = {}) {
    this.debug = options.debug || false;
    this.peer = null;
    this.connection = null;
    this.myId = null;
    this.isHost = false;
    this.connectionTimeout = null;
    this.pingInterval = null;
    this.lastPong = 0;

    // Circuit breakers par peer
    this.circuitBreakers = new Map();

    // Callbacks
    this.onConnected = null;
    this.onDisconnected = null;
    this.onAuthRequired = null;
    this.onData = null;
    this.onError = null;
    this.onIdReady = null;
    this.onPing = null;
    this.onAuthFailed = null;

    // Auth timeout
    this.authTimeout = null;

    // State machine — clone partiel pour self-loop actions
    const states = {
      ...connectionStates,
      CONNECTED: {
        on: {
          ...connectionStates.CONNECTED.on,
          SIGNALING_LOST: {
            ...connectionStates.CONNECTED.on.SIGNALING_LOST,
            action: () => {
              // Tenter de reconnecter au serveur PeerJS
              if (this.peer && !this.peer.destroyed) {
                setTimeout(() => {
                  if (this.peer && !this.peer.destroyed) {
                    this.peer.reconnect();
                  }
                }, 3000);
              }
            }
          }
        }
      }
    };
    this.sm = new StateRunner(states, initial);
    this.#registerActions();
    this.sm.onTransition = (from, to, event) => {
      this.#log(`${from} --[${event}]--> ${to}`);

      if (from === 'CONNECTED' && to !== 'CONNECTED') {
        this.onDisconnected?.();
      }
      if (from === 'AUTHENTICATING' && to !== 'CONNECTED') {
        if (event === 'AUTH_FAILED') {
          this.onAuthFailed?.(this.connection?.peer);
        }
        if (this.connection) {
          try { this.connection.close(); } catch (e) {}
          this.connection = null;
        }
      }
    };

    // Câblage inter-machines : connection SM ↔ circuit breaker
    this.sm.checkGuard = ({ sm, not }) => {
      if (sm === 'cb') {
        const cb = this.#activeCircuitBreaker;
        if (!cb) return true;
        // Timer expiré → transition OPEN → HALF_OPEN avant évaluation
        if (cb.sm.is('OPEN') && Date.now() >= cb.nextAttemptTime) {
          cb.sm.send('RESET_TIMEOUT');
        }
        if (not) return !cb.sm.is(not);
      }
      return true;
    };

    this.sm.onEmit = ({ sm, event }) => {
      if (sm === 'cb' && this.#activeCircuitBreaker) {
        if (event === 'SUCCESS') this.#activeCircuitBreaker.onSuccess();
        else if (event === 'FAILURE') this.#activeCircuitBreaker.onFailure(new Error('Connection failed'));
      }
    };
  }

  #registerActions() {
    this.sm.register('IDLE', {
      entry: () => { this.#cleanupPeer(); }
    });
    this.sm.register('AUTHENTICATING', {
      entry: () => {
        this.clearTimeouts();
        this.authTimeout = setTimeout(() => {
          this.sm.send('AUTH_TIMEOUT');
        }, 5000);
        this.onAuthRequired?.(this.isHost);
      },
      exit: () => {
        if (this.authTimeout) {
          clearTimeout(this.authTimeout);
          this.authTimeout = null;
        }
      }
    });
    this.sm.register('CONNECTED', {
      entry: () => {
        this.clearTimeouts();
        this.startPing();
        this.onConnected?.(this.isHost);
      },
      exit: () => {
        this.stopPing();
        if (this.connection?.peer) rateLimiter.resetPeer(this.connection.peer);
      }
    });
  }

  #log(...args) { this.debug && console.log('[Network]', ...args); }

  /**
   * Initialiser PeerJS avec un pseudo et un identifiant d'application
   * @param {string} pseudo - Le pseudo du joueur
   * @param {string} appId - Préfixe applicatif pour éviter les collisions PeerJS
   */
  init(pseudo, appId) {
    if (!this.sm.is('IDLE')) return;

    // Validation du pseudo : A-Z, 0-9, _, -, min 3, max 10
    const PSEUDO_RE = /^[A-Z0-9_-]{3,10}$/i;
    if (!pseudo || !PSEUDO_RE.test(pseudo)) {
      this.onError?.(new Error('Pseudo invalide (3-10 caractères : lettres, chiffres, - _)'));
      return;
    }

    this.sm.send('INIT');

    this.myId = `${appId}-${pseudo}`;
    this.myPseudo = pseudo;

    try {
      this.peer = new Peer(this.myId, { debug: 1 });
    } catch (e) {
      console.error('[Network] Erreur création Peer:', e);
      this.sm.send('NETWORK_ERROR');
      this.onError?.(new Error('Impossible de créer la connexion P2P'));
      return;
    }

    this.peer.on('open', (id) => {
      this.#log('PeerJS connecté avec ID:', id);
      this.sm.send('PEER_OPEN');
      this.onIdReady?.(id);
    });

    this.peer.on('connection', (conn) => {
      this.#log('Connexion entrante de:', conn.peer);

      // Refuser si déjà connecté
      if (this.connection && this.connection.open) {
        this.#log('Connexion refusée: déjà connecté');
        conn.close();
        return;
      }

      this.connection = conn;
      this.isHost = false;
      this.setupConnection();
    });

    this.peer.on('error', (err) => {
      console.warn('[Network] Erreur PeerJS:', err.type);

      const event = PEER_ERROR_EVENTS[err.type];
      if (event) {
        this.sm.send(event);
      }

      const errorKey = PEER_ERROR_EVENTS[err.type];
      const translated = errorKey ? t(`errors.${errorKey}`) : null;
      const message = (translated && translated !== `errors.${errorKey}`) ? translated : (err.message || err.type);
      this.onError?.(new Error(message));
    });

    this.peer.on('disconnected', () => {
      this.#log('Peer déconnecté du serveur de signaling');
      this.sm.send('SIGNALING_LOST');
    });
  }

  /**
   * Se connecter à un autre joueur avec circuit breaker
   */
  async connectTo(peerId) {
    if (!peerId || peerId.trim() === '') {
      this.onError?.(new Error('ID invalide'));
      return;
    }

    if (!this.sm.is('READY')) {
      this.onError?.(new Error('Non connecté au serveur'));
      return;
    }

    // Obtenir ou créer un circuit breaker pour ce peer
    if (!this.circuitBreakers.has(peerId)) {
      this.circuitBreakers.set(peerId, new P2PCircuitBreaker(peerId));
    }
    this.#activeCircuitBreaker = this.circuitBreakers.get(peerId);

    this.#log('Tentative de connexion à:', peerId);

    // Guard vérifie automatiquement le circuit breaker
    if (!this.sm.send('CONNECT_TO')) {
      const statusMessage = this.#activeCircuitBreaker.getStatusMessage();
      this.onError?.(new Error(statusMessage));
      return;
    }

    try {
      await new Promise((resolve, reject) => {
        this.connection = this.peer.connect(peerId, {
          reliable: true,
          serialization: 'json'
        });
        this.isHost = true;
        this.setupConnection();

        // Timeout de connexion
        this.connectionTimeout = setTimeout(() => {
          if (!this.connection?.open) {
            this.connection?.close();
            this.sm.send('TIMEOUT'); // → emit cb.FAILURE
            reject(new Error('Timeout: joueur introuvable'));
          }
        }, 10000);

        // Attendre l'ouverture de la connexion
        const originalOnOpen = this.connection.on.bind(this.connection);
        this.connection.on = function(event, handler) {
          if (event === 'open') {
            const wrappedHandler = function() {
              clearTimeout(this.connectionTimeout);
              resolve();
              handler.apply(this, arguments);
            }.bind(this);
            return originalOnOpen(event, wrappedHandler);
          }
          return originalOnOpen(event, handler);
        }.bind(this);

        // Gérer les erreurs de connexion
        this.connection.on('error', (err) => {
          clearTimeout(this.connectionTimeout);
          reject(err);
        });
      });
      // CONNECTION_OPEN dans setupConnection → emit cb.SUCCESS
    } catch (e) {
      console.warn('[Network] Erreur de connexion:', e.message);

      // Si encore en CONNECTING, envoyer PEER_UNAVAILABLE → emit cb.FAILURE
      if (this.sm.is('CONNECTING')) {
        this.sm.send('PEER_UNAVAILABLE');
      }

      const statusMessage = this.#activeCircuitBreaker.getStatusMessage();
      this.onError?.(new Error(statusMessage));
    }
  }

  /**
   * Configurer les événements de connexion
   */
  setupConnection() {
    if (!this.connection) return;

    this.connection.on('open', () => {
      this.#log('Connexion établie');
      this.sm.send('CONNECTION_OPEN');
    });

    this.connection.on('data', (data) => {
      const peerId = this.connection.peer;

      if (!validateMessage(data)) {
        console.warn('[Security] Message invalide reçu:', data);
        return;
      }

      if (!rateLimiter.checkLimit(data.type, peerId)) {
        console.warn('[Security] Rate limit dépassé pour:', data.type, 'de', peerId);
        return;
      }

      if (data.state && typeof data.state === 'object') {
        data.state = sanitizeGameState(data.state);
      }

      if (data.type === 'ping') {
        this.send({ type: 'pong', timestamp: data.timestamp });
        return;
      }

      if (data.type === 'pong') {
        this.lastPong = Date.now();
        const latency = this.lastPong - data.timestamp;
        this.onPing?.(latency);
        return;
      }

      this.onData?.(data);
    });

    this.connection.on('close', () => {
      this.#log('Connexion fermée');
      this.sm.send('CLOSE');
    });

    this.connection.on('error', (err) => {
      console.warn('[Network] Erreur connexion:', err.message || err);
      this.sm.send('NETWORK_ERROR');
      this.onError?.(err);
    });
  }

  /**
   * Démarrer le ping pour mesurer la latence
   */
  startPing() {
    this.stopPing();
    this.lastPong = Date.now();

    this.pingInterval = setInterval(() => {
      if (Date.now() - this.lastPong > 10000) {
        console.warn('[Network] Connexion perdue (pas de pong)');
        this.sm.send('PING_TIMEOUT');
        return;
      }

      this.send({ type: 'ping', timestamp: Date.now() });
    }, 3000);
  }

  /**
   * Arrêter le ping
   */
  stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Nettoyer les timeouts
   */
  clearTimeouts() {
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
    this.stopPing();
  }

  /**
   * Nettoyage complet du peer et de la connexion
   */
  #cleanupPeer() {
    this.clearTimeouts();
    if (this.connection) {
      try { this.connection.close(); } catch (e) {}
      this.connection = null;
    }
    if (this.peer) {
      try { this.peer.destroy(); } catch (e) {}
      this.peer = null;
    }
  }

  /**
   * Envoyer des données
   */
  send(data) {
    if (!this.connection || !this.connection.open) {
      return false;
    }

    try {
      this.connection.send(data);
      return true;
    } catch (e) {
      console.warn('[Network] Erreur d\'envoi:', e.message || e);
      return false;
    }
  }

  authSuccess() { this.sm.send('AUTH_SUCCESS'); }
  authFailed() { this.sm.send('AUTH_FAILED'); }

  /**
   * Vérifier si connecté
   */
  isConnected() {
    return this.sm.is('CONNECTED');
  }

  /**
   * Fermer la connexion
   */
  disconnect() {
    this.sm.send('DISCONNECT');
  }
}
