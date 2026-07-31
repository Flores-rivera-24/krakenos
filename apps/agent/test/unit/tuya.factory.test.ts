import { describe, expect, it } from 'vitest';
import type { CompositeIotManager } from '../../src/iot/index.js';
import { MockIotManager, TuyaIotManager, createIotManager } from '../../src/iot/index.js';

describe('createIotManager — tuya', () => {
  /** US-243: el backend va dentro del composite, que envuelve siempre. */
  function backendDe(config: Parameters<typeof createIotManager>[0]) {
    const { manager } = createIotManager(config);
    return (manager as CompositeIotManager).members[0]?.manager;
  }

  it('IOT_KIND=tuya instancia un TuyaIotManager', () => {
    expect(backendDe({ kind: 'tuya', tuya: { configPath: '/tmp/krakenos-tuya.json' } })).toBeInstanceOf(
      TuyaIotManager,
    );
  });

  it('IOT_KIND=tuya expone el tuyaStore compartido en el bundle (US-63)', () => {
    const iot = createIotManager({ kind: 'tuya', tuya: { configPath: '/tmp/krakenos-tuya.json' } });
    expect(iot.tuyaStore).toBeDefined();
  });

  it('IOT_KIND=mock sigue montando un MockIotManager y sin tuyaStore', () => {
    const iot = createIotManager({ kind: 'mock' });
    expect((iot.manager as CompositeIotManager).members[0]?.manager).toBeInstanceOf(MockIotManager);
    expect(iot.tuyaStore).toBeUndefined();
  });
});
