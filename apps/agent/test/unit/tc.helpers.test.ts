import { describe, expect, it } from 'vitest';
import {
  isIpTarget,
  priorityToPrio,
  tcFilterIpArgs,
  tcLeafClassArgs,
  tcQdiscAddRootArgs,
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
});
