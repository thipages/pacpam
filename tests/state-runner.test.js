import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StateRunner } from '../src/core/state-runner.js';

describe('StateRunner', () => {
  const states = {
    IDLE: { on: { START: 'RUNNING' } },
    RUNNING: { on: { STOP: 'IDLE', PAUSE: 'PAUSED' } },
    PAUSED: { on: { RESUME: 'RUNNING', STOP: 'IDLE' } }
  };

  it('état initial correct', () => {
    const sm = new StateRunner(states, 'IDLE');
    assert.equal(sm.current, 'IDLE');
  });

  it('transition simple (IDLE → RUNNING via START)', () => {
    const sm = new StateRunner(states, 'IDLE');
    const result = sm.send('START');
    assert.equal(result, true);
    assert.equal(sm.current, 'RUNNING');
  });

  it('transition ignorée si événement invalide', () => {
    const sm = new StateRunner(states, 'IDLE');
    const result = sm.send('UNKNOWN');
    assert.equal(result, false);
    assert.equal(sm.current, 'IDLE');
  });

  it('is() retourne le bon état', () => {
    const sm = new StateRunner(states, 'IDLE');
    assert.equal(sm.is('IDLE'), true);
    assert.equal(sm.is('RUNNING'), false);
    sm.send('START');
    assert.equal(sm.is('RUNNING'), true);
  });

  it('can() vérifie les transitions possibles', () => {
    const sm = new StateRunner(states, 'IDLE');
    assert.equal(sm.can('START'), true);
    assert.equal(sm.can('STOP'), false);
    assert.equal(sm.can('PAUSE'), false);
  });

  it('guard bloque une transition', () => {
    const guardedStates = {
      A: { on: { GO: { target: 'B', guard: { sm: 'other', not: 'BLOCKED' } } } },
      B: { on: {} }
    };
    const sm = new StateRunner(guardedStates, 'A');
    sm.checkGuard = () => false;
    const result = sm.send('GO');
    assert.equal(result, false);
    assert.equal(sm.current, 'A');
  });

  it('guard autorise une transition', () => {
    const guardedStates = {
      A: { on: { GO: { target: 'B', guard: { sm: 'other', not: 'BLOCKED' } } } },
      B: { on: {} }
    };
    const sm = new StateRunner(guardedStates, 'A');
    sm.checkGuard = () => true;
    const result = sm.send('GO');
    assert.equal(result, true);
    assert.equal(sm.current, 'B');
  });

  it('emit déclenche le callback onEmit', () => {
    const emitStates = {
      A: { on: { GO: { target: 'B', emit: { sm: 'cb', event: 'SUCCESS' } } } },
      B: { on: {} }
    };
    const sm = new StateRunner(emitStates, 'A');
    let emitted = null;
    sm.onEmit = (emit) => { emitted = emit; };
    sm.send('GO');
    assert.notEqual(emitted, null);
    assert.equal(emitted.sm, 'cb');
    assert.equal(emitted.event, 'SUCCESS');
  });

  it('actions entry/exit exécutées via register()', () => {
    const sm = new StateRunner(states, 'IDLE');
    let exitCalled = false;
    let entryCalled = false;
    sm.register('IDLE', { exit: () => { exitCalled = true; } });
    sm.register('RUNNING', { entry: () => { entryCalled = true; } });
    sm.send('START');
    assert.equal(exitCalled, true);
    assert.equal(entryCalled, true);
  });

  it('onTransition appelé avec (from, to, event)', () => {
    const sm = new StateRunner(states, 'IDLE');
    let args = null;
    sm.onTransition = (from, to, event) => { args = { from, to, event }; };
    sm.send('START');
    assert.equal(args.from, 'IDLE');
    assert.equal(args.to, 'RUNNING');
    assert.equal(args.event, 'START');
  });

  it('self-loop: action exécutée sans entry/exit', () => {
    let actionCalled = false;
    const selfLoopStates = {
      A: { on: { LOOP: { target: 'A', action: () => { actionCalled = true; } } } }
    };
    const sm = new StateRunner(selfLoopStates, 'A');
    let entryCalled = false;
    let exitCalled = false;
    sm.register('A', {
      entry: () => { entryCalled = true; },
      exit: () => { exitCalled = true; }
    });
    sm.send('LOOP');
    assert.equal(actionCalled, true);
    assert.equal(entryCalled, false);
    assert.equal(exitCalled, false);
    assert.equal(sm.current, 'A');
  });
});
