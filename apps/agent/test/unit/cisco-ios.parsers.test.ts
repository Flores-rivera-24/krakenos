import { describe, expect, it } from 'vitest';
import {
  normalizeCiscoMac,
  parseArp,
  parseInterfaces,
  parseMacTable,
  parseVersion,
  parseVlan,
} from '../../src/drivers/cisco-ios.parsers.js';

const ARP = `Protocol  Address          Age (min)  Hardware Addr   Type   Interface
Internet  192.168.1.1             -   0011.2233.4455  ARPA   GigabitEthernet0/0
Internet  192.168.1.10           12   aabb.ccdd.eeff  ARPA   GigabitEthernet0/1
Internet  192.168.1.99            5   Incomplete      ARPA`;

const MAC_TABLE = `          Mac Address Table
-------------------------------------------

Vlan    Mac Address       Type        Ports
----    -----------       --------    -----
   1    0011.2233.4455    DYNAMIC     Gi0/1
  10    1122.3344.5566    STATIC      Gi0/3
All    0100.0ccc.cccc    STATIC      CPU`;

const INTERFACES = `GigabitEthernet0/0 is up, line protocol is up
  Hardware is Gigabit Ethernet, address is 0011.2233.4455
  5 minute input rate 1000 bits/sec, 2 packets/sec
  5 minute output rate 2000 bits/sec, 3 packets/sec
     123456 packets input, 789012345 bytes, 0 no buffer
     234567 packets output, 456789012 bytes, 0 underruns`;

const VERSION = `Cisco IOS Software, C2960 Software (C2960-LANBASEK9-M), Version 15.0(2)SE11, RELEASE SOFTWARE (fc3)
Technical Support: http://www.cisco.com/techsupport
ROM: Bootstrap program is C2960 boot loader

cisco WS-C2960-24TT-L (PowerPC405) processor (revision R0) with 65536K bytes of memory.
SW1 uptime is 5 weeks, 2 days, 3 hours, 14 minutes`;

const VLAN = `VLAN Name                             Status    Ports
---- -------------------------------- --------- ---------------------------
1    default                          active    Gi0/1, Gi0/2
10   Servers                          active    Gi0/3
20   IoT                              act/lshut`;

describe('cisco-ios.parsers', () => {
  it('normalizeCiscoMac normaliza xxxx.xxxx.xxxx → xx:xx:xx:xx:xx:xx', () => {
    expect(normalizeCiscoMac('AaBb.Ccdd.Eeff')).toBe('aa:bb:cc:dd:ee:ff');
    expect(normalizeCiscoMac('0011.2233.4455')).toBe('00:11:22:33:44:55');
    expect(() => normalizeCiscoMac('zzzz.zzzz.zzzz')).toThrow(/inválida/);
  });

  it('parseArp normaliza MACs y descarta entradas incompletas', () => {
    expect(parseArp(ARP)).toEqual([
      { ip: '192.168.1.1', mac: '00:11:22:33:44:55', interface: 'GigabitEthernet0/0' },
      { ip: '192.168.1.10', mac: 'aa:bb:cc:dd:ee:ff', interface: 'GigabitEthernet0/1' },
    ]);
  });

  it('parseMacTable lee VLAN/MAC/tipo/puerto y salta cabeceras y multicast', () => {
    expect(parseMacTable(MAC_TABLE)).toEqual([
      { vlan: '1', mac: '00:11:22:33:44:55', type: 'DYNAMIC', ports: 'Gi0/1' },
      { vlan: '10', mac: '11:22:33:44:55:66', type: 'STATIC', ports: 'Gi0/3' },
    ]);
  });

  it('parseInterfaces extrae bytes rx/tx', () => {
    expect(parseInterfaces(INTERFACES)).toEqual({ rxBytes: 789012345, txBytes: 456789012 });
    // Interfaz sin tráfico todavía.
    expect(parseInterfaces('GigabitEthernet0/1 is up')).toEqual({ rxBytes: 0, txBytes: 0 });
  });

  it('parseVersion extrae modelo, versión IOS y uptime', () => {
    expect(parseVersion(VERSION)).toEqual({
      model: 'WS-C2960-24TT-L',
      iosVersion: '15.0(2)SE11',
      uptime: '5 weeks, 2 days, 3 hours, 14 minutes',
    });
  });

  it('parseVlan lee id/nombre/estado', () => {
    expect(parseVlan(VLAN)).toEqual([
      { id: 1, name: 'default', status: 'active' },
      { id: 10, name: 'Servers', status: 'active' },
      { id: 20, name: 'IoT', status: 'act/lshut' },
    ]);
  });
});
