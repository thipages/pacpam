/**
 * Handler indépendant fps=0 — messages de statut
 *
 * Les deux pairs envoient et reçoivent des messages librement.
 * Pas de notion d'autorité sur les données.
 */
export function createStatusHandler(ui) {
    return {
        ctrl: null,

        onStart(ctrl) {
            this.ctrl = ctrl;
            ui.log('[status] session CONNECTED');
        },

        onMessage(message) {
            ui.addStatusMessage(message.from, message.text);
        },

        send(text, pseudo) {
            this.ctrl?.sendMessage({ from: pseudo, text });
        },

        onPeerAbsent() {
            ui.log('[status] pair absent');
        },

        onPeerBack() {
            ui.log('[status] pair de retour');
        },

        onEnd() {
            ui.log('[status] session terminée');
            this.ctrl = null;
        }
    };
}
