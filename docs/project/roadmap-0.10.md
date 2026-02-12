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

- [ ] **Détail transition couche 2** : `onStateChange` de P2PSync ne remonte pas le `tid` de la transition couche 2. L'application ne peut pas distinguer c25 (pair parti) de c26 (ping timeout), c28 (signaling error), c29 (connection error) ou c30 (utilisateur). Ajouter `transition` dans l'objet `detail`
- [ ] **Guard → handlers** : `onPeerAbsent()` / `onPeerBack()` ne sont jamais appelés sur les handlers de session — seuls les callbacks globaux `sync.onPeerAbsent` / `sync.onPeerBack` fonctionnent. Propager les notifications du guard à chaque handler de session actif
- [ ] **Signaling lost (c27)** : le self-loop c27 n'est pas remonté à P2PSync ni à l'application. Impossible d'afficher un indicateur "signalisation perdue" comme recommandé par le guide UX. Exposer un événement ou callback dédié
- [ ] **Circuit breaker → transport** : exposer l'état du CB dans le contrat transport (callback `onCircuitBreakerChange(state, nextAttemptTime)` sur `PeerTransport`) pour distinguer "connexion en cours" de "bloqué par le disjoncteur"
- [ ] **Reconnexion automatique (p5)** : la transition p5 (DISCONNECTED → CONNECTING) est définie mais jamais déclenchée. Ajouter une stratégie de retry (backoff, nombre max de tentatives) dans P2PSync, tenant compte de l'état du circuit breaker
- [ ] **onPing** : le RTT n'est pas exposé par P2PSync, uniquement via `transport.onPing`. Ajouter un proxy `sync.onPing` pour cohérence avec l'API façade
- [ ] **Exceptions handlers** : aucun try-catch autour des appels aux méthodes des handlers. Une exception dans `getLocalState()` ou `onMessage()` crash la boucle sync. Envelopper les appels dans des try-catch

### Application

- [x] `pages/chat-ux/` : chat minimaliste orienté UX (voir `docs/project/chat-ux.md`)

---

### Décisions prises

- **`locales/` hors `src/`** : OK tel quel (données ≠ code)
- **Constantes** : statu quo (valeurs dans les constructeurs, documentées dans `constants.js`)
- **Modes de communication** : P2PSync est la façade unique, transport verrouillé
- **SessionCtrl** : double accès A (handler via `onStart`) + B (application via `sync.getSession`)
