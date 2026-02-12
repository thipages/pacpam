# Plan d'implémentation — v0.10.0

Ce plan transforme le `P2PSync` actuel (130 lignes, sync monolithique) en la façade multi-sessions documentée dans `docs/architecture.md`.

L'app de test `pages/v0.10.0/` évolue à chaque phase pour permettre la validation manuelle. Elle utilise deux **custom elements `<peer-instance>`** côte à côte dans la même page — pas besoin d'ouvrir deux onglets.

Référence : `docs/architecture.md` (spécification complète), `docs/project/roadmap-0.10.md` (vue d'ensemble).

---

## Phase 0 — Nettoyage vocabulaire (breaking changes)

**Objectif** : éliminer toute référence à « game » dans la lib et aligner le vocabulaire sur l'architecture.

**Aucun changement fonctionnel** — uniquement des renommages.

### 0.1 `sanitizeGameState` → `sanitizeState`

Fichiers :
- `src/security/message-validator.js` : renommer la fonction + JSDoc (`"Sanitise un objet état"`)
- `src/core/network.js` (l.8, l.333) : import + appel
- `src/index.js` (l.12) : export

### 0.2 `peerState` → `localState`

Fichiers :
- `src/security/message-validator.js` (l.40–44) : renommer le schéma `peerState` en `localState`
- `src/security/rate-limiter.js` (l.7) : clé `'peerState'` → `'localState'`
- `src/sync/p2p-sync.js` (l.68) : `type: 'peerState'` → `type: 'localState'`

### 0.3 Suppression `isNetworkGame`

Fichier :
- `src/sync/p2p-sync.js` (l.36) : supprimer `session.isNetworkGame = true`

(La propriété n'est plus pertinente — c'est P2PSync qui gère le réseau, pas la session/handler.)

### Test utilisateur (`pages/v0.10.0/`)

Deux `<peer-instance>` (Pair A / Pair B) côte à côte. Chaque instance a son propre `NetworkManager`, ses boutons, son log. `app.js` câble les IDs croisés (quand A init → B peut connecter).

**Vérifier** :
- [ ] Init Pair A → Init Pair B → Connect depuis B → les deux passent en CONNECTED
- [ ] `localState` envoyé automatiquement à la connexion (visible dans les logs des deux côtés)
- [ ] `sanitizeState` est bien appelé (console `[Network]`)
- [ ] Aucune référence à `peerState`, `sanitizeGameState` ou `isNetworkGame` dans `src/`

### Commit phase 0

Un seul commit, breaking change clairement identifié.

---

## Phase 1 — Transport interface

**Objectif** : créer le wrapper qui découple P2PSync du `NetworkManager`.

### Nouveau fichier : `src/sync/transport.js`

Le transport adapte `NetworkManager` au contrat défini dans `architecture.md` :

```js
// Contrat minimal que P2PSync attend
Transport {
    connect(peerId)
    disconnect()
    send(data)               // → boolean
    onData(callback)
    onStateChange(callback)  // (state, transitionId) => void
    isConnected()
    isHost                   // lecture seule
}
```

Implémentation : classe `PeerTransport` qui prend un `NetworkManager` et adapte ses callbacks.

**Mappages** :
- `transport.connect(peerId)` → `network.connectTo(peerId)` (+ `network.init()` si nécessaire)
- `transport.send(data)` → `network.send(data)`
- `transport.onData(cb)` → `network.onData = cb`
- `transport.onStateChange(cb)` → `network.sm.onTransition` (wrappé pour exposer state + transitionId)
- `transport.isConnected()` → `network.isConnected()`
- `transport.isHost` → `network.isHost`

Le transport porte aussi l'authentification (`authSuccess`, `authFailed`, `onAuthRequired`), les callbacks d'erreur (`onError`), et les infos d'identité (`onIdReady`, `myId`). Toutes ces responsabilités passent à travers le transport — P2PSync ne voit que le contrat.

### Test utilisateur (`pages/v0.10.0/`)

`<peer-instance>` utilise `PeerTransport` au lieu de `NetworkManager` directement. Le comportement observable reste identique.

**Vérifier** :
- [ ] `transport.onStateChange` reçoit bien les transitions couche 2 (état + ID transition)
- [ ] `transport.send()` / `transport.onData()` fonctionnent
- [ ] `transport.isHost` correct des deux côtés
- [ ] `transport.isConnected()` renvoie `true` après auth
- [ ] `transport.disconnect()` ramène à l'état initial
- [ ] Le log affiche chaque transition avec son ID (`c1`, `c2`, …, `c18`)

### Commit phase 1

`transport.js` + app de test mise à jour.

---

## Phase 2 — SM P2PSync (groupes + projection)

**Objectif** : P2PSync possède sa propre SM, projection de la couche 2.

### Nouveau fichier : `src/sync/p2p-sync-states.js`

Définition de la SM groupée, compatible `StateRunner` :

```
États : IDLE, CONNECTING, CONNECTED, DISCONNECTED
```

Transitions (IDs préfixés `p1`–`p6`) :

| ID | De | Vers | Événement |
|----|-----|------|-----------|
| p1 | IDLE | CONNECTING | CONNECT |
| p2 | CONNECTING | CONNECTED | TRANSPORT_CONNECTED |
| p3 | CONNECTING | IDLE | TRANSPORT_FAILED |
| p4 | CONNECTED | DISCONNECTED | TRANSPORT_LOST |
| p5 | DISCONNECTED | CONNECTING | RECONNECT |
| p6 | DISCONNECTED | IDLE | RESET |

### Modification : `src/sync/p2p-sync.js`

Réécriture du constructeur. Le P2PSync v0.10 :
1. Reçoit un transport (pas un fps)
2. Crée sa SM (`StateRunner` + `p2pSyncStates`)
3. Écoute `transport.onStateChange` pour mapper les transitions couche 2 → groupes P2PSync
4. Expose `sync.onStateChange = (state, group, detail) => {}`

**Mappage couche 2 → groupe** :

```js
const STATE_GROUPS = {
    IDLE:             'idle',
    INITIALIZING:     'connecting',
    READY:            'connecting',
    CONNECTING:       'connecting',
    AUTHENTICATING:   'connecting',
    CONNECTED:        'connected'
};
```

Quand couche 2 passe à CONNECTED → `this.sm.send('TRANSPORT_CONNECTED')`.
Quand couche 2 quitte CONNECTED (vers IDLE/READY) et P2PSync était CONNECTED → `this.sm.send('TRANSPORT_LOST')`.
Quand couche 2 échoue et P2PSync était CONNECTING → `this.sm.send('TRANSPORT_FAILED')`.

### Test utilisateur (`pages/v0.10.0/`)

`<peer-instance>` instancie `P2PSync(transport)`. L'UI affiche le groupe P2PSync et l'état couche 2 en parallèle.

**Vérifier** :
- [ ] Affichage du groupe : `idle` → `connecting` → `connected`
- [ ] L'état couche 2 exact est visible dans le détail (`INITIALIZING`, `READY`, `CONNECTING`, `AUTHENTICATING`, `CONNECTED`)
- [ ] Le transition ID est remonté (`c1`, …, `c18`, `p1`, …)
- [ ] Déconnexion → le groupe passe à `disconnected` (pas `idle`)
- [ ] Distinction `idle` (jamais connecté) vs `disconnected` (connexion perdue)

### Commit phase 2

SM P2PSync fonctionnelle, projection des transitions, callback `onStateChange`, app mise à jour.

---

## Phase 3 — Guard présence

**Objectif** : SM de présence (HALF_OPEN / CLOSED / OPEN) active en état CONNECTED.

### Nouveau fichier : `src/sync/guard-states.js`

Définition de la SM guard, compatible `StateRunner` :

```
États : HALF_OPEN, CLOSED, OPEN
```

Transitions (IDs préfixés `g1`–`g4`) :

| ID | De | Vers | Événement |
|----|-----|------|-----------|
| g1 | HALF_OPEN | CLOSED | DATA_RECEIVED |
| g2 | CLOSED | OPEN | TIMEOUT |
| g3 | OPEN | HALF_OPEN | DATA_RECEIVED |
| g4 | CLOSED | CLOSED | DATA_RECEIVED (self-loop, reset du timer) |

### Intégration dans P2PSync

- Créer un `StateRunner(guardStates, 'HALF_OPEN')` à l'entrée de CONNECTED
- Chaque donnée entrante (quel que soit le flux) → `guard.send('DATA_RECEIVED')`
- Timer configurable (par défaut 5s) → `guard.send('TIMEOUT')` si aucune donnée
- Guard détruit à la sortie de CONNECTED
- Transitions guard → `sync.onPeerAbsent` / `sync.onPeerBack` + notification aux handlers

### Test utilisateur (`pages/v0.10.0/`)

L'UI affiche l'état du guard en plus du groupe P2PSync. Pas encore de sessions — le guard est nourri par les ping/pong de la couche 2 qui passent par le transport.

**Ajouter à l'UI** : indicateur guard (`HALF_OPEN` / `CLOSED` / `OPEN`).

**Vérifier** :
- [ ] Connexion → guard passe de `HALF_OPEN` à `CLOSED` (premières données reçues)
- [ ] Les deux onglets connectés : guard reste `CLOSED` (ping/pong réguliers)
- [ ] Mettre le réseau en throttle/offline (DevTools) → guard passe à `OPEN` après le timeout
- [ ] Rétablir → guard passe à `HALF_OPEN` puis `CLOSED`
- [ ] `sync.onPeerAbsent` / `sync.onPeerBack` sont appelés (visible dans le log)
- [ ] Déconnexion → guard est détruit (plus de logs guard)

**Note** : le guard est alimenté à cette phase par les données brutes du transport (ping/pong). En phase 6 (`_presence`), le heartbeat applicatif prendra le relais pour les scénarios sans ping couche 2.

### Commit phase 3

Guard fonctionnel, notifications, app mise à jour.

---

## Phase 4 — Session infrastructure

**Objectif** : le cœur du multiplexage — Session, SessionCtrl, protocole _ctrl.

### Nouveau fichier : `src/sync/session.js`

**Classe `Session`** :
- SM propre : `StateRunner` avec les 4 états (IDLE/CONNECTING/CONNECTED/DISCONNECTED)
- Transitions (IDs préfixés `s1`–`s4`) :

| ID | De | Vers | Événement |
|----|-----|------|-----------|
| s1 | IDLE | CONNECTING | CREATE |
| s2 | CONNECTING | CONNECTED | READY |
| s3 | CONNECTED | DISCONNECTED | END |
| s4 | CONNECTING | DISCONNECTED | END |

- Propriétés : `id`, `mode`, `fps`, `handler`, `ctrl`
- Pas de logique de sync ici — juste le cycle de vie

**Classe `SessionCtrl`** :
- Référence vers sa `Session` et le `sendCallback` de P2PSync
- Méthodes : `setFps(n)`, `broadcastState()`, `sendAction(action)`, `sendMessage(message)`
- Propriétés lecture seule : `fps`, `mode`, `id`
- Validation : `sendAction` refuse si pas centralisé ou si hôte, `sendMessage` refuse si pas indépendant, `setFps` refuse si pas hôte

### Intégration dans P2PSync : gestion des sessions

**Registre** : `this.sessions = new Map()` (id → Session)

**Côté hôte — `sync.createSession(id, config, handler)`** :
1. Crée la `Session` avec SM en IDLE
2. `session.sm.send('CREATE')` → CONNECTING
3. Envoie `{ _ctrl: 'sessionCreate', id, mode, fps }` via transport
4. Attend `{ _ctrl: 'sessionReady', id }` du guest
5. `session.sm.send('READY')` → CONNECTED
6. Crée le `SessionCtrl`, appelle `handler.onStart?.(ctrl)`
7. Si `fps > 0`, démarre la boucle continue de cette session

**Côté guest — réception `sessionCreate`** :
1. Appelle `sync.onSessionCreate(id, config)` → le callback retourne un handler
2. Crée la `Session` en IDLE → `sm.send('CREATE')` → CONNECTING
3. Envoie `{ _ctrl: 'sessionReady', id }`
4. `session.sm.send('READY')` → CONNECTED
5. Crée le `SessionCtrl`, appelle `handler.onStart?.(ctrl)`
6. Si `fps > 0`, démarre la boucle continue

**`sync.getSession(id)`** : retourne le `SessionCtrl` (même objet que celui donné au handler).

**Routage des messages entrants** :
- Messages avec `_ctrl` → traitement interne (sessionCreate, sessionReady, sessionSetFps, sessionEnd)
- Messages avec `_s` → lookup `this.sessions.get(data._s)` → dispatch au handler selon `data.type`

**Destruction** :
- Hôte envoie `{ _ctrl: 'sessionEnd', id }` → les deux pairs nettoient la session
- Perte de connexion (P2PSync → DISCONNECTED) → toutes les sessions passent à DISCONNECTED, `handler.onEnd?.()` appelé sur chaque session

### Validation des messages par session

Chaque message reçu avec `_s` est validé contre la configuration de la session cible :
- `action` accepté uniquement en centralisé, venant du guest
- `fullState` accepté uniquement en centralisé, venant de l'hôte
- `message` accepté uniquement en indépendant
- `localState` accepté uniquement si `fps > 0` (ou émis par `broadcastState`)

### Test utilisateur (`pages/v0.10.0/`)

Première apparition des sessions. Chaque `<peer-instance>` crée les sessions selon son rôle (hôte = `createSession`, guest = `onSessionCreate`). Les handlers sont d'abord des stubs qui loguent.

**Ajouter au custom element** : section listant les sessions actives avec leur état (IDLE/CONNECTING/CONNECTED).

**Vérifier** :
- [ ] Hôte : les deux sessions passent de IDLE → CONNECTING → CONNECTED
- [ ] Guest : `onSessionCreate` appelé deux fois (`counter`, `status`)
- [ ] Guest : les sessions passent aussi à CONNECTED
- [ ] `handler.onStart(ctrl)` appelé des deux côtés, `ctrl` reçu
- [ ] `sync.getSession('counter')` retourne le même objet que le `ctrl` du handler
- [ ] Déconnexion → toutes les sessions passent à DISCONNECTED, `onEnd` appelé
- [ ] Reconnexion → l'hôte recrée les sessions (nouveau handshake)
- [ ] Les messages `_ctrl` sont visibles dans le log (sessionCreate, sessionReady)

### Commit phase 4

Sessions fonctionnelles, protocole _ctrl, routage, SessionCtrl. C'est le commit le plus important.

---

## Phase 5 — Logique de sync par session

**Objectif** : boucle continue, setFps, envoi automatique, prédiction.

### Boucle continue (par session)

Chaque session CONNECTED avec `fps > 0` a son propre `setInterval` :

```js
// Centralisé — hôte
getLocalState() → envoie { _s: id, type: 'fullState', state }
// Centralisé — guest
getLocalState() → envoie { _s: id, type: 'localState', state }
// Indépendant — les deux
getLocalState() → envoie { _s: id, type: 'localState', state }
```

### `setFps(n)` (SessionCtrl)

1. Vérifie que l'appelant est l'hôte
2. Met à jour `session.fps`
3. Si `n > 0` : démarre/redémarre le `setInterval`
4. Si `n === 0` : arrête le `setInterval`
5. Envoie `{ _ctrl: 'sessionSetFps', id, fps: n }` au guest
6. Le guest met à jour son `session.fps` et démarre/arrête sa boucle

### Envoi automatique `fullState` après `processAction` (centralisé)

En mode centralisé, quand l'hôte reçoit une action :
1. Appelle `handler.processAction(action)`
2. Appelle `handler.getLocalState()`
3. Envoie `{ _s: id, type: 'fullState', state }` au guest

### Prédiction guest (sendAction)

```js
sendAction(action) {
    handler.processAction?.(action);             // prédiction locale
    transport.send({ _s: id, type: 'action', action }); // envoi à l'hôte
}
```

### `broadcastState()` (SessionCtrl)

- Centralisé (hôte) : `getLocalState()` → envoie `fullState`
- Indépendant (les deux) : `getLocalState()` → envoie `localState`

### Test utilisateur (`pages/v0.10.0/`)

Les handlers deviennent fonctionnels dans chaque `<peer-instance>`. Le compteur et le statut marchent de bout en bout, visibles côte à côte.

**Vérifier — session `counter` (centralisé, fps=0)** :
- [ ] Guest clique +1 → compteur incrémenté immédiatement (prédiction locale)
- [ ] Hôte reçoit l'action, traite via `processAction`, renvoie le `fullState`
- [ ] Guest reçoit le `fullState` — la valeur est confirmée (ou corrigée si divergence)
- [ ] Hôte clique sur « broadcastState » → le guest reçoit l'état courant sans action

**Vérifier — session `status` (indépendant, fps=0)** :
- [ ] Pair A envoie un message → Pair B le reçoit via `onMessage`
- [ ] Bidirectionnel : les deux pairs peuvent envoyer/recevoir

**Vérifier — `setFps` dynamique** :
- [ ] Bouton « Toggle fps (0 ↔ 5) » sur la session `counter`
- [ ] Passage à fps=5 : le compteur s'auto-synchronise en continu (fullState de l'hôte toutes les 200ms)
- [ ] Le guest envoie son `localState` en continu
- [ ] Retour à fps=0 : la boucle s'arrête, seules les actions discrètes circulent
- [ ] Le log montre `_ctrl: sessionSetFps` envoyé par l'hôte

