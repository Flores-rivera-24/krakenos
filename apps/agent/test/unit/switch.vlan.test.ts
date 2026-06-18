import { beforeEach, describe, expect, it } from 'vitest';
import type { Vlan } from '@krakenos/types';
import { MemoryJsonStore } from '../../src/store/json-store.js';
import { VlanError } from '../../src/vlan/mock.vlan.js';
import type { SnmpTransport, SnmpVarbind } from '../../src/vlan/snmp.transport.js';
import { SwitchVlanManager } from '../../src/vlan/switch.vlan.js';

/** Transporte SNMP falso: registra los SET y puede simular un rechazo del switch. */
class FakeSnmp implements SnmpTransport {
  sets: SnmpVarbind[][] = [];
  failNext = false;
  async set(varbinds: SnmpVarbind[]): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('switch rechazó el SET');
    }
    this.sets.push(varbinds);
  }
}

describe('SwitchVlanManager', () => {
  let snmp: FakeSnmp;
  let store: MemoryJsonStore<Vlan>;
  let vlans: SwitchVlanManager;

  beforeEach(() => {
    snmp = new FakeSnmp();
    store = new MemoryJsonStore<Vlan>();
    vlans = new SwitchVlanManager({ store, snmp, now: () => 1_700_000_000_000 });
  });

  it('crea una VLAN: aplica SNMP createAndGo y la persiste', async () => {
    const vlan = await vlans.createVlan({ tag: 30, name: 'IoT', subnet: '10.0.30.0/24', isolated: true });
    expect(vlan).toMatchObject({ tag: 30, name: 'IoT', subnet: '10.0.30.0/24', isolated: true });
    expect(vlan.createdAt).toBe(new Date(1_700_000_000_000).toISOString());
    // Aplicó el SET con RowStatus createAndGo (4).
    expect(snmp.sets[0]![0]).toMatchObject({ value: 4 });
    expect(await store.get(vlan.id)).not.toBeNull();
  });

  it('rechaza un tag duplicado sin tocar el switch', async () => {
    await vlans.createVlan({ tag: 30, name: 'IoT' });
    snmp.sets = [];
    await expect(vlans.createVlan({ tag: 30, name: 'Otra' })).rejects.toBeInstanceOf(VlanError);
    expect(snmp.sets).toHaveLength(0);
  });

  it('no persiste si el switch rechaza el alta', async () => {
    snmp.failNext = true;
    await expect(vlans.createVlan({ tag: 40, name: 'Invitados' })).rejects.toThrow(/switch/);
    expect(await vlans.listVlans()).toHaveLength(0);
  });

  it('lista por tag y resuelve por tag', async () => {
    await vlans.createVlan({ tag: 40, name: 'B' });
    await vlans.createVlan({ tag: 10, name: 'A' });
    expect((await vlans.listVlans()).map((v) => v.tag)).toEqual([10, 40]);
    expect((await vlans.getByTag(40))!.name).toBe('B');
  });

  it('renombra vía SNMP solo si cambia el nombre', async () => {
    const v = await vlans.createVlan({ tag: 30, name: 'IoT' });
    snmp.sets = [];
    await vlans.updateVlan(v.id, { isolated: true }); // sin cambio de nombre → no SNMP
    expect(snmp.sets).toHaveLength(0);
    await vlans.updateVlan(v.id, { name: 'IoT-2' });
    expect(snmp.sets[0]![0]).toMatchObject({ oid: '1.3.6.1.2.1.17.7.1.4.3.1.1.30' });
    expect((await vlans.getVlan(v.id))!.name).toBe('IoT-2');
  });

  it('borra: aplica SNMP destroy y devuelve false si no existe', async () => {
    const v = await vlans.createVlan({ tag: 30, name: 'IoT' });
    snmp.sets = [];
    expect(await vlans.removeVlan(v.id)).toBe(true);
    expect(snmp.sets[0]![0]).toMatchObject({ value: 6 }); // destroy
    expect(await vlans.removeVlan('no-existe')).toBe(false);
  });
});
