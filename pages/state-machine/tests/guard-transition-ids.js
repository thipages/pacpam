import { guardStates } from '../../../src/sync/guard-states.js';

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

export const GUARD_TRANSITIONS = extractTransitions(guardStates);

// Index par clé "FROM:EVENT" → transition
export const byKey = new Map(GUARD_TRANSITIONS.map(t => [`${t.from}:${t.event}`, t]));

// Index par id → transition
export const byId = new Map(GUARD_TRANSITIONS.map(t => [t.id, t]));

// Ordre des états sur le chemin nominal
export const GUARD_STATE_ORDER = ['HALF_OPEN', 'CLOSED', 'OPEN'];
