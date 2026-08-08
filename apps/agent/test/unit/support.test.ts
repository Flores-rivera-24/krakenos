import { describe, expect, it } from 'vitest';
import {
  buildTelemetry,
  PII_SETTING_KEYS,
  sanitizeSettings,
} from '../../src/modules/system/support.service.js';

describe('sanitizeSettings', () => {
  it('omite el nombre y la ubicación del hogar (PII), conserva el resto', () => {
    const clean = sanitizeSettings({
      homeName: 'Casa de Juan',
      homeLatitude: '40.4168',
      homeLongitude: '-3.7038',
      timezone: 'Europe/Madrid',
      scanIntervalSec: '60',
      telemetryEnabled: 'on',
    });
    expect(clean).toEqual({
      timezone: 'Europe/Madrid',
      scanIntervalSec: '60',
      telemetryEnabled: 'on',
    });
    // Ninguna clave PII sobrevive.
    for (const k of PII_SETTING_KEYS) expect(clean).not.toHaveProperty(k);
  });
});

describe('buildTelemetry', () => {
  const counts = { devices: 3, rooms: 2, scenes: 1, automations: 0, users: 2 };

  it('desactivada: sin recuentos (opt-in estricto)', () => {
    const t = buildTelemetry(false, '1.0.0', counts);
    expect(t).toEqual({ enabled: false, version: '1.0.0' });
    expect(t.counts).toBeUndefined();
  });

  it('activada: incluye los recuentos anónimos', () => {
    const t = buildTelemetry(true, '1.0.0', counts);
    expect(t).toEqual({ enabled: true, version: '1.0.0', counts });
  });
});
