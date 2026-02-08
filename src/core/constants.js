/**
 * Référence centralisée des constantes P2P
 *
 * Les valeurs restent définies dans leurs fichiers d'origine.
 * Ce fichier les ré-exporte pour consultation centralisée.
 */

// Rate limiting — défini dans security/rate-limiter.js
export { MESSAGE_RATE_LIMITS } from '../security/rate-limiter.js';

// Sécurité — défini dans security/message-validator.js
// (constantes locales, non exportées)
// MAX_MESSAGE_SIZE = 50000 bytes
// MAX_STRING_LENGTH = 1000
// MAX_ARRAY_LENGTH = 1000
// MAX_OBJECT_DEPTH = 10

// Disjoncteur — défini dans security/circuit-breaker.js
// (options du constructeur, valeurs par défaut)
// maxFailures = 3
// resetTimeout = 30000 ms
// halfOpenAttempts = 1
// monitoringWindow = 60000 ms

// Connexion — défini dans core/network.js
// (configurables via options du constructeur NetworkManager)
export { CONNECTION_TIMEOUT, AUTH_TIMEOUT, PING_INTERVAL, PONG_TIMEOUT } from './network.js';
