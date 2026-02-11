# Changelog — pacpam

## v0.10.0 (en cours)

Réécriture de P2PSync : façade multi-sessions, projection SM, transport découplé.

Ref: `docs/architecture.md`, `docs/implementation-plan-0.10.md`

---

### Phase 0 — Nettoyage vocabulaire

**Breaking changes** — renommages sans changement fonctionnel.

| Avant | Après | Fichiers |
|-------|-------|----------|
| `sanitizeGameState()` | `sanitizeState()` | message-validator.js, network.js, index.js |
| type `peerState` | type `localState` | message-validator.js, rate-limiter.js, p2p-sync.js |
| `session.isNetworkGame = true` | supprimé | p2p-sync.js |

Plus aucune référence à « game » dans `src/`.

---

### Phase 1 — PeerTransport

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

L'app de test (`peer-instance.js`) utilise désormais `PeerTransport` au lieu de `NetworkManager` directement — aucun accès à `.sm.` ou aux internals du network.

---

### Phase 2 — SM P2PSync

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

**Mappage couche 2 → P2PSync** :
- Couche 2 quitte IDLE → `CONNECT`
- Couche 2 atteint CONNECTED → `TRANSPORT_CONNECTED`
- Couche 2 quitte CONNECTED → `TRANSPORT_LOST` (+ `RESET` si retour direct en IDLE)
- Couche 2 retourne en IDLE depuis un état intermédiaire → `TRANSPORT_FAILED` ou `RESET`
- Couche 2 retourne en READY (échec auth, timeout) → P2PSync reste en CONNECTING

**Distinction clé** : `IDLE` (jamais connecté ou reset) vs `DISCONNECTED` (connexion perdue).

API exposée : `sync.onStateChange = (state, detail) => {}`, `sync.state`, `sync.isHost`, `sync.isConnected`.

---

### Phase 3 — Guard présence

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

**Alimentation** : le guard est nourri par toute donnée entrante (messages applicatifs via `addDataListener` + ping/pong via `addPingListener`). Le timer se réinitialise à chaque donnée reçue (défaut : 5s).

**Intégration PeerTransport** : `onData` et `onPing` deviennent multi-listener (`addDataListener`, `addPingListener`) pour que P2PSync et l'application puissent écouter simultanément. Le setter `onData =` / `onPing =` reste disponible pour l'application (marqué `_app`).

**Callbacks** : `sync.onGuardChange`, `sync.onPeerAbsent`, `sync.onPeerBack`, `sync.guardState`.

---

### Phase 4 — Sessions multiplexées

**Nouveau fichier** : `src/sync/session.js`

