import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Mock fetch pour Node.js (lecture fichier local)
globalThis.fetch = async function(url) {
  let filePath;
  if (url instanceof URL) {
    filePath = fileURLToPath(url);
  } else if (typeof url === 'string' && url.startsWith('file:')) {
    filePath = fileURLToPath(url);
  } else {
    filePath = String(url);
  }
  const content = readFileSync(filePath, 'utf-8');
  return { ok: true, json: async () => JSON.parse(content) };
};

// Polyfill Blob si non disponible
if (typeof globalThis.Blob === 'undefined') {
  globalThis.Blob = class Blob {
    constructor(parts) {
      this._data = parts.join('');
    }
    get size() {
      return Buffer.byteLength(this._data, 'utf-8');
    }
  };
}

// Polyfill crypto.subtle si non disponible
if (!globalThis.crypto?.subtle) {
  const { webcrypto } = await import('node:crypto');
  globalThis.crypto = webcrypto;
}

// Supprimer les console.warn/error des modules source pendant les tests
console.warn = () => {};
console.error = () => {};
