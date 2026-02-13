# Changelog

## v0.10.1 — 2026-02-12

Corrections couche 3 — manques identifiés par l'audit.

- `onStateChange` enrichi : `detail` inclut `layer2Tid` et `layer2Event` pour distinguer les causes de déconnexion (c25 pair parti, c26 ping timeout, c28/c29 erreurs réseau, c30 volontaire)
- Guard → handlers de session : `onPeerAbsent()` / `onPeerBack()` propagés aux handlers de chaque session CONNECTED via `#notifyGuardToSessions`
- Circuit breaker exposé via `transport.circuitBreakerInfo(peerId)` + `transport.remotePeerId` (getters lecture seule, pas de modification de `network.js`)
- Reconnexion manuelle : `sync.reconnect()` → `{ ok, reason, retryIn, peerId }` et `sync.reconnectInfo` → `{ canReconnect, reason, retryIn, peerId }`. Vérifie état P2PSync, couche 2, et circuit breaker avant de déclencher p5
- RTT exposé par P2PSync : callback `sync.onPing(latency)` + propriété `sync.latency`
- Try-catch sur tous les appels handler : helper `#safeCall` dans P2PSync + try-catch locaux dans SessionCtrl. Callback `sync.onHandlerError(sessionId, method, error)` pour monitoring applicatif

## v0.10.0 — 2026-02-11

Couche 3 — P2PSync : façade applicative avec sessions multiplexées.

- Erreurs réseau distinctes : PEER_CREATION_ERROR, SIGNALING_ERROR, CONNECTION_ERROR (25 → 30 transitions)
- IDs de transitions intégrés dans les définitions de states (préfixes `c`/`cb`)
- Nettoyage vocabulaire : `sanitizeGameState` → `sanitizeState`, `peerState` → `localState`, `session.isNetworkGame` supprimé
- `sync/transport.js` : wrapper du `NetworkManager` (contrat transport agnostique)
- `sync/p2p-sync-states.js` : SM P2PSync — 4 états, 6 transitions (`p1`–`p6`)
- `sync/guard-states.js` : guard présence — 3 états, 4 transitions (`g1`–`g4`)
- `sync/session.js` : Session avec SM (`s1`–`s4`) + SessionCtrl
- `sync/p2p-sync.js` : façade complète (sessions, contrôle, présence, boucle fps)
- Validation : type `message` + champ `_s` + sous-types `_ctrl` (`message-validator.js`)
- Rate limiting : limites pour `message` + `localState` renommé (`rate-limiter.js`)
- API publique nettoyée (`src/index.js`) : exports `P2PSync`, `PeerTransport`, `sanitizeState`
- Page de test `pages/v0.10.0/` (compteur centralisé + messages indépendants)
- Tests navigateur SM couche 3 : couverture P2PSync, Guard et Session (14 transitions)
- Architecture documentée (`docs/architecture.md`)

## v0.9.1 — 2026-02-08

Rendre pacpam consommable depuis npm.

## v0.9.0 — 2026-02-08

Initial commit — @thipages/pacpam.
