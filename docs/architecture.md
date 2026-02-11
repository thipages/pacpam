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
│  discret/continu × dirigé/peer                   │
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

### Deux dimensions de communication

Une session est caractérisée par deux dimensions : son **autorité** et son **fps**.

**Autorité** — qui détient la vérité :

| Mode | Modèle | Flux de données |
|------|--------|----------------|
| **Dirigé** (host) | L'hôte détient l'état de vérité | Guest → action → Hôte → état autoritaire → Guest |
| **Non dirigé** (peer) | Les deux pairs sont égaux | Pair ↔ Pair (bidirectionnel, symétrique) |

**fps** — paramètre qui contrôle la boucle continue :

| fps | Comportement |
|-----|-------------|
| `0` | **Discret seul** — envois à la demande uniquement (actions, messages) |
| `> 0` | **Discret + continu** — la boucle de synchronisation tourne à la fréquence donnée, ET les envois ponctuels restent possibles |

Une session supporte **toujours** les envois discrets. Le `fps` contrôle uniquement si une boucle continue de synchronisation d'état tourne en plus. `setFps(n)` permet de changer ce paramètre à chaud sur une session active :

```
fps = 0   →  chat, tour par tour (discret seul)
fps = 30  →  on lance le temps réel (la boucle démarre, le discret reste disponible)
fps = 0   →  retour au tour par tour (la boucle s'arrête)
```

**Important** : la **sémantique** du discret dépend de l'autorité de la session :

| Autorité | Discret signifie… | Méthode | Direction |
|----------|-------------------|---------|-----------|
| **host** (dirigé) | **Action** — commande traitée par l'hôte | `sendAction()` → `processAction()` | Guest → Hôte (asymétrique) |
| **peer** (non dirigé) | **Message** — échange libre entre pairs | `sendMessage()` → `onMessage()` | Pair ↔ Pair (symétrique) |

C'est pourquoi un chat (peer) et un jeu (host) nécessitent des sessions distinctes : un message de chat envoyé dans une session host serait traité comme une action de jeu. Chaque session a son propre handler et sa propre sémantique.

En revanche, deux fonctions de même autorité **peuvent** être fusionnées dans une seule session. Une session peer à fps > 0 supporte à la fois l'état continu (`getLocalState` / `applyRemoteState`) et les messages discrets (`onMessage`). Par exemple, une session "cursors" (peer, fps 15) peut aussi transporter des messages de chat via `onMessage`, sans nécessiter une session "chat" séparée. Le découpage en sessions est un **choix applicatif** — séparation des préoccupations vs économie de sessions — pas une contrainte de P2PSync.

Les deux dimensions se combinent :

| | fps = 0 (discret) | fps > 0 (discret + continu) |
|---|---|---|
| **Dirigé** | Jeu tour par tour, quiz | Jeu temps réel |
| **Non dirigé** | Chat, notifications | Curseurs, présence, co-édition |

### Concept de session

Une **session** est un canal logique, identifié par un nom unique, défini par son autorité et son fps. C'est l'unité de base de toute communication à travers P2PSync.

```
Session {
    id        : string            // identifiant unique ("chat", "game", "cursors")
    authority : 'host' | 'peer'   // qui fait foi
    fps       : number            // 0 = discret seul, > 0 = + boucle continue
    handler   : SessionHandler    // objet duck-typed fourni par l'application
}
```

L'application peut créer **autant de sessions que nécessaire**. Elles sont multiplexées sur le même transport physique (un seul `RTCDataChannel`) grâce à l'identifiant de session porté par chaque message.

### Exemples concrets de sessions

#### Scénario 1 — Application de chat simple

```
P2PSync
   └── "chat"    peer (fps 0)
```

Une seule session. Les deux pairs envoient et reçoivent des messages librement. Pas de boucle continue. Le handler implémente simplement `onMessage(msg)`.

#### Scénario 2 — Jeu tour par tour avec chat

```
P2PSync
   ├── "chat"    peer (fps 0)
   └── "game"    host (fps 0)
```

Deux sessions. Le chat est indépendant du jeu. Dans la session "game", le guest envoie ses coups (actions discrètes), l'hôte les valide via `processAction(action)`, met à jour l'état du plateau, et le renvoie au guest via `broadcastState()`.

