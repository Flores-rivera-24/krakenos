import { describe, expect, it } from 'vitest';
import { InvalidArgumentError } from '../../src/privileged/validators.js';
import {
  assignPortToVlanCommand,
  configureBlockMacCommand,
  createVlanCommand,
  deleteVlanCommand,
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

  it('createVlanCommand / deleteVlanCommand / assignPortToVlanCommand (US-38)', () => {
    expect(createVlanCommand(30, 'IoT')).toEqual([
      'configure terminal',
      'vlan 30',
      'name IoT',
      'exit',
      'end',
    ]);
    expect(deleteVlanCommand(30)).toEqual(['configure terminal', 'no vlan 30', 'end']);
    expect(assignPortToVlanCommand('GigabitEthernet0/5', 30)).toEqual([
      'configure terminal',
      'interface GigabitEthernet0/5',
      'switchport access vlan 30',
      'end',
    ]);
  });

  // --- Anti-inyección de CLI IOS: tag/nombre/puerto/VLAN se validan (US-73) ---
  describe('rechazo anti-inyección', () => {
    it('rechaza un nombre de VLAN con salto de línea (inyección de comando IOS)', () => {
      expect(() => createVlanCommand(30, 'IoT\nno vlan 1')).toThrow(InvalidArgumentError);
      expect(() => createVlanCommand(30, 'IoT\r\nshutdown')).toThrow(InvalidArgumentError);
    });

    it('rechaza un nombre de VLAN con espacios o metacaracteres', () => {
      expect(() => createVlanCommand(30, 'mi vlan')).toThrow(InvalidArgumentError);
      expect(() => createVlanCommand(30, 'IoT; reload')).toThrow(InvalidArgumentError);
    });

    it('rechaza un tag de VLAN fuera de rango', () => {
      expect(() => createVlanCommand(0, 'IoT')).toThrow(InvalidArgumentError);
      expect(() => deleteVlanCommand(5000)).toThrow(InvalidArgumentError);
    });

    it('rechaza un puerto Cisco con inyección de bandera o salto de línea', () => {
      expect(() => assignPortToVlanCommand('-x', 30)).toThrow(InvalidArgumentError);
      expect(() => assignPortToVlanCommand('Gi0/1\nshutdown', 30)).toThrow(InvalidArgumentError);
    });

    it('rechaza una VLAN de bloqueo no numérica (inyección en mac address-table)', () => {
      expect(() => configureBlockMacCommand('aa:bb:cc:dd:ee:ff', '1 drop\nreload')).toThrow(
        InvalidArgumentError,
      );
      expect(() => removeBlockMacCommand('aa:bb:cc:dd:ee:ff', 'abc')).toThrow(InvalidArgumentError);
    });
  });
});
