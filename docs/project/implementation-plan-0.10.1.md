# Plan d'implémentation — v0.10.1

Corrections et améliorations de la couche 3 (P2PSync). Chaque point correspond à un manque identifié dans l'audit (`roadmap-0.10.md`).

Référence : `src/sync/p2p-sync.js`, `src/sync/transport.js`, `src/sync/session.js`, `src/core/network.js`, `src/core/state-runner.js`.

---

## M1 — Détail transition couche 2 dans `onStateChange`

### Problème

`P2PSync.onStateChange` reçoit `{ from, to, event, layer2State }` mais pas l'identifiant (`tid`) de la transition couche 2 qui a provoqué le changement. L'application ne peut pas distinguer c25 (pair parti) de c26 (ping timeout), c28/c29 (erreurs réseau) ou c30 (déconnexion volontaire).

Code actuel (`p2p-sync.js:47-48`) :
```js
this.sm.onTransition = (from, to, event) => {
  this.onStateChange?.(to, { from, to, event, layer2State: transport.state });
};
```

La projection couche 2 → P2PSync (`#mapTransportState`, l.404-428) consomme `(state, fromL2)` mais pas le `tid` ni l'`event` couche 2.

### Option A — Stocker le dernier tid couche 2 et le joindre au detail

Ajouter un champ `#lastL2Transition` mis à jour par le listener `transport.onStateChange`. Quand `sm.onTransition` de P2PSync se déclenche, injecter `layer2Tid` et `layer2Event` dans le `detail`.

**Fichiers** : `p2p-sync.js` (3 lignes modifiées)

**PROS**
- Changement minimal, pas de modification d'API transport
- Le `detail` enrichi suffit pour 100 % des cas d'usage (l'app reçoit `detail.layer2Tid`)
- Compatible avec le code existant (champ additionnel)

**CONS**
- Aucun. La chaîne est entièrement synchrone (listener → stockage → `#mapTransportState` → `sm.send` → `sm.onTransition` dans le même tick JS). Le `tid` stocké est toujours celui qui a déclenché la transition P2PSync.

### Option B — Passer `tid` et `event` couche 2 en argument de `#mapTransportState`

Modifier `#mapTransportState(toL2, fromL2, tidL2, eventL2)` pour propager les infos jusqu'au `sm.send()` via un champ temporaire.

**Fichiers** : `p2p-sync.js` (5 lignes modifiées)

**PROS**
- Lien causal exact : la transition P2PSync connaît précisément la transition couche 2 qui l'a déclenchée
- Pas d'état intermédiaire mutable

**CONS**
- `StateRunner.send()` ne supporte pas de payload — il faudrait un champ temporaire `this.#pendingL2Detail` lu dans `sm.onTransition`, ce qui revient au même pattern que l'option A avec plus de plomberie

### Recommandation

**Option A**. Le cas de transitions couche 2 rapides est négligeable (le listener est synchrone, et `#mapTransportState` est appelé dans le même tick). Le champ `#lastL2Transition` est toujours cohérent au moment où `sm.onTransition` se déclenche.

### Implémentation

```
p2p-sync.js :
  - Ajouter #lastL2Tid = null, #lastL2Event = null
  - Dans le listener transport.onStateChange : stocker tid et event avant #mapTransportState
  - Dans sm.onTransition : ajouter layer2Tid et layer2Event au detail
```

---

## M2 — Guard → handlers de session

### Problème

Quand le guard passe à OPEN (`onPeerAbsent`) ou revient à HALF_OPEN (`onPeerBack`), seuls les callbacks globaux `sync.onPeerAbsent` et `sync.onPeerBack` sont appelés. Les handlers de session ne sont jamais notifiés, alors que l'architecture prévoit `handler.onPeerAbsent?.()` et `handler.onPeerBack?.()`.

Code actuel (`p2p-sync.js:365-368`) :
```js
this.#guard.onTransition = (from, to, event) => {
  this.onGuardChange?.(to, { from, to, event });
  if (to === 'OPEN') this.onPeerAbsent?.();
  if (from === 'OPEN' && to === 'HALF_OPEN') this.onPeerBack?.();
};
```

### Option A — Itérer les sessions dans le callback du guard

Après l'appel aux callbacks globaux, parcourir `this.sessions` et appeler `handler.onPeerAbsent?.()` / `handler.onPeerBack?.()` sur chaque session CONNECTED.

**Fichiers** : `p2p-sync.js` (6 lignes ajoutées dans `#startGuard`)

