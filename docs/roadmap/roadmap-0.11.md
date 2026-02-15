# Roadmap v0.11.0

## Fait

- [x] Instanciation simplifiée : `new P2PSync({ network: {...}, guardTimeout })` crée NetworkManager + PeerTransport en interne
- [x] Passthroughs transport : init, connect, disconnect, send, auth, callbacks, getters — P2PSync est le point d'entrée unique
- [x] Filtrage messages internes : listeners app ne reçoivent plus `_ctrl` et `_s`
- [x] Rate limit `action` : 10/sec → 35/sec
- [x] Throttle warnings rate-limiter : 1 log par type/peer/5s
- [x] Auto-pause sessions quand guard OPEN (peer absent)
- [x] ID libre : `init(id)` avec ID opaque ≥ 16 chars
- [x] Serveur PeerJS configurable : `peerOptions` dans NetworkManager
- [x] Migration des 3 démos vers l'API simplifiée

---

## À faire

### Travaux futurs

- [ ] **Détacher le signaling en CONNECTED** : couper la connexion au serveur PeerJS une fois le DataChannel établi (`peer.disconnect()`). Allège les ressources, libère un slot serveur. Reconnexion au serveur uniquement si reconnexion P2P nécessaire. Changement SM couche 2
- [ ] **Topologie N > 2 pairs** : refonte du contrat transport (`send(peerId, data)`, `onData(peerId, cb)`), topologie configurable (mesh/star), probablement une façade `MultiPeerSync` distincte
- [ ] **Protection connexions entrantes non sollicitées (couche 2)** : refuser les connexions entrantes si la SM n'est pas en READY, ou si une connexion sortante est en cours
