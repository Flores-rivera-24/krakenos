import { describe, expect, it } from 'vitest';
import {
  InvalidArgumentError,
  assertCiscoInterface,
  assertInterfaceName,
  assertIpv4,
  assertIpv4Cidr,
  assertNonNegativeInteger,
  assertVlanName,
  assertVlanTag,
  assertVlanTagString,
  assertWireguardKey,
} from '../../src/privileged/validators.js';

/** Cargas hostiles comunes a casi todos los validadores de cadena. */
const HOSTILE = [
  '-flag', // inyección de bandera corta
  '--config', // inyección de bandera larga
  'a b', // espacio
  'a\nb', // salto de línea (inyección de comando CLI)
  'a\rb', // retorno de carro
  'a\tb', // tabulador
  'a;rm -rf /', // metacaracter de shell
  'a$(reboot)', // sustitución de comando
  'a`id`', // backticks
  '../../etc/passwd', // path traversal
  '', // vacío
];

describe('validadores anti-inyección (US-73)', () => {
  describe('assertInterfaceName', () => {
    it('acepta nombres de interfaz de Linux válidos', () => {
      for (const ok of ['wg0', 'eth0', 'wan', 'br-lan', 'eth0.100']) {
        expect(assertInterfaceName(ok)).toBe(ok);
      }
    });
    it('rechaza toda carga hostil y nombres demasiado largos', () => {
      for (const bad of HOSTILE) expect(() => assertInterfaceName(bad)).toThrow(InvalidArgumentError);
      expect(() => assertInterfaceName('a'.repeat(16))).toThrow(InvalidArgumentError);
    });
  });

  describe('assertCiscoInterface', () => {
    it('acepta puertos Cisco con "/"', () => {
      expect(assertCiscoInterface('GigabitEthernet0/1')).toBe('GigabitEthernet0/1');
      expect(assertCiscoInterface('Gi1/0/24')).toBe('Gi1/0/24');
    });
    it('rechaza inyección de bandera, espacios y saltos de línea', () => {
      for (const bad of ['-x', 'Gi0/1 shut', 'Gi0/1\nshutdown', '../x']) {
        expect(() => assertCiscoInterface(bad)).toThrow(InvalidArgumentError);
      }
    });
  });

  describe('assertWireguardKey', () => {
    it('acepta una clave base64 de 32 bytes', () => {
      const key = `${'A'.repeat(43)}=`;
      expect(assertWireguardKey(key)).toBe(key);
    });
    it('rechaza claves mal formadas o con inyección', () => {
      for (const bad of ['PK', 'no-es-clave', '--remove', `${'A'.repeat(43)}= extra`, ...HOSTILE]) {
        expect(() => assertWireguardKey(bad)).toThrow(InvalidArgumentError);
      }
    });
  });

  describe('assertIpv4 / assertIpv4Cidr', () => {
    it('acepta IPv4 escueta y CIDR válidos', () => {
      expect(assertIpv4('10.8.0.2')).toBe('10.8.0.2');
      expect(assertIpv4Cidr('10.0.0.0/24')).toBe('10.0.0.0/24');
      expect(assertIpv4Cidr('192.168.1.5')).toBe('192.168.1.5');
    });
    it('rechaza octetos fuera de rango, prefijo inválido e inyección', () => {
      expect(() => assertIpv4('999.0.0.1')).toThrow(InvalidArgumentError);
      expect(() => assertIpv4('10.8.0.2/32')).toThrow(InvalidArgumentError); // escueta: sin máscara
      expect(() => assertIpv4Cidr('10.0.0.0/99')).toThrow(InvalidArgumentError);
      expect(() => assertIpv4Cidr('10.0.0.0 flowid 1:1')).toThrow(InvalidArgumentError);
      for (const bad of HOSTILE) expect(() => assertIpv4(bad)).toThrow(InvalidArgumentError);
    });
  });

  describe('assertVlanTag / assertVlanTagString', () => {
    it('acepta tags 802.1Q en rango', () => {
      expect(assertVlanTag(1)).toBe(1);
      expect(assertVlanTag(4094)).toBe(4094);
      expect(assertVlanTagString('100')).toBe('100');
    });
    it('rechaza fuera de rango, no enteros y cadenas no numéricas', () => {
      for (const bad of [0, 4095, -1, 1.5, Number.NaN]) {
        expect(() => assertVlanTag(bad)).toThrow(InvalidArgumentError);
      }
      for (const bad of ['0', '5000', 'abc', '1 drop', '1\nreload']) {
        expect(() => assertVlanTagString(bad)).toThrow(InvalidArgumentError);
      }
    });
  });

  describe('assertVlanName', () => {
    it('acepta nombres simples (letras, dígitos, _ . -)', () => {
      for (const ok of ['IoT', 'IoT-2', 'red_invitados', 'v.1']) {
        expect(assertVlanName(ok)).toBe(ok);
      }
    });
    it('rechaza espacios, control, metacaracteres y >32', () => {
      for (const bad of HOSTILE) expect(() => assertVlanName(bad)).toThrow(InvalidArgumentError);
      expect(() => assertVlanName('a'.repeat(33))).toThrow(InvalidArgumentError);
    });
  });

  describe('assertNonNegativeInteger', () => {
    it('acepta enteros no negativos', () => {
      expect(assertNonNegativeInteger(0, 'x')).toBe(0);
      expect(assertNonNegativeInteger(20000, 'x')).toBe(20000);
    });
    it('rechaza negativos, no enteros y NaN/Infinity', () => {
      for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(() => assertNonNegativeInteger(bad, 'x')).toThrow(InvalidArgumentError);
      }
    });
  });

  it('InvalidArgumentError expone label/value/reason', () => {
    try {
      assertInterfaceName('-i');
      throw new Error('no lanzó');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidArgumentError);
      const e = err as InvalidArgumentError;
      expect(e.label).toBe('interfaz');
      expect(e.value).toBe('-i');
      expect(e.reason).toMatch(/.+/);
    }
  });
});
