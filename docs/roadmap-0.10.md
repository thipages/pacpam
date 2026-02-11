# Roadmap v0.10.0

## Fait

- [x] Erreurs réseau distinctes : PEER_CREATION_ERROR, SIGNALING_ERROR, CONNECTION_ERROR (25 → 30 transitions)
- [x] IDs préfixés dans les définitions de states (`c1`–`c30`, `cb1`–`cb10`)
- [x] Changelog (`docs/changelog.md`)

---

## 1. P2PSync — `setFps(n)`

`fps` est fixé au constructeur et immuable. Les briques `startSync()` / `stopSync()` existent mais pas de méthode pour changer le fps à chaud.

Nécessaire pour les transitions entre modes :

```
Chat (fps=0, pas de session) → Tour par tour (fps=0, session) → Temps réel (fps>0, session)
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

## 3. P2PSync — session (interface duck-typed)

Méthodes attendues par `P2PSync.setup()` :

| Méthode | Requis | Appelé par |
|---------|--------|------------|
| `getLocalState()` | oui | boucle sync, `broadcastState()` |
| `applyRemoteState(state)` | oui | `receiveMessage()` (fullState/peerState) |
| `processAction(action)` | optionnel | `receiveMessage()` (hôte), `sendAction()` (prédiction guest) |
| `isRunning` | oui | boucle sync (guard) |
| `isNetworkGame` | set par setup() | — |
| `isHost` | set par setup() | — |

## 4. Architecture — modes de communication dans la lib

La lib est générique (pas spécifique au jeu). Les trois modes sont des patterns de communication P2P :

| Mode | fps | Session | Pattern |
|------|-----|---------|---------|
| **Discret sans session** | 0 | Non | `send()` direct (chat, notifications) |
| **Discret avec session** | 0 | Oui | `sendAction()` / `broadcastState()` à la demande (tour par tour) |
| **Continu** | > 0 | Oui | Boucle périodique automatique (temps réel) |

Aujourd'hui `P2PSync` gère les modes 2 et 3. Le mode 1 passe directement par `NetworkManager.send()`.

Question ouverte : comment structurer ces modes dans la lib ? Options :
1. **Statu quo** — `NetworkManager` (mode 1) + `P2PSync` (modes 2-3), l'app choisit
2. **Plugin/middleware** — `NetworkManager` accepte des plugins qui interceptent `onData`/`send`
3. **Modes intégrés** — `NetworkManager` expose `setMode('direct' | 'session')` et gère P2PSync en interne

## 5. Nettoyage — vocabulaire "game" dans la lib

Le coeur de la lib ne doit pas parler de jeu. Occurrences actuelles :

| Symbole | Fichier | Remplacement proposé |
|---------|---------|---------------------|
| `sanitizeGameState(state)` | `message-validator.js`, `network.js`, `index.js` | `sanitizeState(state)` |
| `session.isNetworkGame` | `p2p-sync.js` | `session.isNetworkSession` |
| `"Sanitise un objet état de jeu"` | `message-validator.js` (JSDoc) | `"Sanitise un objet état"` |

API publique cassante (`sanitizeGameState` est exporté) → prévoir un alias ou documenter le breaking change.

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
