import { describe, expect, it } from 'vitest';
import { DriverUnavailableError, wrapDriverErrors } from '../../src/drivers/driver-error.js';
import { MockDriver } from '../../src/drivers/mock.driver.js';
import { FailingDriver } from '../helpers/failing-driver.js';

describe('wrapDriverErrors (US-98)', () => {
  it('DriverUnavailableError lleva statusCode 502 y code estable', () => {
    const err = new DriverUnavailableError('scanArp');
    expect(err.statusCode).toBe(502);
    expect(err.code).toBe('DRIVER_UNAVAILABLE');
    expect(err.message).toMatch(/scanArp/);
  });

  it('pasa por los valores no-función sin tocar (kind)', () => {
    const wrapped = wrapDriverErrors(new MockDriver());
    expect(wrapped.kind).toBe('mock');
  });

  it('deja pasar las llamadas con éxito tal cual', async () => {
    const wrapped = wrapDriverErrors(new MockDriver());
    expect(await wrapped.healthcheck()).toBe(true);
    expect(await wrapped.getWifi()).toHaveProperty('ssid');
  });

  it('traduce un rechazo del driver en DriverUnavailableError, conservando la causa', async () => {
    const wrapped = wrapDriverErrors(new FailingDriver('throw'));
    await expect(wrapped.scanArp()).rejects.toBeInstanceOf(DriverUnavailableError);
    try {
      await wrapped.getWifi();
      throw new Error('debería haber lanzado');
    } catch (err) {
      expect(err).toBeInstanceOf(DriverUnavailableError);
      expect((err as DriverUnavailableError).statusCode).toBe(502);
      expect((err as DriverUnavailableError).cause).toBeInstanceOf(Error);
    }
  });

  it('traduce también un timeout (rechazo diferido)', async () => {
    const wrapped = wrapDriverErrors(new FailingDriver('timeout', { timeoutMs: 5 }));
    await expect(wrapped.getTrafficSample()).rejects.toBeInstanceOf(DriverUnavailableError);
  });
});
