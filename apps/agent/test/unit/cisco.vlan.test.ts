import type { Vlan } from '@krakenos/types';
import { beforeEach, describe, expect, it } from 'vitest';
import { MockCiscoTransport } from '../../src/drivers/cisco-ios.transport.js';
import { MemoryJsonStore } from '../../src/store/json-store.js';
import { CiscoVlanManager } from '../../src/vlan/cisco.vlan.js';

const VLAN_BRIEF = `VLAN Name                             Status    Ports
---- -------------------------------- --------- ---------------------------
1    default                          active    Gi0/1
30   IoT                              active    Gi0/3`;

describe('CiscoVlanManager', () => {
  let t: MockCiscoTransport;
  let store: MemoryJsonStore<Vlan>;
  let vlans: CiscoVlanManager;

  beforeEach(() => {
    t = new MockCiscoTransport().on('show vlan brief', VLAN_BRIEF);
    store = new MemoryJsonStore<Vlan>();
    vlans = new CiscoVlanManager({ store, transport: t, now: () => 1_700_000_000_000 });
  });

  it('createVlan aplica la secuencia IOS y persiste los metadatos', async () => {
    const vlan = await vlans.createVlan({ tag: 30, name: 'IoT', subnet: '10.0.30.0/24', isolated: true });
    expect(vlan).toMatchObject({ tag: 30, name: 'IoT', subnet: '10.0.30.0/24', isolated: true });
    expect(t.privileged[0]).toEqual([
      'configure terminal',
      'vlan 30',
      'name IoT',
      'exit',
      'end',
    ]);
    expect(await store.get(vlan.id)).not.toBeNull();
  });

  it('createVlan rechaza un tag ya en uso', async () => {
    await vlans.createVlan({ tag: 30, name: 'IoT' });
    await expect(vlans.createVlan({ tag: 30, name: 'Otra' })).rejects.toThrow(/ya está en uso/);
  });

  it('listVlans solo devuelve las VLANs que el switch confirma', async () => {
    await vlans.createVlan({ tag: 30, name: 'IoT' });
    await vlans.createVlan({ tag: 99, name: 'Fantasma' }); // no aparece en show vlan brief
    const listed = await vlans.listVlans();
    expect(listed.map((v) => v.tag)).toEqual([30]);
  });

  it('updateVlan renombra en el switch y persiste', async () => {
    const v = await vlans.createVlan({ tag: 30, name: 'IoT' });
    t.privileged.length = 0;
    const updated = await vlans.updateVlan(v.id, { name: 'Sensores' });
    expect(updated?.name).toBe('Sensores');
    expect(t.privileged[0]).toEqual(['configure terminal', 'vlan 30', 'name Sensores', 'exit', 'end']);
  });

  it('removeVlan borra la VLAN del switch y del store', async () => {
    const v = await vlans.createVlan({ tag: 30, name: 'IoT' });
    t.privileged.length = 0;
    expect(await vlans.removeVlan(v.id)).toBe(true);
    expect(t.privileged[0]).toEqual(['configure terminal', 'no vlan 30', 'end']);
    expect(await store.get(v.id)).toBeNull();
  });

  it('assignPortToVlan emite switchport access vlan', async () => {
    await vlans.assignPortToVlan('GigabitEthernet0/5', 30);
    expect(t.privileged[0]).toEqual([
      'configure terminal',
      'interface GigabitEthernet0/5',
      'switchport access vlan 30',
      'end',
    ]);
  });
});
