# Architecture — couches réseau de pacpam

## Vue d'ensemble

pacpam empile trois couches indépendantes. Chaque couche ne connaît que celle juste en dessous.

```
┌─────────────────────────────────────────────────┐
│  Application                                     │
│  (chat, jeu, collaboration)                      │
├─────────────────────────────────────────────────┤
│  Couche 3 — Protocole                            │
│  P2PSync : façade applicative, sessions multiples│
│  mode (centralisé/indépendant) × fps             │
├─────────────────────────────────────────────────┤
│  Couche 2 — Transport sécurisé                   │
│  NetworkManager : SM, auth, ping, circuit breaker│
│  send/receive : send(data), onData(data)         │
├─────────────────────────────────────────────────┤
│  Couche 1 — Canal de données                     │
│  PeerJS DataConnection (→ RTCDataChannel)        │
│  send/receive : conn.send(data), conn.on('data') │
├─────────────────────────────────────────────────┤
│  Couche 0 — WebRTC                               │
│  RTCPeerConnection + canal de signalisation      │
└─────────────────────────────────────────────────┘
```

---

## Couche 0 — WebRTC (navigateur)

WebRTC est une API navigateur (standard W3C) qui permet la communication directe entre deux navigateurs, sans serveur intermédiaire pour les données.

### Composants

| Composant | Rôle |
|-----------|------|
| `RTCPeerConnection` | Établit la connexion pair-à-pair (échange SDP, négociation ICE) |
| `RTCDataChannel` | Canal bidirectionnel de données arbitraires (texte ou binaire) |
| Serveur STUN | Aide les pairs à découvrir leur IP publique (traversée NAT) |
| Serveur TURN | Relais de dernier recours si la connexion directe échoue |
| Serveur de signalisation | Échange les métadonnées de connexion (SDP, candidats ICE) avant l'établissement P2P |

### Établissement d'une connexion WebRTC

```
Pair A                     Signalisation              Pair B
  │                            │                         │
  │── create offer (SDP) ─────→│                         │
  │                            │── forward offer ───────→│
  │                            │←── answer (SDP) ────────│
  │←── forward answer ────────│                         │
  │                            │                         │
  │── ICE candidates ────────→│── forward ──────────────→│
  │←── forward ───────────────│←── ICE candidates ──────│
  │                            │                         │
  │←─────── connexion P2P directe (DTLS chiffré) ──────→│
```

**SDP** (Session Description Protocol) : décrit les capacités média/données de chaque pair.
**ICE** (Interactive Connectivity Establishment) : trouve le meilleur chemin réseau entre les deux pairs (direct, via STUN, ou via TURN).
**DTLS** : chiffrement obligatoire sur tout canal WebRTC — les données transitent chiffrées de bout en bout.

### Ce que WebRTC ne fait pas

- **Pas de découverte** : les pairs doivent se trouver via un mécanisme externe (signalisation)
- **Pas d'authentification applicative** : DTLS chiffre le canal, mais n'importe qui peut se connecter
- **Pas de structure de données** : `RTCDataChannel` transporte des octets bruts

Référence : [MDN — WebRTC API](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)

---

## Couche 1 — PeerJS DataConnection

PeerJS est une bibliothèque JavaScript qui simplifie WebRTC. Elle masque toute la complexité de la couche 0 (SDP, ICE, STUN/TURN, signalisation) derrière une API minimaliste.

### Ce que PeerJS apporte

| Aspect | WebRTC brut | PeerJS |
|--------|-------------|--------|
| Signalisation | À implémenter (WebSocket, HTTP...) | Serveur PeerJS inclus (cloud ou self-hosted) |
| Établissement | ~50 lignes (offer/answer/ICE) | `peer.connect(id)` |
| Identité | Aucune (IP + port) | ID textuel (`peer.id`) |
| Envoi | `channel.send(buffer)` | `conn.send(objet)` (sérialisation auto) |
| Réception | `channel.onmessage = (e) => ...` | `conn.on('data', fn)` |

### DataConnection et RTCDataChannel

`DataConnection` est un wrapper fin autour de `RTCDataChannel`. Chaque appel à `peer.connect()` ou chaque connexion entrante crée exactement un `RTCDataChannel` encapsulé dans un objet `DataConnection` :

```
DataConnection (PeerJS)
   │
   ├── RTCPeerConnection        ← créé et configuré automatiquement
   │      └── RTCDataChannel    ← le vrai canal de données P2P
   │
   ├── Sérialisation            ← encode/décode les objets JS (JSON, MessagePack, etc.)
   └── Événements               ← traduit les événements WebRTC bruts en API PeerJS
```

L'API PeerJS mappe directement sur l'API WebRTC sous-jacente :

| PeerJS (`DataConnection`) | WebRTC (`RTCDataChannel`) | Différence |
|--------------------------|--------------------------|------------|
| `conn.send(objet)` | `channel.send(buffer)` | PeerJS sérialise automatiquement les objets JS |
| `conn.on('data', fn)` | `channel.onmessage = fn` | PeerJS désérialise automatiquement |
| `conn.on('open', fn)` | `channel.onopen = fn` | Identique (canal prêt) |
| `conn.on('close', fn)` | `channel.onclose = fn` | Identique (canal fermé) |
| `conn.close()` | `channel.close()` | PeerJS ferme aussi le `RTCPeerConnection` |

En résumé : `DataConnection` **est** un `RTCDataChannel` avec la signalisation et la sérialisation en plus. Quand pacpam envoie un objet via `conn.send()`, cet objet est sérialisé, transmis à travers le `RTCDataChannel` chiffré (DTLS), et désérialisé de l'autre côté — le tout de pair à pair, sans serveur intermédiaire.

### API utilisée par pacpam

