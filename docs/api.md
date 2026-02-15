# API Reference — @thipages/pacpam

## Core

### `NetworkManager`

Gestion complète d'une connexion P2P WebRTC via PeerJS.

```javascript
import { NetworkManager } from '@thipages/pacpam';
const network = new NetworkManager({ debug: false });
```

**Constructeur**

| Param | Type | Défaut | Description |
|-------|------|--------|-------------|
| `options.debug` | `boolean` | `false` | Active les logs console `[Network]` |
| `options.connectionTimeout` | `number` | `10000` | Timeout de connexion WebRTC (ms) |
| `options.authTimeout` | `number` | `5000` | Timeout d'authentification (ms) |
| `options.pingInterval` | `number` | `3000` | Intervalle entre les pings keepalive (ms) |
| `options.pongTimeout` | `number` | `10000` | Délai sans pong avant déconnexion (ms) |
| `options.peerOptions` | `object` | `{}` | Options passées au constructeur PeerJS (`host`, `port`, `path`, `secure`, etc.) |

**Méthodes**

| Méthode | Retour | Description |
|---------|--------|-------------|
| `init(pseudo, appId)` | `void` | Mode legacy : initialise PeerJS. L'ID sera `${appId}-${pseudo}`. Le pseudo doit contenir 3 à 10 caractères parmi `A-Z`, `0-9`, `_`, `-` (insensible à la casse). |
| `init(id)` | `void` | Mode libre : initialise PeerJS avec un ID opaque (≥ 16 caractères). `myPseudo` sera `null`. |
| `connectTo(peerId)` | `Promise<void>` | Se connecte à un pair distant (circuit breaker intégré). |
| `send(data)` | `boolean` | Envoie des données au pair connecté. |
| `disconnect()` | `void` | Ferme la connexion et revient à l'état IDLE. |
| `isConnected()` | `boolean` | `true` si l'état est CONNECTED. |
| `authSuccess()` | `void` | Signale que l'authentification a réussi. |
| `authFailed()` | `void` | Signale que l'authentification a échoué. |

**Callbacks**

| Callback | Signature | Description |
|----------|-----------|-------------|
| `onIdReady` | `(id: string) => void` | PeerJS est connecté, l'ID est attribué. |
| `onConnected` | `(isHost: boolean) => void` | Connexion authentifiée et prête. |
| `onDisconnected` | `() => void` | Connexion perdue. |
| `onAuthRequired` | `(isHost: boolean) => void` | Authentification requise (envoyer le hash). |
| `onData` | `(data: object) => void` | Données reçues du pair. |
| `onError` | `(error: Error) => void` | Erreur (message traduit via locale). |
| `onPing` | `(latency: number) => void` | Latence mesurée en ms. |
| `onAuthFailed` | `(peerId: string) => void` | Échec d'authentification d'un pair distant. |

**Machine à états interne**

```
IDLE → INITIALIZING → READY → CONNECTING → AUTHENTICATING → CONNECTED
```

Voir le [diagramme interactif](../pages/state-machine/index.html).

---

### `StateRunner`

Moteur de machine à états fini. Supporte guards, actions, émissions inter-machines.

```javascript
import { StateRunner } from '@thipages/pacpam';
const sm = new StateRunner(states, 'IDLE');
```

**Constructeur**

| Param | Type | Description |
|-------|------|-------------|
| `states` | `object` | Définitions d'états (voir format ci-dessous). |
| `initial` | `string` | État initial. |

**Méthodes**

| Méthode | Retour | Description |
|---------|--------|-------------|
| `send(event)` | `boolean` | Envoie un événement. Retourne `false` si transition impossible. |
| `is(state)` | `boolean` | Vérifie l'état courant. |
| `can(event)` | `boolean` | Vérifie si une transition existe pour cet événement. |
| `register(state, { entry, exit })` | `void` | Enregistre les callbacks entry/exit d'un état. |

**Hooks**

| Hook | Signature | Description |
|------|-----------|-------------|
| `onTransition` | `(from, to, event) => void` | Appelé après chaque transition. |
| `checkGuard` | `(guard) => boolean` | Évalue une garde. Retourne `false` pour bloquer. |
| `onEmit` | `(emit) => void` | Appelé quand une transition émet un signal. |

**Format des définitions d'états**

