export default {
  "states": {
    "connection": {
      "IDLE": "Aucune connexion active. Le système attend une initialisation.",
      "INITIALIZING": "Le client se connecte au serveur de signalisation PeerJS.",
      "READY": "Le client est connecté au serveur et prêt à initier ou recevoir une connexion.",
      "CONNECTING": "Une tentative de connexion WebRTC est en cours vers un pair distant.",
      "AUTHENTICATING": "La connexion WebRTC est ouverte. Les deux pairs échangent un hash d'authentification.",
      "CONNECTED": "La connexion est établie et authentifiée. Les données circulent entre les pairs."
    },
    "circuitBreaker": {
      "CLOSED": "Le circuit est sain. Les tentatives de connexion sont autorisées.",
      "OPEN": "Le circuit est ouvert après des échecs répétés. Les connexions sont bloquées temporairement.",
      "HALF_OPEN": "Le circuit teste une reconnexion. Un seul essai est autorisé."
    }
  },
  "events": {
    "INIT": "L'application demande l'initialisation de la connexion PeerJS.",
    "PEER_OPEN": "Le serveur de signalisation a accepté la connexion et attribué un identifiant.",
    "ID_UNAVAILABLE": "L'identifiant demandé est déjà utilisé par un autre pair.",
    "NETWORK_ERROR": "Une erreur réseau empêche la communication.",
    "CONNECT_TO": "L'utilisateur demande une connexion vers un pair distant.",
    "CONNECTION_OPEN": "La connexion WebRTC est ouverte avec le pair distant.",
    "SIGNALING_LOST": "La connexion au serveur de signalisation a été perdue.",
    "DISCONNECT": "L'utilisateur demande la déconnexion.",
    "TIMEOUT": "Le délai de connexion a expiré sans réponse du pair distant.",
    "PEER_UNAVAILABLE": "Le pair distant est introuvable ou a refusé la connexion.",
    "AUTH_SUCCESS": "L'authentification a réussi. Les deux pairs partagent le même mot de passe.",
    "AUTH_FAILED": "L'authentification a échoué. Les hashs de mot de passe ne correspondent pas.",
    "AUTH_TIMEOUT": "Le pair distant n'a pas répondu au message d'authentification dans le délai imparti.",
    "CLOSE": "Le pair distant a fermé la connexion.",
    "PING_TIMEOUT": "Le pair distant ne répond plus aux pings de keepalive.",
    "SUCCESS": "La tentative de connexion ou de test a réussi (signal circuit breaker).",
    "FAILURE": "La tentative a échoué (signal circuit breaker).",
    "THRESHOLD_REACHED": "Le nombre maximal d'échecs consécutifs a été atteint. Le circuit s'ouvre.",
    "RESET_TIMEOUT": "Le délai d'attente du circuit ouvert a expiré. Un test de reconnexion est autorisé.",
    "RESET": "Réinitialisation manuelle du circuit breaker.",
    "FORCE_OPEN": "Ouverture forcée du circuit breaker (action manuelle)."
  },
  "guards": {
    "circuitBreakerNotOpen": "La connexion n'est autorisée que si le circuit breaker du pair n'est pas en état ouvert. Si le délai d'attente est écoulé, le circuit passe automatiquement en test (HALF_OPEN) avant évaluation."
  },
  "signals": {
    "cb.SUCCESS": "Émis quand la connexion WebRTC s'ouvre avec succès. Signale au circuit breaker que le pair est joignable.",
    "cb.FAILURE": "Émis quand une tentative de connexion échoue (timeout, pair introuvable, erreur réseau). Signale au circuit breaker d'incrémenter le compteur d'échecs."
  },
  "errors": {
    "ID_UNAVAILABLE": "Cet identifiant est déjà utilisé.",
    "PEER_UNAVAILABLE": "Pair introuvable.",
    "NETWORK_ERROR": "Erreur réseau.",
    "SIGNALING_LOST": "Déconnecté du serveur.",
    "AUTH_FAILED": "Échec de l'authentification.",
    "AUTH_TIMEOUT": "Délai d'authentification dépassé.",
    "CIRCUIT_OPEN": "Connexion indisponible (nouvelle tentative dans {secondsLeft}s).",
    "CIRCUIT_HALF_OPEN": "Test de connexion en cours...",
    "CIRCUIT_UNSTABLE": "Connexion instable ({failures} échecs).",
    "CIRCUIT_OK": "Connexion disponible."
  }
};
