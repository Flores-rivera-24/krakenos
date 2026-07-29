import { describe, expect, it } from 'vitest';
import {
  LOCK_TTL_MS,
  isLockStale,
  parseLock,
  processAlive,
  serializeLock,
} from '../../src/system/update-lock.js';

/**
 * Lock de «actualización en curso» (US-232 / AUD3-20).
 *
 * El fallo que estos tests atan: hasta ahora `inProgress` era un `existsSync`
 * pelado, y como el actualizador **moría en su propio `systemctl restart`**, el
 * lock quedaba huérfano y la UI decía «ya hay una actualización en curso» para
 * siempre. La protección es la caducidad (proceso muerto o TTL), así que hay un
 * caso por cada dirección: un lock vivo SÍ bloquea, uno huérfano NO.
 */

const NOW = Date.parse('2026-07-29T12:00:00.000Z');
const alive = () => true;
const dead = () => false;
const at = (ms: number) => () => ms;

describe('parseLock', () => {
  it('ida y vuelta del formato actual', () => {
    const lock = { version: '1.2.0', pid: 4242, startedAt: '2026-07-29T12:00:00.000Z' };
    expect(parseLock(serializeLock(lock))).toEqual(lock);
  });

  it('acepta el formato legado (texto sin PID) y lo marca con pid 0', () => {
    // Locks escritos antes de US-232: `<version>\n<iso>\n`. No hay PID que
    // comprobar, así que solo pueden caducar por edad.
    const parsed = parseLock('1.1.0\n2026-07-29T12:00:00.000Z\n');
    expect(parsed).toEqual({ version: '1.1.0', pid: 0, startedAt: '2026-07-29T12:00:00.000Z' });
  });

  it('devuelve null ante contenido irreconocible (patrón US-63)', () => {
    for (const raw of [
      '',
      '{ roto',
      'solo-una-linea\n',
      '1.1.0\nno-es-una-fecha\n',
      JSON.stringify({ version: '1.0.0' }),
      JSON.stringify({ version: '1.0.0', pid: 'no-es-numero', startedAt: NOW }),
      JSON.stringify({ version: '1.0.0', pid: 1, startedAt: 'ayer' }),
    ]) {
      expect(parseLock(raw), `debería rechazar «${raw}»`).toBeNull();
    }
  });
});

describe('isLockStale', () => {
  const fresh = { version: '1.2.0', pid: 4242, startedAt: new Date(NOW).toISOString() };

  it('sin lock → caduco (no hay nada que bloquee)', () => {
    expect(isLockStale(null, { isProcessAlive: alive, now: at(NOW) })).toBe(true);
  });

  it('lock reciente con el proceso VIVO → no caduco (bloquea de verdad)', () => {
    expect(isLockStale(fresh, { isProcessAlive: alive, now: at(NOW + 1000) })).toBe(false);
  });

  it('lock reciente con el proceso MUERTO → caduco (el caso de AUD3-20)', () => {
    expect(isLockStale(fresh, { isProcessAlive: dead, now: at(NOW + 1000) })).toBe(true);
  });

  it('lock más viejo que el TTL → caduco aunque el proceso viva (actualizador atascado)', () => {
    expect(isLockStale(fresh, { isProcessAlive: alive, now: at(NOW + LOCK_TTL_MS) })).toBe(true);
    expect(isLockStale(fresh, { isProcessAlive: alive, now: at(NOW + LOCK_TTL_MS - 1) })).toBe(false);
  });

  it('lock legado (sin PID): manda solo el TTL', () => {
    const legacy = { ...fresh, pid: 0 };
    // No se puede comprobar el proceso: no se declara caduco antes de tiempo…
    expect(isLockStale(legacy, { isProcessAlive: dead, now: at(NOW + 1000) })).toBe(false);
    // …pero la edad sigue caducándolo.
    expect(isLockStale(legacy, { isProcessAlive: dead, now: at(NOW + LOCK_TTL_MS) })).toBe(true);
  });

  it('el TTL es inyectable (para tests y ajustes futuros)', () => {
    expect(isLockStale(fresh, { isProcessAlive: alive, now: at(NOW + 50), ttlMs: 10 })).toBe(true);
  });
});

describe('processAlive', () => {
  it('reconoce el propio proceso', () => {
    expect(processAlive(process.pid)).toBe(true);
  });

  it('un PID inexistente no está vivo', () => {
    // Por encima de cualquier `pid_max` razonable de Linux (4194304) → ESRCH.
    expect(processAlive(2 ** 30)).toBe(false);
  });
});