```js
// Créer un pair avec un ID
const peer = new Peer(monId);

// Attendre que le serveur de signalisation confirme
peer.on('open', (id) => { /* prêt */ });

// Se connecter à un pair distant
const conn = peer.connect(autreId);

// Recevoir une connexion entrante
peer.on('connection', (conn) => { /* conn entrante */ });

// Événements sur la connexion
conn.on('open', () => { /* canal ouvert */ });
conn.on('data', (data) => { /* données reçues */ });
conn.on('close', () => { /* fermée */ });
conn.on('error', (err) => { /* erreur */ });

// Envoyer / fermer
conn.send(data);
conn.close();
```

### Deux canaux distincts

PeerJS opère sur deux canaux réseau indépendants :

| Canal | Technologie | Direction | Durée de vie |
|-------|------------|-----------|-------------|
| **Signalisation** | WebSocket → serveur PeerJS | Client ↔ Serveur | Toute la session |
| **Données** | RTCDataChannel | Pair ↔ Pair (direct) | Par connexion |

Ces canaux sont indépendants : si la signalisation tombe, le canal de données P2P continue. C'est pourquoi pacpam gère `SIGNALING_LOST` comme un self-loop en état CONNECTED — la conversation n'est pas interrompue.

Référence : [PeerJS Documentation](https://peerjs.com/docs/)

---

## Couche 2 — Transport sécurisé (NetworkManager)

`NetworkManager` transforme le `DataConnection` PeerJS en une connexion fiable, authentifiée et supervisée.

### Responsabilités

| Responsabilité | Mécanisme |
|---------------|-----------|
| **Cycle de vie** | Machine à états (6 états, 30 transitions) — impossible d'envoyer si pas CONNECTED |
| **Authentification** | Échange mutuel de hash SHA-256 au début de chaque connexion |
| **Supervision** | Ping/pong périodique — détection de pair mort (PING_TIMEOUT) |
| **Protection** | Circuit breaker par pair — bloque les tentatives répétées vers un pair défaillant |
| **Validation** | Schéma de message, taille max, sanitisation, rate limiting par pair |
| **Rôle** | Hôte (reçoit la connexion) / invité (initie la connexion) — déterminé automatiquement |

### Machine à états connexion

```
IDLE ──→ INITIALIZING ──→ READY ──→ CONNECTING ──→ AUTHENTICATING ──→ CONNECTED
  ↑            │             ↑↑          │ ↑               │ ↑            │ ↑
  └────────────┘             ││          └─┘               └─┘            └─┘
  (erreurs serveur)          │└──────────────────────────────┘            (SIGNALING_LOST
                             └──────────(erreurs, timeouts)───────────────  = self-loop)
```

Chaque transition a un ID stable (`c1`–`c30`), défini dans `connection-states.js`.

### Contrat exposé à la couche supérieure

```js
// Envoyer des données (objet JS quelconque)
network.send(data);        // → boolean

// Recevoir des données
network.onData = (data) => { ... };

// État et rôle
network.isConnected();     // → boolean
network.isHost;            // → boolean

// Fermer
network.disconnect();
```

C'est le même contrat que `conn.send()` / `conn.on('data')` de PeerJS, enrichi de garanties (authentifié, supervisé, validé).

---

## Couche 3 — Protocole (P2PSync)

`P2PSync` est la **façade applicative** de pacpam. C'est la seule couche que l'application utilise directement — les couches inférieures ne sont jamais exposées.

P2PSync gère des **sessions** : des canaux logiques multiplexés sur le transport unique fourni par la couche 2. Chaque session a son propre mode de communication et son propre handler applicatif. Plusieurs sessions coexistent simultanément sur la même connexion.

### Niveaux d'autorité

L'autorité dans pacpam s'exerce à deux niveaux distincts.

#### Niveau administratif (connexion + sessions) — toujours centralisé

L'**hôte** gère l'administration. Ce rôle est déterminé à l'établissement de la connexion (couche 2) et ne change jamais :

- **Hôte** = celui qui reçoit la connexion (`peer.on('connection')`)
- **Guest** = celui qui l'initie (`peer.connect(peerId)`)

L'hôte décide de la création et de la destruction de toutes les sessions, quel que soit leur mode. Même dans une session indépendante où les deux pairs sont égaux pour les données, c'est l'hôte qui décide de l'existence de cette session.

#### Niveau données — configurable par session

Chaque session définit son propre **mode** pour l'échange de données :

| Mode | Qui fait foi | Flux de données | Statut |
|------|-------------|----------------|--------|
| **centralisé** | L'hôte détient l'état de vérité | Guest → action → Hôte → le fullState autoritaire → Guest | Défini |
| **indépendant** | Chacun son état, pas de conflit | Pair → Pair (chacun envoie le sien, bidirectionnel) | Défini |
| **collaboratif** | Personne — convergence (CRDT/OT) | Pair → Pair (même donnée, conflits possibles) | Réservé |

### Deux dimensions de communication

Une session est caractérisée par son **mode** et son **fps**.

**fps** — paramètre qui contrôle la boucle continue :

| fps | Comportement |
|-----|-------------|
| `0` | **Discret seul** — envois à la demande uniquement |
| `> 0` | **Discret + continu** — la boucle de synchronisation tourne à la fréquence donnée, ET les envois ponctuels restent possibles |

Une session supporte **toujours** les envois discrets. Le `fps` contrôle uniquement si une boucle continue de synchronisation d'état tourne en plus. Le fps est une **propriété de la session**, pas du pair : les deux pairs tournent au même fps. Seul l'hôte peut le changer via `setFps(n)` (niveau administratif), ce qui envoie un `_ctrl: 'sessionSetFps'` pour synchroniser le guest :

```
fps = 0   →  chat, tour par tour (discret seul)
fps = 30  →  on lance le temps réel (la boucle démarre, le discret reste disponible)
fps = 0   →  retour au tour par tour (la boucle s'arrête)
```

**Important** : la **sémantique** du discret dépend du mode de la session :

| Mode | Discret signifie… | Méthode | Direction |
|------|-------------------|---------|-----------|
| **centralisé** | **Action** — commande traitée par l'hôte | `sendAction()` → `processAction()` | Guest → Hôte (asymétrique) |
| **indépendant** | **Message** — échange libre entre pairs | `sendMessage()` → `onMessage()` | Pair → Pair (symétrique) |

C'est pourquoi un chat (indépendant) et un jeu (centralisé) nécessitent des sessions distinctes : un message de chat envoyé dans une session centralisée serait traité comme une action de jeu. Chaque session a son propre handler et sa propre sémantique.

En revanche, deux fonctions de même mode **peuvent** être fusionnées dans une seule session. Une session indépendante à fps > 0 supporte à la fois l'état continu (`getLocalState` / `applyRemoteState`) et les messages discrets (`onMessage`). Par exemple, une session "cursors" (indépendant, fps 15) peut aussi transporter des messages de chat via `onMessage`, sans nécessiter une session "chat" séparée. Le découpage en sessions est un **choix applicatif** — séparation des préoccupations vs économie de sessions — pas une contrainte de P2PSync.

Les deux dimensions se combinent :

| | fps = 0 (discret) | fps > 0 (discret + continu) |
|---|---|---|
| **centralisé** | Jeu tour par tour, quiz | Jeu temps réel |
| **indépendant** | Chat, notifications | Curseurs, présence |
| **collaboratif** | *(réservé)* | *(réservé)* |

### Concept de session

Une **session** est un canal logique, identifié par un nom unique, défini par son mode et son fps. C'est l'unité de base de toute communication à travers P2PSync.

```
Session {
    id      : string                                          // identifiant unique
    mode    : 'centralisé' | 'indépendant' | 'collaboratif'  // mode données
    fps     : number                                          // 0 = discret seul, > 0 = + boucle continue
    handler : SessionHandler                                  // objet duck-typed fourni par l'application
}
```

L'application peut créer **autant de sessions que nécessaire**. Elles sont multiplexées sur le même transport physique (un seul `RTCDataChannel`) grâce à l'identifiant de session porté par chaque message.

### Exemples concrets de sessions

#### Scénario 1 — Application de chat simple

```
P2PSync
   └── "chat"    indépendant (fps 0)
```

Une seule session. Les deux pairs envoient et reçoivent des messages librement. Pas de boucle continue. Le handler implémente simplement `onMessage(msg)`.

#### Scénario 2 — Jeu tour par tour avec chat

```
P2PSync
   ├── "chat"    indépendant (fps 0)
   └── "game"    centralisé  (fps 0)
```

Deux sessions. Le chat est indépendant du jeu. Dans la session "game", le guest envoie ses coups (actions discrètes), l'hôte les valide via `processAction(action)`, met à jour l'état du plateau, et renvoie le `fullState` au guest via `broadcastState()`.

#### Scénario 3 — Jeu temps réel avec chat et curseurs

```
P2PSync
   ├── "chat"      indépendant (fps 0)
   ├── "game"      centralisé  (fps 30)
   └── "cursors"   indépendant (fps 15)
```

Trois sessions simultanées. La session "game" tourne à 30 fps : l'hôte envoie le `fullState` autoritaire à chaque tick, le guest envoie son `localState` (inputs), et les actions discrètes (commandes du joueur) restent possibles à tout moment. La session "cursors" partage la position de chaque pair à 15 fps.

Note : "chat" et "cursors" sont toutes deux indépendantes — elles pourraient être fusionnées en une seule session (les messages de chat passeraient par `onMessage` dans le handler "cursors"). Ici elles sont séparées par choix de clarté, pas par contrainte technique. En revanche, "game" (centralisé) ne peut pas absorber le chat : un message y serait traité comme une action de jeu.

#### Scénario 4 — Quiz / trivia

```
P2PSync
   ├── "quiz"    centralisé  (fps 0)
   └── "chat"    indépendant (fps 0)
```

L'hôte envoie les questions, le guest envoie les réponses, l'hôte envoie les résultats. Tout est discret (fps 0). Le chat permet la discussion libre en parallèle.

#### Scénario 5 — Éditeur collaboratif

```
P2PSync
   ├── "editor"     indépendant (fps 5)
   └── "presence"   indépendant (fps 2)
```

La session "editor" synchronise l'état à 5 fps (position du curseur, sélection), et les opérations discrètes (insertion, suppression de texte) sont envoyées à la demande en plus de la boucle. La session "presence" partage les indicateurs de statut (en train de taper, en ligne/absent) à faible fréquence.

Note : un éditeur véritablement collaboratif (deux pairs modifiant le même document) nécessiterait le mode **collaboratif** (réservé, hors scope). Ici le mode indépendant convient car chaque pair a son propre curseur et ses propres indicateurs.

### Cycle de vie des sessions

#### Qui crée les sessions ?

**L'hôte crée toutes les sessions** (niveau administratif, toujours centralisé). Même pour les sessions indépendantes où les deux pairs sont égaux pour les données, c'est l'hôte qui décide de leur existence.

Ce choix est cohérent avec le fonctionnement des couches inférieures : il y a toujours un pair qui « accueille » et un pair qui « rejoint ». L'hôte est le point de coordination naturel.

#### Protocole de création

Dès que la connexion est établie (couche 2 → CONNECTED), P2PSync démarre automatiquement la session interne `_presence` sur les deux pairs, **avant** toute session applicative. L'hôte crée ensuite les sessions applicatives :

```
Hôte                                        Guest
  │                                            │
  │  ┄┄ connexion CONNECTED ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
  │                                            │
  │  _presence CONNECTED (auto, les deux pairs) │  _presence CONNECTED
  │  → heartbeat 0.5 fps démarre              │  → heartbeat 0.5 fps démarre
  │                                            │
  │── { _ctrl: 'sessionCreate',               │
  │     id: 'chat',                            │
  │     mode: 'indépendant',                   │
  │     fps: 0 }  ──────────────────────────→ │
  │                                            │  app.createHandler('chat', config)
  │                                            │  → handler instancié
  │← { _ctrl: 'sessionReady', id: 'chat' } ──│
  │                                            │
  │  session "chat" CONNECTED                  │  session "chat" CONNECTED
  │                                            │
  │── { _ctrl: 'sessionCreate',               │
  │     id: 'game',                            │
  │     mode: 'centralisé',                    │
  │     fps: 30 }  ──────────────────────────→ │
  │                                            │  app.createHandler('game', config)
  │← { _ctrl: 'sessionReady', id: 'game' } ──│
  │                                            │
  │  session "game" CONNECTED (boucle 30fps)   │  session "game" CONNECTED
  │  _presence SUSPENDUE (game fps > 0.5)      │  _presence SUSPENDUE
```

Les messages préfixés `_ctrl` sont des messages de contrôle internes à P2PSync. Ils ne sont jamais exposés aux handlers. La session `_presence` n'utilise pas ce protocole — elle est démarrée implicitement par P2PSync sur les deux pairs sans handshake.

#### API de création

Côté **hôte** — crée la session et fournit son handler :

```js
sync.createSession('game', { mode: 'centralisé', fps: 30 }, gameHandler);
```

Côté **guest** — enregistre un callback de notification. P2PSync l'appelle à chaque `sessionCreate` reçu. Le callback retourne le handler :

```js
sync.onSessionCreate = (id, config) => {
    // config = { mode, fps }
    return createHandler(id, config);
};
```

P2PSync envoie automatiquement `sessionReady` une fois le handler instancié.

#### États d'une session

```
                sessionCreate envoyé/reçu
                        │
  IDLE ──────────→ CONNECTING ──────→ CONNECTED ──────→ DISCONNECTED
                        │   sessionReady    │                     │
                        │                   │  sessionEnd         │
                        │                   └───────────────────→ │
                        │        connexion perdue                 │
                        └────────────────────────────────────────→│
```

| État | Description |
|------|-------------|
| **IDLE** | La session n'existe pas encore |
| **CONNECTING** | Hôte : `sessionCreate` envoyé, en attente du `sessionReady`. Guest : handler en cours d'instanciation |
| **CONNECTED** | Les deux pairs ont un handler actif. Les messages de données circulent. La boucle continue tourne (si applicable). Le guard de présence surveille le pair : si le guard passe à OPEN (pair absent), les handlers en sont notifiés (`onPeerAbsent()` / `onPeerBack()`) sans que la session ne quitte l'état CONNECTED |
| **DISCONNECTED** | Session terminée. Handlers nettoyés. Peut être recréée plus tard si nécessaire |

#### Destruction

Trois causes de fin de session :

| Cause | Initiateur | Effet |
|-------|-----------|--------|
| **Fin explicite** | L'hôte envoie `{ _ctrl: 'sessionEnd', id }` | Les deux pairs détruisent le handler de cette session |
| **Déconnexion** | Couche 2 (perte de connexion) | Toutes les sessions sont détruites simultanément |
| **Reconnexion** | Couche 2 (nouvelle connexion) | L'hôte recrée les sessions nécessaires (nouveau handshake complet) |

Les sessions sont liées à la connexion. Aucune session ne survit à une déconnexion. Si les pairs se reconnectent, l'hôte doit recréer chaque session.

#### Création dynamique

Les sessions ne sont pas toutes créées au début de la connexion. L'hôte peut créer une session **à tout moment** :

```
Connexion établie
  │
  ├── _presence CONNECTED (automatique, les deux pairs)
  │
  ├── Hôte crée "chat" (immédiat)
  │
  │   ... les pairs discutent ... (_presence active, seul heartbeat)
  │
  ├── Hôte crée "game" fps 30 (quand les joueurs sont prêts)
  │   → _presence SUSPENDUE (game fps 30 > 0.5)
  │
  │   ... partie en cours + chat simultané ...
  │
  ├── Hôte détruit "game" (partie terminée)
  │   → _presence REPRISE (plus de session fps > 0.5)
  │
  │   ... retour au chat seul ...
  │
  └── Déconnexion (toutes les sessions détruites, y compris _presence)
```

### Flux de données par type de session

#### Session centralisée, fps = 0 (jeu tour par tour)

```
Guest                                          Hôte
  │                                              │
  │── { type: 'action', action } ───────────────→│  handler.processAction(action)
  │   handler.processAction(action)  ←prédiction │  state = handler.getLocalState()
  │                                              │
  │←── { type: 'fullState', state } ────────────│  (le fullState autoritaire)
  │  handler.applyRemoteState(state)             │
```

Le guest envoie une action, applique une **prédiction locale** (appel optionnel à `processAction` côté guest), puis reçoit le `fullState` autoritaire de l'hôte qui corrige toute divergence.

#### Session centralisée, fps > 0 (jeu temps réel)

```
Guest                                          Hôte
  │                                              │
  │── { type: 'action', action } ───────────────→│  (ponctuel, discret)
  │                                              │
  │── { type: 'localState', state } ───────────→│  (boucle fps — inputs guest)
  │←── { type: 'fullState', state } ────────────│  (boucle fps — le fullState autoritaire)
  │                                              │
  │── { type: 'localState', state } ───────────→│  (tick suivant)
  │←── { type: 'fullState', state } ────────────│  (tick suivant)
```

Deux flux superposés : les actions discrètes du guest et la boucle continue. Le guest envoie son `localState` (inputs) et l'hôte renvoie le `fullState` autoritaire à chaque tick.

#### Session indépendante, fps = 0 (chat)

```
Pair A                                        Pair B
  │                                              │
  │── { type: 'message', payload } ────────────→│  handler.onMessage(payload)
  │                                              │
  │  handler.onMessage(payload)                  │
  │←── { type: 'message', payload } ────────────│
```

Symétrique. Les deux pairs envoient et reçoivent librement, sans notion d'autorité sur les données.

#### Session indépendante, fps > 0 (curseurs, présence)

```
Pair A                                        Pair B
  │                                              │
  │── { type: 'localState', state } ───────────→│  handler.applyRemoteState(state)
  │←── { type: 'localState', state } ───────────│  (boucle fps)
  │                                              │
  │  handler.applyRemoteState(state)             │
  │── { type: 'localState', state } ───────────→│  (tick suivant)
  │←── { type: 'localState', state } ───────────│  (tick suivant)
```

Symétrique. Chaque pair appelle `handler.getLocalState()` à chaque tick et envoie le résultat. Chaque pair reçoit l'état distant et appelle `handler.applyRemoteState()`.

### Handler — contrat duck-typed

L'application fournit un **handler** pour chaque session. C'est un objet JavaScript dont P2PSync appelle les méthodes selon le type de session. Toutes les méthodes sont optionnelles — seules celles pertinentes pour la session sont appelées.

| Méthode | Signature | Rôle |
|---------|-----------|------|
| `getLocalState()` | `() → object` | Retourne l'état local à envoyer (boucle continue ou `broadcastState()`) |
| `applyRemoteState(state)` | `(object) → void` | Applique l'état reçu du pair distant |
| `processAction(action)` | `(object) → void` | Traite une action reçue (hôte) ou prédiction locale (guest) |
| `onMessage(message)` | `(object) → void` | Reçoit un message discret (sessions indépendantes) |
| `onStart(ctrl)` | `(SessionCtrl) → void` | Session passe en CONNECTED. Reçoit l'objet de contrôle |
| `onEnd()` | `() → void` | Session passe en DISCONNECTED (nettoyage) |
| `onPeerAbsent()` | `() → void` | Guard : le pair ne répond plus (présence perdue) |
| `onPeerBack()` | `() → void` | Guard : le pair répond à nouveau |

#### Quelles méthodes pour quel type ?

Le tableau indique **quand** P2PSync appelle chaque méthode automatiquement. « — » signifie que P2PSync ne l'appelle jamais pour cette configuration (le handler peut ne pas l'implémenter).

