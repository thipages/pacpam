import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadLocale, t } from '../src/core/locale.js';

describe('Locale', () => {
  it('t() retourne la clé brute avant chargement', () => {
    assert.equal(t('errors.SIGNALING_ERROR'), 'errors.SIGNALING_ERROR');
  });

  describe('après chargement fr', () => {
    before(async () => {
      await loadLocale();
    });

    it('loadLocale charge le fichier fr.json', () => {
      const result = t('errors.SIGNALING_ERROR');
      assert.notEqual(result, 'errors.SIGNALING_ERROR');
    });

    it('t() accède aux traductions après chargement', () => {
      assert.equal(t('errors.SIGNALING_ERROR'), 'Erreur du serveur de signalisation.');
    });

    it('t() retourne la clé brute pour une clé inexistante', () => {
      assert.equal(t('inexistant.key.deep'), 'inexistant.key.deep');
    });

    it('t() accède aux clés imbriquées (states.connection.IDLE)', () => {
      const result = t('states.connection.IDLE');
      assert.notEqual(result, 'states.connection.IDLE');
      assert.equal(typeof result, 'string');
      assert.ok(result.length > 0);
    });
  });
});
