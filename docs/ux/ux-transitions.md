# Transitions UI — couples et recommandations UX

Guide UX pour les transitions des machines à états. Complète `architecture.md` avec les aspects interface utilisateur.

## Table des matières

- [Modes applicatifs et débit](#modes-applicatifs-et-débit)
- [Transitions entre modes](#transitions-entre-modes)
- [Interaction couche 2 / sessions](#interaction-couche-2--sessions)
- [Couples de transitions UI (happy path)](#couples-de-transitions-ui-happy-path)
- [Couples de transitions UI (hors happy path)](#couples-de-transitions-ui-hors-happy-path)
- [Recommandations UX (happy path)](#recommandations-ux-happy-path)
- [Recommandations UX (hors happy path)](#recommandations-ux-hors-happy-path)

---

## Modes applicatifs et débit

L'architecture décrit deux modes de transport (discret / continu). Au niveau applicatif, `fps = 0` recouvre deux usages distincts — chat et jeu tour par tour — ce qui donne **3 modes applicatifs** :

| Mode | fps | Session | Communication |
|------|-----|---------|---------------|
| **Chat** | 0 | indépendante | `sendMessage()` via SessionCtrl |
| **Jeu tour par tour** | 0 | centralisée | `sendAction()` / `broadcastState()` via SessionCtrl |
| **Jeu temps réel** | > 0 | centralisée | `sendAction()` + boucle `setInterval` |

### Le chat est une action

Dans une session centralisée, un message chat est simplement une action comme une autre :

```js
// Guest envoie un message chat
ctrl.sendAction({ type: 'chat', text: 'hello' });

// Guest envoie un coup de jeu
ctrl.sendAction({ type: 'move', x: 3, y: 5 });
```

Le handler les traite uniformément dans `processAction()`. L'hôte diffuse ensuite l'état complet. **Un seul flux, un seul canal.**

En revanche, si le chat est une session indépendante (recommandé), il utilise `sendMessage()` — sans autorité de l'hôte.

### Débit par mode

| Mode | Guest → Hôte | Hôte → Guest | Total max |
|------|-------------|-------------|-----------|
| **Chat** | `message` ≤ 20/sec | `message` ≤ 20/sec | 40 msg/sec |
| **Tour par tour** | `action` ≤ 10/sec | `fullState` ponctuel | ~20 msg/sec |
| **Temps réel (30fps)** | `localState` 30/sec + `action` ≤ 10/sec | `fullState` 30/sec | **~70 msg/sec** |

En temps réel, le volume est dominé par les messages de sync (`fullState` + `localState`), les actions discrètes n'ajoutent qu'une fraction marginale.

---

## Transitions entre modes

Tous les modes nécessitent connexion = CONNECTED. Les transitions entre modes sont des actions ▶ utilisateur, gérées via les sessions P2PSync :

```
                  createSession (fps=0)              setFps(n>0)
    Chat ─────────────────────────→ Tour par tour ──────────────────→ Temps réel
     ↑                                    ↑                              │
     │          endSession                │         setFps(0)            │
     └────────────────────────────────────┘←─────────────────────────────┘
```

| Transition | Effet P2PSync | Effet chat |
|------------|---------------|------------|
| Chat → Tour par tour | `createSession('game', { mode: 'centralized', fps: 0 }, handler)` | Inchangé (session séparée) |
| Tour par tour → Temps réel | `ctrl.setFps(30)` — la boucle continue démarre | Inchangé |
| Temps réel → Tour par tour | `ctrl.setFps(0)` — la boucle s'arrête | Inchangé |
| Tour par tour → Chat | `sync.endSession('game')` | Inchangé |

---

## Interaction couche 2 / sessions

| Événement connexion | Session en cours | Conséquence |
|---------------------|-----------------|-------------|
| CONNECTED → READY (c25 CLOSE) | Jeu | Fin normale côté pair — toutes les sessions passent en DISCONNECTED |
| CONNECTED → READY (c26, c28, c29) | Jeu | Perte réseau — sessions DISCONNECTED, reconnexion possible |
| CONNECTED ↺ (c27 SIGNALING_LOST) | Jeu | **Aucun impact** — le canal P2P tient, la sync continue |
| CONNECTED → IDLE (c30 DISCONNECT) | Jeu | Fin définitive — sessions DISCONNECTED, cleanup |

---

## Couples de transitions UI (happy path)

### Connexion — 6 couples

Le happy path couvre deux rôles :
- **Hôte** : IDLE →(c1) INITIALIZING →(c2) READY →(c6) CONNECTING →(c12) AUTHENTICATING →(c18) CONNECTED
- **Invité** : IDLE →(c1) INITIALIZING →(c2) READY →(c7) AUTHENTICATING →(c18) CONNECTED

| Étape | De | Événement |
|-------|----|-----------|
| 1 | IDLE | c1 INIT |
| 2 | INITIALIZING | c2 PEER_OPEN |
| 3 (hôte) | READY | c6 CONNECT_TO |
| 3 (invité) | READY | c7 CONNECTION_OPEN |
| 4 (hôte) | CONNECTING | c12 CONNECTION_OPEN |
| 5 | AUTHENTICATING | c18 AUTH_SUCCESS |

### Fin de conversation — 2 couples

| De | Événement | Rôle |
|----|-----------|------|
| CONNECTED | c30 DISCONNECT | Initiateur (▶ utilisateur) |
| CONNECTED | c25 CLOSE | Pair distant (système) |

### Disjoncteur — 3 couples (cycle de récupération)

CLOSED →(cb2) OPEN →(cb5) HALF_OPEN →(cb7) CLOSED

| De | Événement |
|----|-----------|
| CLOSED | cb2 THRESHOLD_REACHED |
| OPEN | cb5 RESET_TIMEOUT |
| HALF_OPEN | cb7 SUCCESS |

---

## Couples de transitions UI (hors happy path)

### Connexion → IDLE (reset complet) — 5 couples

> Depuis CONNECTED, seul un DISCONNECT volontaire (c30) ramène en IDLE. Les pannes réseau retombent en READY.

| De | Événements |
|----|-----------|
| INITIALIZING | c3 ID_UNAVAILABLE, c4 PEER_CREATION_ERROR, c5 SIGNALING_ERROR |
| READY | c8 SIGNALING_LOST, c9 SIGNALING_ERROR, c10 CONNECTION_ERROR, c11 DISCONNECT |
| CONNECTING | c17 DISCONNECT |
| AUTHENTICATING | c24 DISCONNECT |

### Connexion → READY (retour en attente) — 4 couples

> c25 CLOSE est traité dans le happy path. Les fermetures inattendues sont détectées par c26, c28 ou c29.

| De | Événements |
|----|-----------|
| CONNECTING | c13 TIMEOUT, c14 PEER_UNAVAILABLE, c15 SIGNALING_ERROR, c16 CONNECTION_ERROR |
| AUTHENTICATING | c19 AUTH_FAILED, c20 AUTH_TIMEOUT, c21 CLOSE, c22 SIGNALING_ERROR, c23 CONNECTION_ERROR |
| CONNECTED | c26 PING_TIMEOUT, c28 SIGNALING_ERROR, c29 CONNECTION_ERROR |

### Connexion → CONNECTED (auto-réparation) — 1 couple

| De | Événement |
|----|-----------|
| CONNECTED (↺) | c27 SIGNALING_LOST |

### Disjoncteur → CLOSED (retour nominal) — 3 couples

| De | Événements |
|----|-----------|
| CLOSED (↺) | cb1 SUCCESS, cb3 RESET 🔧 |
| OPEN | cb6 RESET 🔧 |
| HALF_OPEN | cb9 RESET 🔧 |

### Disjoncteur → OPEN (protection activée) — 2 couples

| De | Événements |
|----|-----------|
| CLOSED | cb4 FORCE_OPEN 🔧 |
| HALF_OPEN | cb8 FAILURE, cb10 FORCE_OPEN 🔧 |

### État composé READY × CB — 1 couple

La guard sur c6 crée un **état composé** :

| État connexion | État CB | Comportement UI |
|---------------|---------|----------------|
| READY | CLOSED | Normal — bouton connecter actif |
| READY | OPEN | Bloqué — afficher cooldown ("réessayer dans X s") |
| READY | HALF_OPEN | Test — tentative automatique en cours |

Chaîne causale : échecs connexion (c13–c16) → FAILURE au CB → après N échecs CB passe OPEN (cb2) → guard bloque c6 → UI affiche cooldown → timeout → CB passe HALF_OPEN (cb5) → tentative test → succès (cb7 → CLOSED) ou échec (cb8 → OPEN).

**Total : 10 couples connexion + 5 couples disjoncteur + 1 composé = 16 scénarios UI hors happy path.**

---

## Recommandations UX (happy path)

### Principes généraux

- **Progression visible** : chaque étape donne un feedback immédiat (spinner, changement d'écran)
- **Pas de cul-de-sac** : l'utilisateur sait toujours ce qui se passe et ce qui va suivre
- **Transitions fluides** : changements d'écran ≤ 300ms
- **Rôle transparent** : l'invité n'a pas besoin d'agir — l'UI réagit automatiquement

### Connexion — progression nominale

| Couple | Événement | Déclencheur | Écran suivant | Feedback |
|--------|----------|-------------|---------------|----------|
| IDLE→INIT | c1 | ▶ | Spinner "Connexion au serveur..." | Formulaire désactivé |
| INIT→READY | c2 | Système | Écran d'attente | Toast succès : "Connecté au serveur" |
| READY→CONNECTING | c6 | ▶ | Spinner "Connexion à \<peerId\>..." | Bouton désactivé |
| READY→AUTH (invité) | c7 | Système | Bandeau "Authentification..." | Automatique |
| CONNECTING→AUTH (hôte) | c12 | Système | Spinner "Vérification..." | Transition fluide du label |
| AUTH→CONNECTED | c18 | Système | Interface principale | Toast : "Conversation établie" |

> **Animation** : barre de progression ou étapes numérotées (1. Serveur — 2. Contact — 3. Auth). Chaque étape coche au passage.

### Fin de conversation

| Couple | Événement | Rôle | Feedback |
|--------|----------|------|----------|
| CONNECTED→IDLE | c30 | Initiateur | Silencieux — retour fluide à l'écran initial |
| CONNECTED→READY | c25 | Pair distant | Toast info : "Le contact a quitté la conversation" |

> c25 CLOSE : la SM ne distingue pas fermeture volontaire et crash. Les pertes réseau sont détectées par c26/c28/c29.

### Disjoncteur — cycle de récupération

| Couple | Événement | Comportement UI |
|--------|----------|-----------------|
| CLOSED→OPEN | cb2 | Bandeau cooldown : "Nouvelle tentative dans Xs" |
| OPEN→HALF_OPEN | cb5 | Bascule vers "Test en cours..." avec spinner |
| HALF_OPEN→CLOSED | cb7 | Bandeau disparaît, retour à l'écran normal |

> **Principe** : l'utilisateur ne sait pas qu'un disjoncteur existe. Il voit un délai d'attente qui se résout tout seul.

### Modes applicatifs

| Transition | Écran suivant | Feedback |
|------------|---------------|----------|
| Chat → Tour par tour | Chat + plateau de jeu | Toast : "Partie lancée" |
| Chat → Temps réel | Interface plein écran | Toast : "Partie lancée", chat en overlay |
| Tour par tour → Temps réel | Interface plein écran | Le plateau s'agrandit, chat en overlay |
| Temps réel → Tour par tour | Chat + plateau (figé) | Bandeau "Pause" |
| Tour par tour → Chat | Interface de chat | Toast : "Partie terminée" + résumé |
| Temps réel → Chat | Interface de chat | Écran de résultat puis retour chat |

> Les transitions de mode ne coupent jamais la connexion. C'est un changement d'interface, pas de connexion.

---

## Recommandations UX (hors happy path)

### Principes généraux

- **Pas de jargon technique** : l'utilisateur ne connaît pas les états internes
- **Feedback immédiat** : toute régression visible en < 300ms
- **Action claire** : chaque état dégradé propose une action (réessayer, patienter, vérifier)
- **Dégradation gracieuse** : les auto-réparations sont silencieuses si elles réussissent

### Connexion → IDLE (reset complet)

Retour à l'écran initial. Contexte perdu.

| Couple | Événements | Feedback | Action |
|--------|-----------|----------|--------|
| INIT→IDLE | c3 | Toast erreur : "Identifiant déjà utilisé" | Bouton "Réessayer avec un autre ID" |
| INIT→IDLE | c4 | Toast erreur : "Impossible de créer la connexion P2P" | Vérifier WebRTC |
| INIT→IDLE | c5 | Toast erreur : "Impossible de joindre le serveur" | Bouton "Réessayer" |
| READY→IDLE | c8 | Toast warning : "Connexion au serveur perdue" | Reconnexion auto 3s |
| READY→IDLE | c9, c10 | Toast erreur : "Erreur serveur/connexion" | Bouton "Réessayer" |
| READY→IDLE | c11 | Silencieux | Retour écran d'accueil |
| CONNECTING→IDLE | c17 | Silencieux | Retour écran d'accueil |
| AUTH→IDLE | c24 | Silencieux | Retour écran d'accueil |

> Les transitions ▶ utilisateur (c11, c17, c24) n'affichent pas de toast.

### Connexion → READY (retour en attente)

La session échoue mais le serveur de signalisation reste accessible.

| Couple | Événements | Feedback | Action |
|--------|-----------|----------|--------|
| CONNECTING→READY | c13 | Toast warning : "Délai dépassé" | Réessayer |
| CONNECTING→READY | c14 | Toast info : "Contact introuvable" | Vérifier l'identifiant |
| CONNECTING→READY | c15, c16 | Toast erreur : "Erreur serveur/connexion" | Réessayer |
| AUTH→READY | c19 | Toast erreur : "Authentification refusée" | Vérifier le mot de passe |
| AUTH→READY | c20 | Toast warning : "Délai d'authentification dépassé" | Réessayer |
| AUTH→READY | c21 | Toast warning : "Connexion fermée par le contact" | Réessayer |
| AUTH→READY | c22, c23 | Toast erreur : "Erreur serveur/connexion" | Réessayer |
| CONNECTED→READY | c26, c28, c29 | Toast warning : "Contact injoignable / connexion perdue" | Reconnexion auto 3s |

> Pour les auto-retry (c26, c28, c29) : la zone de chat se grise avec un bandeau "Reconnexion..."

### Connexion → CONNECTED (auto-réparation)

| Couple | Événement | Feedback |
|--------|----------|----------|
| CONNECTED ↺ | c27 SIGNALING_LOST | Indicateur discret (icone orange) : "Reconnexion signalisation..." |

> Ne pas alarmer l'utilisateur. Le canal données P2P fonctionne toujours. L'icone orange suffit.

### Disjoncteur — transitions internes

Les transitions CB → CLOSED sont **invisibles** (retour nominal, compteurs internes remis à zéro).

Les transitions CB → OPEN (cb4, cb8, cb10) sont visibles indirectement via l'état composé READY × CB :

| État CB | Affichage UI | Comportement |
|---------|-------------|-------------|
| CLOSED | Écran normal — bouton connecter actif | Connexion libre |
| OPEN | Bandeau : "Trop de tentatives — nouvelle tentative dans Xs" — bouton désactivé, compteur dégressif | Patienter |
| HALF_OPEN | Bandeau : "Test de connexion en cours..." — spinner | Tentative automatique unique |

> La transition OPEN→HALF_OPEN : le compteur atteint 0, bascule fluide vers "Test en cours..." sans rechargement.
