export const circuitBreakerStates = {
  CLOSED:    { on: { SUCCESS: { target: 'CLOSED', actionLabel: 'reset failures' }, THRESHOLD_REACHED: 'OPEN', RESET: { target: 'CLOSED', actionLabel: 'reset counters', manual: true }, FORCE_OPEN: { target: 'OPEN', manual: true } } },
  OPEN:      { on: { RESET_TIMEOUT: 'HALF_OPEN', RESET: { target: 'CLOSED', manual: true } } },
  HALF_OPEN: { on: { SUCCESS: 'CLOSED', FAILURE: 'OPEN', RESET: { target: 'CLOSED', manual: true }, FORCE_OPEN: { target: 'OPEN', manual: true } } }
};

export const initial = 'CLOSED';