**Vérifier — validation** :
- [ ] Guest tente `sendAction` sur la session `status` (indépendante) → refusé (console)
- [ ] Guest tente `sendMessage` sur la session `counter` (centralisée) → refusé (console)
- [ ] Guest tente `setFps` → refusé (hôte seul)

### Commit phase 5

Logique de sync complète — la communication fonctionne de bout en bout.

---

## Phase 6 — `_presence` (session interne)

**Objectif** : heartbeat applicatif + données de présence.

### Implémentation

`_presence` est une session indépendante à fps 0.5, créée automatiquement (sans handshake _ctrl) sur les deux pairs quand P2PSync passe en CONNECTED.

**Handler interne `_presence`** :
```js
{
    getLocalState() {
        return sync.presenceData ?? {};
    },
    applyRemoteState(state) {
        sync.onPresence?.(state);
    }
}
```

**API publique** :
- `sync.setPresence(data)` → stocke les données à envoyer au prochain tick
- `sync.onPresence = (presence) => {}` → callback réception

### Suspension automatique

À chaque changement de fps d'une session (création, setFps, destruction) :
1. Parcourir toutes les sessions applicatives actives
2. Si au moins une a un `fps > 0.5` → `_presence.ctrl.setFps(0)` (suspension)
3. Sinon → `_presence.ctrl.setFps(0.5)` (reprise)

