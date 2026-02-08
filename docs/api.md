# API Reference — @thipages/pacpam

## Core

### `NetworkManager`

Gestion complète d'une connexion P2P WebRTC via PeerJS.

```javascript
import { NetworkManager } from '@thipages/pacpam';
const network = new NetworkManager({ debug: false });
```

**Constructeur**

| Param | Type | Description |
|-------|------|-------------|
| `options.debug` | `boolean` | Active les logs console `[Network]` |

**Méthodes**

| Méthode | Retour | Description |
|---------|--------|-------------|
| `init(pseudo, appId)` | `void` | Initialise PeerJS. L'ID sera `${appId}-${pseudo}`. Le pseudo doit contenir 3 à 10 caractères parmi `A-Z`, `0-9`, `_`, `-` (insensible à la casse). |
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

Voir le [diagramme interactif](state-machine/index.html).

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

Exemple : `t('errors.NETWORK_ERROR')` → `"Erreur réseau."`

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

### `P2PSync`

Synchronisation unifiée temps réel et tour par tour.

```javascript
import { P2PSync } from '@thipages/pacpam';
const sync = new P2PSync({ fps: 30 }); // temps réel
const sync = new P2PSync({ fps: 0 });  // tour par tour
```

**Constructeur**

| Param | Type | Description |
|-------|------|-------------|
| `fps` | `number` | `> 0` : envoi périodique (temps réel). `0` : envoi à la demande (tour par tour). |

**Méthodes**

| Méthode | Retour | Description |
|---------|--------|-------------|
| `setup(isHost, sendCallback, session)` | `void` | Initialise la sync. Démarre la boucle si `fps > 0`. |
| `receiveMessage(data)` | `void` | Traite un message reçu du réseau. |
| `broadcastState()` | `void` | (Hôte) Envoie l'état complet immédiatement. |
| `sendAction(action)` | `void` | (Guest) Envoie une action à l'hôte. |
| `stop()` | `void` | Arrête la synchronisation. |

**Contrat duck-typing `session`**

L'objet `session` doit implémenter :

| Propriété / Méthode | Requis | Description |
|---------------------|--------|-------------|
| `getLocalState()` | oui | Retourne l'état à envoyer. |
| `applyRemoteState(state)` | oui | Applique l'état reçu. |
| `processAction(action)` | non | (Hôte) Traite une action du guest. |
| `isRunning` | oui | `boolean` — la session est active. |

**Types de messages réseau**

| Type | Envoyé par | Contenu |
|------|-----------|---------|
| `fullState` | Hôte | `{ type: 'fullState', state }` |
| `peerState` | Guest | `{ type: 'peerState', state }` |
| `action` | Guest | `{ type: 'action', action }` |

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
| `sanitizeGameState(state)` | `(object) => object` | Nettoie récursivement toutes les strings d'un objet. |

**Schémas protocolaires intégrés** : `auth`, `ping`, `pong`, `fullState`, `peerState`, `action`

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
| `peerState` / `fullState` | 35 | 1s |
| `action` | 10 | 1s |
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

