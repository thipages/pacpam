# Changelog — pacpam

## v0.11.2 — 2026-02-15

- Réorganisation docs : migrations dans `docs/migrations/`, state-machine déplacé vers `pages/` (accessible sur GitHub Pages)
- Carte « Machines à états » ajoutée dans l'index des démos

## v0.11.1 — 2026-02-15

- Page index démos : checkbox « mode test » intégrée dans les cartes Chat et Pong (ajoute `?test` au lien)

## v0.11.0 — 2026-02-15

P2PSync comme point d'entrée unique — instanciation simplifiée, passthroughs transport, rate-limiter adapté au temps réel.

- **Instanciation simplifiée** : `new P2PSync({ network: { debug: false }, guardTimeout: 5000 })` crée automatiquement NetworkManager + PeerTransport en interne. Mode legacy `new P2PSync(transport, options)` conservé
- **Passthroughs transport** : `sync.init()`, `sync.connect()`, `sync.disconnect()`, `sync.send()`, `sync.authSuccess()`, `sync.authFailed()`, getters/setters `onIdReady`, `onAuthRequired`, `onConnected`, `onDisconnected`, `onError`, `onData`, `myId`, `myPseudo`, `remotePeerId`. L'application n'a plus besoin d'accéder au transport directement
- **Filtrage messages internes** : les listeners app (`transport.onData`) ne reçoivent plus les messages `_ctrl` et `_s`, traités exclusivement par P2PSync. Les listeners internes (`addDataListener`) reçoivent tout
- **Rate limit `action`** : 10/sec → 35/sec pour supporter les sessions 30fps
- **Throttle warnings rate-limiter** : 1 log par type/peer par fenêtre de 5s au lieu d'un warning par message rejeté. Compteur de messages supprimés affiché au prochain log
- **Auto-pause sessions** : quand le guard passe OPEN (peer absent), tous les `setInterval` de sync sont arrêtés. Reprise automatique quand le guard revient HALF_OPEN (peer de retour)
- **ID libre** : `sync.init(id)` avec un ID opaque (≥ 16 chars) en plus du mode legacy `sync.init(pseudo, appId)`. Détection par arité
- **Serveur PeerJS configurable** : `new P2PSync({ network: { peerOptions: { host: '...', port: 9000 } } })` ou `new NetworkManager({ peerOptions: { ... } })`
- Migration des 3 démos (`chat-controller`, `pong-controller`, `peer-instance`) vers l'API simplifiée

## v0.10.1 — 2026-02-12

Corrections couche 3 — manques identifiés par l'audit.

- `onStateChange` enrichi : `detail` inclut `layer2Tid` et `layer2Event` pour distinguer les causes de déconnexion (c25 pair parti, c26 ping timeout, c28/c29 erreurs réseau, c30 volontaire)
- Guard → handlers de session : `onPeerAbsent()` / `onPeerBack()` propagés aux handlers de chaque session CONNECTED via `#notifyGuardToSessions`
- Circuit breaker exposé via `transport.circuitBreakerInfo(peerId)` + `transport.remotePeerId` (getters lecture seule)
- Reconnexion manuelle : `sync.reconnect()` → `{ ok, reason, retryIn, peerId }` et `sync.reconnectInfo` → `{ canReconnect, reason, retryIn, peerId }`. Vérifie état P2PSync, couche 2, et circuit breaker avant de déclencher p5
- RTT exposé par P2PSync : callback `sync.onPing(latency)` + propriété `sync.latency`
- Try-catch sur tous les appels handler : helper `#safeCall` dans P2PSync + try-catch locaux dans SessionCtrl. Callback `sync.onHandlerError(sessionId, method, error)` pour monitoring applicatif
- Documentation : guide de migration v0.9 → v0.10 (`docs/migration-0.9-0.10.md`), persistance d'état après reconnexion (`docs/architecture.md`)
- Démos : chat P2P (`pages/chat/`), pong P2P (`pages/pong/`)
- Visualiseur de machines à états avec onglets (`docs/state-machine/`)

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
- Tests navigateur SM couche 3 : couverture P2PSync, Guard et Session (14 transitions)
- Architecture documentée (`docs/architecture.md`)

### Détail des phases d'implémentation

<details>
<summary>Phase 0 — Nettoyage vocabulaire</summary>

**Breaking changes** — renommages sans changement fonctionnel.

| Avant | Après | Fichiers |
|-------|-------|----------|
| `sanitizeGameState()` | `sanitizeState()` | message-validator.js, network.js, index.js |
| type `peerState` | type `localState` | message-validator.js, rate-limiter.js, p2p-sync.js |
| `session.isNetworkGame = true` | supprimé | p2p-sync.js |

Plus aucune référence à « game » dans `src/`.
</details>

<details>
<summary>Phase 1 — PeerTransport</summary>

**Nouveau fichier** : `src/sync/transport.js`

`PeerTransport` est un adaptateur entre `NetworkManager` (couche 2) et `P2PSync` (couche 3). Il expose un contrat transport minimal :

