/**
 * Handler centralisé fps=0 — compteur partagé
 *
 * L'hôte détient le compteur. Le guest envoie des actions (increment/decrement).
 * L'hôte traite via processAction et renvoie le fullState autoritaire.
 */
export function createCounterHandler(ui) {
    return {
        count: 0,
        ctrl: null,

        onStart(ctrl) {
            this.ctrl = ctrl;
            ui.log('[counter] session CONNECTED');
        },

        processAction(action) {
            if (action.op === 'increment') this.count++;
            if (action.op === 'decrement') this.count--;
            ui.updateCounter(this.count);
        },

        getLocalState() {
            return { count: this.count };
        },

        applyRemoteState(state) {
            this.count = state.count;
            ui.updateCounter(this.count);
        },

        onPeerAbsent() {
            ui.log('[counter] pair absent');
        },

        onPeerBack() {
            ui.log('[counter] pair de retour');
        },

        onEnd() {
            ui.log('[counter] session terminée');
            this.ctrl = null;
        }
    };
}
