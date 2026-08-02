import { describe, expect, it } from 'vitest';
import { IOT_SUPPORT_LEVEL } from '@krakenos/types';
import {
  IOT_KINDS,
  isPrefixed,
  planIdMigration,
  remapIdsInJson,
  stripPrefix,
} from '../../src/iot/id-migration.js';

/**
 * Migración de ids IoT (US-243). El fallo que cierra: añadir un segundo backend
 * re-prefijaba TODOS los ids y orfanaba escenas, habitaciones, horarios,
 * favoritos y el histórico de energía **sin un solo error en pantalla**.
 */

describe('isPrefixed / stripPrefix (US-243)', () => {
  it('reconoce un prefijo de backend conocido', () => {
    expect(isPrefixed('hue:foco-1')).toBe(true);
    expect(stripPrefix('hue:foco-1')).toBe('foco-1');
  });

  it('NO trata como prefijo unos dos puntos cualesquiera', () => {
    // Un zigbee puede llamarse así, y tomar `0x00124b0022` por prefijo lo dejaría
    // fuera de la migración para siempre.
    expect(isPrefixed('0x00124b0022:sensor')).toBe(false);
    expect(stripPrefix('0x00124b0022:sensor')).toBe('0x00124b0022:sensor');
  });

  it('un id sin dos puntos nunca está prefijado', () => {
    expect(isPrefixed('foco-1')).toBe(false);
    expect(isPrefixed(':raro')).toBe(false);
  });
});

describe('planIdMigration (US-243)', () => {
  it('con UN backend prefija los ids crudos: el caso mayoritario', () => {
    const plan = planIdMigration({
      persistedIds: ['foco-1', 'enchufe-2'],
      liveIds: [],
      kinds: ['hue'],
    });
    expect(plan.mapping.get('foco-1')).toBe('hue:foco-1');
    expect(plan.mapping.get('enchufe-2')).toBe('hue:enchufe-2');
    expect(plan.unresolved).toEqual([]);
  });

  it('no toca lo que ya está prefijado (instalación con dos backends)', () => {
    const plan = planIdMigration({
      persistedIds: ['hue:foco-1', 'govee:tira-2'],
      liveIds: ['hue:foco-1', 'govee:tira-2'],
      kinds: ['hue', 'govee'],
    });
    expect(plan.mapping.size).toBe(0);
    expect(plan.unresolved).toEqual([]);
  });

  it('repara una instalación YA rota cruzando con los aparatos vivos', () => {
    // El usuario añadió Govee antes del arreglo: sus ids quedaron crudos y el
    // manager empezó a prefijar. El aparato existe; solo hay que reapuntarlo.
    const plan = planIdMigration({
      persistedIds: ['foco-1'],
      liveIds: ['hue:foco-1', 'govee:tira-2'],
      kinds: ['hue', 'govee'],
    });
    expect(plan.mapping.get('foco-1')).toBe('hue:foco-1');
    expect(plan.unresolved).toEqual([]);
  });

  it('con dos backends y sin aparato vivo que lo explique, NO adivina', () => {
    // Apuntar la escena de alguien a un aparato que no es sería peor que dejarla
    // rota y visible.
    const plan = planIdMigration({
      persistedIds: ['fantasma'],
      liveIds: ['hue:foco-1'],
      kinds: ['hue', 'govee'],
    });
    expect(plan.mapping.size).toBe(0);
    expect(plan.unresolved).toEqual(['fantasma']);
  });

  it('un id ambiguo entre dos backends queda sin resolver', () => {
    const plan = planIdMigration({
      persistedIds: ['1'],
      liveIds: ['hue:1', 'govee:1'],
      kinds: ['hue', 'govee'],
    });
    expect(plan.mapping.size).toBe(0);
    expect(plan.unresolved).toEqual(['1']);
  });

  it('deduplica: el mismo id en cuatro tablas es una sola decisión', () => {
    const plan = planIdMigration({
      persistedIds: ['foco-1', 'foco-1', 'foco-1'],
      liveIds: [],
      kinds: ['hue'],
    });
    expect(plan.mapping.size).toBe(1);
  });
});

describe('remapIdsInJson (US-243)', () => {
  const mapping = new Map([['foco-1', 'hue:foco-1']]);

  it('reescribe el `deviceId` de las acciones de una escena', () => {
    const actions = JSON.stringify([
      { deviceId: 'foco-1', on: true, brightness: 50 },
      { deviceId: 'otro', on: false },
    ]);
    const out = JSON.parse(remapIdsInJson(actions, ['deviceId'], mapping));
    expect(out[0].deviceId).toBe('hue:foco-1');
    // Lo demás se conserva intacto: la migración no puede perder el brillo.
    expect(out[0].brightness).toBe(50);
    expect(out[1].deviceId).toBe('otro');
  });

  it('reescribe un target anidado de horario IoT', () => {
    const target = JSON.stringify({ type: 'device', deviceId: 'foco-1', on: true });
    const out = JSON.parse(remapIdsInJson(target, ['deviceId'], mapping));
    expect(out.deviceId).toBe('hue:foco-1');
    expect(out.type).toBe('device');
  });

  it('reescribe listas de ids (sensores de la alarma)', () => {
    const config = JSON.stringify({ sensorDeviceIds: ['foco-1', 'otro'], entryDelaySec: 30 });
    const out = JSON.parse(remapIdsInJson(config, ['sensorDeviceIds'], mapping));
    expect(out.sensorDeviceIds).toEqual(['hue:foco-1', 'otro']);
    expect(out.entryDelaySec).toBe(30);
  });

  it('devuelve el original SIN TOCAR si no cambia nada', () => {
    // Identidad exacta: así el llamador puede saltarse el UPDATE.
    const raw = JSON.stringify([{ deviceId: 'otro' }]);
    expect(remapIdsInJson(raw, ['deviceId'], mapping)).toBe(raw);
  });

  it('un JSON corrupto se deja tal cual, sin lanzar', () => {
    // Parseo defensivo (US-63): una fila corrupta no puede tumbar el arranque.
    expect(remapIdsInJson('{roto', ['deviceId'], mapping)).toBe('{roto');
  });
});

describe('gate: la lista de prefijos conocidos cubre todos los backends (US-248)', () => {
  it('cada `IotKind` vigente está registrado en IOT_KINDS', () => {
    // `IOT_SUPPORT_LEVEL` es un `Record<IotKind, …>`: el tipo lo obliga a ser
    // exhaustivo, así que sus claves SON la unión entera en tiempo de ejecución.
    // Encadenando ambas cosas, añadir un backend no compila hasta clasificarlo y
    // luego no pasa este gate hasta registrarlo aquí. Sin esto, `isPrefixed` no
    // reconocería sus ids y la migración volvería a prefijarlos
    // (`mqtt:x` → `mock:mqtt:x`): exactamente el desastre que cerró US-243, con la
    // diferencia de que la lista de abajo se escribe a mano y nadie lo notaría.
    for (const kind of Object.keys(IOT_SUPPORT_LEVEL)) {
      expect(IOT_KINDS, `falta el backend ${kind}`).toContain(kind);
    }
  });

  it('guard de tamaño: la fuente de la que deriva no se ha vaciado', () => {
    expect(Object.keys(IOT_SUPPORT_LEVEL).length).toBeGreaterThanOrEqual(9);
  });

  it('conserva los kinds RETIRADOS, que no están en el tipo', () => {
    // Una instalación vieja puede tener ids `switchbot:algo` persistidos (US-242).
    expect(IOT_KINDS).toContain('switchbot');
  });
});