Note : la suspension arrête le heartbeat, mais le guard de présence continue de recevoir les données des sessions actives (qui fournissent un heartbeat plus fréquent).

### Test utilisateur (`pages/v0.10.0/`)

Ajouter au custom element un champ « présence du pair » et un input pour changer sa propre présence.

**Vérifier — présence de base** :
- [ ] Connexion → `_presence` démarre automatiquement (visible dans le log)
- [ ] `sync.setPresence({ typing: true })` → l'autre pair reçoit `{ typing: true }` dans `sync.onPresence`
- [ ] Les données de présence s'affichent dans l'UI

**Vérifier — suspension** :
- [ ] Sessions à fps=0 uniquement → `_presence` active (heartbeat toutes les 2s visible dans le log)
- [ ] Passer `counter` à fps=5 → `_presence` suspendue (plus de heartbeat dans le log)
- [ ] Le guard reste `CLOSED` (nourri par les `localState` de la session continue)
- [ ] Repasser `counter` à fps=0 → `_presence` reprend automatiquement

**Vérifier — interaction guard / présence** :
- [ ] Toutes les sessions à fps=0, couper la connexion réseau du pair (DevTools offline) → guard passe à `OPEN` après ~5s (plus de heartbeat `_presence`)
- [ ] `onPeerAbsent` appelé dans le log
- [ ] Rétablir → `onPeerBack` appelé

