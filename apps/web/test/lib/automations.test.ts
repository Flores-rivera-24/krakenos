import type { IotDevice, Scene } from '@krakenos/types';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => {
  // `getList` delega en `get` para que los mocks por ruta que ya existen
  // sigan valiendo tal cual: es el mismo GET, con la forma comprobada.
  const get = vi.fn();
  return { get, getList: vi.fn((path: string) => get(path)), post: vi.fn(), patch: vi.fn(), del: vi.fn() };
});
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { ensureCatalog, setLocale, t } from '@/lib/i18n';
import {
  createAutomation,
  describeAction,
  describeCondition,
  describeTrigger,
  listAutomationRuns,
  type NameContext,
} from '@/lib/automations';

const CTX: NameContext = {
  devices: [{ id: 'light-1', name: 'Luz salón' } as IotDevice],
  scenes: [{ id: 's1', name: 'Cine' } as Scene],
  networkNames: new Map([['aa:bb', 'Móvil de Ana']]),
  userNames: new Map([['u1', 'Ana']]),
  cameraNames: new Map([['cam-1', 'Entrada']]),
};

describe('lib/automations (US-167)', () => {
  it('describe disparadores con nombres humanos', () => {
    expect(describeTrigger({ type: 'device-new' })).toMatch(/desconocido/);
    expect(describeTrigger({ type: 'device-online', mac: 'aa:bb' }, CTX)).toBe('Móvil de Ana se conecta');
    expect(describeTrigger({ type: 'iot-off', deviceId: 'light-1' }, CTX)).toBe('Luz salón se apaga');
    expect(
      describeTrigger({ type: 'sensor-threshold', deviceId: 'light-1', op: 'gt', value: 30 }, CTX),
    ).toBe('Luz salón supera 30');
    expect(describeTrigger({ type: 'time', days: [1, 2], minute: 8 * 60 })).toBe('a las 08:00 (Lun Mar)');
  });

  it('describe los disparadores de presencia y modo (US-169)', () => {
    expect(describeTrigger({ type: 'person-arrived' }, CTX)).toBe('alguien llega a casa');
    expect(describeTrigger({ type: 'person-arrived', userId: 'u1' }, CTX)).toBe('Ana llega a casa');
    expect(describeTrigger({ type: 'person-left', userId: 'u1' }, CTX)).toBe('Ana sale de casa');
    expect(describeTrigger({ type: 'mode-changed', mode: 'night' }, CTX)).toBe('el hogar pasa a «Noche»');
  });

  it('describe el disparador de movimiento (US-186)', () => {
    expect(describeTrigger({ type: 'motion-detected' }, CTX)).toBe('una cámara detecta movimiento');
    expect(describeTrigger({ type: 'motion-detected', cameraId: 'cam-1' }, CTX)).toBe(
      'Entrada detecta movimiento',
    );
  });

  it('describe acciones (incluido el objetivo implícito del evento)', () => {
    expect(describeAction({ type: 'iot-set', deviceId: 'light-1', on: false }, CTX)).toBe('apaga Luz salón');
    expect(describeAction({ type: 'iot-set', on: true }, CTX)).toBe('enciende el dispositivo del evento');
    expect(describeAction({ type: 'scene-run', sceneId: 's1' }, CTX)).toBe('activa la escena Cine');
    expect(describeAction({ type: 'device-block' }, CTX)).toBe('bloquea el dispositivo del evento');
    // US-255: «quita el bloqueo», no «desbloquea». La acción suelta la fuente
    // manual; un horario o una pausa activos siguen cortando, así que el verbo no
    // puede prometer acceso.
    expect(describeAction({ type: 'device-unblock', mac: 'aa:bb' }, CTX)).toBe(
      'quita el bloqueo de Móvil de Ana',
    );
    // Y la contracción, que es donde se cuela el «de el».
    expect(describeAction({ type: 'device-unblock' }, CTX)).toBe(
      'quita el bloqueo del dispositivo del evento',
    );
    expect(describeAction({ type: 'device-pause', mac: 'aa:bb', minutes: 30 }, CTX)).toBe(
      'pausa Móvil de Ana 30 min',
    );
    expect(describeAction({ type: 'notify', message: 'hola' }, CTX)).toBe('avisa: «hola»');
  });

  it('describe la condición o devuelve null si no hay', () => {
    expect(describeCondition(undefined)).toBeNull();
    expect(describeCondition({ fromMinute: 22 * 60, toMinute: 7 * 60 })).toBe('solo 22:00–07:00');
    expect(describeCondition({ days: [0, 6], fromMinute: 0, toMinute: 60 })).toBe('solo Dom Sáb · 00:00–01:00');
  });

  it('llama a los endpoints correctos', async () => {
    apiMock.post.mockResolvedValue({});
    await createAutomation({ name: 'X', trigger: { type: 'device-new' }, actions: [] });
    expect(apiMock.post).toHaveBeenCalledWith('/automations', expect.objectContaining({ name: 'X' }));

    apiMock.get.mockResolvedValue([]);
    await listAutomationRuns('r1');
    expect(apiMock.get).toHaveBeenCalledWith('/automations/runs?ruleId=r1');
  });
});

