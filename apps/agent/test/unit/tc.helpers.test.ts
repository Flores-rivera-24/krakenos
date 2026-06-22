import { describe, expect, it } from 'vitest';
import { InvalidArgumentError } from '../../src/privileged/validators.js';
import {
  isIpTarget,
  priorityToPrio,
  tcFilterIpArgs,
  tcLeafClassArgs,
  tcQdiscAddRootArgs,
  tcQdiscDelRootArgs,
  tcRootClassArgs,
} from '../../src/qos/tc.helpers.js';

describe('tc helpers', () => {
  it('mapea la prioridad a prio de tc', () => {
    expect(priorityToPrio('high')).toBe(1);
    expect(priorityToPrio('normal')).toBe(4);
    expect(priorityToPrio('low')).toBe(7);
  });

  it('detecta objetivos por IP', () => {
    expect(isIpTarget('10.0.0.50')).toBe(true);
    expect(isIpTarget('10.0.0.0/24')).toBe(true);
    expect(isIpTarget('service:zoom')).toBe(false);
  });

  it('construye la qdisc raíz y la clase raíz', () => {
    expect(tcQdiscAddRootArgs('eth0', 9999)).toEqual([
      'tc', 'qdisc', 'add', 'dev', 'eth0', 'root', 'handle', '1:', 'htb', 'default', '9999',
    ]);
    expect(tcRootClassArgs('eth0', 1000000)).toContain('1000000kbit');
  });

  it('construye una clase hoja con rate/ceil y prio', () => {
    const argv = tcLeafClassArgs('eth0', 10, 20000, 7);
    expect(argv).toEqual([
      'tc', 'class', 'add', 'dev', 'eth0', 'parent', '1:1', 'classid', '1:10',
      'htb', 'rate', '20000kbit', 'ceil', '20000kbit', 'prio', '7',
    ]);
  });

  it('construye un filtro u32 por IP destino', () => {
    const argv = tcFilterIpArgs('eth0', 7, '10.0.0.50', 10);
    expect(argv).toEqual([
      'tc', 'filter', 'add', 'dev', 'eth0', 'protocol', 'ip', 'parent', '1:', 'prio', '7',
      'u32', 'match', 'ip', 'dst', '10.0.0.50', 'flowid', '1:10',
    ]);
  });

  // --- Anti-inyección: interfaz, enteros y objetivo IP se validan (US-73) ---
  describe('rechazo anti-inyección', () => {
    it('rechaza una interfaz con bandera o metacaracteres en cualquier builder', () => {
      expect(() => tcQdiscDelRootArgs('-d')).toThrow(InvalidArgumentError);
      expect(() => tcQdiscAddRootArgs('eth0; reboot', 9999)).toThrow(InvalidArgumentError);
      expect(() => tcRootClassArgs('eth0 root', 1000)).toThrow(InvalidArgumentError);
      expect(() => tcLeafClassArgs('eth0\n', 10, 20000, 7)).toThrow(InvalidArgumentError);
    });

    it('rechaza un objetivo del filtro que no sea IPv4/CIDR', () => {
      expect(() => tcFilterIpArgs('eth0', 7, '10.0.0.50 flowid 1:1', 10)).toThrow(
        InvalidArgumentError,
      );
      expect(() => tcFilterIpArgs('eth0', 7, '--match', 10)).toThrow(InvalidArgumentError);
      expect(() => tcFilterIpArgs('eth0', 7, '999.999.0.0', 10)).toThrow(InvalidArgumentError);
    });

    it('rechaza enteros negativos o no enteros (rate/classid/prio)', () => {
      expect(() => tcLeafClassArgs('eth0', -1, 20000, 7)).toThrow(InvalidArgumentError);
      expect(() => tcLeafClassArgs('eth0', 10, 1.5, 7)).toThrow(InvalidArgumentError);
      expect(() => tcRootClassArgs('eth0', Number.NaN)).toThrow(InvalidArgumentError);
    });
  });
});
