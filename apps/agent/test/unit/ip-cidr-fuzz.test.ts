import type { FirewallRule } from '@krakenos/types';
import { describe, expect, it } from 'vitest';
import { iptablesAppendArgsForRule } from '../../src/firewall/iptables.helpers.js';
import { InvalidArgumentError, assertIpv4Cidr } from '../../src/privileged/validators.js';

/** PRNG determinista (LCG) para un fuzz reproducible sin dependencias. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

const rng = makeRng(0xc0ffee);
const pick = <T>(arr: T[]): T => arr[Math.floor(rng() * arr.length)]!;
const octet = (): number => Math.floor(rng() * 256);
const validIpv4 = (): string => `${octet()}.${octet()}.${octet()}.${octet()}`;
const validCidr = (): string => (rng() < 0.5 ? validIpv4() : `${validIpv4()}/${Math.floor(rng() * 33)}`);

describe('validación IP/CIDR estricta + fuzz (US-84, F12)', () => {
  it('acepta direcciones y redes IPv4 canónicas', () => {
    for (const v of ['0.0.0.0', '255.255.255.255', '10.0.0.0/8', '192.168.1.0/24', '1.2.3.4/32', '8.8.8.8']) {
      expect(assertIpv4Cidr(v)).toBe(v);
    }
  });

  it('rechaza octetos fuera de rango, prefijos inválidos, IPv6 e inyección', () => {
    const bad = [
      '256.0.0.1', // octeto > 255
      '999.999.999.999',
      '1.2.3', // incompleta
      '1.2.3.4.5', // de más
      '10.0.0.0/33', // prefijo > 32
      '10.0.0.0/99',
      '::1', // IPv6
      'fe80::1/64',
      '1.2.3.4 -j ACCEPT', // inyección de bandera
      '1.2.3.4;rm -rf /', // metacaracteres
      '-1.2.3.4', // bandera
      '1.2.3.4\n5.6.7.8', // salto de línea
      ' 1.2.3.4', // espacio
      'localhost',
    ];
    for (const v of bad) {
      expect(() => assertIpv4Cidr(v)).toThrow(InvalidArgumentError);
    }
  });

  it('INVARIANTE: cualquier valor que pasa la validación solo contiene [0-9./] y está acotado', () => {
    const mutators: Array<() => string> = [
      validCidr,
      () => `${octet()}.${octet()}.${octet()}.${octet()}/${Math.floor(rng() * 40)}`, // prefijo a veces inválido
      () => `${Math.floor(rng() * 400)}.${octet()}.${octet()}.${octet()}`, // octeto a veces inválido
      () => `${validIpv4()}${pick([' -j DROP', ';rm', '\n', '\t', '|sh', '`id`', '/64'])}`,
      () => pick(['::1', 'fe80::1', 'no-ip', '', '-A FORWARD']),
    ];
    for (let i = 0; i < 5000; i++) {
      const value = pick(mutators)();
      let passed = true;
      try {
        assertIpv4Cidr(value);
      } catch {
        passed = false;
      }
      if (passed) {
        // La propiedad de seguridad: imposible inyectar una bandera/metacarácter.
        expect(value).toMatch(/^[0-9./]+$/);
        const [addr, prefix] = value.split('/');
        for (const o of addr!.split('.')) expect(Number(o)).toBeLessThanOrEqual(255);
        if (prefix !== undefined) expect(Number(prefix)).toBeLessThanOrEqual(32);
      }
    }
  });

  it('el builder de iptables nunca emite una bandera en posición source/destination', () => {
    for (let i = 0; i < 2000; i++) {
      const source = validCidr();
      const destination = validCidr();
      const rule: FirewallRule = {
        id: 'r1',
        name: 'fuzz',
        action: rng() < 0.5 ? 'allow' : 'deny',
        protocol: pick(['tcp', 'udp', 'any']),
        source,
        destination,
        port: rng() < 0.5 ? Math.floor(rng() * 65535) + 1 : null,
        enabled: true,
        priority: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
      };
      for (const argv of iptablesAppendArgsForRule('KRAKENOS', rule)) {
        const sIdx = argv.indexOf('-s');
        const dIdx = argv.indexOf('-d');
        expect(argv[sIdx + 1]).toBe(source);
        expect(argv[dIdx + 1]).toBe(destination);
        // El valor tras -s/-d jamás empieza por '-' (no es interpretable como opción).
        expect(argv[sIdx + 1]!.startsWith('-')).toBe(false);
        expect(argv[dIdx + 1]!.startsWith('-')).toBe(false);
      }
    }
  });
});
