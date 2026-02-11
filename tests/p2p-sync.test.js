import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { P2PSync } from '../src/sync/p2p-sync.js';

function createMockTransport(isHost = false) {
  const stateListeners = [];
  const dataListeners = [];
  const pingListeners = [];
  return {
    state: 'IDLE',
    isHost,
    sent: [],
    onStateChange(cb) { stateListeners.push(cb); },
    addDataListener(cb) { dataListeners.push(cb); },
    addPingListener(cb) { pingListeners.push(cb); },
    send(data) { this.sent.push(data); return true; },
    _simulateState(to, from) {
      this.state = to;
      for (const cb of stateListeners) cb(to, null, from, null);
    },
    _simulateData(data) {
      for (const cb of dataListeners) cb(data);
    }
  };
}

function connectTransport(transport) {
  transport._simulateState('INITIALIZING', 'IDLE');
  transport._simulateState('READY', 'INITIALIZING');
  transport._simulateState('CONNECTED', 'AUTHENTICATING');
}

describe('P2PSync', () => {
  it('état initial IDLE', () => {
    const transport = createMockTransport();
    const sync = new P2PSync(transport);
    assert.equal(sync.state, 'IDLE');
    assert.equal(sync.isConnected, false);
  });

  it('projection L2 : IDLE → CONNECTING → CONNECTED', () => {
    const transport = createMockTransport();
    const sync = new P2PSync(transport);
    const states = [];
    sync.onStateChange = (state) => states.push(state);

    connectTransport(transport);

    assert.deepEqual(states, ['CONNECTING', 'CONNECTED']);
    assert.equal(sync.state, 'CONNECTED');
    assert.equal(sync.isConnected, true);
  });

  it('projection L2 : CONNECTED → DISCONNECTED sur perte connexion', () => {
    const transport = createMockTransport();
    const sync = new P2PSync(transport);
    connectTransport(transport);

    const states = [];
    sync.onStateChange = (state) => states.push(state);
    transport._simulateState('READY', 'CONNECTED');

    assert.deepEqual(states, ['DISCONNECTED']);
    assert.equal(sync.isConnected, false);
  });

  it('guard démarré sur CONNECTED, arrêté sur déconnexion', () => {
    const transport = createMockTransport();
    const sync = new P2PSync(transport, { guardTimeout: 60000 });

    assert.equal(sync.guardState, null);
    connectTransport(transport);
    assert.equal(sync.guardState, 'HALF_OPEN');

    transport._simulateState('READY', 'CONNECTED');
    assert.equal(sync.guardState, null);
  });

  it('createSession envoie _ctrl sessionCreate (hôte)', () => {
    const transport = createMockTransport(true);
    const sync = new P2PSync(transport);
    connectTransport(transport);
    transport.sent.length = 0;

    const handler = { onStart() {}, getLocalState() { return { x: 1 }; } };
    sync.createSession('counter', { mode: 'centralized', fps: 0 }, handler);

    const ctrl = transport.sent.find(m => m._ctrl === 'sessionCreate');
    assert.ok(ctrl);
    assert.equal(ctrl.id, 'counter');
    assert.equal(ctrl.mode, 'centralized');
  });

  it('session activée après sessionReady du guest', () => {
    const transport = createMockTransport(true);
    const sync = new P2PSync(transport);
    connectTransport(transport);

    let startedCtrl = null;
    const handler = {
      onStart(ctrl) { startedCtrl = ctrl; },
      getLocalState() { return { x: 1 }; }
    };
    sync.createSession('counter', { mode: 'centralized', fps: 0 }, handler);
    transport._simulateData({ _ctrl: 'sessionReady', id: 'counter', type: '_ctrl' });

    assert.ok(startedCtrl);
    assert.equal(startedCtrl.id, 'counter');
    assert.equal(startedCtrl.mode, 'centralized');
    assert.equal(sync.getSession('counter').state, 'CONNECTED');
  });

  it('routage messages _s vers le handler de session', () => {
    const transport = createMockTransport(true);
    const sync = new P2PSync(transport);
    connectTransport(transport);

    let receivedAction = null;
    const handler = {
      onStart() {},
      getLocalState() { return { count: 0 }; },
      processAction(action) { receivedAction = action; }
    };
    sync.createSession('counter', { mode: 'centralized', fps: 0 }, handler);
    transport._simulateData({ _ctrl: 'sessionReady', id: 'counter', type: '_ctrl' });

    transport._simulateData({ _s: 'counter', type: 'action', action: { type: 'increment' } });

    assert.deepEqual(receivedAction, { type: 'increment' });
  });

  it('endSession envoie sessionEnd et détruit la session', () => {
    const transport = createMockTransport(true);
    const sync = new P2PSync(transport);
    connectTransport(transport);

    let ended = false;
    const handler = {
      onStart() {},
      onEnd() { ended = true; },
      getLocalState() { return {}; }
    };
    sync.createSession('counter', { mode: 'centralized', fps: 0 }, handler);
    transport._simulateData({ _ctrl: 'sessionReady', id: 'counter', type: '_ctrl' });
    transport.sent.length = 0;

    sync.endSession('counter');

    assert.ok(ended);
    assert.equal(sync.getSession('counter'), null);
    const ctrl = transport.sent.find(m => m._ctrl === 'sessionEnd');
    assert.ok(ctrl);
  });

  it('_presence créée automatiquement sur CONNECTED', () => {
    const transport = createMockTransport(true);
    const sync = new P2PSync(transport);
    connectTransport(transport);

    assert.ok(sync.sessions.has('_presence'));
  });
});
