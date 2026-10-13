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
  describe('contrato de justTriggered: solo la transición a triggered ordena sonar', () => {
    const t0 = Date.parse('2026-10-12T20:00:00Z');
    const config = cfg({ exitDelaySec: 30, entryDelaySec: 20 });
    // Perezoso: si un fixture se construye al describir y `arm`/`trigger` se rompen,
    // revienta la colección del fichero entero en vez de fallar un test concreto.
    const montar = () => {
      const disarmed = disarmedState(t0);
      const arming = arm('away', t0, config);
      const armed = arm('away', t0, cfg({ exitDelaySec: 0 }));
      const entry = trigger(armed, 'Entrada', t0, config).state;
      const triggered = trigger(armed, 'Entrada', t0, cfg({ entryDelaySec: 0 })).state;
      return { disarmed, arming, armed, entry, triggered };
    };

    it('las fixtures están en la fase que dicen', () => {
      const fases = montar();
      for (const [fase, estado] of Object.entries(fases)) expect(estado.phase).toBe(fase);
    });

    it('trigger: solo armada con retardo 0 (o sin retardo de entrada) dispara', () => {
      const fases = montar();
      for (const [fase, estado] of Object.entries(fases)) {
        const r = trigger(estado, 'x', t0 + 1000, cfg({ entryDelaySec: 0 }));
        expect(r.justTriggered, `${fase} entryDelay=0`).toBe(fase === 'armed');
        const r2 = trigger(estado, 'x', t0 + 1000, config);
        expect(r2.justTriggered, `${fase} con retardo`).toBe(false);
        const r3 = trigger(estado, 'x', t0 + 1000, config, { sinRetardoDeEntrada: true });
        expect(r3.justTriggered, `${fase} sin retardo de entrada`).toBe(fase === 'armed');
      }
    });

    it('trigger sin estar armada deja el estado intacto', () => {
      const { disarmed, arming, entry, triggered } = montar();
      for (const estado of [disarmed, arming, entry, triggered]) {
        const r = trigger(estado, 'x', t0 + 1000, cfg({ entryDelaySec: 0 }));
        expect(r.justTriggered).toBe(false);
        expect(r.state).toBe(estado);
      }
    });

    it('advance con la cuenta de salida vencida pasa a armed SIN ordenar sonar', () => {
      const { arming } = montar();
      const r = advance(arming, t0 + 30_000);
      expect(r.state.phase).toBe('armed');
      expect(r.justTriggered).toBe(false);
    });

    it('advance con la entrada vencida pasa a triggered Y ordena sonar (una vez)', () => {
      const { entry } = montar();
      const r = advance(entry, t0 + 20_000);
      expect(r.state.phase).toBe('triggered');
      expect(r.justTriggered).toBe(true);
      expect(advance(r.state, t0 + 60_000).justTriggered).toBe(false);
    });

    it('advance sin nada vencido no ordena sonar en NINGUNA fase', () => {
      const fases = montar();
      for (const [fase, estado] of Object.entries(fases)) {
        const r = advance(estado, t0 + 1000);
        expect(r.justTriggered, fase).toBe(false);
        expect(r.state.phase, fase).toBe(fase);
      }
    });

    it('advance con mucho tiempo: solo entry dispara; el resto no cambia a triggered', () => {
      const fases = montar();
      for (const [fase, estado] of Object.entries(fases)) {
        const r = advance(estado, t0 + 3_600_000);
        expect(r.justTriggered, fase).toBe(fase === 'entry');
      }
    });

    it('arm y disarm nunca producen estado triggered', () => {
      expect(arm('away', t0, cfg({ exitDelaySec: 0 })).phase).toBe('armed');
      expect(disarm(t0).phase).toBe('disarmed');
    });
  });

  it('isActive es true en armed, entry y triggered y false en disarmed y arming', () => {
    const t0 = 0;
    const armed = arm('away', t0, cfg({ exitDelaySec: 0 }));
    const entry = trigger(armed, 'x', t0, cfg({ entryDelaySec: 20 })).state;
    const triggered = trigger(armed, 'x', t0, cfg({ entryDelaySec: 0 })).state;
    expect(isActive(armed)).toBe(true);
    expect(isActive(entry)).toBe(true);
    expect(isActive(triggered)).toBe(true);
    expect(isActive(disarmedState(t0))).toBe(false);
    expect(isActive(arm('away', t0, cfg({ exitDelaySec: 30 })))).toBe(false);
  });

  it('con exitDelaySec = 0 armar no deja cuenta atrás (y un retardo negativo tampoco)', () => {
    for (const exitDelaySec of [0, -5]) {
      const a = arm('night', 1000, cfg({ exitDelaySec }));
      expect(a.phase).toBe('armed');
      expect(a.countdownEndsAt).toBeNull();
      expect(a.mode).toBe('night');
    }
  });
});
