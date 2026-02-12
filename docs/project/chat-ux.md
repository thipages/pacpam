# Plan d'implémentation — chat-ux

Chat P2P minimaliste axé UX, implémentant les recommandations de `docs/ux/ux-p2p-sync.md`.

Destination : `pages/chat-ux/`

Référence : `docs/ux/ux-p2p-sync.md` (spécification UX), `docs/architecture.md` (architecture P2PSync)

---

## Objectif

Démontrer la couche 3 (P2PSync) dans un usage réel avec une UX soignée. Le chat est le prétexte — l'enjeu est le traitement correct de **chaque transition des 3 SM** (P2PSync, Guard, Session) côté utilisateur.

---

## Structure de fichiers

```
pages/chat-ux/
├── index.html          ← page unique, CSS inline, dark theme
├── app.js              ← orchestration P2PSync + UI
└── chat-handler.js     ← handler de session "chat" (indépendant, fps 0)
```

Un seul fichier HTML, deux modules JS. Pas de build, pas de dépendance externe (hors PeerJS via importmap).

---

## Écrans et navigation

Trois écrans exclusifs, pilotés par l'état P2PSync :

```
P2PSync IDLE            → Écran 1 : Connexion
P2PSync CONNECTING      → Écran 1 : Connexion (formulaire désactivé, spinner)
P2PSync CONNECTED       → Écran 2 : Chat
P2PSync DISCONNECTED    → Écran 2 : Chat + overlay reconnexion
```

### Écran 1 — Connexion

```
┌──────────────────────────────────┐
│        pacpam chat               │
│                                  │
│   Pseudo   [__________]          │
│   Mot de passe [______]          │
│                                  │
│   Pair distant [______]          │
│                                  │
│   [ Connecter ]                  │
│                                  │
│   (état : message d'erreur)      │
└──────────────────────────────────┘
```

- Le bouton "Connecter" initie à la fois l'enregistrement PeerJS ET la connexion au pair distant
- L'utilisateur saisit les deux pseudos d'emblée (pas de séquence en deux temps)
- Pendant CONNECTING : formulaire grisé, spinner sur le bouton, texte "Connexion..."
- Échec p3 : message contextuel sous le formulaire (cf. ux-p2p-sync §"P2PSync → IDLE"), bouton "Réessayer" réactivé

### Écran 2 — Chat

```
┌──────────────────────────────────┐
│ ● pair connecté     [Quitter]    │  ← barre statut
├──────────────────────────────────┤
│                                  │
│              Bonjour !    12:04  │  ← msg envoyé (droite)
│  12:04  Salut !                  │  ← msg reçu (gauche)
│                                  │
│         ┌─── overlay ──────┐     │
│         │ Pair absent...   │     │  ← guard OPEN (semi-transparent)
│         └──────────────────┘     │
│                                  │
├──────────────────────────────────┤
│ [___message___________] [Envoyer]│  ← barre saisie
└──────────────────────────────────┘
```

---

## Composants UI

### Barre de statut

Indicateur combinant P2PSync × Guard :

| P2PSync | Guard | Point | Texte |
|---------|-------|-------|-------|
| CONNECTED | HALF_OPEN | jaune | "Connecté" |
| CONNECTED | CLOSED | vert | "pair connecté" |
| CONNECTED | OPEN | orange | "pair absent" |

Le bouton "Quitter" déclenche `disconnect()` (→ p4 c30, silencieux, retour écran 1).

### Zone de messages

- Messages envoyés à droite (couleur A), reçus à gauche (couleur B)
- Messages système centrés, discrets (connexion, déconnexion, erreurs)
- Horodatage HH:MM sur chaque message
- Auto-scroll vers le bas
- L'historique est conservé en cas de reconnexion (variable locale, pas dans le handler)

### Overlay reconnexion

Affiché en superposition sur le chat quand P2PSync = DISCONNECTED :

