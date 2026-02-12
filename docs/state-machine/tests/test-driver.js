import { Chat } from '../Chat.js';

export class TestDriver {
  #chats = new Map();
  #transitions = new Map();
  #messages = new Map();
  #errors = new Map();
  #stateWaiters = new Map();
  #messageWaiters = new Map();
  #appId;
  #password;
  #chatOptions;

  constructor(appId, password, { rawAppId = false, chatOptions = {} } = {}) {
    this.#appId = rawAppId ? appId : `${appId}-${Date.now()}`;
    this.#password = password;
    this.#chatOptions = chatOptions;
  }

  createChat(name) {
    const chat = new Chat(name, this.#appId, this.#password, this.#chatOptions);

    this.#chats.set(name, chat);
    this.#transitions.set(name, []);
    this.#messages.set(name, []);
    this.#errors.set(name, []);
    this.#stateWaiters.set(name, []);
    this.#messageWaiters.set(name, []);

    chat.onStateChange = (from, to, event) => {
      this.#transitions.get(name).push({ from, to, event });
      const waiters = this.#stateWaiters.get(name);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].state === to) {
          waiters[i].resolve();
          waiters.splice(i, 1);
        }
      }
    };

    chat.onMessage = (data) => {
      this.#messages.get(name).push(data);
      const waiters = this.#messageWaiters.get(name);
      if (waiters.length > 0) {
        const waiter = waiters.shift();
        waiter.resolve(data);
      }
    };

    chat.onError = (err) => {
      this.#errors.get(name).push(err.message || String(err));
    };

    return chat;
  }

  chat(name) {
    return this.#chats.get(name);
  }

  waitForState(name, state, timeoutMs = 15000) {
    const chat = this.#chats.get(name);
    if (!chat) return Promise.reject(new Error(`Chat "${name}" inconnu`));

    if (chat.state === state) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const waiters = this.#stateWaiters.get(name);
        const idx = waiters.findIndex(w => w === waiter);
        if (idx !== -1) waiters.splice(idx, 1);
        reject(new Error(`Timeout: "${name}" n'a pas atteint ${state} (actuel: ${chat.state})`));
      }, timeoutMs);

      const waiter = {
        state,
        resolve: () => { clearTimeout(timer); resolve(); }
      };
      this.#stateWaiters.get(name).push(waiter);
    });
  }

  waitForMessage(name, timeoutMs = 10000) {
    const msgs = this.#messages.get(name);
    if (!msgs) return Promise.reject(new Error(`Chat "${name}" inconnu`));

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const waiters = this.#messageWaiters.get(name);
        const idx = waiters.findIndex(w => w === waiter);
        if (idx !== -1) waiters.splice(idx, 1);
        reject(new Error(`Timeout: "${name}" n'a reçu aucun message`));
      }, timeoutMs);

      const waiter = {
        resolve: (data) => { clearTimeout(timer); resolve(data); }
      };
      this.#messageWaiters.get(name).push(waiter);
    });
  }

  chatNames() {
    return [...this.#chats.keys()];
  }

  transitions(name) {
    return this.#transitions.get(name) || [];
  }

  errors(name) {
    return this.#errors.get(name) || [];
  }

  cleanup() {
    for (const [name, chat] of this.#chats) {
      try {
        if (chat.state !== 'IDLE' && chat.state !== 'INITIALIZING') {
          chat.disconnect();
        }
      } catch (e) {}
    }
    this.#stateWaiters.clear();
    this.#messageWaiters.clear();
  }
}
