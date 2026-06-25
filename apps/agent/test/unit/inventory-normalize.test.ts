import { describe, expect, it } from 'vitest';
import { normalizeDiscovered } from '../../src/modules/inventory/normalize.js';

describe('normalizeDiscovered (frontera del driver, US-98)', () => {
  it('conserva entradas válidas y rellena hostname/vendor a null si faltan', () => {
    const { devices, dropped } = normalizeDiscovered([
      { mac: 'aa:bb:cc:dd:ee:ff', ip: '192.168.1.1', source: 'arp' },
      { mac: '11:22:33:44:55:66', ip: '192.168.1.2', hostname: 'pc', vendor: 'Acme', source: 'mdns' },
    ]);
    expect(dropped).toBe(0);
    expect(devices).toEqual([
      { mac: 'aa:bb:cc:dd:ee:ff', ip: '192.168.1.1', hostname: null, vendor: null, source: 'arp' },
      { mac: '11:22:33:44:55:66', ip: '192.168.1.2', hostname: 'pc', vendor: 'Acme', source: 'mdns' },
    ]);
  });

  it('descarta entradas malformadas y las cuenta', () => {
    const { devices, dropped } = normalizeDiscovered([
      { mac: 'aa:bb:cc:dd:ee:ff', ip: '192.168.1.1', source: 'arp' }, // ok
      null, // no es objeto
      { mac: 12345, ip: '192.168.1.3', source: 'arp' }, // mac numérica
      { mac: '', ip: '192.168.1.4', source: 'arp' }, // mac vacía
      { mac: 'de:ad:be:ef:00:01', source: 'arp' }, // sin ip
      { mac: 'de:ad:be:ef:00:02', ip: '192.168.1.5', source: 'satelite' }, // source inválido
    ]);
    expect(devices).toHaveLength(1);
    expect(devices[0]?.mac).toBe('aa:bb:cc:dd:ee:ff');
    expect(dropped).toBe(5);
  });

  it('una entrada no-array se trata como vacío y se señala (dropped > 0)', () => {
    expect(normalizeDiscovered('no soy un array')).toEqual({ devices: [], dropped: 1 });
    expect(normalizeDiscovered({ not: 'array' })).toEqual({ devices: [], dropped: 1 });
  });

  it('null/undefined → vacío silencioso (dropped 0)', () => {
    expect(normalizeDiscovered(null)).toEqual({ devices: [], dropped: 0 });
    expect(normalizeDiscovered(undefined)).toEqual({ devices: [], dropped: 0 });
  });
});
