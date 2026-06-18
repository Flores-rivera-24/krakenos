import { randomUUID } from 'node:crypto';
import type { CreateVlanRequest, UpdateVlanRequest, Vlan, VlanManager } from '@krakenos/types';
import type { JsonStore } from '../store/json-store.js';
import { VlanError } from './mock.vlan.js';
import { createVlanVarbinds, destroyVlanVarbinds, renameVlanVarbinds } from './q-bridge.js';
import type { SnmpTransport } from './snmp.transport.js';

export interface SwitchVlanOptions {
  store: JsonStore<Vlan>;
  snmp: SnmpTransport;
  /** Reloj inyectable (ms); por defecto `Date.now`. */
  now?: () => number;
}

/**
 * Gestor de VLANs real sobre un **switch gestionado** vía SNMP (Q-BRIDGE-MIB).
 * El `store` es la fuente de verdad de los metadatos (nombre/subred/aislamiento/
 * createdAt); cada alta/baja/renombrado se aplica al switch como un SET SNMP a
 * `dot1qVlanStaticTable` (RowStatus + nombre). Si el switch rechaza el cambio,
 * se propaga el error y **no** se persiste.
 *
 * Baseline: `subnet`/`isolated` son conceptos L3/firewall de KrakenOS y no se
 * empujan al switch (el switch solo gestiona la VLAN 802.1Q y su nombre).
 */
export class SwitchVlanManager implements VlanManager {
  readonly kind = 'switch' as const;
  private readonly now: () => number;

  constructor(private readonly opts: SwitchVlanOptions) {
    this.now = opts.now ?? Date.now;
  }

  async listVlans(): Promise<Vlan[]> {
    return (await this.opts.store.list()).sort((a, b) => a.tag - b.tag);
  }

  async getVlan(id: string): Promise<Vlan | null> {
    return this.opts.store.get(id);
  }

  async getByTag(tag: number): Promise<Vlan | null> {
    return (await this.opts.store.list()).find((v) => v.tag === tag) ?? null;
  }

  async createVlan(input: CreateVlanRequest): Promise<Vlan> {
    if (await this.getByTag(input.tag)) {
      throw new VlanError('VLAN_TAG_TAKEN', `El tag ${input.tag} ya está en uso`);
    }
    // Aplica primero en el switch; si falla, no se persiste.
    await this.opts.snmp.set(createVlanVarbinds(input.tag, input.name));
    const vlan: Vlan = {
      id: randomUUID(),
      tag: input.tag,
      name: input.name,
      subnet: input.subnet ?? null,
      isolated: input.isolated ?? false,
      createdAt: new Date(this.now()).toISOString(),
    };
    await this.opts.store.upsert(vlan);
    return vlan;
  }

  async updateVlan(id: string, patch: UpdateVlanRequest): Promise<Vlan | null> {
    const current = await this.opts.store.get(id);
    if (!current) return null;
    if (patch.name !== undefined && patch.name !== current.name) {
      await this.opts.snmp.set(renameVlanVarbinds(current.tag, patch.name));
    }
    const next: Vlan = { ...current, ...patch };
    await this.opts.store.upsert(next);
    return next;
  }

  async removeVlan(id: string): Promise<boolean> {
    const current = await this.opts.store.get(id);
    if (!current) return false;
    await this.opts.snmp.set(destroyVlanVarbinds(current.tag));
    await this.opts.store.removeById(id);
    return true;
  }
}
