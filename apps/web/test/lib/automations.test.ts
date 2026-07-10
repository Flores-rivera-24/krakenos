import type { IotDevice, Scene } from '@krakenos/types';
import { describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

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
