import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyHash, createAuthMessage } from '../src/core/auth.js';

describe('Authentification', () => {
  it('hashPassword retourne un hash SHA-256 de 64 caractères hex', async () => {
    const hash = await hashPassword('test');
    assert.equal(hash.length, 64);
    assert.match(hash, /^[a-f0-9]{64}$/);
  });

  it('hashPassword est déterministe', async () => {
    const hash1 = await hashPassword('password');
    const hash2 = await hashPassword('password');
    assert.equal(hash1, hash2);
  });

  it('hashPassword produit des hashs différents pour des entrées différentes', async () => {
    const hash1 = await hashPassword('password1');
    const hash2 = await hashPassword('password2');
    assert.notEqual(hash1, hash2);
  });

  it('verifyHash retourne true pour hashs identiques', () => {
    const hash = 'a'.repeat(64);
    assert.equal(verifyHash(hash, hash), true);
  });

  it('verifyHash retourne false pour hashs différents', () => {
    assert.equal(verifyHash('a'.repeat(64), 'b'.repeat(64)), false);
  });

  it('verifyHash retourne false si un hash est vide ou null', () => {
    assert.equal(verifyHash('', 'a'.repeat(64)), false);
    assert.equal(verifyHash(null, 'a'.repeat(64)), false);
    assert.equal(verifyHash('a'.repeat(64), ''), false);
  });

  it('createAuthMessage retourne le bon format', async () => {
    const msg = await createAuthMessage('secret', 'Alice');
    assert.equal(msg.type, 'auth');
    assert.equal(msg.name, 'Alice');
    assert.equal(msg.hash.length, 64);
    assert.match(msg.hash, /^[a-f0-9]{64}$/);
    assert.equal(typeof msg.timestamp, 'number');
  });
});
