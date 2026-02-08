/**
 * Gestion de l'authentification P2P
 * Handshake basé sur un mot de passe partagé
 */

/**
 * Générer un hash SHA-256 d'un mot de passe
 * @param {string} password - Mot de passe (peut être vide)
 * @returns {Promise<string>} Hash hexadécimal
 */
export async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

/**
 * Vérifier que deux hashs correspondent
 * @param {string} hash1 - Premier hash
 * @param {string} hash2 - Second hash
 * @returns {boolean} True si les hashs correspondent
 */
export function verifyHash(hash1, hash2) {
  if (!hash1 || !hash2) return false;
  return hash1 === hash2;
}

/**
 * Créer un message d'authentification
 * @param {string} password - Mot de passe
 * @param {string} playerName - Nom du joueur
 * @returns {Promise<Object>} Message auth
 */
export async function createAuthMessage(password, playerName) {
  const hash = await hashPassword(password);
  return {
    type: 'auth',
    hash: hash,
    name: playerName,
    timestamp: Date.now()
  };
}
