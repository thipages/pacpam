# chat-ux — implémentation

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
├── app.js              ← détection mode test, instanciation 1 ou 2 <chat-instance>
├── chat-instance.js    ← Web Component <chat-instance> : transport + P2PSync + UI
└── chat-handler.js     ← handler de session "chat" (indépendant, fps 0)
```

Un fichier HTML, trois modules JS. Pas de build, pas de dépendance externe (hors PeerJS via importmap).

---

## Architecture

Le chat est encapsulé dans un **Web Component `<chat-instance>`** (sans Shadow DOM). Chaque instance possède son propre `NetworkManager` + `PeerTransport` + `P2PSync`.

En mode normal, une seule instance pleine page. En mode test (`?test`), deux instances côte à côte dans une grille.

---

## Écrans et navigation

Trois écrans exclusifs. La connexion est séparée en deux actions distinctes (init puis connect) pour éviter une race condition PeerJS où un pair tente de se connecter avant que l'autre soit enregistré.

```
Écran 1 : Login      → "Rejoindre"  → transport.init()
Écran 2 : Lobby      → "Connecter"  → transport.connect()
Écran 3 : Chat       → conversation active
```

### Écran 1 — Login

```
┌──────────────────────────────────┐
│           Connexion              │
│                                  │
│   Pseudo   [__________]          │
│   Mot de passe [______]          │
│                                  │
│   [ Rejoindre ]                  │
│                                  │
│   (message d'erreur)             │
└──────────────────────────────────┘
```

- Clic "Rejoindre" → `transport.init(pseudo, APP_ID)` → enregistrement PeerJS
- Formulaire grisé + spinner pendant l'init
- Erreur : message sous le formulaire, formulaire réactivé

### Écran 2 — Lobby

```
┌──────────────────────────────────┐
│ Connecté au serveur    [Quitter] │
├──────────────────────────────────┤
│                                  │
│   Pseudo : ALICE                 │
│                                  │
│   Pseudo du pair [______]        │
│                                  │
│   [ Connecter ]                  │
│                                  │
│   (message d'erreur)             │
└──────────────────────────────────┘
```

- Affiché après `onIdReady` (le pair est enregistré sur PeerJS)
- L'utilisateur saisit le pseudo du pair distant → clic "Connecter"
- Bouton "Quitter" → `transport.disconnect()` → retour écran 1
- Erreur : message sous le formulaire, champ réactivé

### Écran 3 — Chat

```
┌──────────────────────────────────┐
│ ● pair connecté     [Quitter]    │  ← barre statut
├──────────────────────────────────┤
│                                  │
│              Bonjour !    12:04  │  ← msg envoyé (droite)
│  12:04  Salut !                  │  ← msg reçu (gauche)
│                                  │
│         ┌─── overlay ──────┐     │
│         │ Pair absent      │     │  ← guard OPEN (semi-transparent)
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
| CONNECTED | HALF_OPEN | jaune clignotant | "Connecté" |
| CONNECTED | CLOSED | vert | pseudo du pair |
| CONNECTED | OPEN | orange | "Pair absent" |

Le bouton "Quitter" déclenche `disconnect()` (→ p4 c30, silencieux, retour écran 1).

### Zone de messages

- Messages envoyés à droite (couleur A), reçus à gauche (couleur B)
- Nom de l'expéditeur affiché sur les messages reçus
- Horodatage HH:MM sur chaque message
- Auto-scroll vers le bas

### Overlay reconnexion

Affiché en superposition sur le chat quand P2PSync = DISCONNECTED :

| Cause (transition couche 2) | Contenu overlay |
|------------------------------|-----------------|
| c25 (CLOSE) | "Le pair a quitté la conversation" + bouton "Retour" |
| c26/c28/c29 (réseau) | "Connexion perdue" + boutons "Reconnecter" / "Abandonner" |

Note : la reconnexion automatique (p5) n'est pas encore implémentée dans la lib. Les boutons ramènent à l'écran 1 avec les champs pré-remplis (Reconnecter) ou vides (Abandonner).

### Overlay pair absent

Affiché quand guard = OPEN (distinct de l'overlay reconnexion) :

- Bandeau semi-transparent au centre de la zone de messages
- Texte : "Pair absent"
- Disparaît quand guard revient à CLOSED
- La saisie reste active

### Toast

Notifications temporaires (3s) :

| Événement | Toast |
|-----------|-------|
| p2 CONNECTED | "Connecté !" |
| guard retour CLOSED après OPEN | "Pair de retour" |

---

## Session unique

```js
sync.createSession('chat', { mode: 'independent', fps: 0 }, chatHandler)
```

Une seule session "chat" (indépendante, fps 0). L'hôte crée la session dans `onConnected`. Le guest retourne un handler dans `onSessionCreate`.

### chat-handler.js

```js
createChatHandler(callbacks) → {
    onStart(ctrl)       → stocke ctrl, notifie via callback
    onEnd()             → libère ctrl, notifie via callback
    onMessage(payload)  → notifie via callback (payload.text, payload.from)
    send(text, from)    → ctrl.sendMessage({ text, from })
}
```

Le handler ne touche pas au DOM. Il communique via des callbacks injectés à la construction.

---

## Flux de connexion

```
▶ Clic "Rejoindre" (écran 1)
    ├── transport.init(pseudo, APP_ID)
    ├── onIdReady → écran 2 (lobby)
    └── onError → message d'erreur, formulaire réactivé

▶ Clic "Connecter" (écran 2)
    ├── transport.connect(APP_ID-remotePseudo)
    ├── onAuthRequired → createAuthMessage(password, pseudo) → transport.send()
    ├── onData type auth → verifyHash → authSuccess() / authFailed()
    ├── p2 CONNECTED → écran 3, toast "Connecté !"
    ├── onConnected(isHost) → hôte crée la session chat
    └── onError → message d'erreur, champ réactivé
```

### Déconnexion subie

```
p4 TRANSPORT_LOST
    ├── c25 (pair a quitté)
    │   → overlay "Le pair a quitté" + bouton Retour
    └── c26/c28/c29 (réseau)
        → overlay "Connexion perdue" + Reconnecter / Abandonner
```

### Déconnexion volontaire

```
▶ Clic "Quitter"
    → transport.disconnect()
    → retour écran 1 (silencieux)
```

---

## Mode test (`?test`)

Deux instances `<chat-instance>` côte à côte dans une grille CSS.

- Pseudos pré-remplis via attribut (`ALICE`, `BOB`)
- Mots de passe pré-remplis (`test`)
- Cross-wire : quand une instance émet `id-ready`, l'autre reçoit le pseudo distant via la propriété `remotePeerId`
- **Pas d'auto-clic** : l'utilisateur clique manuellement sur chaque bouton pour observer le flux

---

## Niveaux de dégradation (ref. ux-p2p-sync)

| Niveau | État | Feedback | Saisie |
|--------|------|----------|--------|
| 0 Nominal | CONNECTED + CLOSED | Point vert | Active |
| 1 Pair absent | CONNECTED + OPEN | Point orange + bandeau "Pair absent" | Active |
| 2 Déconnecté | DISCONNECTED | Overlay reconnexion | Désactivée |
| 3 Abandonné | IDLE (après reset) | Écran 1 | Active (formulaire) |

---

## Contraintes techniques

- **Web Component `<chat-instance>`** : sans Shadow DOM, préfixe CSS `ci-`
- **CSS inline** dans `index.html` : dark theme, responsive mobile-first
- **Pas de dépendance externe** : PeerJS via importmap uniquement
- **APP_ID** : `'pacpam-chat-7f3a9c2e1d4b'`