```
init(pseudo, appId)    connect(peerId)    disconnect()
send(data) → boolean   onData (setter)    onStateChange(callback)
isConnected()          isHost (getter)    state (getter)
authSuccess()          authFailed()       onAuthRequired (setter)
onIdReady (setter)     onConnected (setter)  onDisconnected (setter)
onError (setter)       onPing (setter)    myId / myPseudo (getters)
```

`onStateChange` supporte plusieurs listeners (pattern subscribe) pour permettre à P2PSync et à l'application d'écouter simultanément.
</details>

<details>
<summary>Phase 2 — SM P2PSync</summary>

**Nouveaux fichiers** :
- `src/sync/p2p-sync-states.js` — définition SM (4 états, 6 transitions)
- `src/sync/p2p-sync.js` — réécriture complète

**SM P2PSync** (projection groupée de la couche 2) :

| ID | De | Vers | Événement |
|----|----|------|-----------|
| p1 | IDLE | CONNECTING | CONNECT |
| p2 | CONNECTING | CONNECTED | TRANSPORT_CONNECTED |
| p3 | CONNECTING | IDLE | TRANSPORT_FAILED |
| p4 | CONNECTED | DISCONNECTED | TRANSPORT_LOST |
| p5 | DISCONNECTED | CONNECTING | RECONNECT |
| p6 | DISCONNECTED | IDLE | RESET |

**Distinction clé** : `IDLE` (jamais connecté ou reset) vs `DISCONNECTED` (connexion perdue).
</details>

<details>
<summary>Phase 3 — Guard présence</summary>

**Nouveau fichier** : `src/sync/guard-states.js`

SM guard présence active en état CONNECTED, détruite à la sortie :

| ID | De | Vers | Événement |
|----|----|------|-----------|
| g1 | HALF_OPEN | CLOSED | DATA_RECEIVED |
| g2 | CLOSED | OPEN | TIMEOUT |
| g3 | OPEN | HALF_OPEN | DATA_RECEIVED |
| g4 | CLOSED | CLOSED | DATA_RECEIVED (self-loop, reset timer) |

- `HALF_OPEN` = en attente de premières données (jaune)
- `CLOSED` = pair présent, données reçues récemment (vert)
- `OPEN` = pair absent, timeout sans données (rouge)

Le guard est nourri par toute donnée entrante (messages applicatifs + ping/pong). Le timer se réinitialise à chaque donnée reçue (défaut : 5s).
</details>

<details>
<summary>Phase 4 — Sessions multiplexées</summary>

**Nouveau fichier** : `src/sync/session.js`

Deux classes : `Session` (cycle de vie + SM) et `SessionCtrl` (contrôleur exposé aux handlers et à l'application).

**SM Session** (4 transitions, `s1`–`s4`) :

| ID | De | Vers | Événement |
|----|----|------|-----------|
| s1 | IDLE | CONNECTING | CREATE |
| s2 | CONNECTING | CONNECTED | READY |
| s3 | CONNECTED | DISCONNECTED | END |
| s4 | CONNECTING | DISCONNECTED | END |

**Protocole `_ctrl`** — messages de contrôle entre pairs :
- `sessionCreate` (hôte → guest) : crée la session côté guest
- `sessionReady` (guest → hôte) : confirme la création
- `sessionSetFps` (hôte → guest) : change le fps
- `sessionEnd` (hôte → guest) : détruit la session
</details>

<details>
<summary>Phase 5 — Logique de sync</summary>

Boucle continue, `setFps`, `broadcastState`, prédiction guest.

- Chaque session CONNECTED avec `fps > 0` a son propre `setInterval`
- `setFps(n)` : hôte seul peut changer le fps à chaud, synchronisé via `_ctrl:sessionSetFps`
- `broadcastState()` : envoi ponctuel de l'état
- Auto-broadcast : après chaque `processAction` sur l'hôte, `fullState` envoyé au guest
- Prédiction guest : `sendAction` appelle `handler.processAction` localement avant d'envoyer
</details>

<details>
<summary>Phase 6 — Présence interne</summary>

Session interne `_presence` — heartbeat applicatif + données de présence.

- Session indépendante à fps 0.5, créée automatiquement sur les deux pairs
- API : `sync.setPresence(data)`, `sync.onPresence`, `sync.presenceSuspended`
- Suspension automatique quand une session applicative a un `fps > 0.5`
</details>

<details>
<summary>Phase 7 — Validation et rate limiting</summary>

- Validation `_ctrl` par sous-type (`sessionCreate`, `sessionReady`, `sessionSetFps`, `sessionEnd`)
- Validation `_s` : string ≤ 50 caractères
- 26 tests unitaires
</details>

<details>
<summary>Phase 8 — API publique et exports</summary>

Nettoyage des exports `src/index.js` : suppression des modules internes. Exports conservés : `NetworkManager`, `PeerTransport`, `P2PSync` (+ core, security).

`P2PSync` est la façade recommandée ; `NetworkManager` reste disponible pour les cas avancés.
</details>

## v0.9.1 — 2026-02-08

Rendre pacpam consommable depuis npm.

## v0.9.0 — 2026-02-08

Initial commit — @thipages/pacpam.
