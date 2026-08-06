import {
  CLIMATE_TARGET_MAX_C,
  CLIMATE_TARGET_MIN_C,
  CLIMATE_TARGET_STEP_C,
  CONTROLLABLE_IOT_KINDS,
  IOT_DEVICE_KINDS,
  IOT_METRICS,
  SECURITY_METRICS,
  SWITCHABLE_IOT_KINDS,
  isControllableKind,
  isSecurityMetric,
  isSwitchableKind,
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

/**
 * US-265. «Controlable» y «se enciende» no son lo mismo, y confundirlos es lo que
 * pintaba un interruptor en una persiana, en un termostato y —lo peor— en una
 * cerradura y en un detector de humo. La distinción vive en el contrato para que
 * no vuelva a estar escrita a mano en cada backend y en la web.
 */
describe('categorías con encendido/apagado (US-265)', () => {
  it('solo la luz y el enchufe se encienden', () => {
    expect([...SWITCHABLE_IOT_KINDS]).toEqual(['light', 'plug']);
    for (const kind of IOT_DEVICE_KINDS) {
      const esperado = (['light', 'plug'] as string[]).includes(kind);
      expect(isSwitchableKind(kind), `${kind} conmutable`).toBe(esperado);
    }
  });

  it('una persiana y un termostato se OPERAN pero no se encienden', () => {
    // Es justo el par que rompía: son controlables (`position`/`targetC`) y por eso
    // pasaban el único filtro que había, que era el de controlabilidad.
    for (const kind of ['cover', 'climate'] as IotDeviceKind[]) {
      expect(isControllableKind(kind), kind).toBe(true);
      expect(isSwitchableKind(kind), kind).toBe(false);
    }
  });

  it('lo conmutable es un subconjunto de lo controlable', () => {
    for (const kind of SWITCHABLE_IOT_KINDS) {
      expect(isControllableKind(kind), kind).toBe(true);
    }
  });
});

describe('límites de la consigna de un termostato (US-265)', () => {
  it('son los que acotan el borde HTTP y los incrementos de la UI', () => {
    // Una sola fuente: si estos cambian sin que cambie el schema, un botón de la
    // UI produce un 400 del que el usuario no puede hacer nada.
    expect(CLIMATE_TARGET_MIN_C).toBe(4);
    expect(CLIMATE_TARGET_MAX_C).toBe(35);
    expect(CLIMATE_TARGET_STEP_C).toBe(0.5);
  });

  it('el paso es exacto en binario: sumarlo no arrastra ruido de coma flotante', () => {
    let v = CLIMATE_TARGET_MIN_C;
    while (v < CLIMATE_TARGET_MAX_C) v += CLIMATE_TARGET_STEP_C;
    expect(v).toBe(CLIMATE_TARGET_MAX_C);
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
