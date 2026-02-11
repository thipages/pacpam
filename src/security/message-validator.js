/**
 * Validateur de messages P2P avec limites strictes
 * Protège contre les attaques par injection et DoS
 */

// Limites de sécurité
const MAX_MESSAGE_SIZE = 50000; // 50KB max pour un message
const MAX_STRING_LENGTH = 1000; // Longueur max pour une string
const MAX_ARRAY_LENGTH = 1000;  // Nombre max d'éléments dans un array
const MAX_OBJECT_DEPTH = 10;    // Profondeur max d'objets imbriqués

// Schémas protocole P2P (6 types fondamentaux)
const PROTOCOL_SCHEMAS = {
  auth: {
    required: ['hash', 'name'],
    fields: {
      hash: { type: 'string', maxLength: 64, pattern: /^[a-f0-9]{64}$/i },
      name: { type: 'string', maxLength: 10, pattern: /^[A-Z0-9_-]+$/i },
      timestamp: { type: 'number' }
    }
  },
  ping: {
    required: ['timestamp'],
    fields: {
      timestamp: { type: 'number', min: 0 }
    }
  },
  pong: {
    required: ['timestamp'],
    fields: {
      timestamp: { type: 'number', min: 0 }
    }
  },
  fullState: {
    required: ['state'],
    fields: {
      state: { type: 'object', maxDepth: 5 }
    }
  },
  localState: {
    required: ['state'],
    fields: {
      state: { type: 'object', maxDepth: 5 }
    }
  },
  action: {
    required: ['action'],
    fields: {
      action: { type: 'object', nullable: true, maxDepth: 3 }
    }
  },
  message: {
    required: ['payload'],
    fields: {
      payload: { type: 'object', maxDepth: 5 }
    }
  },
  _ctrl: {
    required: ['_ctrl'],
    fields: {
      _ctrl: { type: 'string', maxLength: 50 },
      id: { type: 'string', maxLength: 50 },
      mode: { type: 'string', maxLength: 20 },
      fps: { type: 'number', min: 0 }
    }
  }
};

// Schémas applicatifs enregistrés dynamiquement
let customSchemas = {};

/**
 * Enregistre des schémas de messages applicatifs supplémentaires
 * @param {Object} schemas - Objet { type: schéma } à fusionner
 */
export function registerMessageSchemas(schemas) {
  customSchemas = { ...customSchemas, ...schemas };
}

/**
 * Sanitise une string en retirant les caractères dangereux
 */
export function sanitizeString(str, maxLength = MAX_STRING_LENGTH) {
  if (typeof str !== 'string') return '';

  // Retirer les caractères de contrôle et limiter la longueur
  return str
    .slice(0, maxLength)
    .replace(/[\x00-\x1F\x7F]/g, '') // Caractères de contrôle
    .replace(/[<>\"'`]/g, '');        // Caractères HTML dangereux
}

/**
 * Vérifie la profondeur d'un objet
 */
function getObjectDepth(obj, currentDepth = 0) {
  if (currentDepth > MAX_OBJECT_DEPTH) return MAX_OBJECT_DEPTH + 1;
  if (obj === null || typeof obj !== 'object') return currentDepth;

  let maxDepth = currentDepth;
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const depth = getObjectDepth(obj[key], currentDepth + 1);
      if (depth > maxDepth) maxDepth = depth;
    }
  }
  return maxDepth;
}

/**
 * Calcule la taille approximative d'un objet en bytes
 */
function getObjectSize(obj) {
  const str = JSON.stringify(obj);
  return str ? new Blob([str]).size : 0;
}

/**
 * Valide un champ selon son schéma
 */
function validateField(value, schema) {
  // Vérifier le type
  if (schema.nullable && value === null) return true;

  const valueType = Array.isArray(value) ? 'array' : typeof value;
  if (schema.type && valueType !== schema.type) {
    return false;
  }

  // Validations spécifiques par type
  switch (schema.type) {
    case 'string':
      if (schema.maxLength && value.length > schema.maxLength) return false;
      if (schema.pattern && !schema.pattern.test(value)) return false;
      break;

    case 'number':
      if (schema.min !== undefined && value < schema.min) return false;
      if (schema.max !== undefined && value > schema.max) return false;
      if (!Number.isFinite(value)) return false;
      break;

    case 'array':
      if (value.length > MAX_ARRAY_LENGTH) return false;
      break;

    case 'object':
      if (schema.maxDepth && getObjectDepth(value) > schema.maxDepth) return false;
      break;
  }

  return true;
}

/**
 * Valide un message P2P complet
 */
export function validateMessage(data) {
  try {
    // Vérifications de base
    if (!data || typeof data !== 'object') {
      console.warn('[Security] Message invalide: pas un objet');
      return false;
    }

    // Vérifier la taille
    const size = getObjectSize(data);
    if (size > MAX_MESSAGE_SIZE) {
      console.warn(`[Security] Message trop large: ${size} bytes`);
      return false;
    }

    // Vérifier le type
    if (!data.type || typeof data.type !== 'string') {
      console.warn('[Security] Message sans type');
      return false;
    }

    // Vérifier que le type est connu
    const schema = PROTOCOL_SCHEMAS[data.type] || customSchemas[data.type];
    if (!schema) {
      console.warn(`[Security] Type de message inconnu: ${data.type}`);
      return false;
    }

    // Vérifier les champs requis
    if (schema.required) {
      for (const field of schema.required) {
        if (!(field in data)) {
          console.warn(`[Security] Champ requis manquant: ${field}`);
          return false;
        }
      }
    }

    // Valider chaque champ selon le schéma
    if (schema.fields) {
      for (const [field, fieldSchema] of Object.entries(schema.fields)) {
        if (field in data && !validateField(data[field], fieldSchema)) {
          console.warn(`[Security] Champ invalide: ${field}`);
          return false;
        }
      }
    }

    // Vérifier qu'il n'y a pas de champs supplémentaires non autorisés
    // _s (session id) et _ctrl sont des champs de routage acceptés sur tous les messages
    const allowedFields = ['type', '_s', '_ctrl', ...(schema.required || []), ...Object.keys(schema.fields || {})];
    for (const field in data) {
      if (!allowedFields.includes(field)) {
        console.warn(`[Security] Champ non autorisé: ${field}`);
        return false;
      }
    }

    return true;

  } catch (error) {
    console.error('[Security] Erreur validation:', error);
    return false;
  }
}

/**
 * Sanitise un objet état
 */
export function sanitizeState(state) {
  if (!state || typeof state !== 'object') return {};

  // Clone pour éviter les mutations
  const cleaned = JSON.parse(JSON.stringify(state));

  // Sanitiser récursivement les strings
  function cleanObject(obj) {
    for (const key in obj) {
      if (typeof obj[key] === 'string') {
        obj[key] = sanitizeString(obj[key]);
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        cleanObject(obj[key]);
      }
    }
  }

  cleanObject(cleaned);
  return cleaned;
}