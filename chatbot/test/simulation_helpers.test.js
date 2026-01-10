// test/simulation_helpers.test.js
import { describe, it, expect } from 'vitest';
import {
  isStabsstelle,
  isMeldestelle,
  normalizeRole,
  normalizeRoleArray
} from '../server/field_mapper.js';

describe('Simulation Helpers', () => {
  describe('isStabsstelle', () => {
    it('sollte gültige Stabsstellen erkennen', () => {
      expect(isStabsstelle('S1')).toBe(true);
      expect(isStabsstelle('S2')).toBe(true);
      expect(isStabsstelle('S3')).toBe(true);
      expect(isStabsstelle('S4')).toBe(true);
      expect(isStabsstelle('S5')).toBe(true);
      expect(isStabsstelle('S6')).toBe(true);
    });

    it('sollte Leitungsstellen erkennen', () => {
      expect(isStabsstelle('LTSTB')).toBe(true);
      expect(isStabsstelle('LTSTBSTV')).toBe(true);
    });

    it('sollte case-insensitive arbeiten', () => {
      expect(isStabsstelle('s1')).toBe(true);
      expect(isStabsstelle('ltstb')).toBe(true);
    });

    it('sollte ungültige Werte zurückweisen', () => {
      expect(isStabsstelle('S7')).toBe(false);
      expect(isStabsstelle('Polizei')).toBe(false);
      expect(isStabsstelle('')).toBe(false);
      expect(isStabsstelle(null)).toBe(false);
    });
  });

  describe('isMeldestelle', () => {
    it('sollte Meldestelle erkennen', () => {
      expect(isMeldestelle('MELDESTELLE')).toBe(true);
      expect(isMeldestelle('MS')).toBe(true);
      expect(isMeldestelle('MELDESTELLE/S6')).toBe(true);
    });

    it('sollte case-insensitive arbeiten', () => {
      expect(isMeldestelle('meldestelle')).toBe(true);
      expect(isMeldestelle('ms')).toBe(true);
    });

    it('sollte ungültige Werte zurückweisen', () => {
      expect(isMeldestelle('S1')).toBe(false);
      expect(isMeldestelle('Polizei')).toBe(false);
      expect(isMeldestelle('')).toBe(false);
    });
  });

  describe('normalizeRole', () => {
    it('sollte Rollen normalisieren', () => {
      expect(normalizeRole('s1')).toBe('S1');
      expect(normalizeRole('ltstb')).toBe('LTSTB');
      expect(normalizeRole('meldestelle')).toBe('MELDESTELLE');
    });

    it('sollte Leerzeichen entfernen', () => {
      expect(normalizeRole(' S1 ')).toBe('S1');
      expect(normalizeRole('  ltstb  ')).toBe('LTSTB');
    });

    it('sollte externe Stellen beibehalten', () => {
      const external = 'Polizei München';
      expect(normalizeRole(external)).toBe('POLIZEI MÜNCHEN');
    });

    it('sollte leere Strings handhaben', () => {
      expect(normalizeRole('')).toBe('');
      expect(normalizeRole('   ')).toBe('');
    });
  });

  describe('normalizeRoleArray', () => {
    it('sollte Array von Rollen normalisieren', () => {
      const input = ['s1', 's2', 'ltstb'];
      const expected = ['S1', 'S2', 'LTSTB'];
      expect(normalizeRoleArray(input)).toEqual(expected);
    });

    it('sollte Duplikate entfernen', () => {
      const input = ['s1', 'S1', 's1'];
      const result = normalizeRoleArray(input);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe('S1');
    });

    it('sollte leere Strings filtern', () => {
      const input = ['s1', '', '  ', 's2'];
      const result = normalizeRoleArray(input);
      expect(result).toEqual(['S1', 'S2']);
    });

    it('sollte leeres Array handhaben', () => {
      expect(normalizeRoleArray([])).toEqual([]);
    });

    it('sollte gemischte interne und externe Rollen handhaben', () => {
      const input = ['s1', 'Polizei', 's2', 'Feuerwehr'];
      const result = normalizeRoleArray(input);
      expect(result).toContain('S1');
      expect(result).toContain('S2');
      expect(result).toContain('POLIZEI');
      expect(result).toContain('FEUERWEHR');
    });
  });

  describe('Edge Cases', () => {
    it('sollte mit null und undefined umgehen', () => {
      expect(isStabsstelle(null)).toBe(false);
      expect(isStabsstelle(undefined)).toBe(false);
      expect(isMeldestelle(null)).toBe(false);
      expect(isMeldestelle(undefined)).toBe(false);
    });

    it('sollte mit Zahlen umgehen', () => {
      expect(isStabsstelle(1)).toBe(false);
      expect(normalizeRole(123)).toBe('123');
    });

    it('sollte mit Objekten umgehen', () => {
      expect(isStabsstelle({})).toBe(false);
      expect(isStabsstelle([])).toBe(false);
    });

    it('sollte Sonderzeichen in Rollennamen handhaben', () => {
      const roleWithSpecialChars = 'S1/S2';
      expect(normalizeRole(roleWithSpecialChars)).toBe('S1/S2');
    });
  });
});
