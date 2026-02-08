import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { connectionStates, initial } from '../src/core/connection-states.js';

describe('Connection States', () => {
  it('état initial est IDLE', () => {
    assert.equal(initial, 'IDLE');
  });

  it('chaque état possède un objet "on"', () => {
    for (const [name, state] of Object.entries(connectionStates)) {
      assert.ok(state.on && typeof state.on === 'object', `${name} devrait avoir un objet "on"`);
    }
  });

  it('toutes les transitions pointent vers des états existants', () => {
    const stateNames = Object.keys(connectionStates);
    for (const [name, state] of Object.entries(connectionStates)) {
      for (const [event, transition] of Object.entries(state.on)) {
        const target = typeof transition === 'string' ? transition : transition.target;
        assert.ok(stateNames.includes(target), `${name}.${event} → ${target} : état cible inexistant`);
      }
    }
  });

  it('guards ont le format attendu (sm + not)', () => {
    for (const [name, state] of Object.entries(connectionStates)) {
      for (const [event, transition] of Object.entries(state.on)) {
        if (typeof transition === 'object' && transition.guard) {
          assert.equal(typeof transition.guard, 'object', `${name}.${event} guard devrait être un objet`);
          assert.ok('sm' in transition.guard, `${name}.${event} guard devrait avoir "sm"`);
        }
      }
    }
  });

  it('emits ont le format attendu (sm + event)', () => {
    for (const [name, state] of Object.entries(connectionStates)) {
      for (const [event, transition] of Object.entries(state.on)) {
        if (typeof transition === 'object' && transition.emit) {
          assert.equal(typeof transition.emit, 'object', `${name}.${event} emit devrait être un objet`);
          assert.ok('sm' in transition.emit, `${name}.${event} emit devrait avoir "sm"`);
          assert.ok('event' in transition.emit, `${name}.${event} emit devrait avoir "event"`);
        }
      }
    }
  });

  it('IDLE → INITIALIZING via INIT', () => {
    assert.equal(connectionStates.IDLE.on.INIT, 'INITIALIZING');
  });

  it('CONNECTED gère DISCONNECT vers IDLE', () => {
    assert.equal(connectionStates.CONNECTED.on.DISCONNECT, 'IDLE');
  });
});
