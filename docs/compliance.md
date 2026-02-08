# Compliance RGPD — Pacpam

Ce document décrit les flux de données personnelles dans pacpam et identifie les points de non-conformité RGPD. Il s'adresse aux développeurs intégrant pacpam dans un produit destiné à des utilisateurs finaux.

## Statut

Pacpam est une librairie de développement. Elle ne fournit aucun mécanisme de conformité RGPD (consentement, droit d'accès, suppression, etc.). La responsabilité de la conformité incombe à l'application qui l'intègre.

---

## 1. Inventaire des données personnelles

### 1.1 Données traitées directement

| Donnée | Type RGPD | Création | Transmission |
|--------|-----------|----------|-------------|
| Pseudo du joueur | Identifiant personnel | `network.js` — fourni par l'utilisateur | Serveur PeerJS + pair distant |
| Peer ID (`appId-pseudo`) | Identifiant technique | `network.js:156` — dérivé du pseudo | Serveur PeerJS |
| Hash SHA-256 du mot de passe | Donnée pseudonymisée | `auth.js:14` | Pair distant uniquement |
| Nom du joueur dans le message auth | Identifiant personnel | `auth.js:42` | Pair distant uniquement |
| Timestamp d'authentification | Métadonnée | `auth.js:43` | Pair distant uniquement |

### 1.2 Données exposées par le protocole WebRTC

| Donnée | Mécanisme | Destinataire |
|--------|-----------|-------------|
| Adresse IP publique | STUN (ICE candidates) | Serveurs STUN de PeerJS + pair distant |
| Adresses IP locales | ICE candidate gathering | Pair distant (selon configuration navigateur) |
| User-Agent du navigateur | Connexion WebSocket au serveur PeerJS | Serveur PeerJS |

### 1.3 Données NON traitées

- Aucun cookie
- Aucun localStorage / sessionStorage / IndexedDB
- Aucun tracking ou analytics
- Aucune persistance côté client ou serveur

---

## 2. Tiers impliqués

### 2.1 Serveur de signalisation PeerJS

- **Adresse** : `0.peerjs.com:443`
- **Opérateur** : communauté open-source PeerJS ([peers/peerjs-server](https://github.com/peers/peerjs-server))
- **Localisation** : non documentée, présumée hors UE
- **Données reçues** : peer ID (contient le pseudo), adresse IP, metadata WebSocket
- **Rétention** : 60 secondes en mémoire après déconnexion ([PRIVACY.md](https://github.com/peers/peerjs-server/blob/master/PRIVACY.md))
- **DPA disponible** : non
- **Garanties RGPD** : aucune

### 2.2 Serveurs STUN

PeerJS utilise par défaut les serveurs STUN de Google (`stun.l.google.com:19302`).

- **Opérateur** : Google LLC
- **Localisation** : principalement US
- **Données reçues** : adresse IP source, port
- **Finalité** : découverte de l'IP publique pour la traversée NAT
- **DPA** : couvert par les conditions Google Cloud (si applicable)

### 2.3 CDN (page de démonstration uniquement)

`pages/chat.html` charge PeerJS depuis `unpkg.com` :
```html
<script src="https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js"></script>
```
- **Opérateur** : Cloudflare (unpkg)
- **Données reçues** : adresse IP, User-Agent, Referer
- **Note** : concerne uniquement la démo, pas la librairie npm

---

## 3. Flux de données — schéma

```
Utilisateur A                    Serveur PeerJS (0.peerjs.com)                 Utilisateur B
     |                                      |                                      |
     |── peer ID (appId-pseudo) + IP ──────>|                                      |
     |                                      |<────── peer ID (appId-pseudo) + IP ──|
     |                                      |                                      |
     |── signalisation SDP/ICE ────────────>|──── signalisation SDP/ICE ──────────>|
     |                                      |                                      |
     |══════════ WebRTC direct (DTLS chiffré) ════════════════════════════════════>|
     |   auth: { hash, name, timestamp }                                           |
     |   données applicatives (chat, jeu)                                          |
```

Le serveur PeerJS ne voit **jamais** les données applicatives. Il ne voit que les peer IDs et les messages de signalisation (SDP/ICE).

---

## 4. Points de non-conformité RGPD

### 4.1 Pseudo inclus dans le peer ID

Le peer ID est construit comme `${appId}-${pseudo}` (`network.js:156`). Ce pseudo est transmis au serveur PeerJS et potentiellement visible par tout pair connaissant l'ID.

**Risque** : donnée personnelle transmise à un tiers sans base légale.

**Remédiation** : utiliser un identifiant opaque (UUID) comme peer ID et transmettre le pseudo uniquement au pair distant via le canal WebRTC chiffré.

### 4.2 Absence de consentement

Aucun mécanisme de consentement n'est intégré. L'application appelante doit :
- Informer l'utilisateur des données transmises (pseudo, IP)
- Recueillir le consentement avant `network.init()`
- Fournir une politique de confidentialité

### 4.3 Transfert hors UE

Le serveur PeerJS (`0.peerjs.com`) et les serveurs STUN (Google) sont présumés hors UE. Aucune garantie contractuelle (SCC, DPA) n'encadre ces transferts.

**Remédiation** : auto-héberger le serveur PeerJS et les serveurs STUN en UE.

### 4.4 Absence de droits des personnes

Pacpam ne fournit aucun mécanisme pour :
- Droit d'accès (art. 15 RGPD)
- Droit de rectification (art. 16)
- Droit à l'effacement (art. 17)
- Droit à la portabilité (art. 20)

**Note** : la rétention de 60 secondes en mémoire sur le serveur PeerJS rend ces droits peu pertinents pour ce tiers. L'application appelante reste responsable de ses propres traitements.

### 4.5 Pas de registre de traitements

Aucun document de type registre RGPD (art. 30) n'est fourni. Ce document peut servir de base.

---

## 5. Chiffrement et sécurité des données

| Canal | Chiffrement | Protocole |
|-------|-------------|-----------|
| Navigateur ↔ PeerJS | TLS 1.2+ | WebSocket sur HTTPS |
| Navigateur ↔ STUN | Non chiffré | UDP (STUN binding request) |
| Pair ↔ Pair (données) | DTLS 1.2 + SRTP | WebRTC DataChannel |

Les données applicatives (chat, état de jeu) transitent exclusivement par le canal WebRTC, chiffré de bout en bout par DTLS. Ni le serveur PeerJS, ni les serveurs STUN n'ont accès à ces données.

Le hash SHA-256 du mot de passe est transmis via ce canal chiffré. Le mot de passe en clair ne quitte jamais le navigateur.

### 5.1 Authentification de l'identité des pairs

WebRTC chiffre le canal (DTLS), mais les certificats utilisés sont **auto-signés et éphémères**. Ils garantissent la confidentialité, pas l'identité : rien ne prouve que le pair en face est bien celui attendu.

Pacpam compense ce manque via un **mot de passe partagé** (hash SHA-256 mutuel). Ce mécanisme est suffisant pour le cas d'usage visé (jeux entre pairs qui se connaissent), mais ne constitue pas une authentification par certificat d'identité.

**Niveaux d'authentification** :

| Niveau | Mécanisme | Garantie | Statut pacpam |
|--------|-----------|----------|---------------|
| 0 — Aucun | Connexion WebRTC brute | Chiffrement seul, pas d'identité | — |
| 1 — Secret partagé | Mot de passe hashé (SHA-256) | Identité implicite (qui connaît le mot de passe) | **Implémenté** |
| 2 — Certificat client | Certificat X.509 signé par une CA | Identité vérifiable, non répudiable | Non implémenté |

Pour un usage nécessitant une authentification forte (santé, finance, données sensibles), le niveau 1 est insuffisant. Le niveau 2 requiert une infrastructure PKI (autorité de certification, distribution, révocation) incompatible avec l'architecture sans serveur de pacpam.

---

## 6. Recommandations pour la production

| Action | Priorité | Effort |
|--------|----------|--------|
| Anonymiser le peer ID (UUID au lieu du pseudo) | Haute | Faible |
| Auto-héberger le serveur PeerJS en UE | Haute | Moyen |
| Ajouter une politique de confidentialité | Haute | Faible |
| Recueillir le consentement avant connexion | Haute | Faible |
| Auto-héberger un serveur STUN/TURN en UE | Moyenne | Moyen |
| Ajouter le hash SRI sur le CDN (page démo) | Basse | Faible |
| Documenter un registre de traitements (art. 30) | Moyenne | Faible |

---

## 7. Autres réglementations

### ePrivacy (cookies/stockage)

Pacpam n'utilise aucun cookie ni stockage local. Pas de bandeau cookies nécessaire pour la librairie elle-même.

### COPPA (protection des mineurs)

Si l'application cible des mineurs de moins de 13 ans (jeux), des obligations supplémentaires s'appliquent (consentement parental, limitation de collecte). Pacpam ne fournit aucun mécanisme spécifique.

### Accessibilité (RGAA/WCAG)

Hors périmètre de ce document. Concerne l'application appelante, pas la librairie réseau.
