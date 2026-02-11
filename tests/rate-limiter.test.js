import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter, MESSAGE_RATE_LIMITS } from '../src/security/rate-limiter.js';

describe('Rate Limiting', () => {
  it('autorise les messages dans la limite (default: 10/sec)', () => {
    const limiter = new RateLimiter();
    for (let i = 0; i < 10; i++) {
      assert.equal(limiter.checkLimit('default', 'peer1'), true, `Message ${i + 1} devrait passer`);
    }
  });

  it('bloque après la limite', () => {
    const limiter = new RateLimiter();
    for (let i = 0; i < 10; i++) {
      limiter.checkLimit('default', 'peer2');
    }
    assert.equal(limiter.checkLimit('default', 'peer2'), false);
  });

  it('respecte les limites par type (localState: 35/sec)', () => {
    const limiter = new RateLimiter();
    for (let i = 0; i < 35; i++) {
      assert.equal(limiter.checkLimit('localState', 'peer3'), true, `localState ${i + 1} devrait passer`);
    }
    assert.equal(limiter.checkLimit('localState', 'peer3'), false);
  });

  it('bloque un pair après trop de violations', () => {
    const limiter = new RateLimiter();
    for (let j = 0; j < 15; j++) {
      for (let i = 0; i < 11; i++) {
        limiter.checkLimit('ping', 'badPeer');
      }
    }
    assert.equal(limiter.isBlocked('badPeer'), true);
  });

  it('resetPeer réinitialise les compteurs', () => {
    const limiter = new RateLimiter();
    for (let i = 0; i < 10; i++) {
      limiter.checkLimit('default', 'peer4');
    }
    assert.equal(limiter.checkLimit('default', 'peer4'), false);
    limiter.resetPeer('peer4');
    assert.equal(limiter.checkLimit('default', 'peer4'), true);
  });

  it('getStats retourne les statistiques', () => {
    const limiter = new RateLimiter();
    limiter.checkLimit('default', 'peer5');
    const stats = limiter.getStats();
    assert.ok('activeCounters' in stats);
    assert.ok('blockedPeers' in stats);
    assert.ok('totalViolations' in stats);
  });

  it('MESSAGE_RATE_LIMITS contient les types attendus', () => {
    const expected = ['localState', 'fullState', 'action', 'message', '_ctrl', 'auth', 'ping', 'pong', 'default'];
    for (const type of expected) {
      assert.ok(type in MESSAGE_RATE_LIMITS, `${type} devrait être défini`);
      assert.ok('max' in MESSAGE_RATE_LIMITS[type], `${type} devrait avoir max`);
      assert.ok('window' in MESSAGE_RATE_LIMITS[type], `${type} devrait avoir window`);
    }
  });
});
