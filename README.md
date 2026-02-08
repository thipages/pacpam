# @thipages/pacpam

![version](https://img.shields.io/badge/version-0.9.0-blue) ![tests](https://img.shields.io/badge/tests-81%20passing-brightgreen) ![node](https://img.shields.io/badge/node-%E2%89%A520-blue) ![license](https://img.shields.io/badge/license-MIT-green) ![modules](https://img.shields.io/badge/modules-12-informational) ![locales](https://img.shields.io/badge/locales-fr%20%7C%20en-yellow)

Réseau P2P avec PeerJS — machines à états, sécurité, synchronisation.

## Installation

```bash
npm install @thipages/pacpam
```

## Usage

```javascript
import { loadLocale, NetworkManager } from '@thipages/pacpam';

await loadLocale();

const network = new NetworkManager({ debug: true });
network.onIdReady = (id) => console.log('Mon ID:', id);
network.onConnected = () => console.log('Connecté');
network.onData = (data) => console.log('Reçu:', data);
network.onError = (err) => console.error(err.message);

network.init('P01', 'a1b2c3d4e5f6');  // pseudo : 3-10 chars, A-Z 0-9 _ -
```

## Démo

[Chat Pacpam](https://thipages.github.io/pacpam/pages/) — ouvrir dans deux onglets pour tester.

## Documentation

- [Référence API](docs/api.md)
- [Diagramme des machines à états](docs/state-machine/index.html)

## Sécurité

- **Chiffrement** : WebRTC chiffre nativement les données (DTLS). Les échanges entre pairs sont protégés de bout en bout.
- **Authentification** : Mot de passe optionnel vérifié par hash SHA-256 mutuel. Sans le bon mot de passe, la connexion est refusée. Chaque tentative nécessite un handshake WebRTC complet (plusieurs secondes), ce qui limite naturellement le brute-force. L'hôte est notifié de chaque échec via le callback `onAuthFailed(peerId)`.
- **Serveur de signalisation** : Le serveur PeerJS (`0.peerjs.com`) ne sert qu'au rendez-vous initial (échange SDP/ICE). Il ne voit pas les données. Ce serveur gratuit est maintenu par la [communauté PeerJS](https://github.com/peers/peerjs-server), sans garantie de disponibilité. En production, préférer un serveur auto-hébergé (`npx peerjs --port 9000`).

## License

MIT