### Commit phase 6

Présence fonctionnelle, suspension, API `setPresence`/`onPresence`.

---

## Phase 7 — Validation et rate limiting

**Objectif** : adapter la couche de sécurité aux messages multi-sessions.

### `message-validator.js`

Ajouter le schéma `message` (nouveau type de message de données) :

```js
message: {
    required: ['payload'],
    fields: {
        payload: { type: 'object', maxDepth: 5 }
    }
}
```

Adapter `validateMessage` pour accepter le champ `_s` (identifiant de session) et `_ctrl` (contrôle) sur les messages entrants. Le champ `_s` est une string courte (max 50 caractères). Le champ `_ctrl` est une string parmi les valeurs connues.

Ajouter un schéma de validation pour les messages `_ctrl` :

```js
// Messages de contrôle internes
_ctrl_sessionCreate: { required: ['id', 'mode', 'fps'], fields: { ... } }
_ctrl_sessionReady:  { required: ['id'], fields: { ... } }
_ctrl_sessionSetFps: { required: ['id', 'fps'], fields: { ... } }
_ctrl_sessionEnd:    { required: ['id'], fields: { ... } }
```

### `rate-limiter.js`

Ajouter les limites pour le type `message` :

```js
'message': { max: 20, window: 1000 }   // Messages discrets
```