| Méthode | centralisé, fps = 0 | centralisé, fps > 0 | indépendant, fps = 0 | indépendant, fps > 0 |
|---------|:-:|:-:|:-:|:-:|
| `getLocalState()` | après processAction + broadcastState | idem + boucle fps | broadcastState | boucle fps + broadcastState |
| `applyRemoteState()` | guest | les deux | `broadcastState` | les deux |
| `processAction()` | hôte (+guest prédiction) | hôte (+guest prédiction) | — | — |
| `onMessage()` | — | — | les deux | les deux |
| `onStart()` | les deux | les deux | les deux | les deux |
| `onEnd()` | les deux | les deux | les deux | les deux |
| `onPeerAbsent()` | les deux | les deux | les deux | les deux |
| `onPeerBack()` | les deux | les deux | les deux | les deux |

#### SessionCtrl — contrôle de session

`onStart(ctrl)` reçoit un objet **SessionCtrl** qui permet au handler de piloter sa propre session. Le même objet est accessible depuis l'application via `sync.getSession(id)`.

```
SessionCtrl {
    setFps(n)                // Changer le fps à chaud (hôte seul → _ctrl synchronise le guest)
    broadcastState()         // Envoyer getLocalState() immédiatement (envoi initié par l'hôte)
    sendAction(action)       // Envoyer une action discrète (centralisé, guest → hôte)
    sendMessage(message)     // Envoyer un message discret (indépendant, bidirectionnel)
    fps                      // fps courant (lecture seule)
    mode                     // mode de la session (lecture seule)
    id                       // identifiant de la session (lecture seule)
}
```

