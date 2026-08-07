import type { AutomationRule, HomeEvent } from '@krakenos/types';
import { describe, expect, it } from 'vitest';
import {
  describeEvent,
  dueRulesForEvent,
  dueTimeRules,
  eventSubject,
  matchesTrigger,
  passesCondition,
  timeTriggerDue,
} from '../../src/automations/engine.js';

function rule(over: Partial<AutomationRule> = {}): AutomationRule {
  return {
    id: 'r1',
    name: 'Regla',
    enabled: true,
    trigger: { type: 'device-new' },
    actions: [{ type: 'notify', message: 'hola' }],
    cooldownSec: 60,
    createdAt: '',
    ...over,
  };
}

const NOW = new Date(2026, 6, 8, 12, 0, 0); // miércoles (día 3) 12:00

/** Motor de automatizaciones (US-167): decisión pura de disparo. */
describe('automations/engine — matchesTrigger', () => {
  it('device-new casa con cualquier MAC nueva', () => {
    expect(matchesTrigger({ type: 'device-new' }, { type: 'device-new', mac: 'aa' })).toBe(true);
    expect(matchesTrigger({ type: 'device-new' }, { type: 'device-online', mac: 'aa' })).toBe(false);
  });

  it('device-online/offline exigen la MAC concreta', () => {
    expect(
      matchesTrigger({ type: 'device-online', mac: 'aa' }, { type: 'device-online', mac: 'aa' }),
    ).toBe(true);
    expect(
      matchesTrigger({ type: 'device-online', mac: 'aa' }, { type: 'device-online', mac: 'bb' }),
    ).toBe(false);
    expect(
      matchesTrigger({ type: 'device-offline', mac: 'aa' }, { type: 'device-offline', mac: 'aa' }),
    ).toBe(true);
  });

  it('iot-on/off exigen el dispositivo concreto', () => {
    expect(matchesTrigger({ type: 'iot-on', deviceId: 'x' }, { type: 'iot-on', deviceId: 'x' })).toBe(true);
    expect(matchesTrigger({ type: 'iot-on', deviceId: 'x' }, { type: 'iot-off', deviceId: 'x' })).toBe(false);
  });

  it('sensor-threshold dispara solo al CRUZAR el umbral, no sostenido', () => {
    const trigger = { type: 'sensor-threshold', deviceId: 's', op: 'gt', value: 30 } as const;
    const reading = (value: number, prevValue: number | null): HomeEvent => ({
      type: 'sensor-reading',
      deviceId: 's',
      value,
      prevValue,
    });
    expect(matchesTrigger(trigger, reading(35, 25))).toBe(true); // cruza hacia arriba
    expect(matchesTrigger(trigger, reading(36, 35))).toBe(false); // ya estaba por encima
    expect(matchesTrigger(trigger, reading(35, null))).toBe(true); // primera lectura
    expect(matchesTrigger(trigger, reading(25, 35))).toBe(false); // cruza hacia abajo

    const lt = { type: 'sensor-threshold', deviceId: 's', op: 'lt', value: 10 } as const;
    expect(matchesTrigger(lt, reading(5, 15))).toBe(true);
    expect(matchesTrigger(lt, reading(4, 5))).toBe(false);
  });

  it('weather-threshold dispara al CRUZAR, no cada hora mientras dure el frío (US-254)', () => {
    const trigger = { type: 'weather-threshold', metric: 'temperature', op: 'lt', value: 5 } as const;
    const lectura = (value: number, prevValue: number | null): HomeEvent => ({
      type: 'weather-reading',
      metric: 'temperature',
      value,
      prevValue,
    });
    expect(matchesTrigger(trigger, lectura(3, 9))).toBe(true); // cruza hacia abajo
    // El caso que justifica el flanco: con lectura horaria, «sostenido» dispararía
    // la regla cada hora durante toda la noche.
    expect(matchesTrigger(trigger, lectura(2, 3))).toBe(false);
    expect(matchesTrigger(trigger, lectura(3, null))).toBe(true); // primera lectura
    expect(matchesTrigger(trigger, lectura(9, 3))).toBe(false); // vuelve a subir
  });

  it('weather-threshold solo mira SU magnitud', () => {
    // Sin el filtro por métrica, «si llueve» dispararía con la temperatura: es el
    // mismo fallo que la alarma con una lámpara antes de US-244.
    const lluvia = { type: 'weather-threshold', metric: 'precipitation', op: 'gt', value: 0 } as const;
    expect(
      matchesTrigger(lluvia, {
        type: 'weather-reading',
        metric: 'temperature',
        value: 30,
        prevValue: 0,
      }),
    ).toBe(false);
    expect(
      matchesTrigger(lluvia, {
        type: 'weather-reading',
        metric: 'precipitation',
        value: 2,
        prevValue: 0,
      }),
    ).toBe(true);
  });

  it('energy-threshold: sin deviceId casa con cualquiera; con deviceId, solo ese (US-183)', () => {
    const ev: HomeEvent = {
      type: 'energy-threshold',
      deviceId: 'plug-x',
      metric: 'sustained-power',
      value: 600,
      threshold: 500,
    };
    expect(matchesTrigger({ type: 'energy-threshold' }, ev)).toBe(true);
    expect(matchesTrigger({ type: 'energy-threshold', deviceId: 'plug-x' }, ev)).toBe(true);
    expect(matchesTrigger({ type: 'energy-threshold', deviceId: 'other' }, ev)).toBe(false);
    expect(matchesTrigger({ type: 'energy-threshold' }, { type: 'iot-on', deviceId: 'plug-x' })).toBe(
      false,
    );
  });

  it('motion-detected: sin cameraId casa con cualquiera; con cameraId, solo esa (US-186)', () => {
    const ev: HomeEvent = { type: 'motion-detected', cameraId: 'cam-1', cameraName: 'Entrada' };
    expect(matchesTrigger({ type: 'motion-detected' }, ev)).toBe(true);
    expect(matchesTrigger({ type: 'motion-detected', cameraId: 'cam-1' }, ev)).toBe(true);
    expect(matchesTrigger({ type: 'motion-detected', cameraId: 'cam-2' }, ev)).toBe(false);
    expect(matchesTrigger({ type: 'motion-detected' }, { type: 'iot-on', deviceId: 'x' })).toBe(false);
  });

  it('motion-detected con label (Frigate, US-214): filtra por objeto detectado', () => {
    const person: HomeEvent = {
      type: 'motion-detected',
      cameraId: 'cam-1',
      cameraName: 'Entrada',
      label: 'person',
    };
    const plain: HomeEvent = { type: 'motion-detected', cameraId: 'cam-1', cameraName: 'Entrada' };
    // Con label: solo el objeto pedido; el frame-diff local (sin label) NO dispara.
    expect(matchesTrigger({ type: 'motion-detected', label: 'person' }, person)).toBe(true);
    expect(matchesTrigger({ type: 'motion-detected', label: 'car' }, person)).toBe(false);
    expect(matchesTrigger({ type: 'motion-detected', label: 'person' }, plain)).toBe(false);
    // Sin label en la regla: cualquier detección, nativa o local.
    expect(matchesTrigger({ type: 'motion-detected' }, person)).toBe(true);
    // El resumen legible incluye el objeto (no es PII: lo pone el detector).
    expect(describeEvent(person)).toBe('person en Entrada');
    expect(describeEvent(plain)).toBe('movimiento en Entrada');
  });

  it('time nunca casa por evento (va por el barrido)', () => {
    expect(
      matchesTrigger({ type: 'time', days: [3], minute: 720 }, { type: 'device-new', mac: 'aa' }),
    ).toBe(false);
  });

  it('person-arrived/left: sin userId casa con cualquiera; con userId, solo esa persona (US-169)', () => {
    const arrived: HomeEvent = { type: 'person-arrived', userId: 'u1', name: 'Ana' };
    expect(matchesTrigger({ type: 'person-arrived' }, arrived)).toBe(true);
    expect(matchesTrigger({ type: 'person-arrived', userId: 'u1' }, arrived)).toBe(true);
    expect(matchesTrigger({ type: 'person-arrived', userId: 'u2' }, arrived)).toBe(false);
    expect(matchesTrigger({ type: 'person-left' }, arrived)).toBe(false);
    expect(
      matchesTrigger({ type: 'person-left', userId: 'u1' }, { type: 'person-left', userId: 'u1', name: 'Ana' }),
    ).toBe(true);
  });

  it('mode-changed exige el modo concreto (US-169)', () => {
    const event: HomeEvent = { type: 'mode-changed', mode: 'away', prevMode: 'home' };
    expect(matchesTrigger({ type: 'mode-changed', mode: 'away' }, event)).toBe(true);
    expect(matchesTrigger({ type: 'mode-changed', mode: 'night' }, event)).toBe(false);
  });
});