### Test utilisateur (`pages/v0.10.0/`)

Ajouter un bouton « Envoyer message invalide » qui tente d'envoyer des données malformées pour vérifier la sécurité.

**Vérifier** :
- [ ] Envoyer un message avec un type inconnu → rejeté par le validateur (console `[Security]`)
- [ ] Envoyer un `_s` inexistant → rejeté par P2PSync (session inconnue)
- [ ] Envoyer un message trop gros (> 50KB) → rejeté
- [ ] Spammer 50 messages `status` en 1s → rate limiter bloque après 20
- [ ] Les messages normaux (counter, status) continuent de fonctionner avec la validation stricte

### Commit phase 7

Validation étendue, rate limiting à jour.

---

## Phase 8 — API publique et exports

**Objectif** : API propre, exports nettoyés.

### `src/index.js`

```js
// Core (inchangé)
export { NetworkManager } from './core/network.js'
export { loadLocale, t } from './core/locale.js'
export { hashPassword, verifyHash, createAuthMessage } from './core/auth.js'
export { connectionStates, initial as connectionInitial } from './core/connection-states.js'
export { StateRunner } from './core/state-runner.js'

// Sync (mis à jour)
export { P2PSync } from './sync/p2p-sync.js'
export { PeerTransport } from './sync/transport.js'

// Security (mis à jour)
export { validateMessage, sanitizeString, sanitizeState, registerMessageSchemas } from './security/message-validator.js'
export { RateLimiter, rateLimiter, MESSAGE_RATE_LIMITS } from './security/rate-limiter.js'
export { CircuitBreaker, P2PCircuitBreaker } from './security/circuit-breaker.js'
```

