import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NetworkManager } from '../src/core/network.js';

describe('NetworkManager — validation pseudo', () => {
  function initWithPseudo(pseudo) {
    const errors = [];
    const net = new NetworkManager();
    net.onError = (err) => errors.push(err.message);
    net.init(pseudo, 'test-app');
    return { errors, state: net.sm.current };
  }

  it('rejette un pseudo vide', () => {
    const { errors, state } = initWithPseudo('');
    assert.equal(errors.length, 1);
    assert.match(errors[0], /invalide/i);
    assert.equal(state, 'IDLE');
  });

  it('rejette un pseudo null', () => {
    const { errors, state } = initWithPseudo(null);
    assert.equal(errors.length, 1);
    assert.equal(state, 'IDLE');
  });

  it('rejette un pseudo trop court (< 3)', () => {
    const { errors, state } = initWithPseudo('AB');
    assert.equal(errors.length, 1);
    assert.equal(state, 'IDLE');
  });

  it('rejette un pseudo trop long (> 10)', () => {
    const { errors, state } = initWithPseudo('ABCDEFGHIJK');
    assert.equal(errors.length, 1);
    assert.equal(state, 'IDLE');
  });

  it('rejette les caractères spéciaux', () => {
    for (const bad of ['Al ice', 'Bob!', 'a@b.c', 'café', 'user<xss>']) {
      const { errors } = initWithPseudo(bad);
      assert.equal(errors.length, 1, `devrait rejeter "${bad}"`);
    }
  });

  it('accepte un pseudo valide (lettres, chiffres, -, _)', () => {
    for (const good of ['ABC', 'xyz', 'P01_X', 'A-B-C', 'TEST_99']) {
      const { errors } = initWithPseudo(good);
      assert.equal(errors.length, 0, `devrait accepter "${good}"`);
    }
  });

  it('accepte un pseudo de 10 caractères exactement', () => {
    const { errors } = initWithPseudo('ABCDEFGHIJ');
    assert.equal(errors.length, 0);
  });

  it('accepte un pseudo de 3 caractères exactement', () => {
    const { errors } = initWithPseudo('ABC');
    assert.equal(errors.length, 0);
  });

  it('construit le bon ID PeerJS', () => {
    const net = new NetworkManager();
    net.init('P01', 'a1b2c3d4e5f6');
    assert.equal(net.myId, 'a1b2c3d4e5f6-P01');
    assert.equal(net.myPseudo, 'P01');
  });
});
