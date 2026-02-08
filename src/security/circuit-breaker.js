/**
 * Circuit Breaker pour gérer les connexions défaillantes
 * Protège contre les tentatives répétées sur des services indisponibles
 */

import { StateRunner } from '../core/state-runner.js';
import { circuitBreakerStates, initial } from './circuit-breaker-states.js';
import { t } from '../core/locale.js';

export class CircuitBreaker {
  constructor(options = {}) {
    // Configuration
    this.maxFailures = options.maxFailures || 3;
    this.resetTimeout = options.resetTimeout || 30000; // 30 secondes
    this.halfOpenAttempts = options.halfOpenAttempts || 1;
    this.monitoringWindow = options.monitoringWindow || 60000; // 1 minute
    this.debug = options.debug || false;

    // État
    this.failures = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.nextAttemptTime = null;
    this.halfOpenTests = 0;

    // Statistiques
    this.stats = {
      totalCalls: 0,
      totalFailures: 0,
      totalSuccesses: 0,
      consecutiveFailures: 0,
      lastStateChange: Date.now(),
      stateChanges: []
    };

    // Historique pour le monitoring
    this.callHistory = [];

    // State machine (remplace this.state + this.transition)
    // Clone partiel : ajoute les actions sur les self-loops
    const states = {
      ...circuitBreakerStates,
      CLOSED: {
        on: {
          ...circuitBreakerStates.CLOSED.on,
          SUCCESS: { ...circuitBreakerStates.CLOSED.on.SUCCESS, action: () => { this.failures = 0; } }
        }
      }
    };
    this.sm = new StateRunner(states, initial);
    this.#registerActions();
    this.sm.onTransition = (from, to, event) => {
      this.#log(`${from} --[${event}]--> ${to}`);
      this.stats.lastStateChange = Date.now();
      this.stats.stateChanges.push({ from, to, timestamp: Date.now() });
      if (this.stats.stateChanges.length > 10) this.stats.stateChanges.shift();
    };
  }

