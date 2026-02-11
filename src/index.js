// Core
export { NetworkManager } from './core/network.js'
export { loadLocale, t } from './core/locale.js'
export { hashPassword, verifyHash, createAuthMessage } from './core/auth.js'
export { connectionStates, initial as connectionInitial } from './core/connection-states.js'
export { StateRunner } from './core/state-runner.js'

// Sync
export { P2PSync } from './sync/p2p-sync.js'
export { PeerTransport } from './sync/transport.js'
export { p2pSyncStates, p2pSyncInitial } from './sync/p2p-sync-states.js'
export { guardStates, guardInitial } from './sync/guard-states.js'
export { Session, SessionCtrl } from './sync/session.js'

// Security
export { validateMessage, sanitizeString, sanitizeState, registerMessageSchemas } from './security/message-validator.js'
export { RateLimiter, rateLimiter, MESSAGE_RATE_LIMITS } from './security/rate-limiter.js'
export { CircuitBreaker, P2PCircuitBreaker } from './security/circuit-breaker.js'
