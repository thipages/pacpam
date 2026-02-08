import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { P2PSync } from '../src/sync/p2p-sync.js';

function createMockSession(overrides = {}) {
  return {
    isRunning: true,
    isNetworkGame: false,
    isHost: false,
    getLocalState() { return { x: 1, y: 2 }; },
    applyRemoteState(state) { this.lastRemoteState = state; },
    processAction(action) { this.lastAction = action; },
    lastRemoteState: null,
    lastAction: null,
    ...overrides
  };
}

describe('P2PSync', () => {
  it('setup() initialise correctement (host)', () => {
    const sync = new P2PSync({ fps: 0 });
    const sent = [];
    const session = createMockSession();
    sync.setup(true, (msg) => sent.push(msg), session);
    assert.equal(sync.isHost, true);
    assert.equal(session.isNetworkGame, true);
    assert.equal(session.isHost, true);
    // En mode on-demand, l'hôte envoie l'état initial
    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, 'fullState');
  });

  it('setup() initialise correctement (guest)', () => {
    const sync = new P2PSync({ fps: 0 });
    const sent = [];
    const session = createMockSession();
    sync.setup(false, (msg) => sent.push(msg), session);
    assert.equal(sync.isHost, false);
    assert.equal(session.isHost, false);
    // Le guest n'envoie rien au setup en mode on-demand
    assert.equal(sent.length, 0);
  });

  it('receiveMessage() avec type fullState → appelle applyRemoteState()', () => {
    const sync = new P2PSync({ fps: 0 });
    const session = createMockSession();
    sync.setup(false, () => {}, session);
    sync.receiveMessage({ type: 'fullState', state: { score: 42 } });
    assert.deepEqual(session.lastRemoteState, { score: 42 });
  });

  it('receiveMessage() avec type action (host) → appelle processAction()', () => {
    const sync = new P2PSync({ fps: 0 });
    const sent = [];
    const session = createMockSession();
    sync.setup(true, (msg) => sent.push(msg), session);
    sent.length = 0; // Ignorer le broadcastState initial
    sync.receiveMessage({ type: 'action', action: { move: 'up' } });
    assert.deepEqual(session.lastAction, { move: 'up' });
    // L'hôte renvoie l'état après traitement
    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, 'fullState');
  });

  it('sendAction() (guest) → appelle sendCallback avec { type: action }', () => {
    const sync = new P2PSync({ fps: 0 });
    const sent = [];
    const session = createMockSession();
    sync.setup(false, (msg) => sent.push(msg), session);
    sync.sendAction({ play: 'card-7' });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, 'action');
    assert.deepEqual(sent[0].action, { play: 'card-7' });
  });

  it('sendAction() ignoré si isHost', () => {
    const sync = new P2PSync({ fps: 0 });
    const sent = [];
    const session = createMockSession();
    sync.setup(true, (msg) => sent.push(msg), session);
    sent.length = 0;
    sync.sendAction({ play: 'card-7' });
    assert.equal(sent.length, 0);
  });

  it('broadcastState() (host) → envoie fullState', () => {
    const sync = new P2PSync({ fps: 0 });
    const sent = [];
    const session = createMockSession();
    sync.setup(true, (msg) => sent.push(msg), session);
    sent.length = 0;
    sync.broadcastState();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, 'fullState');
    assert.deepEqual(sent[0].state, { x: 1, y: 2 });
  });

  it('broadcastState() ignoré si guest', () => {
    const sync = new P2PSync({ fps: 0 });
    const sent = [];
    const session = createMockSession();
    sync.setup(false, (msg) => sent.push(msg), session);
    sync.broadcastState();
    assert.equal(sent.length, 0);
  });

  it('stop() arrête la synchronisation', () => {
    const sync = new P2PSync({ fps: 0 });
    const session = createMockSession();
    sync.setup(true, () => {}, session);
    sync.stop();
    assert.equal(sync.sendCallback, null);
    assert.equal(sync.session, null);
  });
});
