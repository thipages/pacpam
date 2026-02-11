/**
 * SM Guard présence — circuit breaker applicatif sur CONNECTED.
 *
 * 3 états : HALF_OPEN, CLOSED, OPEN
 * 4 transitions : g1–g4
 *
 * HALF_OPEN = en attente de premières données
 * CLOSED    = pair présent (données reçues récemment)
 * OPEN      = pair absent (timeout sans données)
 *
 * Compatible StateRunner.
 */

export const guardStates = {
  HALF_OPEN: {
    on: {
      DATA_RECEIVED: { id: 'g1', target: 'CLOSED' }
    }
  },
  CLOSED: {
    on: {
      TIMEOUT:       { id: 'g2', target: 'OPEN' },
      DATA_RECEIVED: { id: 'g4', target: 'CLOSED' }
    }
  },
  OPEN: {
    on: {
      DATA_RECEIVED: { id: 'g3', target: 'HALF_OPEN' }
    }
  }
};

export const guardInitial = 'HALF_OPEN';
