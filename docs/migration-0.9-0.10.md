# Migration v0.9.1 → v0.10.1

## Résumé

La v0.10 introduit **P2PSync**, une façade applicative au-dessus de `NetworkManager`. Elle apporte les sessions multiplexées, la détection de présence (guard) et la reconnexion. `NetworkManager` reste disponible mais n'est plus l'API recommandée pour la synchronisation.

---

## 1. Breaking changes

### Renommages

| Avant (v0.9) | Après (v0.10) | Impact |
|--------------|---------------|--------|
| `sanitizeGameState(state)` | `sanitizeState(state)` | Import et appels |
| type de message `peerState` | `localState` | Validation, rate limiting |
| `session.isNetworkGame = true` | supprimé | Géré par P2PSync |

**Action** : rechercher-remplacer dans votre code applicatif.

```js
// Avant
import { sanitizeGameState } from '@thipages/pacpam'

// Après
import { sanitizeState } from '@thipages/pacpam'
```

### Transitions couche 2

La machine à états de connexion passe de **25 à 30 transitions**. Les erreurs réseau sont désormais distinctes :

| Nouveau | Remplace |
|---------|----------|
| `PEER_CREATION_ERROR` | erreur générique |
| `SIGNALING_ERROR` | erreur générique |
| `CONNECTION_ERROR` | erreur générique |

Si votre code écoute `onStateChange` de la couche 2, vérifiez la compatibilité avec les nouvelles transitions.

---

## 2. Nouvelle architecture

### Avant (v0.9) — usage direct de NetworkManager

```
Application → NetworkManager (connexion + données)
```

### Après (v0.10) — trois couches

```
Application → P2PSync (sessions, présence, reconnexion)
                 ↓
              PeerTransport (contrat transport)
                 ↓
              NetworkManager (connexion WebRTC)
```

### Nouveaux modules

| Module | Rôle |
|--------|------|
| `PeerTransport` | Adaptateur entre NetworkManager et P2PSync |
| `P2PSync` | Façade applicative : sessions, guard, reconnexion |
| `Session` / `SessionCtrl` | Cycle de vie et contrôle d'une session |

---

## 3. Migration pas à pas

### 3.1. Imports

```js
// Avant (v0.9)
import { NetworkManager } from '@thipages/pacpam'

// Après (v0.10)
import { NetworkManager, PeerTransport, P2PSync } from '@thipages/pacpam'
```

### 3.2. Initialisation

```js
// Avant (v0.9)
const network = new NetworkManager({ debug: false })
network.onIdReady = (id) => { /* ... */ }
network.onConnected = (isHost) => { /* ... */ }
network.onData = (data) => { /* ... */ }
network.init(pseudo, APP_ID)
network.connectTo(`${APP_ID}-${remotePseudo}`)

// Après (v0.10)
const network = new NetworkManager({ debug: false })
const transport = new PeerTransport(network)
const sync = new P2PSync(transport, { guardTimeout: 5000 })

transport.onIdReady = () => { /* ... */ }
transport.onAuthRequired = async () => { /* envoyer hash */ }
transport.onData = (data) => { /* données non-session (ex: auth) */ }
transport.onError = (err) => { /* ... */ }

sync.onStateChange = (state, detail) => { /* IDLE, CONNECTING, CONNECTED, DISCONNECTED */ }
sync.onGuardChange = (state) => { /* HALF_OPEN, CLOSED, OPEN */ }

transport.init(pseudo, APP_ID)
transport.connect(`${APP_ID}-${remotePseudo}`)
```

**Points clés :**
- `transport.init()` et `transport.connect()` remplacent `network.init()` et `network.connectTo()`
- Les callbacks de connexion passent par `transport`, la logique sync par `sync`
- `sync.onStateChange` donne un état simplifié (4 états au lieu de 6 pour la couche 2)

### 3.3. Envoi et réception de données

La v0.10 organise les échanges en **sessions**. Chaque session a un mode et un handler.

#### Mode indépendant (messages à la demande, ex: chat)

```js
// Hôte : créer la session
const handler = {
  onStart(ctrl) { /* session prête, stocker ctrl */ },
  onEnd() { /* session terminée */ },
  onMessage(payload) { /* message reçu du pair */ }
}
sync.createSession('chat', { mode: 'independent', fps: 0 }, handler)

// Guest : accepter la session
sync.onSessionCreate = (id, config) => {
  if (id === 'chat') return handler // retourner un handler
  return null
}

// Envoyer un message (via le ctrl reçu dans onStart)
ctrl.sendMessage({ text: 'Bonjour', from: pseudo })
```

#### Mode centralisé (boucle continue, ex: jeu)

```js
// Hôte : autorité sur l'état
const handler = {
  onStart(ctrl) { /* démarrer le jeu */ },
  onEnd() { /* arrêter */ },
  getLocalState() { /* retourne l'état du jeu (appelé à chaque tick) */ },
  processAction(action) { /* traiter action du guest */ }
}
sync.createSession('game', { mode: 'centralized', fps: 30 }, handler)

// Guest : reçoit l'état, envoie des actions
const guestHandler = {
  onStart(ctrl) { /* ctrl.sendAction({ op: 'move', y }) */ },
  onEnd() {},
  applyRemoteState(state) { /* afficher l'état reçu */ },
  getLocalState() { return undefined /* pas d'envoi côté guest */ }
}
```