#### Scénario 3 — Jeu temps réel avec chat et curseurs

```
P2PSync
   ├── "chat"      peer (fps 0)
   ├── "game"      host (fps 30)
   └── "cursors"   peer (fps 15)
```

Trois sessions simultanées. La session "game" tourne à 30 fps : l'hôte envoie l'état autoritaire à chaque tick, le guest envoie ses inputs (`peerState`), et les actions discrètes (commandes du joueur) restent possibles à tout moment. La session "cursors" partage la position de chaque pair à 15 fps.

Note : "chat" et "cursors" sont toutes deux peer — elles pourraient être fusionnées en une seule session (les messages de chat passeraient par `onMessage` dans le handler "cursors"). Ici elles sont séparées par choix de clarté, pas par contrainte technique. En revanche, "game" (host) ne peut pas absorber le chat : un message y serait traité comme une action de jeu.

#### Scénario 4 — Quiz / trivia

```
P2PSync
   ├── "quiz"    host (fps 0)
   └── "chat"    peer (fps 0)
```

L'hôte envoie les questions, le guest envoie les réponses, l'hôte envoie les résultats. Tout est discret (fps 0). Le chat permet la discussion libre en parallèle.

#### Scénario 5 — Éditeur collaboratif

```
P2PSync
   ├── "editor"     peer (fps 5)
   └── "presence"   peer (fps 2)
```

La session "editor" synchronise l'état à 5 fps (position du curseur, sélection), et les opérations discrètes (insertion, suppression de texte) sont envoyées à la demande en plus de la boucle. La session "presence" partage les indicateurs de statut (en train de taper, en ligne/absent) à faible fréquence.

### Cycle de vie des sessions

#### Qui crée les sessions ?

**L'hôte crée toutes les sessions.** Le rôle hôte/guest est déterminé à l'établissement de la connexion (couche 2) et ne change jamais :

- **Hôte** = celui qui reçoit la connexion (`peer.on('connection')`)
- **Guest** = celui qui l'initie (`peer.connect(peerId)`)

Même pour les sessions `peer` (non dirigées), c'est l'hôte qui décide de leur existence. Une fois créée, les deux pairs sont égaux dans les échanges — mais la décision de créer ou détruire la session appartient à l'hôte.

Ce choix est cohérent avec le fonctionnement des couches inférieures : il y a toujours un pair qui « accueille » et un pair qui « rejoint ». L'hôte est le point de coordination naturel.

#### Protocole de création

Dès que la connexion est établie (couche 2 → CONNECTED), P2PSync démarre automatiquement la session interne `_presence` sur les deux pairs, **avant** toute session applicative. L'hôte crée ensuite les sessions applicatives :

```
Hôte                                        Guest
  │                                            │
  │  ┄┄ connexion CONNECTED ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
  │                                            │
  │  _presence ACTIVE (auto, les deux pairs)   │  _presence ACTIVE
  │  → heartbeat 0.5 fps démarre              │  → heartbeat 0.5 fps démarre
  │                                            │
  │── { _ctrl: 'sessionCreate',               │
  │     id: 'chat',                            │
  │     authority: 'peer',                     │
  │     fps: 0 }  ──────────────────────────→ │
  │                                            │  app.createHandler('chat', config)
  │                                            │  → handler instancié
  │← { _ctrl: 'sessionReady', id: 'chat' } ──│
  │                                            │
  │  session "chat" ACTIVE                     │  session "chat" ACTIVE
  │                                            │
  │── { _ctrl: 'sessionCreate',               │
  │     id: 'game',                            │
  │     authority: 'host',                     │
  │     fps: 30 }  ──────────────────────────→ │
  │                                            │  app.createHandler('game', config)
  │← { _ctrl: 'sessionReady', id: 'game' } ──│
  │                                            │
  │  session "game" ACTIVE (boucle 30fps)      │  session "game" ACTIVE
  │  _presence SUSPENDUE (game fps > 0.5)      │  _presence SUSPENDUE
```

Les messages préfixés `_ctrl` sont des messages de contrôle internes à P2PSync. Ils ne sont jamais exposés aux handlers. La session `_presence` n'utilise pas ce protocole — elle est démarrée implicitement par P2PSync sur les deux pairs sans handshake.

