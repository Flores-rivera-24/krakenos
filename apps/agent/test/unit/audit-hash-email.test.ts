import { describe, expect, it } from 'vitest';
import { hashEmail } from '../../src/plugins/audit.js';

describe('hashEmail (US-85, F11)', () => {
  it('no devuelve el email en claro y lleva el prefijo email:', () => {
    const h = hashEmail('admin@krakenos.test');
    expect(h).toMatch(/^email:[0-9a-f]{16}$/);
    expect(h).not.toContain('admin@krakenos.test');
  });

  it('es determinista (correlacionable): mismo email → mismo hash', () => {
    expect(hashEmail('a@b.c')).toBe(hashEmail('a@b.c'));
  });

  it('normaliza mayúsculas y espacios', () => {
    expect(hashEmail('  Admin@Krakenos.test ')).toBe(hashEmail('admin@krakenos.test'));
  });

  it('emails distintos → hashes distintos', () => {
    expect(hashEmail('a@b.c')).not.toBe(hashEmail('x@y.z'));
  });
});