```javascript
const states = {
  STATE_NAME: {
    on: {
      EVENT: 'TARGET',                          // transition simple
      EVENT: { target: 'TARGET' },              // transition objet
      EVENT: { target: 'TARGET', guard: { sm: 'cb', not: 'OPEN' } },  // avec garde
      EVENT: { target: 'TARGET', emit: { sm: 'cb', event: 'SUCCESS' } }, // avec émission
      EVENT: { target: 'TARGET', action: () => {} }  // avec action inline
    }
  }
};
```

**Propriétés**

| Propriété | Type | Description |
|-----------|------|-------------|
| `current` | `string` | État courant. |
| `states` | `object` | Définitions d'états. |

---

### Authentification

```javascript
import { hashPassword, verifyHash, createAuthMessage } from '@thipages/pacpam';
```

| Fonction | Signature | Description |
|----------|-----------|-------------|
| `hashPassword(password)` | `(string) => Promise<string>` | Hash SHA-256 hexadécimal. |
| `verifyHash(hash1, hash2)` | `(string, string) => boolean` | Compare deux hashs. |
| `createAuthMessage(password, name)` | `(string, string) => Promise<object>` | Retourne `{ type: 'auth', hash, name, timestamp }`. |

---

### Locale

```javascript
import { loadLocale, t } from '@thipages/pacpam';
```

| Fonction | Signature | Description |
|----------|-----------|-------------|
| `loadLocale(lang?)` | `(string?) => Promise<object>` | Charge un fichier de traduction. `'fr'` (défaut), `'en'` disponible. |
| `t(key)` | `(string) => string` | Accès par clé pointée. Retourne la clé brute si non trouvée. |

**Clés disponibles** : `states.*`, `events.*`, `guards.*`, `signals.*`, `errors.*`

Exemple : `t('errors.SIGNALING_ERROR')` → `"Erreur du serveur de signalisation."`

---

### Constantes

```javascript
import { connectionStates, connectionInitial } from '@thipages/pacpam';
```

| Export | Type | Description |
|--------|------|-------------|
| `connectionStates` | `object` | Définitions de la state machine de connexion. |
| `connectionInitial` | `string` | État initial (`'IDLE'`). |

---

## Sync

### `PeerTransport`

Adaptateur entre `NetworkManager` et `P2PSync`. Expose un contrat transport minimal pour découpler P2PSync des détails de la couche 2.

```javascript
import { PeerTransport, NetworkManager } from '@thipages/pacpam';
const network = new NetworkManager();
const transport = new PeerTransport(network);
```

**Méthodes**

| Méthode | Retour | Description |
|---------|--------|-------------|
| `init(pseudo, appId)` | `void` | Initialise PeerJS via `NetworkManager`. |
| `connect(peerId)` | `void` | Initie une connexion vers un pair distant. |
| `disconnect()` | `void` | Ferme la connexion. |
| `send(data)` | `boolean` | Envoie des données au pair connecté. |
| `isConnected()` | `boolean` | `true` si la couche 2 est CONNECTED. |
| `authSuccess()` | `void` | Signale que l'authentification a réussi. |
| `authFailed()` | `void` | Signale que l'authentification a échoué. |
| `addDataListener(cb)` | `void` | Ajoute un listener interne pour les données entrantes. |
| `addPingListener(cb)` | `void` | Ajoute un listener interne pour les pings. |
| `onStateChange(cb)` | `void` | Ajoute un listener pour les transitions SM couche 2. Callback : `(state, tid, from, event)`. |
| `circuitBreakerInfo(peerId?)` | `object\|null` | Info CB d'un pair : `{ state, nextAttemptTime }`. Par défaut : pair connecté. |

**Propriétés (lecture seule)**

| Propriété | Type | Description |
|-----------|------|-------------|
| `state` | `string` | État courant de la SM couche 2. |
| `isHost` | `boolean` | `true` si le pair local est l'hôte. |
| `myId` | `string` | ID PeerJS local. |
| `myPseudo` | `string` | Pseudo local. |
| `remotePeerId` | `string\|null` | PeerId du pair distant connecté (ou `null`). |

**Callbacks passthrough**