| Méthode | centralisé | indépendant |
|---------|:-:|:-:|
| `setFps(n)` | hôte | hôte |
| `broadcastState()` | hôte | les deux |
| `sendAction(action)` | guest | — |
| `sendMessage(message)` | — | les deux |

**Deux portes d'accès, même objet** : le handler reçoit `ctrl` dans `onStart`, l'application obtient le même objet via `sync.getSession(id)`.

En mode **centralisé**, P2PSync envoie automatiquement le `fullState` (via `getLocalState()`) après chaque `processAction()`. `broadcastState()` n'est nécessaire que pour les envois initiés par l'hôte hors réception d'action (ex : début de partie, timer, changement d'état unilatéral).

```js
// Accès A — depuis le handler (autonomie locale)
onStart(ctrl) { this.ctrl = ctrl; }
onPeerAbsent() { this.ctrl.setFps(0); }

// Accès B — depuis l'application (orchestration globale)
sync.getSession('game').setFps(0);
```

#### Exemple — handler de jeu tour par tour (centralisé, fps = 0)

```js
const gameHandler = {
    board: initialBoard(),

    onStart(ctrl) {
        this.ctrl = ctrl;
    },

    processAction(action) {
        // Hôte : valide et applique le coup
        // Guest : prédiction locale (même logique)
        if (this.isValidMove(action)) {
            this.board = applyMove(this.board, action);
        }
        // P2PSync envoie automatiquement le fullState après cet appel (centralisé)
    },

    getLocalState() {
        return { board: this.board, turn: this.currentTurn };
    },

    applyRemoteState(state) {
        // Guest : reçoit le fullState autoritaire
        this.board = state.board;
        this.currentTurn = state.turn;
        this.render();
    },

    // Envoi initié par l'hôte (pas en réaction à une action)
    startGame() {
        this.board = initialBoard();
        this.ctrl.broadcastState();
    },

    onPeerAbsent() {
        this.showPauseOverlay();
    },

    onPeerBack() {
        this.hidePauseOverlay();
    },

    onEnd() {
        this.board = null;
    }
};
```