**PROS**
- Simple, direct, un seul point de changement
- Cohérent avec `#onSyncDisconnected` qui itère déjà les sessions
- Les handlers reçoivent la notification dans le même tick que le callback global

**CONS**
- Mélange la logique guard et la logique session dans `#startGuard`
- Si un handler throw (voir M7), les handlers suivants ne sont pas notifiés

### Option B — Méthode dédiée `#notifyGuardToSessions(event)`

Extraire l'itération dans une méthode privée appelée depuis le callback du guard.

**Fichiers** : `p2p-sync.js` (10 lignes : méthode + 2 appels)

**PROS**
- Séparation des responsabilités
- Réutilisable si le guard émet d'autres événements à l'avenir
- Combinable avec M7 : le try-catch par handler est localisé dans cette méthode

**CONS**
- Aucun.

### Recommandation

**Option B**. La méthode dédiée isole la logique et se combine naturellement avec M7 (try-catch).

### Implémentation

```
p2p-sync.js :
  - Ajouter #notifyGuardToSessions(method) qui itère this.sessions
    et appelle handler[method]?.() sur chaque session CONNECTED (hors _presence)
  - Dans #startGuard, après onPeerAbsent/onPeerBack, appeler
    #notifyGuardToSessions('onPeerAbsent') / #notifyGuardToSessions('onPeerBack')
```

---

## M3 — Signaling lost (c27) — ANNULÉ

### Problème initial

La transition c27 (CONNECTED → CONNECTED, self-loop `SIGNALING_LOST`) n'est pas remontée à P2PSync.

### Décision : ne pas implémenter

c27 est un détail d'infrastructure de la couche 2 (PeerJS / serveur de signaling). Une fois le DataChannel WebRTC établi (P2PSync CONNECTED) :

- Les données circulent directement en P2P, le serveur de signaling n'est plus dans le chemin
- `network.js` gère déjà la reconnexion au serveur de signaling automatiquement (retry après 3s)
- Si la perte de signaling entraîne une vraie perte de données, elle sera détectée par le ping/pong (c26) ou le guard (OPEN)

Remonter c27 à P2PSync reviendrait à exposer un détail d'implémentation PeerJS qui s'auto-résout. L'application n'a rien à en faire.

### Travaux futurs (hors v0.10.1)

Ce constat ouvre deux pistes à plus long terme, notées dans la roadmap :

1. **Détacher le signaling en CONNECTED** — En mode 1-to-1, le serveur de signaling est inutile une fois le DataChannel établi. Couper volontairement la connexion WebSocket (`peer.disconnect()`) allègerait les ressources et libèrerait un slot sur le serveur PeerJS. La reconnexion au serveur ne serait rétablie qu'en cas de besoin (reconnexion P2P). Ce changement touche la SM couche 2 (nouvel état ou option sur `PeerTransport`).

2. **Topologie N > 2 pairs** — Le maintien du signaling en CONNECTED est pertinent dans un modèle multi-pairs (mesh/star) où de nouveaux pairs peuvent rejoindre la session en cours. Ce cas nécessite une refonte du contrat transport (`send(peerId, data)`, `onData(peerId, cb)`) et probablement une façade `MultiPeerSync` distincte de `P2PSync`.

---

## M4+M5 — Circuit breaker, reconnexion, et UX

M4 et M5 sont traités ensemble car ils partagent le même enjeu : donner à P2PSync (la façade) les moyens de piloter et communiquer la reconnexion à l'application.

### Problème

1. L'état du circuit breaker n'est pas exposé. L'application ne peut pas distinguer "connexion en cours" de "bloqué par le disjoncteur", ni afficher un compte à rebours.

2. La transition p5 (DISCONNECTED → CONNECTING, événement `RECONNECT`) est définie mais jamais déclenchée. P2PSync reste en DISCONNECTED jusqu'à un reset manuel.

3. Le circuit breaker est **par peer** (`network.circuitBreakers`, Map). Les échecs vers PeerA n'affectent pas la connexion vers PeerB — et inversement, les tentatives d'un attaquant PeerZ n'impactent pas le CB de PeerA. L'API doit refléter cette isolation en incluant le `peerId` dans les réponses.

### Contexte couche 2 après déconnexion

