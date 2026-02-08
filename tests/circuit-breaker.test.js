import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadLocale } from '../src/core/locale.js';
import { CircuitBreaker, P2PCircuitBreaker } from '../src/security/circuit-breaker.js';

describe('Circuit Breaker', () => {
  before(async () => {
    await loadLocale();
  });

  it('état initial CLOSED', () => {
    const cb = new CircuitBreaker();
    assert.equal(cb.sm.current, 'CLOSED');
  });

  it('CLOSED → OPEN après maxFailures échecs', () => {
    const cb = new CircuitBreaker({ maxFailures: 3 });
    cb.onFailure(new Error('fail 1'));
    cb.onFailure(new Error('fail 2'));
    cb.onFailure(new Error('fail 3'));
    assert.equal(cb.sm.current, 'OPEN');
  });

  it('HALF_OPEN → CLOSED sur succès', () => {
    const cb = new CircuitBreaker({ maxFailures: 1 });
    cb.onFailure(new Error('fail'));
    assert.equal(cb.sm.current, 'OPEN');
    cb.sm.send('RESET_TIMEOUT');
    assert.equal(cb.sm.current, 'HALF_OPEN');
    cb.onSuccess();
    assert.equal(cb.sm.current, 'CLOSED');
  });

  it('HALF_OPEN → OPEN sur échec', () => {
    const cb = new CircuitBreaker({ maxFailures: 1 });
    cb.onFailure(new Error('fail'));
    cb.sm.send('RESET_TIMEOUT');
    assert.equal(cb.sm.current, 'HALF_OPEN');
    cb.onFailure(new Error('fail again'));
    assert.equal(cb.sm.current, 'OPEN');
  });

  it('getMetrics retourne les bonnes valeurs', () => {
    const cb = new CircuitBreaker();
    cb.onSuccess();
    cb.onSuccess();
    cb.onFailure(new Error('fail'));
    const metrics = cb.getMetrics();
    assert.equal(metrics.state, 'CLOSED');
    assert.equal(metrics.totalSuccesses, 2);
    assert.equal(metrics.totalFailures, 1);
    assert.equal(metrics.consecutiveFailures, 1);
  });

  it('reset() remet le circuit à CLOSED', () => {
    const cb = new CircuitBreaker({ maxFailures: 2 });
    cb.onFailure(new Error('fail'));
    cb.onFailure(new Error('fail'));
    assert.equal(cb.sm.current, 'OPEN');
    cb.reset();
    assert.equal(cb.sm.current, 'CLOSED');
    assert.equal(cb.failures, 0);
  });

  it('open() force l\'ouverture du circuit', () => {
    const cb = new CircuitBreaker();
    assert.equal(cb.sm.current, 'CLOSED');
    cb.open();
    assert.equal(cb.sm.current, 'OPEN');
  });

  it('isAvailable() selon l\'état', () => {
    const cb = new CircuitBreaker({ maxFailures: 1, resetTimeout: 60000 });
    assert.equal(cb.isAvailable(), true);
    cb.onFailure(new Error('fail'));
    assert.equal(cb.isAvailable(), false);
  });

  it('isAvailable() true en OPEN si timeout expiré', () => {
    const cb = new CircuitBreaker({ maxFailures: 1, resetTimeout: 100 });
    cb.onFailure(new Error('fail'));
    assert.equal(cb.sm.current, 'OPEN');
    cb.nextAttemptTime = Date.now() - 1;
    assert.equal(cb.isAvailable(), true);
  });


});

describe('P2P Circuit Breaker', () => {
  before(async () => {
    await loadLocale();
  });

  it('P2PCircuitBreaker hérite de CircuitBreaker', () => {
    const p2pcb = new P2PCircuitBreaker('test-peer');
    assert.ok(p2pcb instanceof CircuitBreaker);
    assert.equal(p2pcb.peerId, 'test-peer');
  });

  it('getStatusMessage en état CLOSED', () => {
    const p2pcb = new P2PCircuitBreaker('peer-ok');
    assert.equal(p2pcb.getStatusMessage(), 'Connexion disponible.');
  });

  it('getStatusMessage en état OPEN', () => {
    const p2pcb = new P2PCircuitBreaker('peer-open');
    p2pcb.open();
    const msg = p2pcb.getStatusMessage();
    assert.ok(msg.includes('Connexion indisponible'));
  });

  it('getStatusMessage en état HALF_OPEN', () => {
    const p2pcb = new P2PCircuitBreaker('peer-half');
    p2pcb.open();
    p2pcb.sm.send('RESET_TIMEOUT');
    assert.equal(p2pcb.getStatusMessage(), 'Test de connexion en cours...');
  });
});
