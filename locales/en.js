export default {
  "states": {
    "connection": {
      "IDLE": "No active connection. The system is waiting for initialization.",
      "INITIALIZING": "The client is connecting to the PeerJS signaling server.",
      "READY": "The client is connected to the server and ready to initiate or receive a connection.",
      "CONNECTING": "A WebRTC connection attempt is in progress toward a remote peer.",
      "AUTHENTICATING": "The WebRTC connection is open. Both peers are exchanging an authentication hash.",
      "CONNECTED": "The connection is established and authenticated. Data is flowing between peers."
    },
    "circuitBreaker": {
      "CLOSED": "The circuit is healthy. Connection attempts are allowed.",
      "OPEN": "The circuit is open after repeated failures. Connections are temporarily blocked.",
      "HALF_OPEN": "The circuit is testing a reconnection. Only one attempt is allowed."
    }
  },
  "events": {
    "INIT": "The application requests PeerJS connection initialization.",
    "PEER_OPEN": "The signaling server accepted the connection and assigned an identifier.",
    "ID_UNAVAILABLE": "The requested identifier is already in use by another peer.",
    "PEER_CREATION_ERROR": "Failed to create the P2P connection (WebRTC unavailable).",
    "SIGNALING_ERROR": "A signaling server error prevents communication.",
    "CONNECTION_ERROR": "A WebRTC data channel error prevents communication.",
    "CONNECT_TO": "The user requests a connection to a remote peer.",
    "CONNECTION_OPEN": "The WebRTC connection is open with the remote peer.",
    "SIGNALING_LOST": "The connection to the signaling server has been lost.",
    "DISCONNECT": "The user requests disconnection.",
    "TIMEOUT": "The connection timeout expired without a response from the remote peer.",
    "PEER_UNAVAILABLE": "The remote peer is unreachable or refused the connection.",
    "AUTH_SUCCESS": "Authentication succeeded. Both peers share the same password.",
    "AUTH_FAILED": "Authentication failed. Password hashes do not match.",
    "AUTH_TIMEOUT": "The remote peer did not respond to the authentication message in time.",
    "CLOSE": "The remote peer closed the connection.",
    "PING_TIMEOUT": "The remote peer no longer responds to keepalive pings.",
    "SUCCESS": "The connection or test attempt succeeded (circuit breaker signal).",
    "FAILURE": "The attempt failed (circuit breaker signal).",
    "THRESHOLD_REACHED": "The maximum number of consecutive failures has been reached. The circuit opens.",
    "RESET_TIMEOUT": "The open circuit wait time has expired. A reconnection test is allowed.",
    "RESET": "Manual reset of the circuit breaker.",
    "FORCE_OPEN": "Forced opening of the circuit breaker (manual action)."
  },
  "guards": {
    "circuitBreakerNotOpen": "Connection is only allowed if the peer's circuit breaker is not in the open state. If the wait time has elapsed, the circuit automatically transitions to test (HALF_OPEN) before evaluation."
  },
  "signals": {
    "cb.SUCCESS": "Emitted when the WebRTC connection opens successfully. Signals the circuit breaker that the peer is reachable.",
    "cb.FAILURE": "Emitted when a connection attempt fails (timeout, peer not found, network error). Signals the circuit breaker to increment the failure counter."
  },
  "errors": {
    "ID_UNAVAILABLE": "This identifier is already in use.",
    "PEER_UNAVAILABLE": "Peer not found.",
    "PEER_CREATION_ERROR": "Failed to create P2P connection.",
    "SIGNALING_ERROR": "Signaling server error.",
    "CONNECTION_ERROR": "P2P connection error.",
    "SIGNALING_LOST": "Disconnected from server.",
    "AUTH_FAILED": "Authentication failed.",
    "AUTH_TIMEOUT": "Authentication timeout exceeded.",
    "CIRCUIT_OPEN": "Connection unavailable (retrying in {secondsLeft}s).",
    "CIRCUIT_HALF_OPEN": "Connection test in progress...",
    "CIRCUIT_UNSTABLE": "Unstable connection ({failures} failures).",
    "CIRCUIT_OK": "Connection available."
  }
};