L'usage typique devient :

```js
import { NetworkManager, P2PSync, PeerTransport, loadLocale } from '@thipages/pacpam';

const network = new NetworkManager();
const transport = new PeerTransport(network);
const sync = new P2PSync(transport);
```

`NetworkManager` reste exporté pour les cas avancés (configuration fine, accès aux callbacks de bas niveau). P2PSync est la façade recommandée.

### Test utilisateur (`pages/v0.10.0/`)

Nettoyage final des imports. `peer-instance.js` utilise exclusivement les exports publics de `index.js`.

**Vérifier** :
- [ ] `peer-instance.js` n'importe plus depuis des chemins internes (`./core/...`, `./sync/session.js`)
- [ ] Tout passe par `import { ... } from '../../src/index.js'`
- [ ] Les deux pairs fonctionnent à l'identique après le nettoyage

### Commit phase 8

Exports finalisés, app nettoyée.

---

## Résumé des fichiers

### Fichiers modifiés

| Fichier | Phase | Nature |
|---------|-------|--------|
| `src/security/message-validator.js` | 0, 7 | Renommages + schéma `message` + `_s`/`_ctrl` |
| `src/security/rate-limiter.js` | 0, 7 | `peerState` → `localState` + type `message` |
| `src/core/network.js` | 0 | Import `sanitizeState` |
| `src/sync/p2p-sync.js` | 0, 2–6 | Réécriture complète |
| `src/index.js` | 0, 8 | Exports mis à jour |
| `pages/v0.10.0/*` | 0–8 | Évolution progressive de l'app de test |

