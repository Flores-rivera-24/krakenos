import { describe, expect, it } from 'vitest';
import { createAttemptLockout } from '../../src/auth/attempt-lockout.js';

/**
 * Tests de la **fábrica** de lockout, no de sus instancias.
 *
 * Por qué hacía falta. `login-lockout.test.ts` cubre bien la instancia del login,
 * pero la fábrica es compartida: US-227 la reutiliza para el PIN de la alarma
 * (AUD3-03). Una campaña de mutación dejó a `attempt-lockout.ts` en **70 %**
 * —el peor de los seis módulos medidos— y señaló exactamente qué se estaba
 * dando por bueno sin comprobarlo:
 *
 *  - La purga por inactividad **dentro de `retryAfterSec`** (borrar la entrada
 *    caducada al consultarla) no la ejecutaba ningún test: Stryker la marcó como
 *    `NoCoverage`. Es la que acota la memoria del proceso y la que decide si un
 *    bloqueo viejo sigue castigando a alguien que ya esperó.
 *  - Los **bordes exactos** (justo en `resetAfterMs`, justo en `lockedUntil`)
 *    quedaban sin fijar, así que un `>` que pasara a `>=` no rompía nada. En un
 *    control anti-fuerza-bruta el borde es justo lo que un atacante busca.
 *  - Que dos instancias **no compartan contadores** está escrito en el módulo
 *    como garantía («los del login y los del PIN no se mezclan») y no lo
 *    comprobaba nadie.
 *
 * El reloj se inyecta (`now`) en vez de usar temporizadores falsos: la fábrica ya
 * lo acepta y así los bordes se fijan al milisegundo, sin depender del scheduler.
 */
const OPTS = {
  failureThreshold: 3,
  baseLockoutMs: 60_000,
  maxLockoutMs: 240_000,
  resetAfterMs: 600_000,
};

/** Lleva al sujeto justo hasta el umbral (primer bloqueo aplicado). */
function hastaBloquear(lockout: ReturnType<typeof createAttemptLockout>, sujeto: string, now: number) {
  for (let i = 0; i < OPTS.failureThreshold; i++) lockout.recordFailure(sujeto, now);
}