#### Exemple — handler de chat (indépendant, fps = 0)

```js
const chatHandler = {
    onStart(ctrl) {
        this.ctrl = ctrl;
    },

    onMessage(message) {
        displayMessage(message.author, message.text);
    },

    // Méthode appelée par l'UI de l'application
    send(text) {
        this.ctrl.sendMessage({ author: myName, text });
    },

    onEnd() {
        displaySystemMessage('Chat terminé');
    }
};
```

### Types de messages — normalisation

P2PSync définit exactement **4 types de messages de données**. Chaque type n'est valide que pour certaines configurations de session. P2PSync rejette tout message dont le type ne correspond pas à la session cible.

| Type | Sémantique | Mode | Direction | Déclencheur |
|------|-----------|------|-----------|-------------|
| `action` | Commande envoyée à l'hôte pour traitement | centralisé uniquement | Guest → Hôte | Discret (à la demande) |
| `fullState` | Le fullState autoritaire diffusé par l'hôte | centralisé uniquement | Hôte → Guest | Discret (`broadcastState`) ou continu (boucle fps) |
| `message` | Message libre entre pairs égaux | indépendant uniquement | Pair → Pair (bidirectionnel) | Discret (à la demande) |
| `localState` | État local partagé | centralisé et indépendant | Guest → Hôte (centralisé) · Pair ↔ Pair (indépendant) | Continu (boucle fps) ou `broadcastState()` |

