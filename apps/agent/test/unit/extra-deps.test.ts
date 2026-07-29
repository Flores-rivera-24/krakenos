import { describe, expect, it } from 'vitest';
import {
  MAX_EXTRA_DEPS,
  isValidPackageName,
  parseExtraDeps,
} from '../../src/system/extra-deps.js';

/**
 * Manifiesto de deps opcionales (US-232 / AUD3-22). Los nombres acaban en la argv
 * de `pnpm add`, así que el parseo es la frontera: nada que empiece por `-` (sería
 * una bandera de pnpm) ni especificadores de versión/ruta.
 */
describe('parseExtraDeps', () => {
  it('acepta la lista que escribe el instalador', () => {
    expect(parseExtraDeps('["node-ssh","mqtt","net-snmp","ws"]')).toEqual([
      'node-ssh',
      'mqtt',
      'net-snmp',
      'ws',
    ]);
  });

  it('acepta paquetes con scope', () => {
    expect(parseExtraDeps('["@matter/main"]')).toEqual(['@matter/main']);
  });

  it('acepta la forma con objeto envolvente', () => {
    expect(parseExtraDeps('{"deps":["mqtt"]}')).toEqual(['mqtt']);
  });

  it('descarta entradas peligrosas o inválidas sin lanzar', () => {
    const raw = JSON.stringify([
      '--force', // bandera de pnpm disfrazada de paquete
      '-D',
      'mqtt@1.2.3', // especificador de versión
      'file:/etc/passwd',
      '../../evil',
      'MAYUS',
      'con espacio',
      '',
      42,
      null,
      { name: 'mqtt' },
      'mqtt', // el único válido
      'mqtt', // duplicado
    ]);
    expect(parseExtraDeps(raw)).toEqual(['mqtt']);
  });

  it('un manifiesto corrupto o vacío no reinstala nada (patrón US-63)', () => {
    for (const raw of ['', '{ roto', 'null', '"mqtt"', '{}', '[]']) {
      expect(parseExtraDeps(raw), `«${raw}»`).toEqual([]);
    }
  });

  it('acota el número de paquetes', () => {
    const many = Array.from({ length: MAX_EXTRA_DEPS + 10 }, (_, i) => `pkg-${i}`);
    expect(parseExtraDeps(JSON.stringify(many))).toHaveLength(MAX_EXTRA_DEPS);
  });
});

describe('isValidPackageName', () => {
  it('acepta nombres npm normales', () => {
    for (const ok of ['ws', 'node-ssh', 'net-snmp', 'tuyapi', '@matter/main', 'a.b_c']) {
      expect(isValidPackageName(ok), ok).toBe(true);
    }
  });

  it('rechaza banderas, rutas, versiones y nombres absurdos', () => {
    for (const bad of ['-x', '--force', './local', '/abs', 'a b', 'Pkg', 'pkg@1', '@/x', 'x'.repeat(129)]) {
      expect(isValidPackageName(bad), bad).toBe(false);
    }
  });
});
