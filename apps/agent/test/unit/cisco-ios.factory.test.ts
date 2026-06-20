import { describe, expect, it } from 'vitest';
import { CiscoIosDriver, createDriver } from '../../src/drivers/index.js';

const CISCO = {
  interface: 'GigabitEthernet0/0',
  ssh: { host: '192.168.1.254', username: 'admin', password: 'x' },
} as const;

describe('createDriver — cisco-ios', () => {
  it('construye un CiscoIosDriver con su configuración SSH', () => {
    const driver = createDriver({ kind: 'cisco-ios', host: '192.168.1.254', ciscoIos: CISCO });
    expect(driver).toBeInstanceOf(CiscoIosDriver);
    expect(driver.kind).toBe('cisco-ios');
  });

  it('lanza si falta la configuración Cisco o el host SSH', () => {
    expect(() => createDriver({ kind: 'cisco-ios' })).toThrow(/Cisco IOS/);
    expect(() =>
      createDriver({ kind: 'cisco-ios', ciscoIos: { ...CISCO, ssh: { ...CISCO.ssh, host: '' } } }),
    ).toThrow(/DRIVER_HOST/);
  });
});
