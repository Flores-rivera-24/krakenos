import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { deriveTapoAuthHash, isTapoAuthHash } from '../../src/iot/tapo-auth.js';

/**
 * US-259. Lo que hace valiosa esta función es que permite **no guardar** la
 * contraseña de la cuenta TP-Link, así que lo que hay que atar es que su salida sea
 * exactamente la que el protocolo KLAP espera: si se desviara, el usuario perdería
 * el control de sus enchufes y el fallo aparecería como «credenciales inválidas»,
 * apuntando a su contraseña en vez de a este código.
 */
describe('deriveTapoAuthHash (US-259)', () => {
  const EMAIL = 'duenyo@example.com';
  const PASSWORD = 'ContrasenaDeLaCuentaTPLink!';

  it('es exactamente sha256(sha256(email) ‖ sha256(password))', () => {
    // Se recalcula aquí con `node:crypto` en vez de fijar una constante opaca: una
    // constante pegada solo prueba que la función no cambió, no que sea la fórmula
    // correcta — y la fórmula es la que tiene que casar con el aparato.
    const sha256 = (b: Buffer) => createHash('sha256').update(b).digest();
    const esperado = sha256(
      Buffer.concat([sha256(Buffer.from(EMAIL)), sha256(Buffer.from(PASSWORD))]),
    ).toString('hex');

    expect(deriveTapoAuthHash(EMAIL, PASSWORD)).toBe(esperado);
  });

  it('devuelve 64 hex en minúscula', () => {
    expect(deriveTapoAuthHash(EMAIL, PASSWORD)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('es determinista y depende de AMBOS componentes', () => {
    const base = deriveTapoAuthHash(EMAIL, PASSWORD);
    expect(deriveTapoAuthHash(EMAIL, PASSWORD)).toBe(base);
    expect(deriveTapoAuthHash('otro@example.com', PASSWORD)).not.toBe(base);
    expect(deriveTapoAuthHash(EMAIL, 'otra-contrasena')).not.toBe(base);
  });

  it('no es reversible a simple vista: no contiene la contraseña', () => {
    expect(deriveTapoAuthHash(EMAIL, PASSWORD)).not.toContain(PASSWORD);
  });

  it('trata bien los no-ASCII (una contraseña con eñe o acentos no rompe)', () => {
    expect(() => deriveTapoAuthHash('dueño@example.com', 'contraseña-ñ')).not.toThrow();
    expect(deriveTapoAuthHash('dueño@example.com', 'contraseña-ñ')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('isTapoAuthHash', () => {
  it('reconoce un hash derivado', () => {
    expect(isTapoAuthHash(deriveTapoAuthHash('a@b.c', 'x'))).toBe(true);
  });

  it('rechaza una contraseña normal y una longitud que no es 64', () => {
    expect(isTapoAuthHash('ContrasenaDeLaCuentaTPLink!')).toBe(false);
    expect(isTapoAuthHash('abc123')).toBe(false);
    expect(isTapoAuthHash('a'.repeat(63))).toBe(false);
    expect(isTapoAuthHash('a'.repeat(65))).toBe(false);
    // 64 caracteres pero no hexadecimales: una contraseña larga no es un hash.
    expect(isTapoAuthHash('z'.repeat(64))).toBe(false);
  });
});