/**
 * Las frases de las rutinas en inglés (US-270).
 *
 * Nacieron concatenando literales españoles (`a las ${hora} (${dias})`), así que
 * la página de Rutinas enseñaba sus frases y sus días en español con la app en
 * inglés. Ahora cada frase es **una plantilla completa** del catálogo: se puede
 * reordenar al traducir, que es justo lo que una frase montada por trozos impide.
 */
describe('frases de rutinas en inglés', () => {
  // El catálogo `en` ya no viaja en el bundle y `setLocale` es SÍNCRONO: sin
  // precargarlo, el test compite con el `import()` del chunk.
  beforeAll(() => ensureCatalog('en'));
  afterEach(() => setLocale('es', { persist: false }));

  const CTX_EN: NameContext = {
    devices: [{ id: 'light-1', name: 'Hall light' }] as IotDevice[],
    networkNames: new Map([['aa:bb', "Ana's phone"]]),
  };

  it('traduce el disparador, incluidos los días', () => {
    setLocale('en', { persist: false });
    expect(describeTrigger({ type: 'device-online', mac: 'aa:bb' }, CTX_EN, t)).toBe(
      "Ana's phone connects",
    );
    // El día sale del catálogo, no de una constante en español.
    expect(describeTrigger({ type: 'time', minute: 450, days: [1, 2] }, {}, t)).toBe(
      'at 07:30 (Mon Tue)',
    );
  });

  it('«supera» y «baja de» son dos plantillas, no una palabra intercambiada', () => {
    setLocale('en', { persist: false });
    const arriba = describeTrigger(
      { type: 'sensor-threshold', deviceId: 'light-1', op: 'gt', value: 20 },
      CTX_EN,
      t,
    );
    const abajo = describeTrigger(
      { type: 'sensor-threshold', deviceId: 'light-1', op: 'lt', value: 20 },
      CTX_EN,
      t,
    );
    expect(arriba).toBe('Hall light goes above 20');
    expect(abajo).toBe('Hall light drops below 20');
  });

  it('traduce la acción, y el brillo va en su propia plantilla', () => {
    setLocale('en', { persist: false });
    expect(describeAction({ type: 'iot-set', deviceId: 'light-1', on: true }, CTX_EN, t)).toBe(
      'turn on Hall light',
    );
    expect(
      describeAction({ type: 'iot-set', deviceId: 'light-1', on: true, brightness: 40 }, CTX_EN, t),
    ).toBe('turn on Hall light at 40%');
  });

  /**
   * El copy dice «quita el bloqueo» y no «desbloquea» porque la acción suelta la
   * fuente manual y no promete acceso: un horario o una pausa siguen cortando.
   * La traducción tiene que conservar esa promesa acotada.
   */
  it('la acción de soltar el bloqueo no promete acceso en inglés tampoco', () => {
    setLocale('en', { persist: false });
    const frase = describeAction({ type: 'device-unblock', mac: 'aa:bb' }, CTX_EN, t);
    expect(frase).toBe("lift the block on Ana's phone");
    expect(frase).not.toMatch(/unblock/i);
  });

  it('la condición se traduce', () => {
    setLocale('en', { persist: false });
    expect(describeCondition({ days: [1, 2], fromMinute: 480, toMinute: 1080 }, t)).toBe(
      'only Mon Tue · 08:00–18:00',
    );
  });
});
