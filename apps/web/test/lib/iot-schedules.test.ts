import { describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import {
  createIotSchedule,
  formatScheduleTime,
  minuteToTimeString,
  timeStringToMinute,
} from '@/lib/iot-schedules';

describe('lib/iot-schedules (US-168)', () => {
  it('formatea la hora fija y los eventos solares con desfase', () => {
    expect(formatScheduleTime({ kind: 'fixed', minute: 7 * 60 })).toBe('07:00');
    expect(formatScheduleTime({ kind: 'fixed', minute: 21 * 60 + 30 })).toBe('21:30');
    expect(formatScheduleTime({ kind: 'sunrise', offsetMin: 0 })).toBe('Amanecer');
    expect(formatScheduleTime({ kind: 'sunset', offsetMin: -15 })).toBe('Atardecer −15m');
    expect(formatScheduleTime({ kind: 'sunset', offsetMin: 30 })).toBe('Atardecer +30m');
  });

  it('convierte HH:MM ↔ minutos del día', () => {
    expect(timeStringToMinute('07:30')).toBe(450);
    expect(minuteToTimeString(450)).toBe('07:30');
    expect(minuteToTimeString(0)).toBe('00:00');
  });

  it('el helper de alta llama al endpoint correcto', () => {
    const body = {
      name: 'Riego',
      days: [1],
      time: { kind: 'fixed', minute: 420 } as const,
      target: { type: 'device', deviceId: 'plug', on: true } as const,
    };
    createIotSchedule(body);
    expect(apiMock.post).toHaveBeenCalledWith('/iot-schedules', body);
  });
});
