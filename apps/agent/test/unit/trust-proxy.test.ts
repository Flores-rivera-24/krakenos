import { describe, expect, it } from 'vitest';
import { parseTrustProxy, trustProxyWarnings } from '../../src/config/env.js';

describe('parseTrustProxy (US-76, F2)', () => {
  it('vacío / false / undefined → false (no confía en XFF)', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('   ')).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('FALSE')).toBe(false);
  });

  it('true → true (compat, inseguro)', () => {
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('True')).toBe(true);
  });

  it('entero → nº de hops', () => {
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('3')).toBe(3);
    expect(parseTrustProxy('0')).toBe(0);
  });

  it('lista → array de IPs/CIDRs/keywords sin vacíos', () => {
    expect(parseTrustProxy('10.0.0.1')).toEqual(['10.0.0.1']);
    expect(parseTrustProxy('10.0.0.1, 10.0.0.0/8 ,loopback')).toEqual([
      '10.0.0.1',
      '10.0.0.0/8',
      'loopback',
    ]);
  });

  it('una lista que queda vacía tras limpiar → false', () => {
    expect(parseTrustProxy(',, ,')).toBe(false);
  });
});

describe('trustProxyWarnings (US-76, F2)', () => {
  it('avisa solo cuando es true (confía en cualquiera)', () => {
    expect(trustProxyWarnings(true)).toHaveLength(1);
    expect(trustProxyWarnings(true)[0]).toMatch(/X-Forwarded-For/);
  });

  it('no avisa para false / nº de hops / lista', () => {
    expect(trustProxyWarnings(false)).toEqual([]);
    expect(trustProxyWarnings(1)).toEqual([]);
    expect(trustProxyWarnings(['10.0.0.1'])).toEqual([]);
  });
});