#### États d'une session

```
                sessionCreate envoyé/reçu
                        │
INACTIVE ──────────→ PENDING ──────────→ ACTIVE ──────────→ ENDED
                        │    sessionReady     │                 │
                        │                     │  sessionEnd     │
                        │                     └────────────────→│
                        │         connexion perdue              │
                        └──────────────────────────────────────→│
```

| État | Description |
|------|-------------|
| **INACTIVE** | La session n'existe pas encore |
| **PENDING** | Hôte : `sessionCreate` envoyé, en attente du `sessionReady`. Guest : handler en cours d'instanciation |
| **ACTIVE** | Les deux pairs ont un handler actif. Les messages de données circulent. La boucle continue tourne (si applicable). La présence du pair agit comme **guard** : si le pair devient ABSENT, les handlers en sont notifiés (`onPeerAbsent()` / `onPeerBack()`) et peuvent adapter leur comportement (pause de la boucle, affichage d'un indicateur, etc.) sans que la session ne quitte l'état ACTIVE |
| **ENDED** | Session terminée. Handlers nettoyés. Peut être recréée plus tard si nécessaire |

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
  ├── _presence ACTIVE (automatique, les deux pairs)
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

#### Session dirigée, fps = 0 (jeu tour par tour)

```
Guest                                          Hôte
  │                                              │
  │── { type: 'action', action } ───────────────→│  handler.processAction(action)
  │   handler.processAction(action)  ←prédiction │  state = handler.getLocalState()
  │                                              │
  │←── { type: 'fullState', state } ────────────│  (état autoritaire)
  │  handler.applyRemoteState(state)             │
```

Le guest envoie une action, applique une **prédiction locale** (appel optionnel à `processAction` côté guest), puis reçoit l'état autoritaire de l'hôte qui corrige toute divergence.

#### Session dirigée, fps > 0 (jeu temps réel)

```
Guest                                          Hôte
  │                                              │
  │── { type: 'action', action } ───────────────→│  (ponctuel, discret)
  │                                              │
  │── { type: 'peerState', state } ────────────→│  (boucle fps — inputs guest)
  │←── { type: 'fullState', state } ────────────│  (boucle fps — état autoritaire)
  │                                              │
  │── { type: 'peerState', state } ────────────→│  (tick suivant)
  │←── { type: 'fullState', state } ────────────│  (tick suivant)
```

Deux flux superposés : les actions discrètes du guest et la boucle continue bidirectionnelle. L'hôte reçoit les inputs du guest (`peerState`) et renvoie l'état autoritaire (`fullState`) à chaque tick.

#### Session non dirigée, fps = 0 (chat)

```
Pair A                                        Pair B
  │                                              │
  │── { type: 'message', payload } ────────────→│  handler.onMessage(payload)
  │                                              │
  │  handler.onMessage(payload)                  │
  │←── { type: 'message', payload } ────────────│
```

Symétrique. Les deux pairs envoient et reçoivent librement, sans notion d'autorité.

#### Session non dirigée, fps > 0 (curseurs, présence)

```
Pair A                                        Pair B
  │                                              │
  │── { type: 'peerState', state } ────────────→│  handler.applyRemoteState(state)
  │←── { type: 'peerState', state } ────────────│  (boucle fps)
  │                                              │
  │  handler.applyRemoteState(state)             │
  │── { type: 'peerState', state } ────────────→│  (tick suivant)
  │←── { type: 'peerState', state } ────────────│  (tick suivant)
```

Symétrique. Chaque pair appelle `handler.getLocalState()` à chaque tick et envoie le résultat. Chaque pair reçoit l'état distant et appelle `handler.applyRemoteState()`.

### Handler — contrat duck-typed

L'application fournit un **handler** pour chaque session. C'est un objet JavaScript dont P2PSync appelle les méthodes selon le type de session. Toutes les méthodes sont optionnelles — seules celles pertinentes pour la session sont appelées.

| Méthode | Signature | Rôle |
|---------|-----------|------|
| `getLocalState()` | `() → object` | Retourne l'état local à envoyer (boucle continue ou `broadcastState()`) |
| `applyRemoteState(state)` | `(object) → void` | Applique l'état reçu du pair distant |
| `processAction(action)` | `(object) → void` | Traite une action reçue (hôte) ou prédiction locale (guest) |
| `onMessage(message)` | `(object) → void` | Reçoit un message discret (sessions peer) |
| `onStart()` | `() → void` | Session passe en ACTIVE |
| `onEnd()` | `() → void` | Session passe en ENDED (nettoyage) |
| `onPeerAbsent()` | `() → void` | Guard : le pair ne répond plus (présence perdue) |
| `onPeerBack()` | `() → void` | Guard : le pair répond à nouveau |

#### Quelles méthodes pour quel type ?

| Méthode | host, fps = 0 | host, fps > 0 | peer, fps = 0 | peer, fps > 0 |
|---------|:-:|:-:|:-:|:-:|
| `getLocalState()` | broadcastState | broadcastState + boucle fps | — | boucle fps |
| `applyRemoteState()` | guest | guest | — | les deux |
| `processAction()` | hôte (+guest prédiction) | hôte (+guest prédiction) | — | — |
| `onMessage()` | — | — | les deux | les deux |
| `onStart()` | les deux | les deux | les deux | les deux |
| `onEnd()` | les deux | les deux | les deux | les deux |
| `onPeerAbsent()` | les deux | les deux | les deux | les deux |
| `onPeerBack()` | les deux | les deux | les deux | les deux |

#### Exemple — handler de jeu tour par tour (host + discret)

```js
const gameHandler = {
    board: initialBoard(),

    processAction(action) {
        // Hôte : valide et applique le coup
        // Guest : prédiction locale (même logique)
        if (this.isValidMove(action)) {
            this.board = applyMove(this.board, action);
        }
    },

    getLocalState() {
        return { board: this.board, turn: this.currentTurn };
    },

    applyRemoteState(state) {
        // Guest : reçoit l'état autoritaire de l'hôte
        this.board = state.board;
        this.currentTurn = state.turn;
        this.render();
    },

    onEnd() {
        this.board = null;
    }
};
```

#### Exemple — handler de chat (peer + discret)

```js
const chatHandler = {
    onMessage(message) {
        displayMessage(message.author, message.text);
    },

    onEnd() {
        displaySystemMessage('Chat terminé');
    }
};
```

### Types de messages — normalisation

P2PSync définit exactement **4 types de messages de données**. Chaque type n'est valide que pour certaines configurations de session. P2PSync rejette tout message dont le type ne correspond pas à la session cible.

| Type | Sémantique | Autorité | Direction | Déclencheur |
|------|-----------|----------|-----------|-------------|
| `action` | Commande envoyée à l'hôte pour traitement | host uniquement | Guest → Hôte | Discret (à la demande) |
| `fullState` | État autoritaire diffusé par l'hôte | host uniquement | Hôte → Guest | Discret (`broadcastState`) ou continu (boucle fps) |
| `message` | Message libre entre pairs égaux | peer uniquement | Pair → Pair (bidirectionnel) | Discret (à la demande) |
| `peerState` | État local partagé périodiquement | les deux | Pair → Pair (bidirectionnel) | Continu (boucle fps) |

#### Types valides par configuration de session

| | host, fps = 0 | host, fps > 0 | peer, fps = 0 | peer, fps > 0 |
|---|:-:|:-:|:-:|:-:|
| `action` | guest → hôte | guest → hôte | — | — |
| `fullState` | hôte → guest | hôte → guest | — | — |
| `message` | — | — | les deux | les deux |
| `peerState` | — | les deux | — | les deux |

Un `message` envoyé dans une session host est rejeté. Une `action` envoyée dans une session peer est rejetée. Un `peerState` envoyé dans une session à fps = 0 est rejeté. Cette validation stricte garantit que chaque session respecte son contrat.

### Format des messages sur le fil

Chaque message envoyé par P2PSync porte l'identifiant de la session cible. P2PSync aiguille les messages entrants vers le bon handler.

#### Messages de données (échangés entre handlers)

```js
// Action discrète (guest → hôte, session dirigée)
{ _s: 'game', type: 'action', action: { move: 'e2e4' } }

// État autoritaire (hôte → guest, session dirigée)
{ _s: 'game', type: 'fullState', state: { board: [...], turn: 2 } }

// État pair (boucle continue, bidirectionnel)
{ _s: 'cursors', type: 'peerState', state: { x: 120, y: 340 } }

// Message discret (sessions peer, bidirectionnel)
{ _s: 'chat', type: 'message', payload: { author: 'Alice', text: 'Salut !' } }
```

#### Messages de contrôle (gérés par P2PSync, jamais exposés aux handlers)

```js
{ _ctrl: 'sessionCreate', id: 'game', authority: 'host', fps: 30 }
{ _ctrl: 'sessionReady',  id: 'game' }
{ _ctrl: 'sessionEnd',    id: 'game' }
```

Le champ `_s` identifie la session cible d'un message de données. Le champ `_ctrl` identifie les messages de contrôle internes. Ces deux préfixes sont réservés par P2PSync.

### Remontée de la machine à états

P2PSync remonte **toutes** les transitions de la SM de la couche 2 vers l'application. Rien n'est filtré — l'application dispose de l'information complète.

Pour simplifier l'usage courant, P2PSync ajoute un **groupe** à chaque transition :

| Groupe | États SM correspondants | Signification |
|--------|------------------------|---------------|
| `connecting` | INITIALIZING, READY, CONNECTING, AUTHENTICATING | Connexion en cours d'établissement |
| `connected` | CONNECTED | Connexion active, prêt à communiquer |
| `disconnected` | Retour à IDLE (normal) | Connexion terminée proprement |
| `error` | Retour à IDLE (sur erreur/timeout) | Connexion perdue ou échouée |

```js
sync.onStateChange = (state, group, detail) => {
    // state  : état SM exact ("AUTHENTICATING", "CONNECTED", ...)
    // group  : groupe simplifié ("connecting", "connected", "disconnected", "error")
    // detail : ID de transition et contexte ({ transition: 'c15', reason: 'PING_TIMEOUT' })

    if (group === 'connected') {
        showStatus('Connecté');
    } else if (group === 'connecting') {
        showStatus('Connexion en cours...');
    } else if (group === 'error') {
        showStatus(`Erreur : ${detail.reason}`);
    }
};
```

L'application peut écouter `group` pour un usage simple, ou `state` / `detail.transition` pour un contrôle fin (ex: afficher une barre de progression pendant la connexion).

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
   ├── _presence    peer (fps 0.5)   ← interne, automatique
   ├── "chat"       peer (fps 0)     ← applicatif
   └── "game"       host (fps 30)    ← applicatif
```

#### Fonctionnement

La session `_presence` est une session peer à très basse fréquence (0.5 fps par défaut — un échange toutes les 2 secondes). Elle envoie un `peerState` minimal auquel l'application peut attacher des données optionnelles (statut de frappe, état en ligne/absent, etc.).

```js
// Fournir des données de présence (optionnel)
sync.setPresence({ status: 'typing' });

// Écouter la présence du pair
sync.onPresence = (presence) => {
    showTypingIndicator(presence.status === 'typing');
};
```

#### Suspension automatique

Quand au moins une session applicative a un fps **supérieur à celui de `_presence`** (0.5 par défaut), la session `_presence` est **suspendue** — son heartbeat est redondant puisque les `peerState` de la session continue arrivent plus fréquemment. Dès que cette condition n'est plus remplie, `_presence` reprend automatiquement.

| Sessions actives | `_presence` |
|-----------------|-------------|
| Uniquement fps = 0 (chat, tour par tour) | **Active** — seule source de heartbeat |
| Sessions fps > 0 mais toutes ≤ 0.5 | **Active** — les sessions sont trop lentes pour remplacer le heartbeat |
| Au moins une session fps > 0.5 | **Suspendue** — la session continue fait office de heartbeat |
| Aucune session (juste connecté) | **Active** — maintient la détection de présence |

#### Détection d'absence

P2PSync surveille la réception de données (tous flux confondus : `_presence`, sessions continues, messages discrets). Si aucune donnée n'est reçue pendant un délai configurable, P2PSync déclenche un événement d'absence :

```js
sync.onPresenceLost = () => {
    showStatus('Pair inactif');
};
```

#### Impact sur la machine à états de P2PSync

La présence intégrée ajoute une dimension d'état au niveau de P2PSync. En plus de la SM de connexion (remontée de la couche 2), P2PSync maintient un **état de présence du pair** :

```
                    données reçues
                         │
UNKNOWN ──────────→ PRESENT ←──────────── (toute réception)
  ↑                    │
  │                    │  aucune donnée depuis N secondes
  │                    ▼
  │               ABSENT
  │                    │
  └────────────────────┘  données reçues à nouveau
```

| État | Signification | Transition vers |
|------|---------------|-----------------|
| **UNKNOWN** | Connexion établie, pas encore de données reçues | PRESENT (première réception) |
| **PRESENT** | Le pair envoie activement des données | ABSENT (timeout sans réception) |
| **ABSENT** | Aucune donnée reçue depuis le seuil configuré | PRESENT (réception reprend) |

Cet état est indépendant de la SM de connexion de la couche 2 : le pair peut être **connecté** (couche 2) mais **absent** (couche 3) — par exemple si l'onglet est en arrière-plan ou si l'application a gelé.

L'application dispose ainsi de deux niveaux de diagnostic :
- **Couche 2** (`onStateChange`) : la connexion réseau est-elle active ?
- **Couche 3** (`onPresenceLost`) : le pair applicatif est-il réactif ?

---

## Résumé

| Couche | Module | Rôle | Dépendance |
|--------|--------|------|-----------|
| 0 | WebRTC (navigateur) | Connexion P2P directe, chiffrement DTLS | — |
| 1 | PeerJS | Simplification WebRTC : signalisation, identité, sérialisation | WebRTC |
| 2 | NetworkManager | Transport sécurisé : SM, auth, ping, CB, validation | PeerJS |
| 3 | P2PSync | Façade applicative : sessions multiplexées, discret/continu × dirigé/peer | aucune (transport-agnostique) |

Chaque couche ajoute des garanties sans exposer les détails de la couche inférieure. L'application ne voit que la couche 3 — P2PSync est son unique point d'entrée.

---

## Glossaire

| Terme | Définition |
|-------|-----------|
| **CB** | Circuit Breaker — patron de résilience qui bloque temporairement les appels vers un pair défaillant après N échecs consécutifs |
| **DTLS** | Datagram Transport Layer Security — protocole de chiffrement pour les transports datagramme (UDP). WebRTC l'impose sur tout `RTCDataChannel` : les données sont chiffrées de bout en bout |
| **Handler** | Objet duck-typed fourni par l'application pour chaque session. P2PSync appelle ses méthodes (`getLocalState`, `onMessage`, etc.) selon le type de session |
| **ICE** | Interactive Connectivity Establishment — protocole qui teste plusieurs chemins réseau (direct, STUN, TURN) et sélectionne le meilleur pour établir la connexion P2P |
| **NAT** | Network Address Translation — mécanisme réseau qui partage une IP publique entre plusieurs appareils d'un réseau local. Obstacle principal à la connexion P2P directe |
| **P2P** | Peer-to-Peer — communication directe entre deux pairs, sans serveur intermédiaire pour les données |
| **RTT** | Round Trip Time — temps d'aller-retour d'un message entre deux pairs |
| **SDP** | Session Description Protocol — format texte décrivant les capacités média/données d'un pair (codecs, protocoles, paramètres réseau). Échangé lors de la négociation WebRTC |
| **Session** | Canal logique multiplexé sur un transport unique, défini par son autorité (host/peer) et son fps (0 = discret, > 0 = + boucle continue). Identifié par un nom unique, géré par un handler applicatif |
| **SHA-256** | Algorithme de hachage cryptographique utilisé par pacpam pour l'authentification mutuelle des pairs |
| **SM** | State Machine — machine à états finis qui gouverne le cycle de vie d'une connexion dans `NetworkManager` |
| **STUN** | Session Traversal Utilities for NAT — serveur léger qui permet à un pair de découvrir son IP publique et son port, nécessaire pour traverser un NAT |
| **TURN** | Traversal Using Relays around NAT — serveur relais utilisé quand la connexion directe est impossible (NAT symétrique, pare-feu restrictif). Les données transitent par le serveur |
| **WebRTC** | Web Real-Time Communication — API navigateur (standard W3C) pour la communication P2P directe entre navigateurs |
