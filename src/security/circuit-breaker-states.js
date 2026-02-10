export const circuitBreakerStates = {
  CLOSED: {
    on: {
      SUCCESS:           { id: 'cb1', target: 'CLOSED', actionLabel: 'reset failures' },
      THRESHOLD_REACHED: { id: 'cb2', target: 'OPEN' },
      RESET:             { id: 'cb3', target: 'CLOSED', actionLabel: 'reset counters', manual: true },
      FORCE_OPEN:        { id: 'cb4', target: 'OPEN', manual: true }
    }
  },
  OPEN: {
    on: {
      RESET_TIMEOUT: { id: 'cb5', target: 'HALF_OPEN' },
      RESET:         { id: 'cb6', target: 'CLOSED', manual: true }
    }
  },
  HALF_OPEN: {
    on: {
      SUCCESS:    { id: 'cb7', target: 'CLOSED' },
      FAILURE:    { id: 'cb8', target: 'OPEN' },
      RESET:      { id: 'cb9', target: 'CLOSED', manual: true },
      FORCE_OPEN: { id: 'cb10', target: 'OPEN', manual: true }
    }
  }
};

export const initial = 'CLOSED';
