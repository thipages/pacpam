import { connectionStates } from '../../../src/core/connection-states.js';

function extractTransitions(states) {
  const result = [];
  for (const [from, config] of Object.entries(states)) {
    for (const [event, transition] of Object.entries(config.on || {})) {
      const target = typeof transition === 'string' ? transition : transition.target;
      const id = transition.id;
      result.push({ id, from, event, to: target });
    }
  }
  return result;
}

export const TRANSITIONS = extractTransitions(connectionStates);

// Index par clé "FROM:EVENT" → transition
export const byKey = new Map(TRANSITIONS.map(t => [`${t.from}:${t.event}`, t]));

// Index par id → transition
export const byId = new Map(TRANSITIONS.map(t => [t.id, t]));

// Ordre des états sur le chemin nominal
export const STATE_ORDER = ['IDLE', 'INITIALIZING', 'READY', 'CONNECTING', 'AUTHENTICATING', 'CONNECTED'];

// Événement "happy path" pour chaque état sur le chemin linéaire hôte.
// Le chemin invité (#c7 CONNECTION_OPEN) et la fin de conversation (#c25 #c30)
// sont aussi des transitions happy path — voir notes.md.
export const HAPPY_EVENTS = {
  IDLE:           'INIT',
  INITIALIZING:   'PEER_OPEN',
  READY:          'CONNECT_TO',
  CONNECTING:     'CONNECTION_OPEN',
  AUTHENTICATING: 'AUTH_SUCCESS'
};
