import { describe, expect, it } from 'vitest';
import { MockIotManager, TuyaIotManager, createIotManager } from '../../src/iot/index.js';

describe('createIotManager — tuya', () => {
  it('IOT_KIND=tuya instancia un TuyaIotManager', () => {
    const iot = createIotManager({ kind: 'tuya', tuya: { configPath: '/tmp/krakenos-tuya.json' } });
    expect(iot).toBeInstanceOf(TuyaIotManager);
  });

  it('IOT_KIND=mock sigue devolviendo un MockIotManager', () => {
    expect(createIotManager({ kind: 'mock' })).toBeInstanceOf(MockIotManager);
  });
});