### Fichiers créés

| Fichier | Phase | Rôle |
|---------|-------|------|
| `src/sync/transport.js` | 1 | `PeerTransport` — wrapper NetworkManager |
| `src/sync/p2p-sync-states.js` | 2 | SM P2PSync (6 transitions, `p1`–`p6`) |
| `src/sync/guard-states.js` | 3 | SM guard présence (4 transitions, `g1`–`g4`) |
| `src/sync/session.js` | 4 | `Session` + `SessionCtrl` |

### Fichiers inchangés

`src/core/state-runner.js`, `src/core/connection-states.js`, `src/core/auth.js`, `src/core/locale.js`, `src/core/constants.js`, `src/security/circuit-breaker.js`, `src/security/circuit-breaker-states.js`, `locales/`

---

## Évolution de `pages/v0.10.0/` par phase

Architecture : deux `<peer-instance>` côte à côte (Pair A / Pair B). Le custom element encapsule un pair complet et évolue à chaque phase.

| Phase | Ce que chaque `<peer-instance>` sait faire | Nouveauté dans le custom element |
|-------|------------------------|-------------|
| 0 | Connexion brute, envoi `localState` | Init/connect, compteur brut, messages bruts, log SM |
| 1 | Idem via `PeerTransport` | Log des transitions avec IDs (interne, même UI) |
| 2 | P2PSync avec groupes d'état | Affichage groupe (`idle`/`connecting`/`connected`/`disconnected`) |
| 3 | Guard présence actif | Indicateur guard (`HALF_OPEN`/`CLOSED`/`OPEN`) |
| 4 | Sessions créées, handshake _ctrl | Section sessions avec leur état |
| 5 | Compteur + statut fonctionnels, setFps | Compteur via `sendAction`, messages via `sendMessage`, bouton toggle fps |
| 6 | Présence intégrée | Champ présence pair, indicateur suspension |
| 7 | Validation stricte | Bouton « message invalide » |
| 8 | Imports nettoyés | Aucune nouveauté UI |

---

## Ordre des commits

| # | Phase | Message |
|---|-------|---------|
| 1 | 0 | `Renommer sanitizeGameState, peerState, supprimer isNetworkGame (breaking v0.10.0)` |
| 2 | 1 | `Ajouter PeerTransport — interface transport pour P2PSync` |
| 3 | 2 | `SM P2PSync : projection groupée de la couche 2` |
| 4 | 3 | `Guard présence : HALF_OPEN / CLOSED / OPEN sur CONNECTED` |
| 5 | 4 | `Sessions multiplexées : Session, SessionCtrl, protocole _ctrl` |
| 6 | 5 | `Logique de sync : boucle fps, setFps, processAction auto, prédiction` |
| 7 | 6 | `Session _presence : heartbeat, suspension automatique, API` |
| 8 | 7 | `Validation et rate limiting multi-sessions` |
| 9 | 8 | `API publique v0.10.0 : exports nettoyés` |
