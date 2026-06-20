import type { Device } from '@krakenos/types';
import { describe, expect, it } from 'vitest';
import {
  DEVICE_TYPES,
  TYPE_LABELS,
  filterDevices,
  groupDevicesByType,
} from '@/lib/devices';

function device(over: Partial<Device> = {}): Device {
  return {
    id: 'd1',
    mac: 'aa:bb:cc:dd:ee:01',
    ip: '192.168.1.10',
    hostname: 'macbook',
    label: null,
    notes: null,
    vendor: 'Apple',
    type: 'computer',
    isBlocked: false,
    online: true,
    vlanTag: null,
    sources: ['arp'],
    firstSeen: '2026-01-01T00:00:00.000Z',
    lastSeen: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('catálogo de tipos de dispositivo', () => {
  it('cada tipo tiene una etiqueta en español', () => {
    for (const type of DEVICE_TYPES) {
      expect(TYPE_LABELS[type]).toBeTruthy();
    }
  });

  it('no hay etiquetas huérfanas (claves = DEVICE_TYPES)', () => {
    expect(Object.keys(TYPE_LABELS).sort()).toEqual([...DEVICE_TYPES].sort());
  });

  it('incluye los tipos esperados', () => {
    expect(DEVICE_TYPES).toContain('router');
    expect(DEVICE_TYPES).toContain('unknown');
    expect(TYPE_LABELS.iot).toBe('IoT');
  });
});

describe('filterDevices', () => {
  const list = [
    device({ id: 'a', label: 'MacBook Pro', hostname: 'mbp', mac: 'aa:aa:aa:aa:aa:aa' }),
    device({ id: 'b', label: 'Living Room TV', hostname: 'tv', type: 'tv', mac: 'bb:bb:bb:bb:bb:bb' }),
    device({ id: 'c', label: 'Old Phone', hostname: 'phone', type: 'phone', online: false, mac: 'cc:cc:cc:cc:cc:cc' }),
    device({ id: 'd', label: 'Blocked Laptop', hostname: 'lap', isBlocked: true, mac: 'dd:dd:dd:dd:dd:dd' }),
  ];

  it('filtra por query en label (coincidencia única)', () => {
    const result = filterDevices(list, 'macbook', []);
    expect(result.map((d) => d.id)).toEqual(['a']);
  });

  it('filtra por query en label (coincidencia parcial, varios)', () => {
    const result = filterDevices(list, 'o', []); // MacBook Pro, Living Room, Old Phone, Blocked Laptop
    expect(result.length).toBeGreaterThan(1);
    expect(result.every((d) => /o/i.test(d.label ?? ''))).toBe(true);
  });

  it('filtra por query en mac devuelve el dispositivo correcto', () => {
    const result = filterDevices(list, 'cc:cc', []);
    expect(result.map((d) => d.id)).toEqual(['c']);
  });

  it('el filtro "blocked" excluye los no bloqueados', () => {
    const result = filterDevices(list, '', ['blocked']);
    expect(result.map((d) => d.id)).toEqual(['d']);
  });

  it('el filtro "online" excluye los offline', () => {
    const result = filterDevices(list, '', ['online']);
    expect(result.map((d) => d.id)).not.toContain('c');
    expect(result.map((d) => d.id)).toContain('a');
  });
});

describe('groupDevicesByType', () => {
  it('agrupa correctamente por tipo', () => {
    const grouped = groupDevicesByType([
      device({ id: 'a', type: 'computer' }),
      device({ id: 'b', type: 'phone' }),
      device({ id: 'c', type: 'computer' }),
    ]);
    expect(grouped.computer.map((d) => d.id)).toEqual(['a', 'c']);
    expect(grouped.phone.map((d) => d.id)).toEqual(['b']);
    expect(grouped.tv).toEqual([]);
  });
});
