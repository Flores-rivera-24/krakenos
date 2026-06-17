import { describe, expect, it } from 'vitest';
import { MockVlanManager, VlanError } from '../../src/vlan/mock.vlan.js';

describe('MockVlanManager', () => {
  it('arranca con VLANs de ejemplo ordenadas por tag', async () => {
    const mgr = new MockVlanManager();
    const vlans = await mgr.listVlans();
    expect(vlans.length).toBeGreaterThanOrEqual(2);
    const tags = vlans.map((v) => v.tag);
    expect(tags).toEqual([...tags].sort((a, b) => a - b));
  });

  it('busca por tag', async () => {
    const mgr = new MockVlanManager();
    const v = await mgr.getByTag(30);
    expect(v?.name).toBe('IoT');
    expect(await mgr.getByTag(999)).toBeNull();
  });

  it('crea una VLAN con valores por defecto', async () => {
    const mgr = new MockVlanManager();
    const vlan = await mgr.createVlan({ tag: 50, name: 'Cámaras' });
    expect(vlan.id).toBeTruthy();
    expect(vlan.subnet).toBeNull();
    expect(vlan.isolated).toBe(false);
    expect(await mgr.getByTag(50)).toEqual(vlan);
  });

  it('rechaza un tag duplicado', async () => {
    const mgr = new MockVlanManager();
    await expect(mgr.createVlan({ tag: 30, name: 'dup' })).rejects.toBeInstanceOf(VlanError);
  });

  it('actualiza y elimina; devuelve null/false si no existe', async () => {
    const mgr = new MockVlanManager();
    const vlan = await mgr.createVlan({ tag: 60, name: 'tmp' });
    const updated = await mgr.updateVlan(vlan.id, { isolated: true, name: 'renombrada' });
    expect(updated?.isolated).toBe(true);
    expect(updated?.name).toBe('renombrada');
    expect(await mgr.updateVlan('inexistente', { name: 'x' })).toBeNull();

    expect(await mgr.removeVlan(vlan.id)).toBe(true);
    expect(await mgr.removeVlan(vlan.id)).toBe(false);
  });
});
