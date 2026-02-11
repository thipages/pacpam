/**
 * SM P2PSync — projection groupée de la couche 2 (connexion).
 *
 * 4 états : IDLE, CONNECTING, CONNECTED, DISCONNECTED
 * 6 transitions : p1–p6
 *
 * Compatible StateRunner.
 */

export const p2pSyncStates = {
  IDLE: {
    on: {
      CONNECT: { id: 'p1', target: 'CONNECTING' }
    }
  },
  CONNECTING: {
    on: {
      TRANSPORT_CONNECTED: { id: 'p2', target: 'CONNECTED' },
      TRANSPORT_FAILED:    { id: 'p3', target: 'IDLE' }
    }
  },
  CONNECTED: {
    on: {
      TRANSPORT_LOST: { id: 'p4', target: 'DISCONNECTED' }
    }
  },
  DISCONNECTED: {
    on: {
      RECONNECT: { id: 'p5', target: 'CONNECTING' },
      RESET:     { id: 'p6', target: 'IDLE' }
    }
  }
};

export const p2pSyncInitial = 'IDLE';
