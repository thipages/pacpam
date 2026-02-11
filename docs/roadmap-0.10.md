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
  - Handler duck-typed (8 méthodes optionnelles) + SessionCtrl (double accès A+B)
  - API création : `sync.createSession()` (hôte) + `sync.onSessionCreate` (guest)
  - Messages de contrôle : `sessionCreate`, `sessionReady`, `sessionSetFps`, `sessionEnd`

---

## À implémenter

Voir `docs/implementation-plan-0.10.md` pour le plan détaillé et phasé.

### Nettoyage vocabulaire (breaking changes)

| Ancien | Nouveau | Fichiers | Breaking |
|--------|---------|----------|----------|
| `sanitizeGameState(state)` | `sanitizeState(state)` | `message-validator.js`, `network.js`, `index.js` | Oui (export public) |
| `session.isNetworkGame` | *(supprimé — géré par P2PSync)* | `p2p-sync.js` | Oui |
| `peerState` (type message + schéma + rate limit) | `localState` | `message-validator.js`, `rate-limiter.js`, `p2p-sync.js` | Oui |
| `"Sanitise un objet état de jeu"` | `"Sanitise un objet état"` | `message-validator.js` (JSDoc) | Non |

### Nouveau code

| Composant | Fichier(s) | Résumé |
|-----------|-----------|--------|
| Transport | `sync/transport.js` | Wrapper du `NetworkManager` exposant le contrat minimal |
| SM P2PSync | `sync/p2p-sync-states.js` | IDLE / CONNECTING / CONNECTED / DISCONNECTED (groupes) |
| Guard présence | `sync/guard-states.js` | HALF_OPEN / CLOSED / OPEN (réutilise `StateRunner`) |
| Session + SessionCtrl | `sync/session.js` | Session avec SM + objet de contrôle |
| P2PSync (réécriture) | `sync/p2p-sync.js` | Façade complète : sessions, contrôle, présence |
| Schéma `message` | `security/message-validator.js` | Nouveau type `message` + champ `_s` autorisé |
| Rate limit `message` | `security/rate-limiter.js` | Limites pour le type `message` + `localState` renommé |

### Décisions prises

- **`locales/` hors `src/`** : OK tel quel (données ≠ code)
- **Constantes** : statu quo (valeurs dans les constructeurs, documentées dans `constants.js`)
- **Modes de communication** : P2PSync est la façade unique, transport verrouillé
- **SessionCtrl** : double accès A (handler via `onStart`) + B (application via `sync.getSession`)

### Pages de test

- `pages/old-chat/` : ancienne app de test (renommée depuis `new-chat/`, pour référence)
- `pages/v0.10.0/` : nouvelle app minimaliste testant la v0.10.0

### Tests navigateur

Les tests de couverture SM et PeerJS (`pages/old-chat/tests/`) restent fonctionnels. À compléter avec des tests pour les nouvelles SM (P2PSync, guard, sessions).
