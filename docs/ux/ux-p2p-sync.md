# Transitions UI — couche 3 (P2PSync, Guard, Session)

Guide UX pour les transitions des machines à états de la couche 3. Complète `ux-transitions.md` (couche 2) avec la couche applicative.

## Table des matières

- [Vue d'ensemble des 3 SM](#vue-densemble-des-3-sm)
- [Projection couche 2 → P2PSync](#projection-couche-2--p2psync)
- [États composés P2PSync × Guard × Sessions](#états-composés-p2psync--guard--sessions)
- [Couples de transitions UI (happy path)](#couples-de-transitions-ui-happy-path)
- [Couples de transitions UI (hors happy path)](#couples-de-transitions-ui-hors-happy-path)
- [Recommandations UX (happy path)](#recommandations-ux-happy-path)
- [Recommandations UX (hors happy path)](#recommandations-ux-hors-happy-path)
- [Latence et timing](#latence-et-timing)
- [Déconnexion et reconnexion — guide détaillé](#déconnexion-et-reconnexion--guide-détaillé)

---

## Vue d'ensemble des 3 SM

La couche 3 regroupe trois machines à états parallèles. Elles partagent le même vocabulaire (IDLE, CONNECTING, CONNECTED, DISCONNECTED) mais vivent à des niveaux différents.

```
P2PSync :           IDLE → CONNECTING → CONNECTED → DISCONNECTED
                                             │
guard présence :              [HALF_OPEN → CLOSED ↔ OPEN]
                                             │
sessions (× N) :        IDLE → CONNECTING → CONNECTED → DISCONNECTED
```

| SM | États | Transitions | Rôle |
|----|-------|-------------|------|
| **P2PSync** | 4 (IDLE, CONNECTING, CONNECTED, DISCONNECTED) | p1–p6 (6) | Projection groupée de la couche 2 |
| **Guard** | 3 (HALF_OPEN, CLOSED, OPEN) | g1–g4 (4) | Surveillance présence du pair en CONNECTED |
| **Session** | 4 (IDLE, CONNECTING, CONNECTED, DISCONNECTED) | s1–s4 (4) | Cycle de vie par session multiplexée |

**Contraintes hiérarchiques** :
- Le guard ne vit que quand P2PSync = CONNECTED
- Une session ne peut être CONNECTED que si P2PSync = CONNECTED
- Si P2PSync quitte CONNECTED → guard réinitialisé, toutes les sessions → DISCONNECTED

---

## Projection couche 2 → P2PSync

P2PSync simplifie les 6 états et 30 transitions de la couche 2 en 4 états et 6 transitions. L'application n'a pas besoin de connaître les états intermédiaires (INITIALIZING, READY, AUTHENTICATING).

### Correspondance des états

| P2PSync | États couche 2 regroupés | Signification utilisateur |
|---------|--------------------------|---------------------------|
| **IDLE** | IDLE | Pas de connexion |
| **CONNECTING** | INITIALIZING, READY, CONNECTING, AUTHENTICATING | Connexion en cours |
| **CONNECTED** | CONNECTED | Connecté — sessions possibles |
| **DISCONNECTED** | *(propre à P2PSync)* | Était connecté, connexion perdue |

### Émissions couche 2 → P2PSync

| Transition couche 2 | Événement émis | Transition P2PSync | Condition |
|----------------------|----------------|---------------------|-----------|
| c1 IDLE → INITIALIZING | CONNECT | p1 IDLE → CONNECTING | — |
| c18 AUTH → CONNECTED | TRANSPORT_CONNECTED | p2 CONNECTING → CONNECTED | — |
| c3–c5 → IDLE | TRANSPORT_FAILED | p3 CONNECTING → IDLE | P2PSync = CONNECTING |
| c8–c11 → IDLE | TRANSPORT_FAILED | p3 CONNECTING → IDLE | P2PSync = CONNECTING |
| c25 CLOSE | TRANSPORT_LOST | p4 CONNECTED → DISCONNECTED | — |
| c26 PING_TIMEOUT | TRANSPORT_LOST | p4 CONNECTED → DISCONNECTED | — |
| c28 SIGNALING_ERROR | TRANSPORT_LOST | p4 CONNECTED → DISCONNECTED | — |
| c29 CONNECTION_ERROR | TRANSPORT_LOST | p4 CONNECTED → DISCONNECTED | — |
| c30 DISCONNECT | TRANSPORT_LOST | p4 CONNECTED → DISCONNECTED | — |
| c27 SIGNALING_LOST ↺ | *(aucun)* | *(aucune)* | Canal P2P tient |
| → IDLE (après DISCONNECTED) | RESET | p6 DISCONNECTED → IDLE | P2PSync = DISCONNECTED |

> c27 (SIGNALING_LOST) est un self-loop en couche 2 et ne produit aucune transition en couche 3. Le canal de données P2P fonctionne toujours.

---

## États composés P2PSync × Guard × Sessions

L'état perçu par l'utilisateur est la combinaison des trois SM. Voici les combinaisons significatives.

### P2PSync × Guard (pendant CONNECTED)

| P2PSync | Guard | Signification | Indicateur UI |
|---------|-------|---------------|---------------|
| CONNECTED | HALF_OPEN | Vient de se connecter, en attente de confirmation | Neutre (pas d'indicateur) |
| CONNECTED | CLOSED | Pair présent et réactif | Indicateur vert |
| CONNECTED | OPEN | Pair absent — timeout sans données | Indicateur orange/rouge |

### P2PSync × Sessions

| P2PSync | Session | Possible ? | Signification |
|---------|---------|------------|---------------|
| IDLE / CONNECTING | Toute | Non | Aucune session avant CONNECTED |
| CONNECTED | CONNECTING | Oui | Handshake de session en cours |
| CONNECTED | CONNECTED | Oui | Session active — données circulent |
| DISCONNECTED | DISCONNECTED | Oui | Toutes les sessions tombent simultanément |

### Triple composé : CONNECTED × Guard × Session

| Guard | Session(s) | Expérience utilisateur |
|-------|-----------|------------------------|
| CLOSED | CONNECTED | **Nominal** — tout fonctionne, données circulent |
| OPEN | CONNECTED | **Dégradé** — session active mais pair absent. Jeu en pause, chat silencieux |
| HALF_OPEN | CONNECTED | **Transitoire** — premier signe de vie, pas encore confirmé |
| CLOSED | CONNECTING | **Handshake** — pair présent, session en cours de négociation |

---

## Couples de transitions UI (happy path)

### P2PSync — 3 couples (connexion nominale)

IDLE →(p1) CONNECTING →(p2) CONNECTED →(p4) DISCONNECTED

| Étape | De | Transition | Déclencheur |
|-------|----|------------|-------------|
| 1 | IDLE | p1 CONNECT | ▶ utilisateur (via couche 2 c1) |
| 2 | CONNECTING | p2 TRANSPORT_CONNECTED | Système (couche 2 c18) |
| 3 | CONNECTED | p4 TRANSPORT_LOST | Pair/réseau (couche 2 c25/c26/c28/c29) ou ▶ utilisateur (c30) |

### Guard — 3 couples (cycle de confirmation)

HALF_OPEN →(g1) CLOSED →(g4↺) CLOSED →(g2) OPEN

| De | Transition | Déclencheur |
|----|------------|-------------|
| HALF_OPEN | g1 DATA_RECEIVED | Système (premières données du pair) |
| CLOSED | g4 DATA_RECEIVED ↺ | Système (données continues — self-loop) |
| CLOSED | g2 TIMEOUT | Système (5s sans données) |

### Session — 3 couples (cycle de vie nominal)

IDLE →(s1) CONNECTING →(s2) CONNECTED →(s3) DISCONNECTED

| Étape | De | Transition | Déclencheur | Rôle |
|-------|----|------------|-------------|------|
| 1 | IDLE | s1 CREATE | Hôte (`createSession`) ou guest (réception `sessionCreate`) |
| 2 | CONNECTING | s2 READY | Système (guest envoie `sessionReady`) |
| 3 | CONNECTED | s3 END | Hôte (`endSession`) ou perte de connexion |

### Reconnexion — 1 couple

| De | Transition | Déclencheur |
|----|------------|-------------|
| DISCONNECTED | p5 RECONNECT | Système (reconnexion automatique) |

---

## Couples de transitions UI (hors happy path)

### P2PSync → IDLE (échec avant connexion) — 1 couple

| De | Transition | Événements couche 2 | Signification |
|----|------------|---------------------|---------------|
| CONNECTING | p3 TRANSPORT_FAILED | c3–c5, c8–c11 → IDLE | Échec réseau/serveur avant d'avoir été connecté |

### P2PSync → IDLE (reset après déconnexion) — 1 couple

| De | Transition | Signification |
|----|------------|---------------|
| DISCONNECTED | p6 RESET | Abandon de la reconnexion — retour à l'état initial |

### Guard → OPEN (pair absent) — 1 couple

| De | Transition | Cause |
|----|------------|-------|
| CLOSED | g2 TIMEOUT | Aucune donnée depuis 5s (tous flux confondus) |

### Guard → récupération (pair de retour) — 2 couples

| De | Transition | Signification |
|----|------------|---------------|
| OPEN | g3 DATA_RECEIVED → HALF_OPEN | Premier signe de vie |
| HALF_OPEN | g1 DATA_RECEIVED → CLOSED | Confirmation — pair de retour |

### Session → DISCONNECTED (fin prématurée) — 1 couple

| De | Transition | Cause |
|----|------------|-------|
| CONNECTING | s4 END | Perte de connexion P2PSync pendant le handshake de session |

### Cascade : P2PSync DISCONNECTED → toutes sessions DISCONNECTED

Quand p4 se déclenche, toutes les sessions en cours (CONNECTING ou CONNECTED) reçoivent un END forcé. Ce n'est pas une transition de session individuelle — c'est un effet en cascade.

| Événement | Effet Guard | Effet Sessions |
|-----------|-------------|----------------|
| p4 TRANSPORT_LOST | Guard détruit (réinitialisé à HALF_OPEN au prochain CONNECTED) | Toutes → DISCONNECTED (s3 ou s4 selon l'état) |

**Total : 3 P2PSync + 3 Guard + 1 Session + 1 cascade = 8 scénarios UI hors happy path.**

---

## Recommandations UX (happy path)

### Principes généraux

- **Regroupement** : l'utilisateur ne voit pas les 30 transitions de la couche 2, il voit 4 états P2PSync
- **Progression fluide** : IDLE → "Connexion..." → interface principale
- **Sessions transparentes** : le handshake s1/s2 est invisible — l'UI apparaît quand la session est CONNECTED
- **Présence passive** : le guard est un indicateur, pas une action utilisateur

### P2PSync — progression nominale

| Couple | Transition | Déclencheur | Écran suivant | Feedback |
|--------|-----------|-------------|---------------|----------|
| IDLE → CONNECTING | p1 | ▶ | Spinner "Connexion..." | Formulaire désactivé |
| CONNECTING → CONNECTED | p2 | Système | Interface principale | Toast : "Connecté" |
| CONNECTED → DISCONNECTED | p4 (c25) | Pair distant | Bandeau "Déconnecté" | Toast : "Le contact a quitté" |
| CONNECTED → DISCONNECTED | p4 (c30) | ▶ utilisateur | Retour écran initial | Silencieux |
| CONNECTED → DISCONNECTED | p4 (c26/c28/c29) | Réseau | Bandeau "Reconnexion..." | Toast : "Connexion perdue" |
| DISCONNECTED → CONNECTING | p5 | Système | Spinner "Reconnexion..." | Automatique |

> Pendant CONNECTING, l'application peut écouter `onStateChange` pour afficher les étapes détaillées (serveur → contact → auth) — mais ce n'est pas obligatoire. L'état groupé "Connexion..." suffit pour la plupart des usages.

### Guard — indicateur de présence

| Couple | Transition | Feedback | Durée visible |
|--------|-----------|----------|---------------|
| HALF_OPEN → CLOSED | g1 | Indicateur vert apparaît | Permanent |
| CLOSED ↺ | g4 | *(invisible — timer interne réinitialisé)* | — |
| CLOSED → OPEN | g2 | Indicateur passe orange : "Pair absent" | Jusqu'à g3 ou déconnexion |
| OPEN → HALF_OPEN → CLOSED | g3 + g1 | Indicateur redevient vert | Transition rapide |

> **Principe** : l'indicateur de présence est un point coloré discret dans la barre de statut. Vert = pair réactif, orange = pair absent. Pas de popup, pas de toast — c'est un signal passif.

### Session — cycle transparent

| Couple | Transition | Feedback |
|--------|-----------|----------|
| IDLE → CONNECTING | s1 | *(invisible — handshake interne)* |
| CONNECTING → CONNECTED | s2 | L'UI de la session apparaît (chat, plateau de jeu, etc.) |
| CONNECTED → DISCONNECTED | s3 (explicite) | Toast : "Partie terminée" / "Session fermée" |
| CONNECTED → DISCONNECTED | s3 (perte connexion) | *(géré par P2PSync — pas de feedback séparé par session)* |

> Le handshake de session (s1 → s2) est typiquement < 100ms sur un canal P2P déjà ouvert. L'utilisateur ne le perçoit pas. L'UI de la session doit apparaître directement sur `onStart(ctrl)`.

### Séquence complète — du lancement à la partie

```
[Écran d'accueil]
    ▶ "Connecter"
        │
        ├── p1 → Spinner "Connexion..."
        │         (couche 2 : c1→c2→c6/c7→c12→c18)
        │
        ├── p2 → "Connecté !"
        │         guard démarre (HALF_OPEN)
        │         _presence CONNECTED automatiquement
        │
        ├── g1 → Indicateur vert (pair confirmé)
        │
        ├── s1+s2 "chat" → Zone de chat apparaît
        │
        ├── (plus tard) s1+s2 "game" → Plateau de jeu apparaît
        │                               _presence suspendue (fps 30 > 0.5)
        │
        ├── s3 "game" → "Partie terminée", plateau disparaît
        │                _presence reprend
        │
        └── p4 → "Déconnecté" (toutes sessions fermées, guard arrêté)
```

---

## Recommandations UX (hors happy path)

### Principes généraux

- **Simplicité** : l'utilisateur voit les états P2PSync, pas les détails couche 2
- **Niveaux de gravité** : perte de présence (guard) < perte de session < perte de connexion (P2PSync)
- **Cascade descendante** : une déconnexion P2PSync gère automatiquement tout ce qui est en dessous — pas besoin de feedback par session

### P2PSync → IDLE (échec connexion)

| Couple | Transition | Causes couche 2 | Feedback | Action |
|--------|-----------|-----------------|----------|--------|
| CONNECTING → IDLE | p3 | c3 ID_UNAVAILABLE | Toast : "Identifiant déjà utilisé" | Réessayer avec un autre ID |
| CONNECTING → IDLE | p3 | c4 PEER_CREATION_ERROR | Toast : "Impossible de créer la connexion" | Vérifier le navigateur |
| CONNECTING → IDLE | p3 | c5, c8, c9 serveur | Toast : "Serveur injoignable" | Bouton "Réessayer" |
| CONNECTING → IDLE | p3 | c10 CONNECTION_ERROR | Toast : "Erreur de connexion" | Bouton "Réessayer" |

> L'application peut distinguer les causes via `detail.transition` dans `onStateChange`. Mais un message générique "Connexion échouée — Réessayer" est acceptable pour la plupart des cas.

### P2PSync — déconnexion et reconnexion

| Couple | Transition | Feedback | Comportement |
|--------|-----------|----------|-------------|
| CONNECTED → DISCONNECTED | p4 (c26/c28/c29) | Bandeau "Reconnexion en cours..." | Reconnexion auto (p5) après délai |
| CONNECTED → DISCONNECTED | p4 (c25) | Toast : "Le contact a quitté" | Pas de reconnexion auto |
| CONNECTED → DISCONNECTED | p4 (c30) | Silencieux (▶ utilisateur) | Retour à IDLE |
| DISCONNECTED → CONNECTING | p5 | Spinner "Reconnexion..." | Automatique |
| DISCONNECTED → IDLE | p6 | Retour écran d'accueil | Fin du cycle de reconnexion |

> Pendant la reconnexion (DISCONNECTED → CONNECTING), la zone principale se grise avec un overlay "Reconnexion...". Si la reconnexion réussit (p2), l'overlay disparaît et l'hôte recrée les sessions — l'utilisateur retrouve son interface.

### Guard — pair absent

La perte de présence n'interrompt pas la connexion ni les sessions. C'est un signal informatif.

| Couple | Transition | Feedback handler | Feedback UI |
|--------|-----------|------------------|-------------|
| CLOSED → OPEN | g2 | `onPeerAbsent()` appelé sur chaque handler | Indicateur orange + bandeau "Pair absent" |
| OPEN → HALF_OPEN | g3 | — | Indicateur clignote (transitoire) |
| HALF_OPEN → CLOSED | g1 | `onPeerBack()` appelé sur chaque handler | Indicateur redevient vert |

#### Réactions recommandées par type de session

| Type de session | Pair absent (guard OPEN) | Pair de retour (guard CLOSED) |
|-----------------|--------------------------|-------------------------------|
| **Chat** | Indicateur "absent" à côté du nom | Indicateur disparaît |
| **Jeu tour par tour** | "En attente du joueur..." — timer du tour en pause | Reprise du tour |
| **Jeu temps réel** | Overlay pause semi-transparent | L'overlay disparaît, le jeu reprend |
| **Curseurs / présence** | Curseur distant grisé ou masqué | Curseur réapparaît |

> Le handler décide de la réaction. P2PSync notifie via `onPeerAbsent()` / `onPeerBack()` — c'est au handler d'implémenter le comportement (pause, griser, masquer, etc.).

### Session — fin prématurée

| Couple | Transition | Cause | Feedback |
|--------|-----------|-------|----------|
| CONNECTING → DISCONNECTED | s4 | P2PSync passe à DISCONNECTED pendant le handshake | *(absorbé par le feedback P2PSync — pas de message séparé)* |

> s4 est rare. Si le handshake échoue parce que la connexion tombe, l'utilisateur voit le feedback P2PSync ("Connexion perdue"), pas un feedback de session. La session n'a jamais été visible côté UI.

### Cascade — impact d'une déconnexion P2PSync

Quand P2PSync passe à DISCONNECTED, l'impact se propage vers le bas :

```
p4 TRANSPORT_LOST
    │
    ├── Guard → détruit (reset HALF_OPEN au prochain CONNECTED)
    │   └── Indicateur de présence disparaît
    │
    ├── _presence → DISCONNECTED
    │   └── Heartbeat arrêté
    │
    ├── Session "chat" → DISCONNECTED
    │   └── handler.onEnd() → "Chat terminé"
    │
    ├── Session "game" → DISCONNECTED
    │   └── handler.onEnd() → "Partie interrompue"
    │
    └── UI : overlay "Connexion perdue" couvre tout
```

**Règle** : un seul feedback global pour la déconnexion P2PSync. Les fins de sessions individuelles ne produisent pas de toast séparé — l'overlay P2PSync suffit. Les handlers appellent `onEnd()` pour leur nettoyage interne, mais l'UI ne doit pas empiler les messages.

### Reconnexion — recréation des sessions

Après une reconnexion réussie (p5 → p2), l'hôte doit recréer les sessions. Aucune session ne survit à une déconnexion.

```
p5 → CONNECTING → p2 → CONNECTED
    │
    ├── Guard redémarre (HALF_OPEN)
    ├── _presence CONNECTED (automatique)
    │
    ├── Hôte recrée "chat" → s1 → s2 → CONNECTED
    ├── Hôte recrée "game" → s1 → s2 → CONNECTED
    │
    └── UI : overlay "Reconnexion..." disparaît, interfaces réapparaissent
```

> L'état applicatif (messages de chat, position dans le jeu) dépend de l'implémentation des handlers. P2PSync ne persiste rien — c'est au handler de sauvegarder/restaurer si nécessaire.

---

## Latence et timing

### Budget temporel — constantes du système

Toutes les durées qui gouvernent la détection et la réaction. L'UI doit anticiper ces délais pour ne jamais laisser l'utilisateur sans feedback.

| Composant | Durée | Configurable | Rôle |
|-----------|-------|:------------:|------|
| **Ping interval** | 3s | oui | Fréquence des ping/pong (couche 2) |
| **Pong timeout** | 10s | oui | Seuil de détection pair mort (couche 2) |
| **Guard timeout** | 5s | oui | Seuil d'absence applicative (couche 3) |
| **Auth timeout** | 5s | oui | Durée max du handshake d'authentification |
| **Connection timeout** | 10s | oui | Durée max de l'établissement du canal P2P |
| **CB reset timeout** | 30s | oui | Durée de blocage après 3 échecs consécutifs |
| **Signaling reconnect** | 3s | non | Délai avant tentative de reconnexion signalisation |
| **Presence heartbeat** | 2s (0.5 fps) | non | Fréquence du heartbeat quand aucune session rapide |

### Chaîne de détection — du problème réseau au feedback utilisateur

Quand le réseau tombe, plusieurs mécanismes se déclenchent en cascade. L'ordre dépend du mode de communication actif.

#### En temps réel (session fps 30)

```
   0s   Réseau tombe
         │
   0–5s  Guard : plus de données reçues
         │
   5s    g2 TIMEOUT → guard OPEN
         │  └── onPeerAbsent() → UI : overlay pause
         │
   3–6s  Ping manqué (interval 3s)
         │
  10s    c26 PING_TIMEOUT → p4 TRANSPORT_LOST
         │  └── P2PSync DISCONNECTED → UI : overlay reconnexion
```

**L'utilisateur voit la pause en ~5s, la déconnexion en ~10s.** Le guard réagit avant la couche 2 car il surveille les données applicatives (envoyées à 30 fps) alors que le ping ne vérifie que toutes les 3s.

#### En chat / tour par tour (session fps 0)

```
   0s   Réseau tombe
         │
   0–2s  _presence heartbeat manqué (interval 2s)
         │
   5s    g2 TIMEOUT → guard OPEN
         │  └── onPeerAbsent() → UI : "Pair absent"
         │
   3–6s  Ping manqué (interval 3s)
         │
  10s    c26 PING_TIMEOUT → p4 TRANSPORT_LOST
         │  └── P2PSync DISCONNECTED → UI : overlay reconnexion
```

**Même timing**, mais la source de données du guard est le heartbeat `_presence` (toutes les 2s) plutôt que les messages de session.

#### Cas spécial : signalisation seule perdue

```
   0s   Signalisation WebSocket tombe (le canal P2P tient)
         │
   0s    c27 SIGNALING_LOST ↺ (self-loop, pas de transition P2PSync)
         │  └── UI : indicateur discret orange (icone signalisation)
         │
   3s    Tentative de reconnexion signalisation automatique
         │
         ├── Succès → indicateur disparaît, aucun impact utilisateur
         └── Échec + perte données P2P → c26 PING_TIMEOUT → p4 → déconnexion
```

**Aucun impact sur les sessions en cours.** Les données P2P continuent via RTCDataChannel. Seule la capacité à établir de nouvelles connexions est temporairement perdue.

### Perception de la latence par mode

| Mode | fps | Données toutes les… | Guard réagit en… | Latence perceptible ? |
|------|-----|---------------------|-------------------|-----------------------|
| **Chat** | 0 | à la demande + heartbeat 2s | 5s | Non (envois ponctuels) |
| **Tour par tour** | 0 | à la demande + heartbeat 2s | 5s | Non (pas de flux continu) |
| **Temps réel** | 30 | 33ms | 5s | **Oui** — tout retard > 50ms est visible |
| **Curseurs** | 15 | 67ms | 5s | Oui — saccades visibles > 100ms |
| **Présence** | 0.5 | 2000ms | 5s | Non (indicateurs lents par nature) |

### Temps réel — contraintes spécifiques

En temps réel (fps > 0), la latence réseau s'additionne à la latence de la boucle de synchronisation. L'utilisateur voit un état qui a **au moins 1 tick + RTT de retard**.

```
Pair A envoie localState → [RTT/2] → Pair B reçoit → [1 tick] → Pair B affiche
                                                      (33ms à 30fps)
```

#### Latence totale perçue

| Composant | Durée typique | Pire cas |
|-----------|:------------:|:--------:|
| RTT/2 (demi aller-retour P2P) | 10–30ms | 100ms+ |
| Tick de rendu (1/fps) | 33ms (30fps) | 33ms |
| **Total** | **43–63ms** | **133ms+** |

#### Recommandations UI pour le temps réel

- **Prédiction locale** : en mode centralisé, le guest appelle `processAction()` localement avant confirmation de l'hôte — l'action est immédiate côté UI, corrigée par le `fullState` autoritaire
- **Interpolation** : pour les positions (curseurs, personnages), interpoler entre le dernier état reçu et le suivant plutôt qu'afficher par à-coups
- **Indicateur de latence** : afficher le RTT si > 100ms (jaune) ou > 200ms (rouge). Le RTT est disponible via `onPing(latency)` de la couche 2
- **Pas de freeze** : ne jamais bloquer l'UI en attendant un message. Si un tick manque, conserver le dernier état reçu

### Dimensionnement guard timeout vs fps

Le guard timeout (5s par défaut) est calibré pour fonctionner avec tous les modes :

| Session la plus rapide | Données attendues en 5s | Marge |
|------------------------|:-----------------------:|:-----:|
| fps 0 + _presence (0.5 fps) | ~2 heartbeats | Faible — 1 heartbeat manqué = alerte en 5s |
| fps 5 | ~25 messages | Large |
| fps 15 | ~75 messages | Très large |
| fps 30 | ~150 messages | Très large |

> En chat pur (fps 0), le guard dépend uniquement du heartbeat `_presence` (1 message / 2s). Le timeout de 5s tolère 2 heartbeats manqués. Si le réseau est instable avec des pertes ponctuelles, le guard peut osciller CLOSED↔OPEN. Dans ce cas, l'application peut augmenter `guardTimeout` à 10s.

---

## Déconnexion et reconnexion — guide détaillé

La gestion de la déconnexion/reconnexion est **critique en temps réel** et **importante en général**. Cette section détaille les scénarios concrets et les réponses UX attendues.

### Niveaux de dégradation

La dégradation est progressive. Chaque niveau a son propre feedback et sa propre réponse.

```
Niveau 0 ── NOMINAL
    Guard CLOSED, sessions CONNECTED
    └── Indicateur vert, tout fonctionne

Niveau 1 ── PAIR ABSENT (guard OPEN)
    Connexion tient, pair ne répond plus
    └── Indicateur orange, jeu en pause, chat silencieux
    └── Réversible : g3+g1 → retour niveau 0

Niveau 2 ── DÉCONNECTÉ (P2PSync DISCONNECTED)
    Connexion perdue, sessions détruites
    └── Overlay "Reconnexion...", tout grisé
    └── Réversible : p5 → p2 → recréation sessions → retour niveau 0

Niveau 3 ── BLOQUÉ (CB OPEN)
    3 échecs consécutifs, disjoncteur ouvert
    └── "Nouvelle tentative dans Xs", compteur dégressif
    └── Réversible après 30s : cb5 → tentative → cb7 si succès

Niveau 4 ── ABANDONNÉ (P2PSync IDLE)
    Reset ou abandon volontaire
    └── Retour écran d'accueil
    └── Action utilisateur requise pour reconnecter
```

### Scénario 1 — Micro-coupure réseau (< 5s)

Fréquent sur mobile ou Wi-Fi instable. Le canal P2P se rétablit avant le timeout du guard.

```
   0s    Micro-coupure
          │
   0–3s   Messages en vol perdus (pas de retransmission P2P)
          │
   < 5s   Réseau revient
          │
          ├── Guard : g4 DATA_RECEIVED ↺ (timer reset, jamais passé OPEN)
          └── Aucun impact visible pour l'utilisateur
```

**UX** : rien à faire. Le guard absorbe les micro-coupures < 5s. En temps réel, l'utilisateur peut percevoir un freeze momentané (1–3 ticks manqués), mais le jeu reprend sans intervention.

### Scénario 2 — Pair absent temporaire (5–10s)

Le pair ferme son laptop, passe en arrière-plan (mobile), ou subit une coupure réseau longue.

```
   0s    Pair arrête de répondre
   5s    g2 TIMEOUT → Guard OPEN
         └── onPeerAbsent() sur tous les handlers
         └── UI : overlay pause / indicateur orange

   ?s    Pair revient
         └── g3 DATA_RECEIVED → HALF_OPEN
         └── g1 DATA_RECEIVED → CLOSED
         └── onPeerBack() sur tous les handlers
         └── UI : overlay disparaît / indicateur vert
```

**UX** :
- **Chat** : indicateur "absent" à côté du nom du pair. Pas de blocage — l'utilisateur peut continuer à écrire (les messages seront reçus au retour si la connexion tient).
- **Jeu tour par tour** : "En attente de \<nom\>..." avec timer optionnel. Le tour est suspendu.
- **Jeu temps réel** : overlay semi-transparent "Pause — pair absent". La boucle continue côté local (prédiction), mais l'état distant est gelé.

### Scénario 3 — Déconnexion réseau (> 10s)

Le pair est injoignable et le ping timeout de la couche 2 se déclenche.

```
   0s    Réseau tombe
   5s    Guard OPEN → pair absent
  10s    c26 PING_TIMEOUT → p4 TRANSPORT_LOST
         └── P2PSync DISCONNECTED
         └── Guard détruit
         └── Toutes sessions → DISCONNECTED
         └── UI : overlay "Connexion perdue — Reconnexion..."
```

**UX** :

| Phase | Durée | UI | Action utilisateur |
|-------|:-----:|----|--------------------|
| Pair absent | 5–10s | Overlay pause | Patienter |
| Déconnexion | 10s | Overlay "Connexion perdue" | Patienter (reconnexion auto) ou abandonner |
| Reconnexion en cours | 10–15s | Spinner "Reconnexion..." | Patienter |
| Reconnexion réussie | — | Interfaces réapparaissent | Aucune |
| Reconnexion échouée (×3) | — | "Nouvelle tentative dans 30s" | Patienter ou abandonner |

### Scénario 4 — Échecs répétés et circuit breaker

Quand la reconnexion échoue 3 fois consécutivement, le disjoncteur (couche 2) passe OPEN et bloque les tentatives pendant 30 secondes.

```
   Tentative 1 → échec (10s timeout)    CB: failure 1/3
   Tentative 2 → échec (10s timeout)    CB: failure 2/3
   Tentative 3 → échec (10s timeout)    CB: failure 3/3 → OPEN
         │
         └── 30s de blocage
              │
              └── CB HALF_OPEN → 1 tentative test
                   │
                   ├── Succès → CB CLOSED → reconnexion normale
                   └── Échec → CB OPEN → 30s de plus
```

**UX** :
- Compteur dégressif visible : "Nouvelle tentative dans 28s..."
- Bouton "Abandonner" toujours accessible (→ p6 RESET → IDLE)
- Pas de tentative manuelle possible pendant le blocage CB — expliquer pourquoi : "Trop de tentatives échouées"

**Timing total pire cas** : 3 × 10s (timeouts) + 30s (CB) = **60s** avant la prochaine tentative. L'UI doit préparer l'utilisateur à cette attente.

### Scénario 5 — Déconnexion volontaire (un seul pair)

Le pair distant ferme l'application ou clique "Déconnecter".

```
   0s    Pair distant ferme la connexion
         └── c25 CLOSE → p4 TRANSPORT_LOST
         └── Immédiat (pas d'attente de timeout)

   UI:   Toast "Le contact a quitté la conversation"
         └── Pas de reconnexion auto (le pair a choisi de partir)
         └── Retour à l'écran d'attente (READY en couche 2)
```

**UX** : distinguer la fermeture volontaire (c25) de la perte réseau (c26/c28/c29). Pour c25 : pas de reconnexion auto, message clair. Pour les erreurs réseau : reconnexion auto.

### Reconnexion — recréation des sessions

Après une reconnexion réussie, **aucune session ne survit**. Le cycle complet est nécessaire.

```
Avant déconnexion                    Après reconnexion

P2PSync CONNECTED ───────────→ P2PSync CONNECTED (nouveau)
Guard CLOSED ────────────────→ Guard HALF_OPEN (réinitialisé)
_presence CONNECTED ─────────→ _presence CONNECTED (auto)
"chat" CONNECTED ────────────→ "chat" CONNECTING → CONNECTED (recréé)
"game" CONNECTED (fps 30) ──→ "game" CONNECTING → CONNECTED (recréé)
```

**Comportement par rôle** :

| Rôle | À la déconnexion | À la reconnexion |
|------|------------------|------------------|
| **Hôte** | Sessions gardées en mémoire (`#pendingSessions`), SM resetées à IDLE | Recrée automatiquement toutes les sessions pendantes |
| **Guest** | Sessions effacées (`sessions.clear()`) | Reçoit les `sessionCreate` de l'hôte, réinstancie les handlers |

**Responsabilité de l'état applicatif** : P2PSync ne persiste rien. Si le jeu doit reprendre là où il s'est arrêté, le handler hôte doit conserver l'état du plateau et le renvoyer via `fullState` à la reconnexion. Le handler guest recevra cet état via `applyRemoteState()`.

### Recommandations de persistance par type

| Type de session | État à sauvegarder | Où | Qui restaure |
|-----------------|--------------------|----|-------------|
| **Chat** | Historique des messages | Variable locale (handler ou app) | L'UI conserve l'historique, les nouveaux messages s'ajoutent |
| **Jeu tour par tour** | Position du plateau, scores, tour courant | Handler hôte | L'hôte envoie le `fullState` complet à la reconnexion |
| **Jeu temps réel** | État du monde, positions des joueurs | Handler hôte | L'hôte renvoie le `fullState` au premier tick |
| **Curseurs** | Rien (état éphémère) | — | Le flux reprend naturellement |

### Feedback UI — chronologie complète d'une reconnexion

```
[Jeu en cours, fps 30]
    │
    ├── t=0s   Réseau tombe
    │          └── (rien de visible encore)
    │
    ├── t=5s   Guard OPEN
    │          └── Overlay pause : "En attente du joueur..."
    │          └── Boucle locale continue (prédiction)
    │
    ├── t=10s  p4 TRANSPORT_LOST
    │          └── Overlay change : "Connexion perdue — Reconnexion..."
    │          └── Sessions détruites, boucle arrêtée
    │          └── Compteur : "Reconnexion dans 3... 2... 1..."
    │
    ├── t=13s  p5 RECONNECT → CONNECTING
    │          └── Spinner "Connexion au serveur..."
    │
    ├── t=16s  p2 TRANSPORT_CONNECTED
    │          └── "Connecté !" (bref)
    │          └── Guard redémarre (HALF_OPEN)
    │          └── Hôte recrée "game" → s1+s2
    │
    ├── t=16.1s Sessions recréées
    │           └── Overlay disparaît
    │           └── Boucle fps 30 reprend
    │           └── Le fullState autoritaire resynchronise le guest
    │
    └── t=16.5s Guard CLOSED (g1)
               └── Indicateur vert
               └── Jeu nominal
```

**Durée totale de l'interruption** : ~16s dans le cas favorable. L'overlay de pause (t=5s) masque les 5 premières secondes. L'overlay de reconnexion (t=10s) couvre le reste. L'utilisateur ne voit jamais un écran figé sans explication.

---

## Résumé des transitions

| SM | Happy path | Hors happy path | Total |
|----|-----------|-----------------|-------|
| **P2PSync** | p1, p2, p4, p5 (4) | p3, p6 (2) | 6 |
| **Guard** | g1, g4 (2) | g2, g3 (2) | 4 |
| **Session** | s1, s2, s3 (3) | s4 (1) | 4 |
| **Total** | **9** | **5** | **14** |
