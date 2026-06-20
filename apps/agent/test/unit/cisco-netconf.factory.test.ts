import { describe, expect, it } from 'vitest';
import { CiscoNetconfDriver, createDriver } from '../../src/drivers/index.js';

const CFG = {
  interface: 'GigabitEthernet1',
  netconf: { host: '192.168.1.254', username: 'admin', password: 'x' },
} as const;

describe('createDriver — cisco-netconf', () => {
  it('construye un CiscoNetconfDriver con su configuración NETCONF', () => {
    const driver = createDriver({ kind: 'cisco-netconf', ciscoNetconf: CFG });
    expect(driver).toBeInstanceOf(CiscoNetconfDriver);
    expect(driver.kind).toBe('cisco-netconf');
  });

  it('lanza si falta la configuración o el host NETCONF', () => {
    expect(() => createDriver({ kind: 'cisco-netconf' })).toThrow(/Cisco NETCONF/);
    expect(() =>
      createDriver({ kind: 'cisco-netconf', ciscoNetconf: { ...CFG, netconf: { ...CFG.netconf, host: '' } } }),
    ).toThrow(/CISCO_NETCONF_HOST/);
  });
});