| Cause (detail.transition) | Contenu overlay |
|---------------------------|-----------------|
| c25 (CLOSE) | "Le pair a quitté" + bouton "Retour" (→ p6 RESET → écran 1) |
| c26 (PING_TIMEOUT) | "Connexion perdue — Reconnexion..." + spinner |
| c28 (SIGNALING_ERROR) | "Connexion perdue — Reconnexion..." + spinner |
| c29 (CONNECTION_ERROR) | "Connexion perdue — Reconnexion..." + spinner |

Pour c26/c28/c29 : reconnexion automatique (p5). Bouton "Abandonner" visible (→ p6 RESET → écran 1).

### Overlay pair absent

Affiché quand guard = OPEN (distinct de l'overlay reconnexion) :

- Bandeau semi-transparent au centre de la zone de messages
- Texte : "Pair absent..."
- Disparaît quand guard revient à CLOSED (g3 → g1)
- La saisie reste active (les messages seront reçus au retour du pair)

### Toast

Notifications temporaires (3s) pour les événements ponctuels :

| Événement | Toast |
|-----------|-------|
| p2 CONNECTED | "Connecté !" |
| g1 CLOSED (retour après absence) | "Pair de retour" |
| p3 TRANSPORT_FAILED | (pas de toast — message inline sur écran 1) |

---

## Session unique

```js
sync.createSession('chat', { mode: 'independent', fps: 0 }, chatHandler);
```

Une seule session "chat" (indépendante, fps 0). Le handshake s1 → s2 est transparent (< 100ms). L'UI du chat apparaît directement sur `onStart(ctrl)`.

### chat-handler.js

```
chatHandler {
    onStart(ctrl)           → stocke ctrl, notifie l'app (session prête)
    onEnd()                 → notifie l'app (session terminée)
    onMessage(payload)      → notifie l'app (message reçu)
    onPeerAbsent()          → notifie l'app (overlay pair absent)
    onPeerBack()            → notifie l'app (overlay disparaît)
    send(text, pseudo)      → ctrl.sendMessage({ text, from })
}
```

Le handler ne touche pas au DOM. Il communique avec `app.js` via des callbacks injectés à la construction.

---

## Flux P2PSync dans app.js

### Connexion

```
▶ Clic "Connecter"
    │
    ├── transport.init(pseudo, APP_ID)
    │   → onIdReady → transport.connect(remotePeerId)
    │   → onAuthRequired → send auth message
    │
    ├── p1 → UI : spinner "Connexion..."
    │
    ├── p2 → CONNECTED
    │   → écran 2 apparaît
    │   → hôte : sync.createSession('chat', ...)
    │   → toast "Connecté !"
    │
    └── p3 → IDLE (échec)
        → message d'erreur sur écran 1
```

### Déconnexion subie

```
p4 TRANSPORT_LOST
    │
    ├── c25 (pair a quitté)
    │   → overlay "Le pair a quitté" + bouton retour
    │
    └── c26/c28/c29 (réseau)
        → overlay "Connexion perdue — Reconnexion..."
        → p5 automatique → CONNECTING → p2 → sessions recréées → overlay disparaît
```

### Déconnexion volontaire

```
▶ Clic "Quitter"
    → transport.disconnect()
    → p4 (c30, silencieux)
    → retour écran 1
```

---

## Niveaux de dégradation (ref. ux-p2p-sync §"Niveaux de dégradation")

| Niveau | État | Feedback | Saisie |
|--------|------|----------|--------|
| 0 Nominal | CONNECTED + CLOSED | Point vert | Active |
| 1 Pair absent | CONNECTED + OPEN | Point orange + bandeau "Pair absent..." | Active (messages envoyés, reçus au retour) |
| 2 Déconnecté | DISCONNECTED | Overlay reconnexion | Désactivée |
| 3 Abandonné | IDLE (après p6) | Écran 1 | Active (formulaire) |

---

## Contraintes techniques

- **Couche 3 uniquement** : l'app utilise `P2PSync` et `PeerTransport`, jamais `NetworkManager` directement
- **Web Components vanilla** : pas de Shadow DOM (sauf demande explicite)
- **CSS inline** dans `index.html` : dark theme, responsive mobile-first
- **Pas de dépendance externe** : PeerJS via importmap uniquement
- **Imports depuis `../../src/index.js`** : API publique pacpam