  #registerActions() {
    this.sm.register('OPEN', {
      entry: () => {
        this.nextAttemptTime = Date.now() + this.resetTimeout;
        this.halfOpenTests = 0;
      }
    });
    this.sm.register('HALF_OPEN', {
      entry: () => { this.halfOpenTests = 0; }
    });
    this.sm.register('CLOSED', {
      entry: () => {
        this.failures = 0;
        this.nextAttemptTime = null;
      }
    });
  }

  #log(...args) { this.debug && console.log('[CircuitBreaker]', ...args); }

  /**
   * Exécute une fonction à travers le circuit breaker
   */
  async execute(fn, fallback = null) {
    this.stats.totalCalls++;

    // Vérifier l'état du circuit
    if (this.sm.is('OPEN')) {
      if (Date.now() < this.nextAttemptTime) {
        // Circuit ouvert, rejeter immédiatement
        const error = new Error('Circuit breaker is OPEN');
        error.code = 'CIRCUIT_OPEN';
        error.nextAttempt = this.nextAttemptTime;

        if (fallback) {
          console.warn('[CircuitBreaker] Circuit ouvert, utilisation du fallback');
          return fallback(error);
        }

        throw error;
      } else {
        // Temps écoulé, passer en HALF_OPEN pour tester
        this.sm.send('RESET_TIMEOUT');
      }
    }

    try {
      // Exécuter la fonction
      const result = await fn();

      // Succès
      this.onSuccess();
      return result;

    } catch (error) {
      // Échec
      this.onFailure(error);

      if (fallback) {
        console.warn('[CircuitBreaker] Échec, utilisation du fallback');
        return fallback(error);
      }

      throw error;
    }
  }

  /**
   * Gère un succès
   */
  onSuccess() {
    this.stats.totalSuccesses++;
    this.stats.consecutiveFailures = 0;
    this.successCount++;

    // Ajouter à l'historique
    this.addToHistory(true);

    // HALF_OPEN → CLOSED : entry action remet failures à 0
    // CLOSED → CLOSED : self-loop action remet failures à 0
    this.sm.send('SUCCESS');
  }

  /**
   * Gère un échec
   */
  onFailure(error) {
    this.stats.totalFailures++;
    this.stats.consecutiveFailures++;
    this.failures++;
    this.lastFailureTime = Date.now();

    // Ajouter à l'historique
    this.addToHistory(false, error);

    if (this.sm.is('CLOSED') && this.failures >= this.maxFailures) {
      // Trop d'échecs, ouvrir le circuit
      this.sm.send('THRESHOLD_REACHED');
    } else if (this.sm.is('HALF_OPEN')) {
      // Un échec en half-open rouvre immédiatement
      this.sm.send('FAILURE');
    }
  }

  /**
   * Ajoute un appel à l'historique
   */
  addToHistory(success, error = null) {
    const now = Date.now();

    this.callHistory.push({
      success,
      error: error ? error.message : null,
      timestamp: now
    });

    // Nettoyer l'historique ancien
    const cutoff = now - this.monitoringWindow;
    this.callHistory = this.callHistory.filter(call => call.timestamp > cutoff);
  }

  /**
   * Obtient les métriques actuelles
   */
  getMetrics() {
    const now = Date.now();
    const recentCalls = this.callHistory.filter(
      call => now - call.timestamp < this.monitoringWindow
    );

    const successRate = recentCalls.length > 0
      ? recentCalls.filter(c => c.success).length / recentCalls.length
      : 1;

    return {
      state: this.sm.current,
      successRate: Math.round(successRate * 100),
      totalCalls: this.stats.totalCalls,
      totalFailures: this.stats.totalFailures,
      totalSuccesses: this.stats.totalSuccesses,
      consecutiveFailures: this.stats.consecutiveFailures,
      recentCalls: recentCalls.length,
      nextAttemptIn: this.nextAttemptTime ? Math.max(0, this.nextAttemptTime - now) : null,
      lastStateChange: this.stats.lastStateChange,
      stateChanges: this.stats.stateChanges
    };
  }

  /**
   * Reset manuel du circuit
   */
  reset() {
    this.#log('Reset manuel');
    this.sm.send('RESET');
    this.failures = 0;
    this.successCount = 0;
    this.stats.consecutiveFailures = 0;
  }

  /**
   * Force l'ouverture du circuit
   */
  open() {
    this.#log('Ouverture forcée');
    this.sm.send('FORCE_OPEN');
  }

  /**
   * Vérifie si le circuit est disponible
   */
  isAvailable() {
    if (this.sm.is('CLOSED') || this.sm.is('HALF_OPEN')) {
      return true;
    }

    if (this.sm.is('OPEN') && Date.now() >= this.nextAttemptTime) {
      return true;
    }

    return false;
  }
}

/**
 * Circuit breaker spécialisé pour les connexions P2P
 */
export class P2PCircuitBreaker extends CircuitBreaker {
  constructor(peerId) {
    super({
      maxFailures: 3,
      resetTimeout: 30000, // 30 secondes
      halfOpenAttempts: 1,
      monitoringWindow: 60000 // 1 minute
    });

    this.peerId = peerId;
  }

  /**
   * Tente une connexion P2P
   */
  async connect(connectFn) {
    return this.execute(
      () => connectFn(this.peerId),
      (error) => {
        console.error(`[P2P] Impossible de se connecter à ${this.peerId}:`, error.message);
        throw new Error(`Connexion à ${this.peerId} temporairement indisponible`);
      }
    );
  }

  /**
   * Obtient un message d'état pour l'utilisateur
   */
  getStatusMessage() {
    const metrics = this.getMetrics();

    switch (this.sm.current) {
      case 'OPEN':
        const secondsLeft = Math.ceil(metrics.nextAttemptIn / 1000);
        return t('errors.CIRCUIT_OPEN').replace('{secondsLeft}', secondsLeft);

      case 'HALF_OPEN':
        return t('errors.CIRCUIT_HALF_OPEN');

      case 'CLOSED':
        if (metrics.consecutiveFailures > 0) {
          return t('errors.CIRCUIT_UNSTABLE').replace('{failures}', metrics.consecutiveFailures);
        }
        return t('errors.CIRCUIT_OK');

      default:
        return this.sm.current;
    }
  }
}
