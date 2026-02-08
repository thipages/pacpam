/**
 * Synchronisation P2P unifiée
 *
 * Fusionne les modes temps réel et tour par tour :
 * - fps > 0 : envoi périodique (temps réel, ex: 30 fps pour Pong/Snake/Tank)
 * - fps = 0 : envoi à la demande (tour par tour, ex: Mo-piou)
 *
 * Le session object doit implémenter (duck typing) :
 *   getLocalState() → objet à envoyer
 *   applyRemoteState(state) → appliquer état reçu
 *   processAction(action) → optionnel, host traite une commande
 *   isRunning → boolean
 */

export class P2PSync {
  constructor({ fps = 0 } = {}) {
    this.fps = fps;
    this.sendCallback = null;
    this.isHost = false;
    this.session = null;
    this.syncInterval = null;
  }

  /**
   * Initialise la synchronisation
   * @param {boolean} isHost - Est-ce l'hôte ?
   * @param {Function} sendCallback - Fonction pour envoyer des messages
   * @param {Object} session - Objet implémentant le duck typing P2P
   */
  setup(isHost, sendCallback, session) {
    this.isHost = isHost;
    this.sendCallback = sendCallback;
    this.session = session;

    // Marquer la session comme mode réseau
    session.isNetworkGame = true;
    session.isHost = isHost;

    if (this.fps > 0) {
      // Mode temps réel : démarrer la boucle de sync
      this.startSync();
    } else if (isHost) {
      // Mode on-demand : l'hôte envoie l'état initial
      this.broadcastState();
    }
  }

  /**
   * Démarre la boucle de synchronisation (mode temps réel)
   */
  startSync() {
    this.stopSync();

    const interval = 1000 / this.fps;

    // TODO: setInterval n'est pas précis (drift, throttle en arrière-plan).
    // Acceptable ici car on envoie des snapshots complets (pas de deltas),
    // donc un retard n'accumule pas d'erreur. À réévaluer si besoin de
    // timing strict (ex: setTimeout récursif auto-corrigé).
    this.syncInterval = setInterval(() => {
      if (!this.session?.isRunning || !this.sendCallback) return;

      const state = this.session.getLocalState();

      if (this.isHost) {
        this.sendCallback({ type: 'fullState', state });
      } else {
        this.sendCallback({ type: 'peerState', state });
      }
    }, interval);
  }

  /**
   * Arrête la boucle de synchronisation
   */
  stopSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  /**
   * (Hôte) Diffuse l'état complet (on-demand)
   */
  broadcastState() {
    if (!this.isHost || !this.sendCallback || !this.session) return;

    const state = this.session.getLocalState();
    this.sendCallback({ type: 'fullState', state });
  }

  /**
   * (Guest) Envoie une commande à l'hôte (on-demand)
   */
  sendAction(action) {
    if (this.isHost || !this.sendCallback) return;

    this.sendCallback({ type: 'action', action });
  }

  /**
   * Reçoit un message du réseau et le dispatche
   */
  receiveMessage(data) {
    if (!this.session) return;

    if (data.type === 'action' && this.isHost) {
      // Hôte reçoit une commande du guest
      if (this.session.processAction) {
        this.session.processAction(data.action);
      }
      // Renvoyer l'état après traitement
      this.broadcastState();
    } else if (data.state) {
      // Appliquer l'état reçu
      this.session.applyRemoteState(data.state);
    }
  }

  /**
   * Arrête la synchronisation complètement
   */
  stop() {
    this.stopSync();
    this.sendCallback = null;
    this.session = null;
  }
}