describe('automations/engine — passesCondition', () => {
  it('sin condición siempre pasa; los días filtran', () => {
    expect(passesCondition(undefined, NOW)).toBe(true);
    expect(passesCondition({ days: [3] }, NOW)).toBe(true);
    expect(passesCondition({ days: [0, 6] }, NOW)).toBe(false);
  });

  it('ventana horaria normal y cruzando medianoche', () => {
    expect(passesCondition({ fromMinute: 600, toMinute: 800 }, NOW)).toBe(true); // 12:00 ∈ [10:00,13:20)
    expect(passesCondition({ fromMinute: 800, toMinute: 900 }, NOW)).toBe(false);
    // 22:00→07:00 cruza medianoche: 12:00 fuera, 23:00 dentro, 06:00 dentro.
    const night = { fromMinute: 22 * 60, toMinute: 7 * 60 };
    expect(passesCondition(night, NOW)).toBe(false);
    expect(passesCondition(night, new Date(2026, 6, 8, 23, 0))).toBe(true);
    expect(passesCondition(night, new Date(2026, 6, 8, 6, 0))).toBe(true);
  });
});

describe('automations/engine — timeTriggerDue', () => {
  const trigger = { type: 'time', days: [3], minute: 12 * 60 } as const; // miércoles 12:00

  it('dispara al cruzar el minuto, no antes ni después', () => {
    expect(timeTriggerDue(trigger, new Date(2026, 6, 8, 11, 59), new Date(2026, 6, 8, 12, 0))).toBe(true);
    expect(timeTriggerDue(trigger, new Date(2026, 6, 8, 11, 57), new Date(2026, 6, 8, 11, 58))).toBe(false);
    expect(timeTriggerDue(trigger, new Date(2026, 6, 8, 12, 0), new Date(2026, 6, 8, 12, 1))).toBe(false);
  });

  it('respeta el día de la semana y cruza medianoche', () => {
    // Mismo minuto pero jueves → no dispara.
    expect(timeTriggerDue(trigger, new Date(2026, 6, 9, 11, 59), new Date(2026, 6, 9, 12, 0))).toBe(false);
    // 00:00 del jueves con barrido que cruza medianoche desde el miércoles.
    const midnight = { type: 'time', days: [4], minute: 0 } as const;
    expect(
      timeTriggerDue(midnight, new Date(2026, 6, 8, 23, 59, 30), new Date(2026, 6, 9, 0, 0, 30)),
    ).toBe(true);
  });
});

