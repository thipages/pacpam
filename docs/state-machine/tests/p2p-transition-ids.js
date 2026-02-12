import { p2pSyncStates } from '../../../src/sync/p2p-sync-states.js';

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

export const P2P_TRANSITIONS = extractTransitions(p2pSyncStates);

// Index par clé "FROM:EVENT" → transition
export const byKey = new Map(P2P_TRANSITIONS.map(t => [`${t.from}:${t.event}`, t]));

// Index par id → transition
export const byId = new Map(P2P_TRANSITIONS.map(t => [t.id, t]));

// Ordre des états sur le chemin nominal
export const P2P_STATE_ORDER = ['IDLE', 'CONNECTING', 'CONNECTED', 'DISCONNECTED'];
