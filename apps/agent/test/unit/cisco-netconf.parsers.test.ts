import { describe, expect, it } from 'vitest';
import {
  netconfArpToDevices,
  parseNetconfArp,
  parseNetconfInterface,
} from '../../src/drivers/cisco-netconf.parsers.js';

const ARP_XML = `<rpc-reply><data>
  <arp-data xmlns="http://cisco.com/ns/yang/Cisco-IOS-XE-arp-oper">
    <arp-vrf>
      <arp-oper>
        <address>192.168.1.1</address>
        <hardware>0011.2233.4455</hardware>
        <interface>GigabitEthernet1</interface>
      </arp-oper>
      <arp-oper>
        <address>192.168.1.10</address>
        <hardware>AABB.CCDD.EEFF</hardware>
        <interface>GigabitEthernet2</interface>
      </arp-oper>
    </arp-vrf>
  </arp-data>
</data></rpc-reply>`;

const IFACE_XML = `<rpc-reply><data>
  <interfaces xmlns="http://cisco.com/ns/yang/Cisco-IOS-XE-interfaces-oper">
    <interface>
      <name>GigabitEthernet1</name>
      <statistics><in-octets>789012345</in-octets><out-octets>456789012</out-octets></statistics>
    </interface>
  </interfaces>
</data></rpc-reply>`;

describe('cisco-netconf.parsers', () => {
  it('parseNetconfArp extrae ip/mac/interface y normaliza la MAC', () => {
    expect(parseNetconfArp(ARP_XML)).toEqual([
      { ip: '192.168.1.1', mac: '00:11:22:33:44:55', interface: 'GigabitEthernet1' },
      { ip: '192.168.1.10', mac: 'aa:bb:cc:dd:ee:ff', interface: 'GigabitEthernet2' },
    ]);
  });

  it('parseNetconfArp devuelve vacío sin entradas', () => {
    expect(parseNetconfArp('<data/>')).toEqual([]);
  });

  it('parseNetconfInterface extrae bytes rx/tx de la interfaz dada', () => {
    expect(parseNetconfInterface(IFACE_XML, 'GigabitEthernet1')).toEqual({
      rxBytes: 789012345,
      txBytes: 456789012,
    });
    // Interfaz inexistente → null.
    expect(parseNetconfInterface(IFACE_XML, 'GigabitEthernet9')).toBeNull();
  });

  it('netconfArpToDevices deduplica por MAC y marca source arp', () => {
    const devices = netconfArpToDevices(parseNetconfArp(ARP_XML));
    expect(devices).toEqual([
      { mac: '00:11:22:33:44:55', ip: '192.168.1.1', source: 'arp' },
      { mac: 'aa:bb:cc:dd:ee:ff', ip: '192.168.1.10', source: 'arp' },
    ]);
  });
});
