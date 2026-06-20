import { describe, expect, it } from 'vitest';
import {
  configureBlockMacCommand,
  removeBlockMacCommand,
  showArpCommand,
  showInterfacesCommand,
  showMacAddressTableCommand,
  showVersionCommand,
  showVlanCommand,
  toCiscoMac,
} from '../../src/drivers/cisco-ios.commands.js';

describe('cisco-ios.commands', () => {
  it('showArpCommand', () => {
    expect(showArpCommand()).toBe('show arp');
  });

  it('showMacAddressTableCommand', () => {
    expect(showMacAddressTableCommand()).toBe('show mac address-table');
  });

  it('showInterfacesCommand interpola la interfaz', () => {
    expect(showInterfacesCommand('GigabitEthernet0/0')).toBe(
      'show interfaces GigabitEthernet0/0',
    );
  });

  it('showVersionCommand', () => {
    expect(showVersionCommand()).toBe('show version');
  });

  it('showVlanCommand', () => {
    expect(showVlanCommand()).toBe('show vlan brief');
  });

  it('configureBlockMacCommand devuelve la secuencia con la MAC en formato Cisco', () => {
    expect(configureBlockMacCommand('aa:bb:cc:dd:ee:ff', '10')).toEqual([
      'configure terminal',
      'mac address-table static aabb.ccdd.eeff vlan 10 drop',
      'end',
    ]);
    // toCiscoMac valida la longitud.
    expect(() => configureBlockMacCommand('aa:bb', '1')).toThrow(/MAC inválida/);
  });

  it('removeBlockMacCommand antepone "no" a la entrada estática', () => {
    expect(removeBlockMacCommand('AA:BB:CC:DD:EE:FF', '1')).toEqual([
      'configure terminal',
      'no mac address-table static aabb.ccdd.eeff vlan 1 drop',
      'end',
    ]);
    expect(toCiscoMac('aabbccddeeff')).toBe('aabb.ccdd.eeff');
  });
});