**Si votre code v0.9 utilise `network.send(data)` directement** : migrer vers une session avec le mode approprié. Les `send()` directs via `transport.send()` restent possibles pour les messages hors-session (ex: authentification).

### 3.4. Authentification

L'authentification ne change pas fondamentalement, mais passe par `transport` :

```js
// Avant (v0.9)
network.onAuthRequired = async () => {
  const msg = await createAuthMessage(password, pseudo)
  network.send(msg)
}

// Après (v0.10)
transport.onAuthRequired = async () => {
  const msg = await createAuthMessage(password, pseudo)
  transport.send(msg)
}
```

### 3.5. Déconnexion

```js
// Avant
network.disconnect()

// Après
transport.disconnect()
```

---

## 4. Nouvelles fonctionnalités

### Détection de présence (guard)

Le guard surveille si le pair distant est toujours actif :

```js
sync.onGuardChange = (state) => {
  // HALF_OPEN → en attente de données
  // CLOSED    → pair présent
  // OPEN      → pair absent (timeout)
}

sync.onPeerAbsent = () => { /* guard → OPEN */ }
sync.onPeerBack = () => { /* retour de OPEN */ }
```

Le guard est nourri automatiquement par toute donnée entrante (messages, pings). Le timeout par défaut est de 5 secondes.

Les handlers de session reçoivent aussi `onPeerAbsent()` / `onPeerBack()` si ces méthodes sont définies.

### Reconnexion manuelle

```js
const result = sync.reconnect()

if (result.ok) {
  // reconnexion lancée
} else {
  // result.reason : 'not_disconnected', 'no_peer', 'transport_not_ready', 'circuit_breaker'
  // result.retryIn : ms avant prochaine tentative (si circuit_breaker)
}

// Info sans déclencher
const info = sync.reconnectInfo
// { canReconnect, reason?, retryIn?, peerId? }
```

### Latence

```js
sync.onPing = (ms) => { /* latence en ms */ }
sync.latency // dernière valeur mesurée
```

### Présence applicative

Session interne `_presence` à 0.5 fps pour échanger des données de présence :

```js
sync.setPresence({ status: 'en train de taper...' })
sync.onPresence = (data) => { /* données du pair distant */ }
```

Suspension automatique quand une session applicative a un fps > 0.5.

### Diagnostic des déconnexions

`onStateChange` fournit un `detail` enrichi :

```js
sync.onStateChange = (state, detail) => {
  // detail.layer2Tid  — ID de transition couche 2 (ex: 'c25')
  // detail.layer2Event — événement couche 2 (ex: 'CLOSE')
  // Permet de distinguer : pair parti (c25), ping timeout (c26), erreur réseau (c28/c29)
}
```

### Validation des messages applicatifs

Enregistrer des schémas pour valider les messages entrants :

```js
import { registerMessageSchemas } from '@thipages/pacpam'

registerMessageSchemas({
  chat: {
    required: ['text'],
    fields: {
      text: { type: 'string', maxLength: 500 },
      from: { type: 'string', maxLength: 20 }
    }
  }
})
```

### Protection des appels handler

Tous les appels aux méthodes des handlers sont protégés par try-catch. Les erreurs sont remontées via :

```js
sync.onHandlerError = (sessionId, method, error) => {
  console.error(`Erreur dans ${sessionId}.${method}:`, error)
}
```

---

## 5. Récapitulatif des exports

```js
// Core (inchangé)
export { NetworkManager } from './core/network.js'
export { loadLocale, t } from './core/locale.js'
export { hashPassword, verifyHash, createAuthMessage } from './core/auth.js'
export { connectionStates, connectionInitial } from './core/connection-states.js'
export { StateRunner } from './core/state-runner.js'

// Sync (nouveau)
export { P2PSync } from './sync/p2p-sync.js'
export { PeerTransport } from './sync/transport.js'

// Security
export { validateMessage, sanitizeString, sanitizeState, registerMessageSchemas } from './security/message-validator.js'
//                                        ^^^^^^^^^^^^^^  ^^^^^^^^^^^^^^^^^^^^^^^
//                                        renommé         nouveau
export { RateLimiter, rateLimiter, MESSAGE_RATE_LIMITS } from './security/rate-limiter.js'
export { CircuitBreaker, P2PCircuitBreaker } from './security/circuit-breaker.js'
```

---

## 6. Exemples complets

Deux démos fonctionnelles dans `pages/` illustrent les deux modes :

| Démo | Mode | fps | Fichiers |
|------|------|-----|----------|
| Chat | `independent` | 0 | `pages/chat/` |
| Pong | `centralized` | 30 | `pages/pong/` |

Chaque démo suit le pattern **controller** (orchestration lib) + **instance** (Web Component, rendu) documenté dans `docs/project/ux/`.