describe('createAttemptLockout — contrato de la fábrica', () => {
  describe('purga por inactividad al consultar (retryAfterSec)', () => {
    it('olvida al sujeto pasado el periodo de inactividad, y el siguiente fallo arranca de cero', () => {
      const lockout = createAttemptLockout(OPTS);
      const t0 = 1_000_000;
      hastaBloquear(lockout, 'ana@casa.test', t0);
      expect(lockout.retryAfterSec('ana@casa.test', t0)).toBe(OPTS.baseLockoutMs / 1000);

      // Mucho después: la consulta no solo devuelve 0, **borra** la entrada.
      const despues = t0 + OPTS.resetAfterMs + 1;
      expect(lockout.retryAfterSec('ana@casa.test', despues)).toBe(0);

      // Que de verdad se olvidó se comprueba por su efecto: si el contador
      // siguiera en 3, el primer fallo nuevo bloquearía de inmediato. Arranca
      // de cero → no bloquea.
      expect(lockout.recordFailure('ana@casa.test', despues)).toBe(0);
    });

    it('en el borde exacto del periodo NO olvida (el corte es estrictamente mayor)', () => {
      const lockout = createAttemptLockout(OPTS);
      const t0 = 1_000_000;
      hastaBloquear(lockout, 'bea@casa.test', t0);

      // Justo en `resetAfterMs` la entrada sigue viva: un atacante que espera
      // exactamente el periodo no debe encontrar el contador limpio.
      const borde = t0 + OPTS.resetAfterMs;
      expect(lockout.retryAfterSec('bea@casa.test', borde)).toBe(0); // el bloqueo ya expiró…
      // …pero el CONTADOR no: el siguiente fallo es el 4º y bloquea más tiempo.
      expect(lockout.recordFailure('bea@casa.test', borde)).toBe((OPTS.baseLockoutMs * 2) / 1000);
    });
  });

  describe('bordes del bloqueo', () => {
    it('en el instante exacto de expiración ya no bloquea', () => {
      const lockout = createAttemptLockout(OPTS);
      const t0 = 500_000;
      hastaBloquear(lockout, 'cris@casa.test', t0);

      const unMsAntes = t0 + OPTS.baseLockoutMs - 1;
      expect(lockout.retryAfterSec('cris@casa.test', unMsAntes)).toBe(1);

      // `lockedUntil > now` es estricto: justo al cumplirse, se puede reintentar.
      const justo = t0 + OPTS.baseLockoutMs;
      expect(lockout.retryAfterSec('cris@casa.test', justo)).toBe(0);
    });

    it('acumula fallos separados exactamente por el periodo de inactividad', () => {
      const lockout = createAttemptLockout(OPTS);
      const t0 = 200_000;
      lockout.recordFailure('dani@casa.test', t0);
      lockout.recordFailure('dani@casa.test', t0 + OPTS.resetAfterMs);
      // Dos fallos acumulados: el tercero alcanza el umbral y bloquea.
      expect(lockout.recordFailure('dani@casa.test', t0 + OPTS.resetAfterMs)).toBe(
        OPTS.baseLockoutMs / 1000,
      );
    });

    it('el backoff dobla pero topa en maxLockoutMs', () => {
      const lockout = createAttemptLockout(OPTS);
      expect(lockout.lockoutMsForFailures(OPTS.failureThreshold - 1)).toBe(0);
      expect(lockout.lockoutMsForFailures(OPTS.failureThreshold)).toBe(OPTS.baseLockoutMs);
      expect(lockout.lockoutMsForFailures(OPTS.failureThreshold + 1)).toBe(OPTS.baseLockoutMs * 2);
      expect(lockout.lockoutMsForFailures(OPTS.failureThreshold + 2)).toBe(OPTS.maxLockoutMs);
      // Muy por encima sigue topado (no desborda ni crece sin fin).
      expect(lockout.lockoutMsForFailures(500)).toBe(OPTS.maxLockoutMs);
    });
  });

  describe('aislamiento entre instancias', () => {
    it('dos lockouts no comparten contadores (login y PIN de la alarma)', () => {
      const login = createAttemptLockout(OPTS);
      const pin = createAttemptLockout(OPTS);
      const t0 = 42_000;

      hastaBloquear(login, 'eva@casa.test', t0);
      expect(login.retryAfterSec('eva@casa.test', t0)).toBeGreaterThan(0);
      // El mismo sujeto en la otra instancia está limpio: fallar el login no
      // puede dejar a nadie sin poder desarmar la alarma, ni al revés.
      expect(pin.retryAfterSec('eva@casa.test', t0)).toBe(0);
    });

    it('reset() vacía solo su propio registro', () => {
      const login = createAttemptLockout(OPTS);
      const pin = createAttemptLockout(OPTS);
      const t0 = 42_000;
      hastaBloquear(login, 'fran@casa.test', t0);
      hastaBloquear(pin, 'fran@casa.test', t0);

      login.reset();
      expect(login.retryAfterSec('fran@casa.test', t0)).toBe(0);
      expect(pin.retryAfterSec('fran@casa.test', t0)).toBeGreaterThan(0);
    });
  });

  describe('normalización del sujeto', () => {
    it('ignora mayúsculas y espacios alrededor', () => {
      const lockout = createAttemptLockout(OPTS);
      const t0 = 7_000;
      hastaBloquear(lockout, '  Eva@Casa.test ', t0);
      expect(lockout.retryAfterSec('eva@casa.test', t0)).toBeGreaterThan(0);
      expect(lockout.retryAfterSec('EVA@CASA.TEST', t0)).toBeGreaterThan(0);
    });

    it('sujetos distintos no se contagian el bloqueo', () => {
      const lockout = createAttemptLockout(OPTS);
      const t0 = 7_000;
      hastaBloquear(lockout, 'uno@casa.test', t0);
      expect(lockout.retryAfterSec('dos@casa.test', t0)).toBe(0);
    });
  });
});
