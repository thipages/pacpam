export const connectionStates = {
  IDLE: {
    on: { INIT: { id: 'c1', target: 'INITIALIZING' } }
  },
  INITIALIZING: {
    on: {
      PEER_OPEN:           { id: 'c2', target: 'READY' },
      ID_UNAVAILABLE:      { id: 'c3', target: 'IDLE' },
      PEER_CREATION_ERROR: { id: 'c4', target: 'IDLE' },
      SIGNALING_ERROR:     { id: 'c5', target: 'IDLE' }
    }
  },
  READY: {
    on: {
      CONNECT_TO:      { id: 'c6', target: 'CONNECTING', guard: { sm: 'cb', not: 'OPEN' } },
      CONNECTION_OPEN: { id: 'c7', target: 'AUTHENTICATING' },
      SIGNALING_LOST:  { id: 'c8', target: 'IDLE' },
      SIGNALING_ERROR: { id: 'c9', target: 'IDLE' },
      CONNECTION_ERROR: { id: 'c10', target: 'IDLE' },
      DISCONNECT:      { id: 'c11', target: 'IDLE' }
    }
  },
  CONNECTING: {
    on: {
      CONNECTION_OPEN:  { id: 'c12', target: 'AUTHENTICATING', emit: { sm: 'cb', event: 'SUCCESS' } },
      TIMEOUT:          { id: 'c13', target: 'READY', emit: { sm: 'cb', event: 'FAILURE' } },
      PEER_UNAVAILABLE: { id: 'c14', target: 'READY', emit: { sm: 'cb', event: 'FAILURE' } },
      SIGNALING_ERROR:  { id: 'c15', target: 'READY', emit: { sm: 'cb', event: 'FAILURE' } },
      CONNECTION_ERROR: { id: 'c16', target: 'READY', emit: { sm: 'cb', event: 'FAILURE' } },
      DISCONNECT:       { id: 'c17', target: 'IDLE' }
    }
  },
  AUTHENTICATING: {
    on: {
      AUTH_SUCCESS:     { id: 'c18', target: 'CONNECTED' },
      AUTH_FAILED:      { id: 'c19', target: 'READY' },
      AUTH_TIMEOUT:     { id: 'c20', target: 'READY' },
      CLOSE:            { id: 'c21', target: 'READY' },
      SIGNALING_ERROR:  { id: 'c22', target: 'READY' },
      CONNECTION_ERROR: { id: 'c23', target: 'READY' },
      DISCONNECT:       { id: 'c24', target: 'IDLE' }
    }
  },
  CONNECTED: {
    on: {
      CLOSE:            { id: 'c25', target: 'READY' },
      PING_TIMEOUT:     { id: 'c26', target: 'READY' },
      SIGNALING_LOST:   { id: 'c27', target: 'CONNECTED', actionLabel: 'reconnect signaling' },
      SIGNALING_ERROR:  { id: 'c28', target: 'READY' },
      CONNECTION_ERROR: { id: 'c29', target: 'READY' },
      DISCONNECT:       { id: 'c30', target: 'IDLE' }
    }
  }
};

export const initial = 'IDLE';
