import { describe, expect, it } from 'vitest';
import { normalizeTrafficSample } from '../../src/modules/traffic/normalize.js';

describe('normalizeTrafficSample (frontera del driver, US-98)', () => {
  it('conserva un WAN válido y un desglose por dispositivo válido', () => {
    const result = normalizeTrafficSample({
      wan: { rxBytesPerSec: 100, txBytesPerSec: 50 },
      devices: [{ mac: 'aa:bb:cc:dd:ee:ff', ip: '192.168.1.1', rxBytesPerSec: 10, txBytesPerSec: 5 }],
    });
    expect(result.wan).toEqual({ rxBytesPerSec: 100, txBytesPerSec: 50 });
    expect(result.devices).toHaveLength(1);
  });

  it('devices ausente → []', () => {
    const result = normalizeTrafficSample({ wan: { rxBytesPerSec: 0, txBytesPerSec: 0 } });
    expect(result.devices).toEqual([]);
  });

  it('descarta entradas de desglose inválidas y rellena ip ausente con ""', () => {
    const result = normalizeTrafficSample({
      wan: { rxBytesPerSec: 1, txBytesPerSec: 1 },
      devices: [
        { mac: 'aa:bb:cc:dd:ee:ff', rxBytesPerSec: 10, txBytesPerSec: 5 }, // sin ip → ip ''
        { mac: null, rxBytesPerSec: 1, txBytesPerSec: 1 }, // mac inválida → fuera
        { mac: 'de:ad:be:ef:00:01', rxBytesPerSec: 'x', txBytesPerSec: 1 }, // rx no numérico → fuera
        'basura', // no objeto → fuera
      ],
    });
    expect(result.devices).toEqual([
      { mac: 'aa:bb:cc:dd:ee:ff', ip: '', rxBytesPerSec: 10, txBytesPerSec: 5 },
    ]);
  });

  it('lanza si la muestra no es un objeto', () => {
    expect(() => normalizeTrafficSample(null)).toThrow(/forma inválida/i);
    expect(() => normalizeTrafficSample('x')).toThrow(/forma inválida/i);
  });

  it('lanza si el WAN falta o no es numérico (no inventa un 0)', () => {
    expect(() => normalizeTrafficSample({ devices: [] })).toThrow(/wan/i);
    expect(() => normalizeTrafficSample({ wan: null })).toThrow(/wan/i);
    expect(() => normalizeTrafficSample({ wan: { rxBytesPerSec: 'x', txBytesPerSec: 1 } })).toThrow(
      /no numérico/i,
    );
    expect(() => normalizeTrafficSample({ wan: { rxBytesPerSec: NaN, txBytesPerSec: 1 } })).toThrow(
      /no numérico/i,
    );
  });
});