Deux classes : `Session` (cycle de vie + SM) et `SessionCtrl` (contrôleur exposé aux handlers et à l'application).

**SM Session** (4 transitions, `s1`–`s4`) :

| ID | De | Vers | Événement |
|----|----|------|-----------|
| s1 | IDLE | CONNECTING | CREATE |
| s2 | CONNECTING | CONNECTED | READY |
| s3 | CONNECTED | DISCONNECTED | END |
| s4 | CONNECTING | DISCONNECTED | END |

**SessionCtrl** — méthodes : `setFps(n)`, `broadcastState()`, `sendAction(action)`, `sendMessage(payload)`. Validation intégrée (sendAction refusé si pas centralisé/si hôte, sendMessage refusé si pas indépendant, setFps refusé si pas hôte).

**Protocole `_ctrl`** — messages de contrôle entre pairs :
- `sessionCreate` (hôte → guest) : crée la session côté guest
- `sessionReady` (guest → hôte) : confirme la création
- `sessionSetFps` (hôte → guest) : change le fps
- `sessionEnd` (hôte → guest) : détruit la session

**Routage dans P2PSync** :
- Messages avec `_ctrl` → traitement interne
- Messages avec `_s` → dispatch au handler de la session (`action`, `fullState`, `localState`, `message`)
- Auto-broadcast : après `processAction` sur l'hôte, `getLocalState()` → `fullState` envoyé au guest
- Prédiction locale : `sendAction` appelle `handler.processAction` avant d'envoyer

**Validateur** : ajout des types `message` et `_ctrl` aux schémas. Champs `_s` et `_ctrl` acceptés sur tous les messages. Rate limiting ajouté pour `message` et `_ctrl`.

**Destruction** : perte de connexion → toutes les sessions passent en DISCONNECTED, `handler.onEnd()` appelé. Côté hôte, les SM sont réinitialisées pour reconnexion.

**App de test** : les boutons +1/−1 utilisent `counterCtrl.sendAction()`, les messages utilisent `statusCtrl.sendMessage()`. Section « Sessions » affiche l'état de chaque session.

---

### Phase 5 — Logique de sync

Boucle continue, `setFps`, `broadcastState`, prédiction guest — le tout validé bout en bout.

**Boucle continue** : chaque session CONNECTED avec `fps > 0` a son propre `setInterval`. Centralisé : hôte envoie `fullState`, guest envoie `localState` (inputs). Indépendant : les deux envoient `localState`.

**`setFps(n)`** : hôte seul peut changer le fps à chaud. Envoie `_ctrl:sessionSetFps` au guest, les deux redémarrent leur boucle. Le guest applique le changement sans renvoyer le `_ctrl` (pas de boucle infinie).

**`broadcastState()`** : envoi ponctuel de l'état (centralisé : hôte → `fullState`, indépendant : les deux → `localState`). Utile hors réception d'action (début de partie, timer, etc.).

**Auto-broadcast** : après chaque `processAction` sur l'hôte, `getLocalState()` → `fullState` envoyé au guest automatiquement.

**Prédiction guest** : `sendAction` appelle `handler.processAction` localement avant d'envoyer au réseau.

**App de test** : boutons Broadcast et Toggle fps (hôte uniquement). Boutons +1/−1 désactivés côté hôte (centralisé). Indicateur fps dans le titre de section.

---

### Phase 6 — Présence interne

**Nouveau** : session interne `_presence` — heartbeat applicatif + données de présence.

**`_presence`** : session indépendante à fps 0.5, créée automatiquement (sans handshake `_ctrl`) sur les deux pairs quand P2PSync passe en CONNECTED. Chaque tick envoie `presenceData` via `localState`, le pair distant reçoit via `onPresence`.

**API publique** :
- `sync.setPresence(data)` — stocke les données à envoyer au prochain tick
- `sync.onPresence = (presence) => {}` — callback réception
- `sync.onPresenceSuspensionChange = (suspended) => {}` — notification changement
- `sync.presenceSuspended` — getter lecture seule

**Suspension automatique** : quand au moins une session applicative a un `fps > 0.5`, `_presence` est suspendue (fps=0). Le guard de présence continue de fonctionner, nourri par les données des sessions actives. Quand toutes les sessions reviennent à `fps ≤ 0.5`, `_presence` reprend automatiquement.

**App de test** : section « Présence » avec affichage pair distant, input de présence, indicateur suspension.

---

### Phase 7 — Validation et rate limiting

**Validation _ctrl par sous-type** : les messages `_ctrl` sont désormais validés spécifiquement selon leur sous-type (`sessionCreate`, `sessionReady`, `sessionSetFps`, `sessionEnd`). Un sous-type inconnu est rejeté.

**Validation `_s`** : le champ `_s` (identifiant de session) est validé comme string ≤ 50 caractères quand présent.

**Tests unitaires** : correction des anciens noms (`peerState` → `localState`, `sanitizeGameState` → `sanitizeState`). Ajout de 13 tests couvrant `_ctrl` par sous-type, `message`, `_s`, et les rejets associés. Total : 26 tests.

**App de test** : bouton « Envoyer invalide » qui envoie 3 messages malformés (type inconnu, _ctrl inconnu, champ requis manquant) — vérifier les rejets dans la console du pair distant.

---

### Phase 8 — API publique et exports

Nettoyage des exports `src/index.js` : suppression des modules internes (`p2pSyncStates`, `guardStates`, `Session`, `SessionCtrl`) qui ne font pas partie de l'API publique.

Exports conservés : `NetworkManager`, `PeerTransport`, `P2PSync` (+ core, security). `P2PSync` est la façade recommandée ; `NetworkManager` reste disponible pour les cas avancés.

L'app de test (`peer-instance.js`) utilise exclusivement les exports publics de `index.js`.
