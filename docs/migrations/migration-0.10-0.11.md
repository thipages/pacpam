# Migration v0.10 → v0.11

## Changement potentiellement impactant

### `transport.onData` ne reçoit plus les messages internes

Les listeners applicatifs définis via `transport.onData = cb` (ou `sync.onData = cb`) ne reçoivent plus les messages dont `data._ctrl` ou `data._s` est défini. Ces messages sont traités exclusivement par P2PSync.

**Avant** (v0.10) — filtrage manuel nécessaire :

```javascript
transport.onData = (data) => {
  if (data._ctrl || data._s) return; // filtrage manuel
  // traitement applicatif
};
```

**Après** (v0.11) — filtrage automatique :

```javascript
sync.onData = (data) => {
  // seuls les messages applicatifs arrivent ici
};
```

Si votre code dépendait de la réception de messages `_ctrl` ou `_s` dans `onData`, utilisez `transport.addDataListener(cb)` (listener interne, reçoit tout).

## Nouvelles fonctionnalités (rétrocompatibles)

### Instanciation simplifiée

```javascript
// Avant (toujours supporté)
const network = new NetworkManager({ debug: false });
const transport = new PeerTransport(network);
const sync = new P2PSync(transport, { guardTimeout: 5000 });

// Après (recommandé)
const sync = new P2PSync({ network: { debug: false }, guardTimeout: 5000 });
```

### Passthroughs transport

Toutes les méthodes et callbacks du transport sont maintenant accessibles directement via P2PSync :

```javascript
// Avant
transport.init('P01', 'mon-app');
transport.connect(peerId);
transport.onIdReady = (id) => { ... };

// Après
sync.init('P01', 'mon-app');
sync.connect(peerId);
sync.onIdReady = (id) => { ... };
```

Le transport reste accessible via `sync.transport` pour les cas avancés (ex: `sync.transport.onStateChange()` pour le diagnostic L2).

### ID libre

```javascript
// Mode legacy (inchangé)
sync.init('P01', 'mon-app-id'); // myId = 'mon-app-id-P01'

// Mode libre (nouveau)
sync.init('abcdef1234567890'); // myId = 'abcdef1234567890', myPseudo = null
```

### Serveur PeerJS configurable

```javascript
const sync = new P2PSync({
  network: {
    peerOptions: { host: 'localhost', port: 9000, path: '/myapp' }
  }
});
```
