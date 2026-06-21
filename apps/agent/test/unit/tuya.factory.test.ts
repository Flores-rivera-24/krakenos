import { describe, expect, it } from 'vitest';
import { MockIotManager, TuyaIotManager, createIotManager } from '../../src/iot/index.js';

describe('createIotManager — tuya', () => {
  it('IOT_KIND=tuya instancia un TuyaIotManager', () => {
    const iot = createIotManager({ kind: 'tuya', tuya: { configPath: '/tmp/krakenos-tuya.json' } });
    expect(iot.manager).toBeInstanceOf(TuyaIotManager);
  });

  it('IOT_KIND=tuya expone el tuyaStore compartido en el bundle (US-63)', () => {
    const iot = createIotManager({ kind: 'tuya', tuya: { configPath: '/tmp/krakenos-tuya.json' } });
    expect(iot.tuyaStore).toBeDefined();
  });

  it('IOT_KIND=mock sigue devolviendo un MockIotManager y sin tuyaStore', () => {
    const iot = createIotManager({ kind: 'mock' });
    expect(iot.manager).toBeInstanceOf(MockIotManager);
    expect(iot.tuyaStore).toBeUndefined();
  });
});
