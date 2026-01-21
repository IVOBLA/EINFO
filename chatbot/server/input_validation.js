// chatbot/server/input_validation.js
// Input-Validierung für Simulation

import fs from "fs/promises";
import { ValidationError } from "./simulation_errors.js";
import { logInfo } from "./logger.js";

/**
 * Validierungs-Schemas
 */
export const schemas = {
  incident: {
    latitude: (v) => typeof v === 'number' && v >= -90 && v <= 90,
    longitude: (v) => typeof v === 'number' && v >= -180 && v <= 180,
    id: (v) => typeof v === 'string' && v.length > 0,
    titel: (v) => typeof v === 'string' && v.length > 0
  },

  coordinates: {
    latitude: (v) => typeof v === 'number' && v >= -90 && v <= 90 && !isNaN(v),
    longitude: (v) => typeof v === 'number' && v >= -180 && v <= 180 && !isNaN(v)
  },

  path: {
    exists: async (p) => {
      try {
        await fs.access(p);
        return true;
      } catch {
        return false;
      }
    },
    isFile: async (p) => {
      try {
        const stat = await fs.stat(p);
        return stat.isFile();
      } catch {
        return false;
      }
    }
  },

  number: {
    positive: (v) => typeof v === 'number' && v > 0 && !isNaN(v),
    nonNegative: (v) => typeof v === 'number' && v >= 0 && !isNaN(v),
    integer: (v) => typeof v === 'number' && Number.isInteger(v)
  },

  string: {
    notEmpty: (v) => typeof v === 'string' && v.trim().length > 0,
    maxLength: (max) => (v) => typeof v === 'string' && v.length <= max,
    minLength: (min) => (v) => typeof v === 'string' && v.length >= min
  },

  array: {
    notEmpty: (v) => Array.isArray(v) && v.length > 0,
    minLength: (min) => (v) => Array.isArray(v) && v.length >= min,
    maxLength: (max) => (v) => Array.isArray(v) && v.length <= max
  },

  role: {
    valid: (v) => {
      if (typeof v !== 'string') return false;
      const upper = v.toUpperCase();
      const validRoles = ['LTSTB', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6'];
      return validRoles.includes(upper);
    }
  }
};

/**
 * Validiert Input gegen Schema
 * @param {*} data - Zu validierende Daten
 * @param {Object} schema - Schema
 * @param {string} fieldName - Feldname für Fehlermeldungen
 * @throws {ValidationError}
 */
export function validateInput(data, schema, fieldName = 'data') {
  if (!data) {
    throw new ValidationError(`${fieldName} ist null oder undefined`, {
      fieldName,
      data
    });
  }

  const errors = [];

  for (const [key, validator] of Object.entries(schema)) {
    const value = data[key];

    try {
      const isValid = validator(value);
      if (!isValid) {
        errors.push(`${fieldName}.${key} ist ungültig: ${JSON.stringify(value)}`);
      }
    } catch (err) {
      errors.push(`${fieldName}.${key} Validierung fehlgeschlagen: ${err.message}`);
    }
  }

  if (errors.length > 0) {
    throw new ValidationError(`Validierung fehlgeschlagen: ${errors.join(', ')}`, {
      errors,
      fieldName,
      data
    });
  }
}

/**
 * Validiert Input asynchron gegen Schema
 * @param {*} data - Zu validierende Daten
 * @param {Object} schema - Schema
 * @param {string} fieldName - Feldname für Fehlermeldungen
 * @throws {ValidationError}
 */
export async function validateInputAsync(data, schema, fieldName = 'data') {
  if (!data) {
    throw new ValidationError(`${fieldName} ist null oder undefined`, {
      fieldName,
      data
    });
  }

  const errors = [];

  for (const [key, validator] of Object.entries(schema)) {
    const value = data[key];

    try {
      const isValid = await validator(value);
      if (!isValid) {
        errors.push(`${fieldName}.${key} ist ungültig: ${JSON.stringify(value)}`);
      }
    } catch (err) {
      errors.push(`${fieldName}.${key} Validierung fehlgeschlagen: ${err.message}`);
    }
  }

  if (errors.length > 0) {
    throw new ValidationError(`Validierung fehlgeschlagen: ${errors.join(', ')}`, {
      errors,
      fieldName,
      data
    });
  }
}

/**
 * Validiert Koordinaten
 * @param {Object} coords - { latitude, longitude }
 * @throws {ValidationError}
 */
export function validateCoordinates(coords) {
  validateInput(coords, schemas.coordinates, 'coordinates');
}

/**
 * Validiert Einsatzstelle
 * @param {Object} incident - Einsatzstelle
 * @throws {ValidationError}
 */
export function validateIncident(incident) {
  validateInput(incident, schemas.incident, 'incident');
}

/**
 * Validiert Dateipfad
 * @param {string} path - Dateipfad
 * @throws {ValidationError}
 */
export async function validateFilePath(path) {
  if (!path || typeof path !== 'string') {
    throw new ValidationError('Dateipfad ist ungültig', {
      path
    });
  }

  const exists = await schemas.path.exists(path);
  if (!exists) {
    throw new ValidationError(`Datei existiert nicht: ${path}`, {
      path
    });
  }

  const isFile = await schemas.path.isFile(path);
  if (!isFile) {
    throw new ValidationError(`Pfad ist keine Datei: ${path}`, {
      path
    });
  }
}

/**
 * Sichere Validierung (wirft keine Fehler)
 * @param {*} data - Daten
 * @param {Object} schema - Schema
 * @param {string} fieldName - Feldname
 * @returns {Object} - { valid: boolean, errors: string[] }
 */
export function safeValidate(data, schema, fieldName = 'data') {
  try {
    validateInput(data, schema, fieldName);
    return { valid: true, errors: [] };
  } catch (err) {
    if (err instanceof ValidationError) {
      return {
        valid: false,
        errors: err.context.errors || [err.message]
      };
    }
    return {
      valid: false,
      errors: [err.message]
    };
  }
}

/**
 * Validiert und gibt Default-Wert zurück bei Fehler
 * @param {*} data - Daten
 * @param {Object} schema - Schema
 * @param {*} defaultValue - Default-Wert
 * @param {string} fieldName - Feldname
 * @returns {*} - Daten oder Default-Wert
 */
export function validateWithDefault(data, schema, defaultValue, fieldName = 'data') {
  try {
    validateInput(data, schema, fieldName);
    return data;
  } catch (err) {
    logInfo("Validierung fehlgeschlagen, verwende Default-Wert", {
      fieldName,
      error: err.message,
      defaultValue
    });
    return defaultValue;
  }
}
