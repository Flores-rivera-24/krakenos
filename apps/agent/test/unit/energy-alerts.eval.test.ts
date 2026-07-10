import { describe, expect, it } from 'vitest';
import {
  ALERT_COOLDOWN_MS,
  evaluate,
  initialState,
  type RuleState,
} from '../../src/modules/energy/energy-alerts.eval.js';

const SUSTAINED = { metric: 'sustained-power' as const, threshold: 500, sustainMinutes: 5 };
const DAILY = { metric: 'daily-energy' as const, threshold: 1000, sustainMinutes: 5 };

function at(min: number): Date {
  return new Date(2026, 6, 10, 0, min, 0, 0);
}

describe('energy-alerts evaluator (US-183)', () => {
  describe('sustained-power', () => {
    it('no dispara antes de mantener el umbral el tiempo requerido', () => {
      let s = initialState();
      // Supera el umbral en t=0 pero solo lleva 4 min a t=4 → no dispara.
      ({ state: s } = evaluate(s, SUSTAINED, 600, at(0)));
      const r = evaluate(s, SUSTAINED, 600, at(4));
      expect(r.fire).toBe(false);
    });

    it('dispara al superar el umbral de forma sostenida', () => {
      let s = initialState();
      ({ state: s } = evaluate(s, SUSTAINED, 600, at(0)));
      const r = evaluate(s, SUSTAINED, 600, at(5));
      expect(r.fire).toBe(true);
    });

    it('no vuelve a disparar mientras sigue por encima (histéresis)', () => {
      let s = initialState();
      ({ state: s } = evaluate(s, SUSTAINED, 600, at(0)));
      let r = evaluate(s, SUSTAINED, 600, at(5));
      expect(r.fire).toBe(true);
      s = r.state;
      // Sigue alto: no re-dispara.
      r = evaluate(s, SUSTAINED, 600, at(6));
      expect(r.fire).toBe(false);
    });

    it('rearma al caer por debajo de la banda de histéresis y respeta el cooldown', () => {
      let s = initialState();
      ({ state: s } = evaluate(s, SUSTAINED, 600, at(0)));
      let r = evaluate(s, SUSTAINED, 600, at(5));
      s = r.state;
      expect(r.fire).toBe(true);
      // Cae por debajo de threshold*0.9 (=450) → rearma (firing=false).
      r = evaluate(s, SUSTAINED, 400, at(6));
      s = r.state;
      expect(s.firing).toBe(false);
      // Vuelve a subir sostenido, pero el cooldown aún no pasó → no dispara.
      ({ state: s } = evaluate(s, SUSTAINED, 600, at(7)));
      r = evaluate(s, SUSTAINED, 600, at(12));
      expect(r.fire).toBe(false);
      // Pasado el cooldown, sí dispara.
      const later = new Date(at(0).getTime() + ALERT_COOLDOWN_MS + 6 * 60_000);
      const start = new Date(later.getTime() - 6 * 60_000);
      const s2: RuleState = { ...s, aboveSinceMs: start.getTime() };
      r = evaluate(s2, SUSTAINED, 600, later);
      expect(r.fire).toBe(true);
    });

    it('un dispositivo justo en el umbral no dispara (estrictamente mayor)', () => {
      const r = evaluate(initialState(), SUSTAINED, 500, at(10));
      expect(r.fire).toBe(false);
    });
  });

  describe('daily-energy', () => {
    it('dispara una vez al superar la energía del día', () => {
      let r = evaluate(initialState(), DAILY, 1200, at(0));
      expect(r.fire).toBe(true);
      // Mismo día, sigue alto: no re-dispara.
      r = evaluate(r.state, DAILY, 1500, at(60));
      expect(r.fire).toBe(false);
    });

    it('rearma al cambiar de día', () => {
      let r = evaluate(initialState(), DAILY, 1200, at(0));
      expect(r.fire).toBe(true);
      // Día siguiente.
      const tomorrow = new Date(2026, 6, 11, 8, 0, 0, 0);
      r = evaluate(r.state, DAILY, 1200, tomorrow);
      expect(r.fire).toBe(true);
    });

    it('no dispara por debajo del umbral', () => {
      const r = evaluate(initialState(), DAILY, 800, at(0));
      expect(r.fire).toBe(false);
    });
  });
});