| Callback | Signature | Description |
|----------|-----------|-------------|
| `onIdReady` | `(id: string) => void` | PeerJS est connecté, l'ID est attribué. |
| `onConnected` | `(isHost: boolean) => void` | Connexion authentifiée et prête. |
| `onDisconnected` | `() => void` | Connexion perdue. |
| `onAuthRequired` | `(isHost: boolean) => void` | Authentification requise. |
| `onData` | `(data: object) => void` | Données reçues (listener applicatif). |
| `onError` | `(error: Error) => void` | Erreur réseau. |
| `onPing` | `(latency: number) => void` | Latence mesurée (listener applicatif). |

---

### `P2PSync`

Façade applicative de pacpam. Gère les sessions multiplexées, la présence, la reconnexion et le diagnostic.

```javascript
import { P2PSync } from '@thipages/pacpam';

// Mode simplifié (recommandé)
const sync = new P2PSync({ network: { debug: false }, guardTimeout: 5000 });

// Mode legacy (toujours supporté)
const transport = new PeerTransport(new NetworkManager());
const sync = new P2PSync(transport, { guardTimeout: 5000 });
```

**Constructeur — mode simplifié**

| Param | Type | Défaut | Description |
|-------|------|--------|-------------|
| `options.network` | `object` | `{}` | Options passées au constructeur `NetworkManager` (`debug`, `peerOptions`, etc.). |
| `options.guardTimeout` | `number` | `5000` | Délai (ms) sans données avant que le guard passe à OPEN. |

**Constructeur — mode legacy**

| Param | Type | Défaut | Description |
|-------|------|--------|-------------|
| `transport` | `object` | *(requis)* | Objet implémentant le contrat transport (doit avoir une méthode `send`). |
| `options.guardTimeout` | `number` | `5000` | Délai (ms) sans données avant que le guard passe à OPEN. |

**Méthodes**

| Méthode | Retour | Description |
|---------|--------|-------------|
| `createSession(id, config, handler)` | `void` | Crée une session (hôte). `config` : `{ mode, fps }`. |
| `getSession(id)` | `SessionCtrl\|null` | Retourne le contrôleur d'une session. |
| `endSession(id)` | `void` | Termine une session (hôte). |
| `setPresence(data)` | `void` | Définit les données de présence locales. |
| `feedGuard()` | `void` | Nourrit le guard (appelé automatiquement sur réception de données). |
| `reconnect()` | `object` | Tente une reconnexion vers le dernier pair. Voir ci-dessous. |
| `init(pseudo, appId)` | `void` | Passthrough transport : initialise PeerJS en mode legacy. |
| `init(id)` | `void` | Passthrough transport : initialise PeerJS en mode ID libre (≥ 16 chars). |
| `connect(peerId)` | `void` | Passthrough transport : initie une connexion vers un pair. |
| `disconnect()` | `void` | Passthrough transport : ferme la connexion. |
| `send(data)` | `boolean` | Passthrough transport : envoie des données. |
| `authSuccess()` | `void` | Passthrough transport : signale l'authentification réussie. |
| `authFailed()` | `void` | Passthrough transport : signale l'authentification échouée. |

**Propriétés (lecture seule)**

| Propriété | Type | Description |
|-----------|------|-------------|
| `state` | `string` | État P2PSync : `IDLE`, `CONNECTING`, `CONNECTED`, `DISCONNECTED`. |
| `isConnected` | `boolean` | `true` si P2PSync est CONNECTED. |
| `isHost` | `boolean` | `true` si le pair local est l'hôte. |
| `guardState` | `string\|null` | État du guard : `HALF_OPEN`, `CLOSED`, `OPEN` (ou `null` si inactif). |
| `latency` | `number\|null` | Dernière latence mesurée (ms), ou `null`. |
| `reconnectInfo` | `object\|null` | Info reconnexion pour l'UX. `null` si pas en DISCONNECTED. |
| `presenceSuspended` | `boolean` | `true` si `_presence` est suspendue. |
| `transport` | `PeerTransport` | Accès direct au transport (pour diagnostic L2). |
| `myId` | `string` | Passthrough transport : ID PeerJS local. |
| `myPseudo` | `string\|null` | Passthrough transport : pseudo local (ou `null` en mode ID libre). |
| `remotePeerId` | `string\|null` | Passthrough transport : PeerId du pair distant. |

**Callbacks**

