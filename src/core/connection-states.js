export const connectionStates = {
  IDLE: {
    on: { INIT: 'INITIALIZING' }
  },
  INITIALIZING: {
    on: {
      PEER_OPEN:           'READY',
      ID_UNAVAILABLE:      'IDLE',
      PEER_CREATION_ERROR: 'IDLE',
      SIGNALING_ERROR:     'IDLE'
    }
  },
  READY: {
    on: {
      CONNECT_TO:      { target: 'CONNECTING', guard: { sm: 'cb', not: 'OPEN' } },
      CONNECTION_OPEN: 'AUTHENTICATING',
      SIGNALING_LOST:  'IDLE',
      SIGNALING_ERROR: 'IDLE',
      CONNECTION_ERROR: 'IDLE',
      DISCONNECT:      'IDLE'
    }
  },
  CONNECTING: {
    on: {
      CONNECTION_OPEN:  { target: 'AUTHENTICATING', emit: { sm: 'cb', event: 'SUCCESS' } },
      TIMEOUT:          { target: 'READY', emit: { sm: 'cb', event: 'FAILURE' } },
      PEER_UNAVAILABLE: { target: 'READY', emit: { sm: 'cb', event: 'FAILURE' } },
      SIGNALING_ERROR:  { target: 'READY', emit: { sm: 'cb', event: 'FAILURE' } },
      CONNECTION_ERROR: { target: 'READY', emit: { sm: 'cb', event: 'FAILURE' } },
      DISCONNECT:       'IDLE'
    }
  },
  AUTHENTICATING: {
    on: {
      AUTH_SUCCESS:     'CONNECTED',
      AUTH_FAILED:      'READY',
      AUTH_TIMEOUT:     'READY',
      CLOSE:            'READY',
      SIGNALING_ERROR:  'READY',
      CONNECTION_ERROR: 'READY',
      DISCONNECT:       'IDLE'
    }
  },
  CONNECTED: {
    on: {
      CLOSE:            'READY',
      PING_TIMEOUT:     'READY',
      SIGNALING_LOST:   { target: 'CONNECTED', actionLabel: 'reconnect signaling' },
      SIGNALING_ERROR:  'READY',
      CONNECTION_ERROR: 'READY',
      DISCONNECT:       'IDLE'
    }
  }
};

export const initial = 'IDLE';
