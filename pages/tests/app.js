/**
 * App de test — v0.10.0 (phase 0)
 *
 * Coordination des deux <peer-instance> côte à côte.
 * Quand un pair obtient son ID, l'autre peut s'y connecter automatiquement.
 */

import { loadLocale } from '../../src/index.js';
import './peer-instance.js';

await loadLocale('fr');

const peerA = document.querySelector('#peer-a');
const peerB = document.querySelector('#peer-b');

// Quand A obtient son ID, B sait où se connecter (et vice versa)
peerA.addEventListener('id-ready', (e) => {
    peerB.remotePeerId = e.detail.id;
});

peerB.addEventListener('id-ready', (e) => {
    peerA.remotePeerId = e.detail.id;
});