| Callback | Signature | Description |
|----------|-----------|-------------|
| `onStateChange` | `(state, detail) => void` | Transition P2PSync. `detail` : `{ from, to, event, layer2State, layer2Tid, layer2Event }`. |
| `onGuardChange` | `(state, detail) => void` | Transition guard. `detail` : `{ from, to, event }`. |
| `onPeerAbsent` | `() => void` | Guard passe à OPEN (pair absent). Les sessions sync sont automatiquement pausées. |
| `onPeerBack` | `() => void` | Guard revient de OPEN (pair de retour). Les sessions sync reprennent. |
| `onSessionCreate` | `(id, config) => handler` | Guest : P2PSync demande un handler pour la session créée par l'hôte. |
| `onSessionStateChange` | `(sessionId, state) => void` | Transition d'une session. |
| `onPing` | `(latency) => void` | Latence mesurée (ms). |
| `onPresence` | `(data) => void` | Données de présence du pair distant. |
| `onPresenceSuspensionChange` | `(suspended) => void` | `_presence` suspendue/reprise. |
| `onHandlerError` | `(sessionId, method, error) => void` | Erreur capturée dans un appel handler. |
| `onIdReady` | `(id) => void` | Passthrough transport : PeerJS connecté, ID attribué. |
| `onAuthRequired` | `(isHost) => void` | Passthrough transport : authentification requise. |
| `onConnected` | `(isHost) => void` | Passthrough transport : connexion authentifiée. |
| `onDisconnected` | `() => void` | Passthrough transport : connexion perdue. |
| `onError` | `(error) => void` | Passthrough transport : erreur réseau. |
| `onData` | `(data) => void` | Passthrough transport : données applicatives (exclut `_ctrl` et `_s`). |

**Reconnexion manuelle**

`reconnect()` retourne un objet décrivant le résultat :

| Retour | Signification |
|--------|---------------|
| `{ ok: true, peerId }` | Reconnexion lancée. |
| `{ ok: false, reason: 'not_disconnected' }` | P2PSync n'est pas en DISCONNECTED. |
| `{ ok: false, reason: 'no_peer' }` | Aucun pair précédent. |
| `{ ok: false, reason: 'transport_not_ready' }` | Couche 2 pas en READY. |
| `{ ok: false, reason: 'circuit_breaker', retryIn, peerId }` | CB ouvert, `retryIn` ms avant la prochaine tentative. |

`reconnectInfo` retourne les mêmes informations sous forme `{ canReconnect, reason?, retryIn?, peerId? }` sans déclencher la reconnexion.

---

### `SessionCtrl`

Contrôleur de session, reçu par le handler dans `onStart(ctrl)` et accessible via `sync.getSession(id)`.

**Méthodes**

| Méthode | Retour | Description |
|---------|--------|-------------|
| `setFps(n)` | `void` | Change le fps (hôte uniquement). |
| `broadcastState()` | `void` | Envoie `getLocalState()` immédiatement. |
| `sendAction(action)` | `void` | Envoie une action (centralisé, guest uniquement). |
| `sendMessage(payload)` | `void` | Envoie un message (indépendant uniquement). |

**Propriétés (lecture seule)**

| Propriété | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Identifiant de la session. |
| `mode` | `string` | `'centralized'` ou `'independent'`. |
| `fps` | `number` | Fréquence courante. |
| `state` | `string` | État de la session : `IDLE`, `CONNECTING`, `CONNECTED`, `DISCONNECTED`. |

**Handler — contrat duck-typed**

| Méthode | Signature | Rôle |
|---------|-----------|------|
| `onStart(ctrl)` | `(SessionCtrl) => void` | Session CONNECTED. |
| `onEnd()` | `() => void` | Session DISCONNECTED. |
| `getLocalState()` | `() => object` | État local à envoyer. |
| `applyRemoteState(state)` | `(object) => void` | Applique l'état distant. |
| `processAction(action)` | `(object) => void` | Traite une action (centralisé). |
| `onMessage(payload)` | `(object) => void` | Reçoit un message (indépendant). |
| `onPeerAbsent()` | `() => void` | Guard OPEN propagé à la session. |
| `onPeerBack()` | `() => void` | Guard retour propagé à la session. |

Toutes les méthodes sont optionnelles. Les erreurs sont capturées par `#safeCall` et remontées via `sync.onHandlerError`.

---

## Security

### `validateMessage`

Valide un message P2P contre les schémas protocolaires et applicatifs.

```javascript
import { validateMessage, registerMessageSchemas } from '@thipages/pacpam';
```

