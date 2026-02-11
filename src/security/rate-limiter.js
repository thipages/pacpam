/**
 * Rate limiter pour prévenir le spam et les attaques DoS
 */

// Configuration des limites par type de message
export const MESSAGE_RATE_LIMITS = {
  'localState': { max: 35, window: 1000 },    // 35/sec pour 30fps + marge
  'fullState': { max: 35, window: 1000 },    // Idem
  'action': { max: 10, window: 1000 },       // Actions on-demand
  'message': { max: 20, window: 1000 },      // Messages discrets
  '_ctrl': { max: 20, window: 1000 },        // Messages de contrôle session
  'auth': { max: 5, window: 10000 },         // Authentification
  'ping': { max: 2, window: 3000 },          // 2 pings toutes les 3 sec
  'pong': { max: 2, window: 3000 },
  'default': { max: 10, window: 1000 }       // Limite par défaut
};

export class RateLimiter {
  constructor() {
    // Map de compteurs par type de message
    this.counters = new Map();

    // Historique des violations pour bloquer les spammers
    this.violations = new Map();
    this.maxViolations = 10;
    this.blockDuration = 60000; // 1 minute de blocage
  }

  /**
   * Vérifie si un message peut passer selon les limites
   */
  checkLimit(messageType, peerId = 'default') {
    const now = Date.now();
    const limits = MESSAGE_RATE_LIMITS[messageType] || MESSAGE_RATE_LIMITS.default;

    // Vérifier si le peer est bloqué
    if (this.isBlocked(peerId)) {
      console.warn(`[RateLimit] Peer bloqué: ${peerId}`);
      return false;
    }

    // Créer la clé unique pour ce peer et ce type de message
    const key = `${peerId}:${messageType}`;

    // Récupérer ou créer le compteur
    if (!this.counters.has(key)) {
      this.counters.set(key, {
        count: 0,
        windowStart: now
      });
    }

    const counter = this.counters.get(key);

    // Réinitialiser la fenêtre si elle est expirée
    if (now - counter.windowStart >= limits.window) {
      counter.count = 0;
      counter.windowStart = now;
    }

    // Vérifier la limite
    if (counter.count >= limits.max) {
      this.recordViolation(peerId, messageType);
      console.warn(`[RateLimit] Limite atteinte pour ${messageType}: ${counter.count}/${limits.max}`);
      return false;
    }

    // Incrémenter le compteur
    counter.count++;
    return true;
  }

  /**
   * Enregistre une violation de rate limit
   */
  recordViolation(peerId, messageType) {
    const now = Date.now();

    if (!this.violations.has(peerId)) {
      this.violations.set(peerId, []);
    }

    const peerViolations = this.violations.get(peerId);
    peerViolations.push({
      type: messageType,
      timestamp: now
    });

    // Garder seulement les violations récentes (dernière minute)
    const recentViolations = peerViolations.filter(v => now - v.timestamp < 60000);
    this.violations.set(peerId, recentViolations);

    // Bloquer si trop de violations
    if (recentViolations.length >= this.maxViolations) {
      this.blockPeer(peerId);
    }
  }

  /**
   * Bloque un peer pour spam
   */
  blockPeer(peerId) {
    const now = Date.now();
    this.violations.set(peerId, [{
      type: 'BLOCKED',
      timestamp: now,
      unblockAt: now + this.blockDuration
    }]);
    console.error(`[RateLimit] Peer ${peerId} bloqué pour spam jusqu'à ${new Date(now + this.blockDuration).toLocaleTimeString()}`);
  }

  /**
   * Vérifie si un peer est bloqué
   */
  isBlocked(peerId) {
    if (!this.violations.has(peerId)) return false;

    const violations = this.violations.get(peerId);
    if (violations.length === 0) return false;

    const lastViolation = violations[violations.length - 1];
    if (lastViolation.type === 'BLOCKED') {
      const now = Date.now();
      if (now < lastViolation.unblockAt) {
        return true;
      } else {
        // Débloquer automatiquement
        this.violations.delete(peerId);
      }
    }
    return false;
  }

  /**
   * Réinitialise les compteurs pour un peer
   */
  resetPeer(peerId) {
    // Supprimer tous les compteurs de ce peer
    for (const [key] of this.counters) {
      if (key.startsWith(`${peerId}:`)) {
        this.counters.delete(key);
      }
    }
    // Supprimer les violations
    this.violations.delete(peerId);
  }

  /**
   * Nettoie les vieux compteurs pour économiser la mémoire
   */
  cleanup() {
    const now = Date.now();
    const maxAge = 60000; // Garder 1 minute d'historique

    // Nettoyer les compteurs
    for (const [key, counter] of this.counters) {
      if (now - counter.windowStart > maxAge) {
        this.counters.delete(key);
      }
    }

    // Nettoyer les violations
    for (const [peerId, violations] of this.violations) {
      const recentViolations = violations.filter(v => {
        if (v.type === 'BLOCKED') {
          return now < v.unblockAt;
        }
        return now - v.timestamp < maxAge;
      });

      if (recentViolations.length === 0) {
        this.violations.delete(peerId);
      } else {
        this.violations.set(peerId, recentViolations);
      }
    }
  }

  /**
   * Obtient les statistiques actuelles
   */
  getStats() {
    const stats = {
      activeCounters: this.counters.size,
      blockedPeers: 0,
      totalViolations: 0
    };

    for (const [peerId, violations] of this.violations) {
      if (violations.some(v => v.type === 'BLOCKED' && Date.now() < v.unblockAt)) {
        stats.blockedPeers++;
      }
      stats.totalViolations += violations.filter(v => v.type !== 'BLOCKED').length;
    }

    return stats;
  }
}

// Instance globale
export const rateLimiter = new RateLimiter();

// Nettoyer périodiquement la mémoire
setInterval(() => {
  rateLimiter.cleanup();
}, 30000); // Toutes les 30 secondes