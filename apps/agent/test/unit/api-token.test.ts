import { describe, expect, it } from 'vitest';
import {
  allowedScopesFor,
  generateApiToken,
  hashApiToken,
  isApiTokenValue,
  parseScopes,
} from '../../src/auth/api-token.js';

describe('generateApiToken', () => {
  it('genera un token krt_ con su hash y prefijo, únicos', () => {
    const a = generateApiToken();
    const b = generateApiToken();
    expect(a.token.startsWith('krt_')).toBe(true);
    expect(a.prefix).toBe(a.token.slice(0, 8));
    expect(a.hash).toBe(hashApiToken(a.token));
    expect(a.hash).not.toBe(b.hash); // aleatorio
    expect(a.token).not.toBe(b.token);
  });
});

describe('isApiTokenValue', () => {
  it('reconoce solo los valores krt_', () => {
    expect(isApiTokenValue('krt_abc')).toBe(true);
    expect(isApiTokenValue('eyJhbGci...')).toBe(false); // un JWT
  });
});

describe('parseScopes', () => {
  it('parsea JSON válido descartando scopes desconocidos', () => {
    expect(parseScopes('["home.view","home.control"]')).toEqual(['home.view', 'home.control']);
    expect(parseScopes('["home.view","network.manage","basura"]')).toEqual(['home.view']);
  });
  it('devuelve [] ante JSON corrupto o no-array', () => {
    expect(parseScopes('{roto')).toEqual([]);
    expect(parseScopes('"home.view"')).toEqual([]);
  });
});

describe('allowedScopesFor', () => {
  it('acota los scopes a las capacidades del rol (nunca lo superan)', () => {
    // admin y member tienen home.control; viewer/kid/guest no.
    expect(allowedScopesFor('admin', ['home.view', 'home.control'])).toEqual([
      'home.view',
      'home.control',
    ]);
    expect(allowedScopesFor('member', ['home.view', 'home.control'])).toEqual([
      'home.view',
      'home.control',
    ]);
    // viewer pide control → se le cae; solo conserva home.view.
    expect(allowedScopesFor('viewer', ['home.view', 'home.control'])).toEqual(['home.view']);
    // kid pide solo control → nada válido.
    expect(allowedScopesFor('kid', ['home.control'])).toEqual([]);
  });

  it('deduplica y ordena canónicamente', () => {
    expect(allowedScopesFor('admin', ['home.control', 'home.view', 'home.control'])).toEqual([
      'home.view',
      'home.control',
    ]);
  });
});