describe('automations/engine — dueRulesForEvent / dueTimeRules', () => {
  const event: HomeEvent = { type: 'device-new', mac: 'aa:bb' };

  it('filtra deshabilitadas, no-casan, condición y cooldown', () => {
    const rules = [
      rule({ id: 'ok' }),
      rule({ id: 'off', enabled: false }),
      rule({ id: 'otra', trigger: { type: 'iot-on', deviceId: 'x' } }),
      rule({ id: 'noche', condition: { days: [0] } }),
      rule({ id: 'caliente' }),
    ];
    const lastFired = new Map([['caliente', NOW.getTime() - 30_000]]); // cooldown 60 s
    expect(dueRulesForEvent(rules, event, NOW, lastFired).map((r) => r.id)).toEqual(['ok']);
  });

  it('anti-bucle: un evento con origin de la propia regla no la re-dispara', () => {
    const self = rule({ id: 'r1' });
    const other = rule({ id: 'r2' });
    const caused: HomeEvent = { ...event, origin: 'automation:r1' };
    expect(dueRulesForEvent([self, other], caused, NOW, new Map()).map((r) => r.id)).toEqual(['r2']);
  });

  it('cooldown cumplido vuelve a permitir el disparo', () => {
    const r = rule({ id: 'ok', cooldownSec: 60 });
    const lastFired = new Map([['ok', NOW.getTime() - 61_000]]);
    expect(dueRulesForEvent([r], event, NOW, lastFired)).toHaveLength(1);
  });

  it('dueTimeRules solo considera disparadores de hora', () => {
    const timed = rule({ id: 't', trigger: { type: 'time', days: [3], minute: 12 * 60 } });
    const evented = rule({ id: 'e' });
    const due = dueTimeRules(
      [timed, evented],
      new Date(2026, 6, 8, 11, 59),
      new Date(2026, 6, 8, 12, 0),
      new Map(),
    );
    expect(due.map((r) => r.id)).toEqual(['t']);
  });
});

