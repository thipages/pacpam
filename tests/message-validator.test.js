import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateMessage, sanitizeString, sanitizeGameState } from '../src/security/message-validator.js';

describe('Validation des messages', () => {
  it('rejet de message sans type', () => {
    assert.equal(validateMessage({ data: 'test' }), false);
  });

  it('rejet de type de message inconnu', () => {
    assert.equal(validateMessage({ type: 'hackAttempt' }), false);
  });

  it('validation auth avec hash et nom valides', () => {
    assert.equal(validateMessage({ type: 'auth', hash: 'a'.repeat(64), name: 'ALICE' }), true);
  });

  it('rejet auth sans hash', () => {
    assert.equal(validateMessage({ type: 'auth', name: 'ALICE' }), false);
  });

  it('rejet auth avec nom trop long', () => {
    assert.equal(validateMessage({ type: 'auth', hash: 'a'.repeat(64), name: 'A'.repeat(20) }), false);
  });

  it('rejet de message avec champ non autorisé', () => {
    assert.equal(validateMessage({ type: 'ping', timestamp: Date.now(), maliciousField: 'hack' }), false);
  });

  it('validation peerState avec état valide', () => {
    assert.equal(validateMessage({
      type: 'peerState',
      state: { players: [], score: { p1: 0, p2: 0 } }
    }), true);
  });

  it('rejet peerState avec objet trop profond', () => {
    let deepObj = {};
    let current = deepObj;
    for (let i = 0; i < 15; i++) {
      current.nested = {};
      current = current.nested;
    }
    assert.equal(validateMessage({ type: 'peerState', state: deepObj }), false);
  });
});

describe('Sanitisation', () => {
  it('sanitisation de string avec HTML', () => {
    const output = sanitizeString('<script>alert("xss")</script>');
    assert.equal(output.includes('<'), false);
    assert.equal(output.includes('>'), false);
  });

  it('protection contre caractères de contrôle', () => {
    const output = sanitizeString('Normal\x00Text\x1FWith\x7FControl');
    assert.equal(output.includes('\x00'), false);
    assert.equal(output.includes('\x1F'), false);
    assert.equal(output.includes('\x7F'), false);
  });

  it('protection XSS dans sanitizeGameState', () => {
    const sanitized = sanitizeGameState({
      playerName: '<img src=x onerror=alert(1)>',
      message: '<script>steal()</script>'
    });
    assert.equal(sanitized.playerName.includes('<'), false);
    assert.equal(sanitized.message.includes('<'), false);
    assert.equal(sanitized.message.includes('>'), false);
  });
});

describe('Taille de payload', () => {
  it('rejet de message trop large (>50KB)', () => {
    const hugeArray = new Array(10000).fill('A'.repeat(100));
    assert.equal(validateMessage({ type: 'peerState', state: { data: hugeArray } }), false);
  });

  it('limitation de longueur de string à 1000 caractères', () => {
    const sanitized = sanitizeString('A'.repeat(2000));
    assert.ok(sanitized.length <= 1000);
  });
});