#### Types valides par configuration de session

| | centralisé, fps = 0 | centralisé, fps > 0 | indépendant, fps = 0 | indépendant, fps > 0 |
|---|:-:|:-:|:-:|:-:|
| `action` | guest → hôte | guest → hôte | — | — |
| `fullState` | hôte → guest | hôte → guest | — | — |
| `message` | — | — | les deux | les deux |
| `localState` | — | guest → hôte | `broadcastState` | les deux |

Un `message` envoyé dans une session centralisée est rejeté. Une `action` envoyée dans une session indépendante est rejetée. Un `localState` est rejeté en session centralisée à fps = 0 (seules les actions discrètes et le fullState circulent). En session indépendante à fps = 0, `localState` n'est émis que via `broadcastState()`. Cette validation stricte garantit que chaque session respecte son contrat.

### Format des messages sur le fil

Chaque message envoyé par P2PSync porte l'identifiant de la session cible. P2PSync aiguille les messages entrants vers le bon handler.

#### Messages de données (échangés entre handlers)

```js
// Action discrète (guest → hôte, session centralisée)
{ _s: 'game', type: 'action', action: { move: 'e2e4' } }

// Le fullState autoritaire (hôte → guest, session centralisée)
{ _s: 'game', type: 'fullState', state: { board: [...], turn: 2 } }

// État local (boucle continue, bidirectionnel)
{ _s: 'cursors', type: 'localState', state: { x: 120, y: 340 } }

// Message discret (sessions indépendantes, bidirectionnel)
{ _s: 'chat', type: 'message', payload: { author: 'Alice', text: 'Salut !' } }
```

#### Messages de contrôle (gérés par P2PSync, jamais exposés aux handlers)

```js
{ _ctrl: 'sessionCreate', id: 'game', mode: 'centralisé', fps: 30 }
{ _ctrl: 'sessionReady',  id: 'game' }
{ _ctrl: 'sessionSetFps', id: 'game', fps: 0 }
{ _ctrl: 'sessionEnd',    id: 'game' }
```

Le champ `_s` identifie la session cible d'un message de données. Le champ `_ctrl` identifie les messages de contrôle internes. Ces deux préfixes sont réservés par P2PSync.

### Machine à états de P2PSync

P2PSync possède sa propre machine à états, construite au-dessus de la SM de connexion (couche 2). Elle expose **toujours** l'état exact de la couche inférieure, en y ajoutant un groupement et une sémantique propre.

#### États groupés

| Groupe P2PSync | États couche 2 | Signification |
|---|---|---|
| **IDLE** | IDLE | Pas de connexion, aucune session |
| **CONNECTING** | INITIALIZING, READY, CONNECTING, AUTHENTICATING | Connexion en cours |
| **CONNECTED** | CONNECTED | Connecté — sessions possibles, guard actif |
| **DISCONNECTED** | *(propre à P2PSync)* | Était connecté, connexion perdue |

DISCONNECTED est un état propre à P2PSync. En couche 2, la déconnexion ramène à IDLE. P2PSync distingue « jamais connecté » (IDLE) de « connexion perdue » (DISCONNECTED).

#### Transitions groupées

```
                    ┌───── échec ──────┐
                    │ (jamais connecté) │
IDLE ──────→ CONNECTING ──────→ CONNECTED ──────→ DISCONNECTED
  ↑               ↑                                     │
  │               └─────────── reconnexion ─────────────┘
  └────────────── reset ────────────────────────────────┘
```

| Transition | Cause | Transitions couche 2 |
|---|---|---|
| IDLE → CONNECTING | Lancement de la connexion | IDLE → INITIALIZING |
| CONNECTING → CONNECTED | Authentification réussie | AUTHENTICATING → CONNECTED |
| CONNECTING → IDLE | Échec avant CONNECTED | Erreurs/timeouts → IDLE |
| CONNECTED → DISCONNECTED | Connexion perdue | CONNECTED → IDLE (erreur/déconnexion) |
| DISCONNECTED → CONNECTING | Tentative de reconnexion | IDLE → INITIALIZING |
| DISCONNECTED → IDLE | Abandon / reset | — |

