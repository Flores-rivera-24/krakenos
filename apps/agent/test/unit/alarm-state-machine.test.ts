import type { AlarmConfig } from '@krakenos/types';
import { describe, expect, it } from 'vitest';
import {
  advance,
  arm,
  disarm,
  disarmedState,
  isActive,
  trigger,
} from '../../src/alarm/state-machine.js';

const cfg = (over: Partial<AlarmConfig> = {}): AlarmConfig => ({
  sirenDeviceId: null,
  lightDeviceIds: [],
  sensorDeviceIds: [],
  cameraIds: [],
  exitDelaySec: 30,
  entryDelaySec: 30,
  autoArmAway: false,
  hasPin: false,
  ...over,
});

describe('alarm/state-machine (US-188)', () => {
  it('arma con cuenta de salida y la resuelve a armed', () => {
    const armed = arm('away', 1000, cfg({ exitDelaySec: 10 }));
    expect(armed.phase).toBe('arming');
    expect(armed.countdownEndsAt).toBe(new Date(11_000).toISOString());
    // Antes de tiempo sigue arming; al vencer pasa a armed.
    expect(advance(armed, 5000).state.phase).toBe('arming');
    expect(advance(armed, 11_000).state.phase).toBe('armed');
  });

  it('exitDelay=0 arma al instante', () => {
    expect(arm('night', 0, cfg({ exitDelaySec: 0 })).phase).toBe('armed');
  });

  it('un disparo estando armed entra en entry y luego dispara al vencer', () => {
    const armed = arm('away', 0, cfg({ exitDelaySec: 0 }));
    const r = trigger(armed, 'Entrada', 1000, cfg({ entryDelaySec: 20 }));
    expect(r.state.phase).toBe('entry');
    expect(r.justTriggered).toBe(false);
    expect(r.state.triggeredBy).toBe('Entrada');
    // No dispara hasta que vence la entrada.
    expect(advance(r.state, 10_000).state.phase).toBe('entry');
    const fired = advance(r.state, 21_000);
    expect(fired.state.phase).toBe('triggered');
    expect(fired.justTriggered).toBe(true);
  });

  it('entryDelay=0 dispara al instante (justTriggered)', () => {
    const armed = arm('away', 0, cfg({ exitDelaySec: 0 }));
    const r = trigger(armed, 'sensor', 1000, cfg({ entryDelaySec: 0 }));
    expect(r.state.phase).toBe('triggered');
    expect(r.justTriggered).toBe(true);
  });

  it('un disparo en arming (cuenta de salida) o desarmada se ignora', () => {
    const arming = arm('away', 0, cfg({ exitDelaySec: 30 }));
    expect(trigger(arming, 'x', 1000, cfg()).state.phase).toBe('arming');
    expect(trigger(disarmedState(0), 'x', 1000, cfg()).state.phase).toBe('disarmed');
  });

  it('disarm siempre lleva a disarmed; isActive refleja la vigilancia', () => {
    const armed = arm('away', 0, cfg({ exitDelaySec: 0 }));
    expect(isActive(armed)).toBe(true);
    expect(disarm(5000).phase).toBe('disarmed');
    expect(isActive(disarmedState(0))).toBe(false);
    expect(isActive(arm('away', 0, cfg({ exitDelaySec: 30 })))).toBe(false); // arming aún no vigila
  });
});
