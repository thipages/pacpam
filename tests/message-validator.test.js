import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateMessage, sanitizeString, sanitizeState } from '../src/security/message-validator.js';

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

  it('validation localState avec état valide', () => {
    assert.equal(validateMessage({
      type: 'localState',
      state: { players: [], score: { p1: 0, p2: 0 } }
    }), true);
  });

  it('rejet localState avec objet trop profond', () => {
    let deepObj = {};
    let current = deepObj;
    for (let i = 0; i < 15; i++) {
      current.nested = {};
      current = current.nested;
    }
    assert.equal(validateMessage({ type: 'localState', state: deepObj }), false);
  });
});

describe('Validation _ctrl', () => {
  it('validation sessionCreate valide', () => {
    assert.equal(validateMessage({
      type: '_ctrl', _ctrl: 'sessionCreate', id: 'counter', mode: 'centralized', fps: 0
    }), true);
  });

  it('rejet sessionCreate sans mode', () => {
    assert.equal(validateMessage({
      type: '_ctrl', _ctrl: 'sessionCreate', id: 'counter', fps: 0
    }), false);
  });

  it('validation sessionReady valide', () => {
    assert.equal(validateMessage({
      type: '_ctrl', _ctrl: 'sessionReady', id: 'counter'
    }), true);
  });

  it('validation sessionSetFps valide', () => {
    assert.equal(validateMessage({
      type: '_ctrl', _ctrl: 'sessionSetFps', id: 'counter', fps: 5
    }), true);
  });

  it('rejet sessionSetFps sans fps', () => {
    assert.equal(validateMessage({
      type: '_ctrl', _ctrl: 'sessionSetFps', id: 'counter'
    }), false);
  });

  it('validation sessionEnd valide', () => {
    assert.equal(validateMessage({
      type: '_ctrl', _ctrl: 'sessionEnd', id: 'counter'
    }), true);
  });

  it('rejet _ctrl avec sous-type inconnu', () => {
    assert.equal(validateMessage({
      type: '_ctrl', _ctrl: 'unknownCommand', id: 'x'
    }), false);
  });

  it('rejet _ctrl sans sous-type', () => {
    assert.equal(validateMessage({ type: '_ctrl' }), false);
  });
});

describe('Validation _s et message', () => {
  it('validation message avec payload', () => {
    assert.equal(validateMessage({
      type: 'message', _s: 'status', payload: { text: 'hello', from: 'ALICE' }
    }), true);
  });

  it('rejet message sans payload', () => {
    assert.equal(validateMessage({ type: 'message', _s: 'status' }), false);
  });

  it('validation fullState avec _s', () => {
    assert.equal(validateMessage({
      type: 'fullState', _s: 'counter', state: { count: 42 }
    }), true);
  });

  it('rejet _s trop long', () => {
    assert.equal(validateMessage({
      type: 'fullState', _s: 'x'.repeat(51), state: { count: 0 }
    }), false);
  });

  it('rejet _s non-string', () => {
    assert.equal(validateMessage({
      type: 'fullState', _s: 123, state: { count: 0 }
    }), false);
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

  it('protection XSS dans sanitizeState', () => {
    const sanitized = sanitizeState({
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
    assert.equal(validateMessage({ type: 'localState', state: { data: hugeArray } }), false);
  });

  it('limitation de longueur de string à 1000 caractères', () => {
    const sanitized = sanitizeString('A'.repeat(2000));
    assert.ok(sanitized.length <= 1000);
  });
});