Chaque transition de la couche 2 est remontée intégralement à l'application :

```js
sync.onStateChange = (state, group, detail) => {
    // state  : état couche 2 exact ("AUTHENTICATING", "CONNECTED", ...)
    // group  : groupe P2PSync ("idle", "connecting", "connected", "disconnected")
    // detail : ID de transition et contexte ({ transition: 'c15', reason: 'PING_TIMEOUT' })

    if (group === 'connected') {
        showStatus('Connecté');
    } else if (group === 'connecting') {
        showStatus('Connexion en cours...');
    } else if (group === 'disconnected') {
        showStatus(`Déconnecté : ${detail.reason}`);
    }
};
```

L'application peut écouter `group` pour un usage simple, ou `state` / `detail.transition` pour un contrôle fin.

#### Guard présence (sur CONNECTED)

En état CONNECTED, P2PSync maintient un **guard de présence** — une SM interne qui suit le même formalisme que le circuit breaker (couche 2) :

```
                   données reçues
HALF_OPEN ─────────────────────→ CLOSED
    ↑                               │
    │                               │ timeout sans données
    │     données reçues            ▼
    └─────────────────────────── OPEN
```

| État | Sémantique | Transition vers |
|---|---|---|
| **HALF_OPEN** | Incertain — en attente de confirmation (état initial, ou premier signe de vie après absence) | CLOSED (données confirmées) |
| **CLOSED** | Pair présent — données reçues régulièrement | OPEN (timeout sans réception) |
| **OPEN** | Pair absent — aucune donnée depuis le seuil configuré | HALF_OPEN (données reçues à nouveau) |

Le guard ne vit que dans CONNECTED. Dès que P2PSync quitte CONNECTED, il est réinitialisé (HALF_OPEN à la prochaine connexion).

Source du guard : toute donnée entrante — messages `_presence`, sessions continues, messages discrets. Le guard ne dépend pas d'une session spécifique. C'est pourquoi `_presence` est suspendue (et non le guard) quand une session applicative a un fps > 0.5.

Les handlers de session sont notifiés des transitions du guard :
- `onPeerAbsent()` : guard passe à OPEN
- `onPeerBack()` : guard revient à CLOSED

L'application dispose ainsi de deux niveaux de diagnostic :
- **Couche 2** (`onStateChange`) : la connexion réseau est-elle active ?
- **Couche 3** (guard présence) : le pair applicatif est-il réactif ?

#### Sessions — machines parallèles

Chaque session possède sa propre SM, avec le **même vocabulaire** que P2PSync :

```
IDLE ──→ CONNECTING ──→ CONNECTED ──→ DISCONNECTED
```

**Contrainte** : une session ne peut être CONNECTED que si P2PSync est lui-même CONNECTED. Si P2PSync passe à DISCONNECTED → toutes les sessions passent simultanément à DISCONNECTED.

#### Vue d'ensemble

```
P2PSync :           IDLE → CONNECTING → CONNECTED → DISCONNECTED
                                             │
guard présence :              [HALF_OPEN → CLOSED ↔ OPEN]
                                             │
sessions (× N) :        IDLE → CONNECTING → CONNECTED → DISCONNECTED
(parallèles)            (contrainte : P2PSync CONNECTED)
```

Trois niveaux de SM, un seul vocabulaire.

### Interface transport

P2PSync ne connaît pas `NetworkManager` ni PeerJS. Il communique avec la couche inférieure via un **objet transport** au contrat minimal :

```js
Transport {
    connect(peerId)              // Initier une connexion
    disconnect()                 // Fermer la connexion
    send(data)                   // Envoyer un objet JS
    onData(callback)             // S'abonner aux données entrantes
    onStateChange(callback)      // S'abonner aux transitions SM
    isConnected()                // État courant
    isHost                       // Rôle (lecture seule)
}
```

N'importe quel objet implémentant ce contrat convient :

| Transport | Implémentation |
|-----------|---------------|
| PeerJS via NetworkManager | `NetworkManager` implémente directement ce contrat |
| WebRTC brut (futur) | Wrapper autour de `RTCDataChannel` |
| WebSocket (futur) | Wrapper autour de `WebSocket` |
| Local / test | Deux instances connectées en mémoire |

Cette indépendance permet de tester P2PSync sans réseau et de changer de transport sans modifier le code applicatif.

### Verrouillage du transport

Quand P2PSync est actif, le `send()` brut du transport n'est plus accessible à l'application. **Toute communication passe par les sessions.** Il n'est pas possible d'envoyer des données « hors session » à travers P2PSync.

Ce verrouillage est garanti par construction : l'application reçoit une instance de P2PSync, pas le transport. Seul P2PSync détient la référence au transport.

### Présence intégrée (`_presence`)

P2PSync inclut une session interne de **présence**, active par défaut dès la connexion établie. Elle sert de heartbeat applicatif et de canal de statut entre les pairs.

```
P2PSync
   ├── _presence    indépendant (fps 0.5)   ← interne, automatique
   ├── "chat"       indépendant (fps 0)     ← applicatif
   └── "game"       centralisé  (fps 30)    ← applicatif
```

#### Fonctionnement

La session `_presence` est une session indépendante à très basse fréquence (0.5 fps par défaut — un échange toutes les 2 secondes). Elle envoie un `localState` minimal auquel l'application peut attacher des données optionnelles (statut de frappe, état en ligne/absent, etc.).

```js
// Fournir des données de présence (optionnel)
sync.setPresence({ status: 'typing' });

// Écouter la présence du pair
sync.onPresence = (presence) => {
    showTypingIndicator(presence.status === 'typing');
};
```

