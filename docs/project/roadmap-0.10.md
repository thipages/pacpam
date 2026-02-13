# Roadmap v0.10.0

## Fait

- [x] Erreurs réseau distinctes : PEER_CREATION_ERROR, SIGNALING_ERROR, CONNECTION_ERROR (25 → 30 transitions)
- [x] IDs préfixés dans les définitions de states (`c1`–`c30`, `cb1`–`cb10`)
- [x] Changelog (`docs/project/changelog.md`)
- [x] Architecture P2PSync documentée (`docs/architecture.md`) :
  - [x] SM P2PSync : IDLE / CONNECTING / CONNECTED / DISCONNECTED (projection groupée de la SM couche 2)
  - [x] Guard présence sur CONNECTED : HALF_OPEN / CLOSED / OPEN (même formalisme que le circuit breaker)
  - [x] Sessions = machines parallèles, même vocabulaire que P2PSync
  - [x] Modes de données par session : centralisé / indépendant / collaboratif (réservé)
  - [x] Deux niveaux d'autorité : administratif (hôte, toujours centralisé) + données (configurable par session)
  - [x] 4 types de messages normalisés : `action`, `fullState`, `localState`, `message`
  - [x] Présence intégrée (`_presence`), suspension automatique si session fps > 0.5
  - [x] Interface transport agnostique + verrouillage du transport
  - [x] Handler duck-typed (8 méthodes optionnelles) + SessionCtrl (double accès A+B)
  - [x] API création : `sync.createSession()` (hôte) + `sync.onSessionCreate` (guest)
  - [x] Messages de contrôle : `sessionCreate`, `sessionReady`, `sessionSetFps`, `sessionEnd`
- [x] Nettoyage vocabulaire (breaking changes) :
  - [x] `sanitizeGameState(state)` → `sanitizeState(state)` (`message-validator.js`, `network.js`, `index.js`)
  - [x] `session.isNetworkGame` supprimé (géré par P2PSync)
  - [x] `peerState` → `localState` (`message-validator.js`, `rate-limiter.js`, `p2p-sync.js`)
  - [x] JSDoc "Sanitise un objet état de jeu" → "Sanitise un objet état"
- [x] Nouveau code :
  - [x] `sync/transport.js` : wrapper du `NetworkManager` exposant le contrat minimal
  - [x] `sync/p2p-sync-states.js` : SM P2PSync, 4 états, 6 transitions (`p1`–`p6`)
  - [x] `sync/guard-states.js` : guard présence, 3 états, 4 transitions (`g1`–`g4`)
  - [x] `sync/session.js` : Session avec SM (`s1`–`s4`) + SessionCtrl
  - [x] `sync/p2p-sync.js` : façade complète (sessions, contrôle, présence, boucle fps)
  - [x] `security/message-validator.js` : type `message` + champ `_s` + sous-types `_ctrl`
  - [x] `security/rate-limiter.js` : limites pour `message` + `localState` renommé
- [x] API publique nettoyée (`src/index.js`) : exports `P2PSync`, `PeerTransport`, `sanitizeState`
- [x] Page de test `pages/v0.10.0/` : app minimaliste (compteur centralisé + messages indépendants)
- [x] Tests navigateur SM couche 3 (`docs/state-machine/tests/`) : couverture P2PSync, Guard et Session (14 transitions)

---

## À faire

Chaque point sera évalué et décidé individuellement avant implémentation.

### Manques couche 3 (audit)

- [x] **Détail transition couche 2** : `onStateChange` enrichi avec `layer2Tid` et `layer2Event` dans `detail`
- [x] **Guard → handlers** : `onPeerAbsent()` / `onPeerBack()` propagés aux handlers de session via `#notifyGuardToSessions`
- ~~**Signaling lost (c27)**~~ : annulé — c27 est un détail d'infrastructure PeerJS géré automatiquement par la couche 2. Voir travaux futurs ci-dessous
- [x] **Circuit breaker → transport + reconnexion (p5)** : getter `transport.circuitBreakerInfo(peerId)` (lecture Map CB par peer) + `transport.remotePeerId`. `sync.reconnect()` et `sync.reconnectInfo` exposent l'état CB et pilotent la reconnexion manuelle (pas d'auto-retry). Réponses typées avec `peerId` pour isoler les CB par pair
- [x] **onPing** : callback `sync.onPing(latency)` + propriété `sync.latency`
- [x] **Exceptions handlers** : helper `#safeCall` dans P2PSync (10 points protégés) + try-catch dans SessionCtrl (2 points). Callback `sync.onHandlerError`

### Application

- [x] `pages/chat-ux/` : chat minimaliste orienté UX (voir `docs/project/chat-ux.md`)

---

### Travaux futurs (hors v0.10.x)

- [ ] **Détacher le signaling en CONNECTED** : en mode 1-to-1, couper la connexion au serveur PeerJS une fois le DataChannel établi (`peer.disconnect()`). Allège les ressources, libère un slot serveur. Reconnexion au serveur uniquement si reconnexion P2P nécessaire. Changement SM couche 2.
- [ ] **Topologie N > 2 pairs** : refonte du contrat transport (`send(peerId, data)`, `onData(peerId, cb)`), topologie configurable (mesh/star), probablement une façade `MultiPeerSync` distincte. Le maintien du signaling en CONNECTED est pertinent dans ce modèle.
- [ ] **Protection connexions entrantes non sollicitées (couche 2)** : actuellement, toute connexion entrante est acceptée si `this.connection` n'est pas déjà ouverte (`network.js:196`). Un attaquant peut se connecter et bloquer la SM en AUTHENTICATING pendant AUTH_TIMEOUT (5s), empêchant toute connexion sortante. Avec N attaquants qui se relaient, le blocage est permanent. Solution : refuser les connexions entrantes si la SM n'est pas en READY, ou si une connexion sortante est en cours. Optionnellement, notifier l'application des tentatives rejetées (sans passer par P2PSync — c'est une responsabilité couche 2).

### Décisions prises

- **`locales/` hors `src/`** : OK tel quel (données ≠ code)
- **Constantes** : statu quo (valeurs dans les constructeurs, documentées dans `constants.js`)
- **Modes de communication** : P2PSync est la façade unique, transport verrouillé
- **SessionCtrl** : double accès A (handler via `onStart`) + B (application via `sync.getSession`)