describe('automations/engine — eventSubject / describeEvent', () => {
  it('extrae el objetivo implícito del evento', () => {
    expect(eventSubject({ type: 'device-new', mac: 'aa' })).toEqual({ mac: 'aa' });
    expect(eventSubject({ type: 'iot-on', deviceId: 'x' })).toEqual({ deviceId: 'x' });
    expect(eventSubject({ type: 'sensor-reading', deviceId: 's', value: 1, prevValue: null })).toEqual({
      deviceId: 's',
    });
  });

  it('describe los eventos de forma legible', () => {
    expect(describeEvent({ type: 'device-new', mac: 'aa' })).toContain('aa');
    expect(describeEvent({ type: 'sensor-reading', deviceId: 's', value: 21, prevValue: 20 })).toBe('s = 21');
  });

  it('motion-detected: sin objetivo implícito, resumen con el nombre de la cámara (US-186)', () => {
    const ev: HomeEvent = { type: 'motion-detected', cameraId: 'cam-1', cameraName: 'Entrada' };
    expect(eventSubject(ev)).toEqual({});
    expect(describeEvent(ev)).toContain('Entrada');
  });

  it('la presencia no aporta objetivo implícito y su resumen NO filtra el nombre (privacidad US-169)', () => {
    expect(eventSubject({ type: 'person-arrived', userId: 'u1', name: 'Ana' })).toEqual({});
    expect(eventSubject({ type: 'mode-changed', mode: 'night', prevMode: 'home' })).toEqual({});
    // El resumen acaba en AutomationRun.event, legible por cualquier autenticado:
    // no debe contener el nombre de la persona (la presencia ajena es por rol).
    expect(describeEvent({ type: 'person-arrived', userId: 'u1', name: 'Ana' })).not.toContain('Ana');
    expect(describeEvent({ type: 'person-arrived', userId: 'u1', name: 'Ana' })).toContain('llega');
    expect(describeEvent({ type: 'person-left', userId: 'u1', name: 'Ana' })).toContain('sale');
    expect(describeEvent({ type: 'mode-changed', mode: 'night', prevMode: 'home' })).toContain('night');
  });
});
