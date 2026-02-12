import { circuitBreakerStates } from '../../../src/security/circuit-breaker-states.js';

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

export const CB_TRANSITIONS = extractTransitions(circuitBreakerStates);

// Index par clé "FROM:EVENT" → transition
export const byKey = new Map(CB_TRANSITIONS.map(t => [`${t.from}:${t.event}`, t]));

// Index par id → transition
export const byId = new Map(CB_TRANSITIONS.map(t => [t.id, t]));

// Ordre des états sur le chemin nominal
export const CB_STATE_ORDER = ['CLOSED', 'OPEN', 'HALF_OPEN'];

// Événement "happy path" pour chaque état (circuit se déclenche puis récupère)
export const CB_HAPPY_EVENTS = {
  CLOSED:    'THRESHOLD_REACHED',
  OPEN:      'RESET_TIMEOUT',
  HALF_OPEN: 'SUCCESS'
};