#### Suspension automatique

Quand au moins une session applicative a un fps **supérieur à celui de `_presence`** (0.5 par défaut), la session `_presence` est **suspendue** — son heartbeat est redondant puisque les `localState` de la session continue arrivent plus fréquemment. Dès que cette condition n'est plus remplie, `_presence` reprend automatiquement.

| Sessions actives | `_presence` |
|-----------------|-------------|
| Uniquement fps = 0 (chat, tour par tour) | **Active** — seule source de heartbeat |
| Sessions fps > 0 mais toutes ≤ 0.5 | **Active** — les sessions sont trop lentes pour remplacer le heartbeat |
| Au moins une session fps > 0.5 | **Suspendue** — la session continue fait office de heartbeat |
| Aucune session (juste connecté) | **Active** — maintient la détection de présence |

#### Détection d'absence

P2PSync surveille la réception de données (tous flux confondus : `_presence`, sessions continues, messages discrets) via le guard de présence. Si aucune donnée n'est reçue pendant un délai configurable, le guard passe à OPEN et P2PSync déclenche un événement d'absence :

```js
// Guard passe à OPEN (pair absent)
sync.onPeerAbsent = () => {
    showStatus('Pair inactif');
};

// Guard revient à CLOSED (pair de retour)
sync.onPeerBack = () => {
    showStatus('Pair connecté');
};
```

Mêmes noms à deux niveaux : `sync.onPeerAbsent` / `sync.onPeerBack` (P2PSync, une seule fois) et `handler.onPeerAbsent()` / `handler.onPeerBack()` (par session). Le contexte (sync vs handler) distingue le niveau.

La SM du guard de présence (HALF_OPEN / CLOSED / OPEN) et son intégration dans la SM de P2PSync sont décrites dans la section **Machine à états de P2PSync**.

---

## Résumé

| Couche | Module | Rôle | Dépendance |
|--------|--------|------|-----------|
| 0 | WebRTC (navigateur) | Connexion P2P directe, chiffrement DTLS | — |
| 1 | PeerJS | Simplification WebRTC : signalisation, identité, sérialisation | WebRTC |
| 2 | NetworkManager | Transport sécurisé : SM, auth, ping, CB, validation | PeerJS |
| 3 | P2PSync | Façade applicative : sessions multiplexées, mode (centralisé/indépendant) × fps | aucune (transport-agnostique) |

Chaque couche ajoute des garanties sans exposer les détails de la couche inférieure. L'application ne voit que la couche 3 — P2PSync est son unique point d'entrée.

---

## Glossaire

| Terme | Définition |
|-------|-----------|
| **CB** | Circuit Breaker — patron de résilience qui bloque temporairement les appels vers un pair défaillant après N échecs consécutifs |
| **Centralisé** | Mode de session où l'hôte détient l'état de vérité. Le guest envoie des actions, l'hôte répond avec le fullState autoritaire |
| **Collaboratif** | Mode de session réservé (hors scope) où les deux pairs modifient la même donnée, nécessitant un mécanisme de convergence (CRDT, OT) |
| **DTLS** | Datagram Transport Layer Security — protocole de chiffrement pour les transports datagramme (UDP). WebRTC l'impose sur tout `RTCDataChannel` : les données sont chiffrées de bout en bout |
| **Guard** | SM interne qui surveille une condition en continu. Le circuit breaker (couche 2) est un guard sur les tentatives de connexion (CLOSED/OPEN/HALF_OPEN). Le guard de présence (couche 3) est un guard sur l'activité du pair en état CONNECTED (même formalisme) |
| **Handler** | Objet duck-typed fourni par l'application pour chaque session. P2PSync appelle ses méthodes (`getLocalState`, `onMessage`, etc.) selon le mode et le fps de la session |
| **ICE** | Interactive Connectivity Establishment — protocole qui teste plusieurs chemins réseau (direct, STUN, TURN) et sélectionne le meilleur pour établir la connexion P2P |
| **Indépendant** | Mode de session où chaque pair a son propre état, partagé en lecture seule. Pas de conflit possible |
| **NAT** | Network Address Translation — mécanisme réseau qui partage une IP publique entre plusieurs appareils d'un réseau local. Obstacle principal à la connexion P2P directe |
| **P2P** | Peer-to-Peer — communication directe entre deux pairs, sans serveur intermédiaire pour les données |
| **RTT** | Round Trip Time — temps d'aller-retour d'un message entre deux pairs |
| **SDP** | Session Description Protocol — format texte décrivant les capacités média/données d'un pair (codecs, protocoles, paramètres réseau). Échangé lors de la négociation WebRTC |
| **Session** | Canal logique multiplexé sur un transport unique, défini par son mode (centralisé/indépendant/collaboratif) et son fps. Identifié par un nom unique, géré par un handler applicatif |
| **SessionCtrl** | Objet de contrôle d'une session, transmis au handler via `onStart(ctrl)` et accessible à l'application via `sync.getSession(id)`. Expose `setFps`, `broadcastState`, `sendAction`, `sendMessage` |
| **SHA-256** | Algorithme de hachage cryptographique utilisé par pacpam pour l'authentification mutuelle des pairs |
| **SM** | State Machine — machine à états finis qui gouverne le cycle de vie d'une connexion dans `NetworkManager` |
| **STUN** | Session Traversal Utilities for NAT — serveur léger qui permet à un pair de découvrir son IP publique et son port, nécessaire pour traverser un NAT |
| **TURN** | Traversal Using Relays around NAT — serveur relais utilisé quand la connexion directe est impossible (NAT symétrique, pare-feu restrictif). Les données transitent par le serveur |
| **WebRTC** | Web Real-Time Communication — API navigateur (standard W3C) pour la communication P2P directe entre navigateurs |
