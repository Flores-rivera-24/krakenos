import {
  CONTROLLABLE_IOT_KINDS,
  IOT_DEVICE_KINDS,
  IOT_METRICS,
  SECURITY_METRICS,
  isControllableKind,
  isSecurityMetric,
} from '@krakenos/types';
import type { IotDeviceKind, IotMetric } from '@krakenos/types';
import { describe, expect, it } from 'vitest';

/**
 * US-244. Estas dos clasificaciones son las que impiden que la alarma vuelva a
 * dispararse con una lámpara y que se pueda escribir en una cerradura sin haber
 * decidido su política, así que se atan de forma **explícita**: un cambio
 * accidental en cualquiera de las dos listas falla aquí y no en producción.
 */
describe('categorías de dispositivo IoT (US-244)', () => {
  it('la lista es exactamente la esperada', () => {
    expect([...IOT_DEVICE_KINDS]).toEqual([
      'light',
      'plug',
      'sensor',
      'climate',
      'cover',
      'lock',
      'contact',
      'smoke',
    ]);
  });

  it('solo son controlables luz, enchufe, persiana y termostato', () => {
    expect([...CONTROLLABLE_IOT_KINDS]).toEqual(['light', 'plug', 'cover', 'climate']);
    for (const kind of IOT_DEVICE_KINDS) {
      const esperado = (['light', 'plug', 'cover', 'climate'] as string[]).includes(kind);
      expect(isControllableKind(kind), `${kind} controlable`).toBe(esperado);
    }
  });

  it('⚠️ `lock` NO es controlable: su política la decide US-246', () => {
    // Si esto se pone en verde sin que US-246 exista, se ha abierto una ruta que
    // abre la puerta de la calle. El test está para que sea una decisión.
    expect(isControllableKind('lock')).toBe(false);
  });

  it('ni los sensores ni los detectores aceptan escritura', () => {
    for (const kind of ['sensor', 'contact', 'smoke'] as IotDeviceKind[]) {
      expect(isControllableKind(kind), kind).toBe(false);
    }
  });
});

describe('métricas de seguridad (US-244)', () => {
  it('la lista es exactamente la esperada', () => {
    expect([...SECURITY_METRICS]).toEqual(['contact', 'occupancy', 'smoke', 'co']);
  });

  it('clasifica cada métrica del catálogo, y solo esas cuatro son sucesos', () => {
    const seguridad: string[] = ['contact', 'occupancy', 'smoke', 'co'];
    for (const metric of IOT_METRICS) {
      expect(isSecurityMetric(metric), `${metric}`).toBe(seguridad.includes(metric));
    }
  });

  it('⚠️ la potencia NO es un suceso de seguridad', () => {
    // Era el fallo concreto: un canal Shelly en `sensorDeviceIds` disparaba la
    // alarma al encender una lámpara, porque su potencia cruzaba 1 W.
    for (const metric of ['power', 'energy', 'temperature', 'humidity', 'battery', 'illuminance'] as IotMetric[]) {
      expect(isSecurityMetric(metric), metric).toBe(false);
    }
  });

  it('guard de tamaño: la lista de métricas no se ha vaciado', () => {
    // Sin esto, un catálogo vacío haría pasar el bucle de arriba sin comprobar nada.
    expect(IOT_METRICS.length).toBeGreaterThanOrEqual(10);
  });
});
