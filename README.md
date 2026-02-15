# @thipages/pacpam

![version](https://img.shields.io/badge/version-0.11.3-blue) ![tests](https://img.shields.io/badge/tests-106%20passing-brightgreen) ![node](https://img.shields.io/badge/node-%E2%89%A520-blue) ![license](https://img.shields.io/badge/license-MIT-green) ![modules](https://img.shields.io/badge/modules-16-informational) ![locales](https://img.shields.io/badge/locales-fr%20%7C%20en-yellow)

Réseau P2P avec PeerJS — machines à états, sécurité, synchronisation.

## Installation

```bash
npm install @thipages/pacpam
```

## Usage

### P2PSync (recommandé)

Façade haut niveau avec sessions multiplexées, guard de présence et reconnexion.

```javascript
import { P2PSync } from '@thipages/pacpam';

const sync = new P2PSync({ network: { debug: false } });

sync.onStateChange = (state, detail) => console.log('État:', state);
sync.onSessionCreate = (id, config) => myHandler; // guest : retourner un handler

sync.init('P01', 'mon-app-id');
```

### Sans bundler (ES modules natifs)

```html
<script type="importmap">
{ "imports": { "@thipages/pacpam": "https://esm.sh/@thipages/pacpam@0.11.0" } }
</script>
<script type="module">
  import { P2PSync } from '@thipages/pacpam';
</script>
```

## Démos

[Index des démos](https://thipages.github.io/pacpam/pages/) — ouvrir dans deux onglets pour tester.

- **Chat** — mode indépendant, fps=0 (messages à la demande)
- **Pong** — mode centralisé, 30fps (temps réel, hôte autoritaire)

[Installer son propre chat](docs/install-chat.md)

## Documentation

- [Architecture](docs/architecture.md)
- [Référence API](docs/api.md)
- [Guides de migration](docs/migrations/)
- [Machines à états (outil de visualisation)](https://thipages.github.io/pacpam/pages/state-machine/)
- [Changelog](docs/changelog.md)

## Sécurité

- **Chiffrement** : WebRTC chiffre nativement les données (DTLS). Les échanges entre pairs sont protégés de bout en bout.
- **Authentification** : Mot de passe optionnel vérifié par hash SHA-256 mutuel. Sans le bon mot de passe, la connexion est refusée. Chaque tentative nécessite un handshake WebRTC complet (plusieurs secondes), ce qui limite naturellement le brute-force. L'hôte est notifié de chaque échec via le callback `onAuthFailed(peerId)`.
- **Serveur de signalisation** : Le serveur PeerJS (`0.peerjs.com`) ne sert qu'au rendez-vous initial (échange SDP/ICE). Il ne voit pas les données. Ce serveur gratuit est maintenu par la [communauté PeerJS](https://github.com/peers/peerjs-server), sans garantie de disponibilité. En production, préférer un serveur auto-hébergé (`npx peerjs --port 9000`).

## License

MIT
