# Roadmap v0.10.0

## Fait

- [x] Erreurs réseau distinctes : PEER_CREATION_ERROR, SIGNALING_ERROR, CONNECTION_ERROR (25 → 30 transitions)
- [x] IDs préfixés dans les définitions de states (`c1`–`c30`, `cb1`–`cb10`)
- [x] Changelog (`docs/changelog.md`)
- [x] Architecture P2PSync documentée (`docs/architecture.md`) :
  - SM P2PSync : IDLE / CONNECTING / CONNECTED / DISCONNECTED (projection groupée de la SM couche 2)
  - Guard présence sur CONNECTED : HALF_OPEN / CLOSED / OPEN (même formalisme que le circuit breaker)
  - Sessions = machines parallèles, même vocabulaire que P2PSync
  - Modes de données par session : centralisé / indépendant / collaboratif (réservé)
  - Deux niveaux d'autorité : administratif (hôte, toujours centralisé) + données (configurable par session)
  - 4 types de messages normalisés : `action`, `fullState`, `localState`, `message`
  - Présence intégrée (`_presence`), suspension automatique si session fps > 0.5
  - Interface transport agnostique + verrouillage du transport

---

## 1. P2PSync — `setFps(n)`

`fps` est fixé au constructeur et immuable. Les briques `startSync()` / `stopSync()` existent mais pas de méthode pour changer le fps à chaud.

Nécessaire pour les transitions dynamiques sur une session :

```
session "game" centralisé fps=0 (tour par tour) → setFps(30) → temps réel → setFps(0) → retour tour par tour
```

- `setFps(0)` : arrête la boucle (`stopSync()`)
- `setFps(n>0)` : met à jour `this.fps`, redémarre la boucle (`startSync()`)

## 2. P2PSync — prédiction guest

`sendAction()` envoie la commande à l'hôte sans feedback local. Le guest attend le `fullState` retour (1 RTT de latence visible).

Changement minimal :

```js
sendAction(action) {
    this.session.processAction?.(action);          // prédiction locale
    this.sendCallback({ type: 'action', action }); // envoi à l'hôte
}
```

Le `fullState` autoritaire corrige toute divergence au prochain cycle (≤ 33ms à 30fps).

## 3. P2PSync — handler (contrat duck-typed)

Le handler est un objet fourni par l'application pour chaque session. Contrat cible (voir `docs/architecture.md`) :

| Méthode | Optionnel | Appelé par |
|---------|-----------|------------|
| `getLocalState()` | oui | boucle fps, `broadcastState()` |
| `applyRemoteState(state)` | oui | réception `fullState` ou `localState` |
| `processAction(action)` | oui | réception `action` (hôte), prédiction locale (guest) |
| `onMessage(message)` | oui | réception `message` (sessions indépendantes) |
| `onStart()` | oui | session passe en CONNECTED |
| `onEnd()` | oui | session passe en DISCONNECTED |
| `onPeerAbsent()` | oui | guard présence passe à OPEN |
| `onPeerBack()` | oui | guard présence revient à CLOSED |

Toutes les méthodes sont optionnelles — seules celles pertinentes pour le mode/fps de la session sont appelées.

## 4. Architecture — modes de communication *(décidé)*

**Décision** : P2PSync est la façade unique. Toute communication passe par des sessions. Le transport est verrouillé — plus d'accès direct à `NetworkManager.send()`.

Deux dimensions par session (voir `docs/architecture.md`) :

| | fps = 0 (discret) | fps > 0 (discret + continu) |
|---|---|---|
| **centralisé** | Jeu tour par tour, quiz | Jeu temps réel |
| **indépendant** | Chat, notifications | Curseurs, présence |
| **collaboratif** | *(réservé — CRDT/OT)* | *(réservé)* |

## 5. Nettoyage — vocabulaire

Le cœur de la lib ne doit pas parler de jeu. Changements prévus :

| Ancien | Nouveau | Fichiers | Breaking |
|--------|---------|----------|----------|
| `sanitizeGameState(state)` | `sanitizeState(state)` | `message-validator.js`, `network.js`, `index.js` | Oui (export public) |
| `session.isNetworkGame` | *(supprimé — géré par P2PSync)* | `p2p-sync.js` | Oui |
| `peerState` (type message) | `localState` | `p2p-sync.js` | Oui |
| `"Sanitise un objet état de jeu"` | `"Sanitise un objet état"` | `message-validator.js` (JSDoc) | Non |
| INACTIVE/PENDING/ACTIVE/ENDED | IDLE/CONNECTING/CONNECTED/DISCONNECTED | nouveau code sessions | Non (nouveau) |
| UNKNOWN/PRESENT/ABSENT | HALF_OPEN/CLOSED/OPEN | nouveau code présence | Non (nouveau) |

API publique cassante → documenter dans le breaking change v0.10.0.

## 6. Nettoyage — `locales/` hors `src/`

`locales/` est au même niveau que `src/`. C'est cohérent : les traductions sont des données, pas du code. `locale.js` les importe via `../../locales/`. Le `package.json` les inclut dans les fichiers publiés (`"files": ["src/", "locales/"]`).

**Verdict : OK tel quel.** Les données (traductions) restent séparées du code. Pas de changement nécessaire.

## 7. Nettoyage — constantes non formalisées

`constants.js` est un fichier de ré-export + commentaires, pas une vraie centralisation. Certaines constantes sont des nombres magiques dans les constructeurs (ex: `maxFailures = 3`, `resetTimeout = 30000`).

Options :
1. **Statu quo** — les valeurs par défaut sont dans les constructeurs, documentées dans `constants.js`
2. **Objet de constantes** — `export const DEFAULTS = { maxFailures: 3, ... }` importé par les constructeurs

## 8. Nettoyage — pages/new-chat

- `components/secret.js` : fichier déprécié (mot de passe déplacé dans login), à supprimer
- Commit du dossier `pages/new-chat/` une fois stabilisé

## 9. Tests navigateur (pages/new-chat/tests/)

Les tests de couverture SM et PeerJS tournent dans le navigateur (`tests/index.html`). Pas d'intégration CI.

---

*À compléter — ce fichier est un brouillon.*

## Backlog