| Fonction | Signature | Description |
|----------|-----------|-------------|
| `validateMessage(data)` | `(object) => boolean` | Valide type, champs requis, tailles, profondeur. |
| `registerMessageSchemas(schemas)` | `(object) => void` | Enregistre des schémas applicatifs supplémentaires. |
| `sanitizeString(str, maxLength?)` | `(string, number?) => string` | Échappe HTML et caractères de contrôle. Max 1000 chars par défaut. |
| `sanitizeState(state)` | `(object) => object` | Nettoie récursivement toutes les strings d'un objet. |

**Schémas protocolaires intégrés** : `auth`, `ping`, `pong`, `fullState`, `localState`, `action`, `message`, `_ctrl`

**Limites de sécurité** :
- Message max : 50 Ko
- String max : 1000 chars
- Array max : 1000 éléments
- Profondeur objet max : 10

**Enregistrement de schémas applicatifs** :

```javascript
registerMessageSchemas({
  chatMessage: {
    required: ['text'],
    fields: {
      text: { type: 'string', maxLength: 500 }
    }
  }
});
```

---

### `RateLimiter`

Protection DoS par limitation de débit par pair et par type de message.

```javascript
import { rateLimiter, RateLimiter, MESSAGE_RATE_LIMITS } from '@thipages/pacpam';
```

| Export | Type | Description |
|--------|------|-------------|
| `rateLimiter` | `RateLimiter` | Instance singleton. |
| `MESSAGE_RATE_LIMITS` | `object` | Limites par type de message. |

**Méthodes de `RateLimiter`**

| Méthode | Retour | Description |
|---------|--------|-------------|
| `checkLimit(type, peerId)` | `boolean` | `false` si la limite est atteinte. |
| `resetPeer(peerId)` | `void` | Remet à zéro les compteurs d'un pair. |
| `isBlocked(peerId)` | `boolean` | `true` si le pair est bloqué pour spam. |
| `cleanup()` | `void` | Nettoie les compteurs expirés (appelé automatiquement toutes les 30s). |
| `getStats()` | `object` | `{ activeCounters, blockedPeers, totalViolations }` |

**Limites par défaut** :

| Type | Max | Fenêtre |
|------|-----|---------|
| `localState` / `fullState` / `action` | 35 | 1s |
| `auth` | 5 | 10s |
| `ping` / `pong` | 2 | 3s |
| `default` | 10 | 1s |

Après 10 violations en 60s → blocage du pair pendant 60s.

---

### `CircuitBreaker` / `P2PCircuitBreaker`

Pattern circuit breaker pour la résilience des connexions.

```javascript
import { CircuitBreaker, P2PCircuitBreaker } from '@thipages/pacpam';
```

**`CircuitBreaker` — Constructeur**

| Param | Type | Défaut | Description |
|-------|------|--------|-------------|
| `options.maxFailures` | `number` | 3 | Échecs avant ouverture du circuit. |
| `options.resetTimeout` | `number` | 30000 | Durée (ms) en état OPEN avant test. |
| `options.halfOpenAttempts` | `number` | 1 | Tentatives autorisées en HALF_OPEN. |
| `options.monitoringWindow` | `number` | 60000 | Fenêtre (ms) pour le calcul du taux de succès. |

**Méthodes**

| Méthode | Retour | Description |
|---------|--------|-------------|
| `execute(fn, fallback?)` | `Promise<any>` | Exécute `fn` à travers le circuit breaker. |
| `onSuccess()` | `void` | Signale un succès. |
| `onFailure(error)` | `void` | Signale un échec. |
| `getMetrics()` | `object` | `{ state, successRate, totalCalls, consecutiveFailures, nextAttemptIn, ... }` |
| `reset()` | `void` | Réinitialisation manuelle. |
| `open()` | `void` | Ouverture forcée. |
| `isAvailable()` | `boolean` | `true` si CLOSED, HALF_OPEN, ou OPEN avec timeout expiré. |

**`P2PCircuitBreaker`** — Hérite de `CircuitBreaker`, ajoute :

| Méthode | Retour | Description |
|---------|--------|-------------|
| `connect(connectFn)` | `Promise<any>` | Exécute `connectFn(peerId)` à travers le circuit breaker. |
| `getStatusMessage()` | `string` | Message traduit via locale (`errors.CIRCUIT_*`). |

**Machine à états** : `CLOSED` → `OPEN` → `HALF_OPEN` → `CLOSED`

