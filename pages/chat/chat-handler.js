export function createChatHandler(callbacks) {
  return {
    ctrl: null,
    onStart(ctrl) {
      this.ctrl = ctrl
      callbacks.onReady?.()
    },
    onEnd() {
      this.ctrl = null
      callbacks.onEnded?.()
    },
    onMessage(payload) {
      callbacks.onMessage?.(payload)
    },
    send(text, from) {
      this.ctrl?.sendMessage({ text, from })
    }
  }
}