| Transition | Couche 2 arrive en | Peer local | Reconnexion ? |
|---|---|---|---|
| c25 (pair parti) | READY | vivant | Oui (mais le pair n'est plus là) |
| c26 (ping timeout) | READY | vivant | Oui |
| c28/c29 (erreur réseau) | READY | vivant | Oui |
| c30 (volontaire) | IDLE | détruit | Non |

`reconnect()` n'a de sens que si la couche 2 est en READY.

### Design retenu

**Pas de callback push** pour le CB (over-engineering). **Pas de reconnexion automatique** (l'application contrôle le timing). Toute l'information passe par P2PSync, la façade.

#### Transport (M4) — 2 getters lecture seule

```js
// transport.js
get remotePeerId() { return this.#network.connection?.peer ?? null; }

circuitBreakerInfo(peerId = this.remotePeerId) {
  if (!peerId) return null;
  const cb = this.#network.circuitBreakers.get(peerId);
  if (!cb) return null;
  return { state: cb.sm.current, nextAttemptTime: cb.nextAttemptTime };
}
```

`circuitBreakerInfo` lit directement la Map publique `network.circuitBreakers`. Paramètre optionnel : par défaut le pair connecté, mais P2PSync passe `#lastPeerId` pour les cas post-déconnexion (où `remotePeerId` pourrait ne plus être disponible). Pas besoin d'exposer un getter sur `NetworkManager`.

#### P2PSync (M5) — `reconnect()` + `reconnectInfo`

```js
// Champ privé, stocké quand P2PSync entre en CONNECTED
#lastPeerId = null;

reconnect() {
  if (!this.sm.is('DISCONNECTED'))
    return { ok: false, reason: 'not_disconnected' };
  if (!this.#lastPeerId)
    return { ok: false, reason: 'no_peer' };
  if (this.transport.state !== 'READY')
    return { ok: false, reason: 'transport_not_ready' };

  const cbInfo = this.transport.circuitBreakerInfo;
  if (cbInfo?.state === 'OPEN') {
    const retryIn = Math.max(0, cbInfo.nextAttemptTime - Date.now());
    return { ok: false, reason: 'circuit_breaker', retryIn, peerId: this.#lastPeerId };
  }

  this.sm.send('RECONNECT');  // p5 : DISCONNECTED → CONNECTING
  this.transport.connect(this.#lastPeerId);
  return { ok: true, peerId: this.#lastPeerId };
}

get reconnectInfo() {
  if (!this.sm.is('DISCONNECTED')) return null;
  if (!this.#lastPeerId)
    return { canReconnect: false, reason: 'no_peer' };
  if (this.transport.state !== 'READY')
    return { canReconnect: false, reason: 'transport_not_ready' };

  const cbInfo = this.transport.circuitBreakerInfo;
  if (cbInfo?.state === 'OPEN') {
    const retryIn = Math.max(0, cbInfo.nextAttemptTime - Date.now());
    return { canReconnect: false, reason: 'circuit_breaker', retryIn, peerId: this.#lastPeerId };
  }
  return { canReconnect: true, peerId: this.#lastPeerId };
}
```

#### Raisons de refus

| `reason` | Signification |
|---|---|
| `not_disconnected` | P2PSync n'est pas en DISCONNECTED |
| `no_peer` | Aucun peer précédent connu |
| `transport_not_ready` | Couche 2 pas en READY (peer détruit après c30) |
| `circuit_breaker` | CB OPEN pour ce peer, `retryIn` = délai en ms |

#### Usage UX typique

```js
sync.onStateChange = (state, detail) => {
  if (state === 'DISCONNECTED') {
    if (detail.layer2Tid === 'c25') {
      showOverlay('Pair parti', ['Retour']);
    } else if (detail.layer2Tid !== 'c30') {
      const info = sync.reconnectInfo;
      if (info.canReconnect) {
        showOverlay(`Connexion perdue avec ${info.peerId}`, ['Reconnecter', 'Abandonner']);
      } else if (info.reason === 'circuit_breaker') {
        showOverlay(`Réessai dans ${Math.ceil(info.retryIn / 1000)}s`, ['Abandonner']);
      }
    }
  }
};

btnReconnect.onclick = () => {
  const result = sync.reconnect();
  if (!result.ok && result.reason === 'circuit_breaker') {
    showMessage(`Bloqué, réessai dans ${Math.ceil(result.retryIn / 1000)}s`);
  }
};
```

### Implémentation

```
transport.js :
  - Ajouter get remotePeerId() { return this.#network.connection?.peer ?? null; }
  - Ajouter get circuitBreakerInfo() : lit network.circuitBreakers.get(remotePeerId)

p2p-sync.js :
  - Ajouter #lastPeerId = null
  - Dans sm.onTransition, quand to === 'CONNECTED' :
    this.#lastPeerId = this.transport.remotePeerId;
  - Ajouter reconnect() et get reconnectInfo() (voir design ci-dessus)
```

---

## M6 — onPing (proxy RTT)

### Problème

Le RTT (latence ping/pong) est exposé par `transport.onPing` et `transport.addPingListener()`, mais pas par P2PSync. L'application qui utilise la façade P2PSync n'a pas accès au RTT sans accéder directement au transport.

Code actuel (`p2p-sync.js:73`) :
```js
transport.addPingListener(() => this.feedGuard());
```

Le callback reçoit `(latency)` mais la valeur est ignorée.

### Option A — Callback `sync.onPing`

Ajouter `this.onPing = null` et câbler le listener existant pour appeler `this.onPing?.(latency)`.

**Fichiers** : `p2p-sync.js` (3 lignes)

**PROS**
- Minimal, cohérent avec l'API existante (tous les callbacks sont sur `sync`)
- L'application reçoit la latence brute à chaque pong

**CONS**
- Appelé toutes les 3 secondes (PING_INTERVAL) — potentiellement verbeux si l'app ne s'y intéresse pas
- Mais c'est un callback opt-in (null par défaut), donc pas de coût si non utilisé

### Option B — Propriété `sync.latency` (dernière valeur)

Stocker la dernière latence mesurée dans `this.latency` et laisser l'app la lire quand elle veut.

**Fichiers** : `p2p-sync.js` (3 lignes)

**PROS**
- Pas de callback supplémentaire
- L'app lit la valeur à son rythme

**CONS**
- Pas de notification de mise à jour
- L'app ne sait pas quand la valeur change (doit poller ou combiner avec un autre événement)

### Option C — Les deux

**Fichiers** : `p2p-sync.js` (4 lignes)

**PROS**
- Complet : notification push + lecture synchrone
- Même pattern que `presenceData` (donnée stockée + callback de notification)

**CONS**
- Marginalement plus de code

### Recommandation

**Option C**. Le coût est négligeable (4 lignes) et couvre les deux usages (affichage temps réel + lecture ponctuelle).

### Implémentation

```
p2p-sync.js :
  - Ajouter this.onPing = null et this.latency = null dans le constructeur
  - Modifier le listener ping (l.73) :
    transport.addPingListener((latency) => {
      this.feedGuard();
      this.latency = latency;
      this.onPing?.(latency);
    });
```

---

## M7 — Exceptions handlers (try-catch)

### Problème

Aucun try-catch autour des appels aux méthodes des handlers de session. Une exception dans `getLocalState()`, `onMessage()`, `processAction()`, `applyRemoteState()`, `onStart()` ou `onEnd()` crash :

- La boucle sync (setInterval dans `#startSessionSync`, l.233-243)
- Le routage des messages (`#handleSessionMessage`, l.331-358)
- L'activation/destruction de session (`#activateSession`, `#destroySession`)
- Les notifications guard (si M2 est implémenté)

De plus, `StateRunner.send()` n'a aucun try-catch autour des callbacks `exit`, `action`, `entry`, `onTransition`, `onEmit` (l.28-36). Une exception dans une action d'état laisse la SM dans un état incohérent (le `current` est déjà modifié).

### Option A — Try-catch localisés dans P2PSync uniquement

Envelopper chaque appel `handler.XXX()` dans un try-catch avec log console.

**8 points à protéger** dans `p2p-sync.js` :
1. `handler.onStart(ctrl)` — l.132
2. `handler.onEnd()` — l.138
3. `handler.onEnd()` — l.164
4. `handler.getLocalState()` — l.237 (boucle sync)
5. `handler.processAction(action)` — l.341
6. `handler.getLocalState()` — l.344 (auto-broadcast après action)
7. `handler.applyRemoteState(state)` — l.350, l.353
8. `handler.onMessage(payload)` — l.356

**2 points** dans `session.js` :
9. `handler.processAction(action)` — l.99 (prédiction locale dans `sendAction`)
10. `handler.getLocalState()` — l.80 (dans `broadcastState`)

**Fichiers** : `p2p-sync.js` (16 lignes de try-catch), `session.js` (4 lignes)

**PROS**
- Granulaire : chaque appel est protégé individuellement
- L'erreur est logguée avec le contexte (nom de la session, méthode qui a échoué)
- La boucle sync continue de tourner même si un handler throw
- Pas de changement d'API

**CONS**
- Répétitif (8+ blocs try-catch similaires)
- Si un `getLocalState()` throw, le message n'est pas envoyé — le pair distant ne reçoit rien (dégradation silencieuse)

### Option B — Helper `#safeCall(handler, method, ...args)` + callback `onHandlerError`

Factoriser les try-catch dans un helper privé. Ajouter un callback `sync.onHandlerError` pour que l'application puisse logger/réagir.

**Fichiers** : `p2p-sync.js` (10 lignes helper + 1 callback + remplacement des 8 appels), `session.js` (importation du pattern ou duplication du helper)

**PROS**
- DRY : un seul try-catch, réutilisé partout
- L'app est notifiée des erreurs handler (monitoring, debug)
- Facile à tester unitairement (le helper est isolable)

**CONS**
- Légère indirection
- `session.js` a besoin du même helper — soit duplication, soit refactoring (passer le helper au SessionCtrl)

### Option C — Try-catch dans `StateRunner.send()` également

Étendre la protection aux callbacks de la SM (`exit`, `action`, `entry`, `onTransition`, `onEmit`).

**Fichiers** : `state-runner.js` (10 lignes), `p2p-sync.js` et `session.js` (comme option B)

**PROS**
- Protège toutes les couches (pas seulement les handlers applicatifs)
- Si une `entry` action throw, la SM ne se retrouve pas dans un état incohérent

**CONS**
- `StateRunner` est utilisé par toutes les SM (couche 1, 2, 3, CB) — un try-catch dans `send()` masquerait les bugs dans le code de la lib elle-même
- Les actions des SM internes *devraient* être sans erreur (elles sont écrites par la lib, pas par l'utilisateur)
- Une erreur dans une action SM est un bug de la lib → il vaut mieux la laisser remonter

### Recommandation

**Option B**. Le helper `#safeCall` + `onHandlerError` est DRY et observable. On ne touche **pas** à `StateRunner` (option C rejetée) : les actions SM internes sont de la responsabilité de la lib et ne doivent pas être silencieusement avalées.

Pour `session.js`, le plus simple est que `SessionCtrl` reçoive le helper via son constructeur (il reçoit déjà `sendFn` et `onFpsChange` — un `safeFn` de plus est cohérent).

### Implémentation

```
p2p-sync.js :
  - Ajouter this.onHandlerError = null dans le constructeur
  - Ajouter #safeCall(sessionId, handler, method, ...args) :
    try { return handler[method]?.(...args); }
    catch (e) {
      console.error(`[P2PSync] Erreur handler ${sessionId}.${method}:`, e);
      this.onHandlerError?.(sessionId, method, e);
    }
  - Remplacer les 8 appels directs par #safeCall(session.id, handler, 'onStart', ctrl), etc.
  - Pour getLocalState, gérer le retour undefined en cas d'erreur (ne pas envoyer)

session.js :
  - SessionCtrl reçoit un 5e argument safeFn (ou utilise un try-catch local)
  - Protéger processAction (l.99) et getLocalState (l.80) dans broadcastState/sendAction
```

---

## Ordre d'implémentation recommandé

| Ordre | Manque | Justification |
|-------|--------|---------------|
| 1 | **M7** — try-catch handlers | Fondation : protège contre les crashs, nécessaire avant M2 |
| 2 | **M1** — detail transition L2 | Simple, enrichit le debug | ✅ fait |
| 3 | **M6** — onPing | 4 lignes, aucune dépendance |
| 4 | **M2** — guard → handlers | Dépend de M7 (les handlers sont protégés) | ✅ fait |
| 5 | ~~**M3**~~ | Annulé |
| 6 | **M4+M5** — CB + reconnexion | Traités ensemble, M4 est un pré-requis de M5 |

---

## Résumé des fichiers impactés

| Fichier | Manques | Nature |
|---------|---------|--------|
| `src/sync/p2p-sync.js` | M1, M2, M4+M5, M6, M7 | Callbacks, helper safeCall, reconnect, reconnectInfo |
| `src/sync/transport.js` | M4+M5 | Getters circuitBreakerInfo, remotePeerId |
| `src/sync/session.js` | M7 | Protection appels handler dans SessionCtrl |

Fichiers **inchangés** : `network.js`, `state-runner.js`, `connection-states.js`, `p2p-sync-states.js`, `guard-states.js`, `circuit-breaker.js`, `message-validator.js`, `rate-limiter.js`.
