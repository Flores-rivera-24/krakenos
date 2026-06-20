import { randomUUID } from 'node:crypto';
import type { CreateVlanRequest, UpdateVlanRequest, Vlan, VlanManager } from '@krakenos/types';
import {
  assignPortToVlanCommand,
  createVlanCommand,
  deleteVlanCommand,
} from '../drivers/cisco-ios.commands.js';
import { parseVlan } from '../drivers/cisco-ios.parsers.js';
import type { CiscoTransport } from '../drivers/cisco-ios.transport.js';
import type { JsonStore } from '../store/json-store.js';
import { VlanError } from './mock.vlan.js';

export interface CiscoVlanOptions {
  store: JsonStore<Vlan>;
  transport: CiscoTransport;
  /** Reloj inyectable (ms); por defecto `Date.now`. */
  now?: () => number;
}

/**
 * Gestor de VLANs real sobre un **switch/router Cisco IOS** vía SSH + CLI de IOS,
 * sobre el mismo `CiscoTransport` inyectable del driver `cisco-ios` (US-37). El
 * `store` es la fuente de verdad de los metadatos (nombre/subred/aislamiento/
 * createdAt); cada alta/baja/renombrado se aplica al switch con `configure
 * terminal` … `vlan <tag>`/`no vlan <tag>`. Si el switch rechaza el cambio se
 * propaga el error y **no** se persiste.
 *
 * `listVlans` complementa el store con `show vlan brief`: solo devuelve las VLANs
 * que el switch confirma que existen (si la consulta falla, cae al store). Como
 * en `SwitchVlanManager`, `subnet`/`isolated` son conceptos L3/firewall de
 * KrakenOS y no se empujan al switch.
 */
export class CiscoVlanManager implements VlanManager {
  readonly kind = 'cisco' as const;
  private readonly now: () => number;

  constructor(private readonly opts: CiscoVlanOptions) {
    this.now = opts.now ?? Date.now;
  }

  /** Tags presentes en el switch según `show vlan brief`, o `null` si no se pudo leer. */
  private async switchTags(): Promise<Set<number> | null> {
    try {
      const out = await this.opts.transport.execute('show vlan brief');
      return new Set(parseVlan(out).map((v) => v.id));
    } catch {
      return null;
    }
  }

  async listVlans(): Promise<Vlan[]> {
    const stored = (await this.opts.store.list()).sort((a, b) => a.tag - b.tag);
    const tags = await this.switchTags();
    // Si el switch responde, solo se listan las VLANs que confirma; si no, el store.
    return tags ? stored.filter((v) => tags.has(v.tag)) : stored;
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
    await this.opts.transport.executePrivileged(createVlanCommand(input.tag, input.name));
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
    // Renombrar en IOS es `vlan <tag>` + `name <nuevo>` (reusa createVlanCommand).
    if (patch.name !== undefined && patch.name !== current.name) {
      await this.opts.transport.executePrivileged(createVlanCommand(current.tag, patch.name));
    }
    const next: Vlan = { ...current, ...patch };
    await this.opts.store.upsert(next);
    return next;
  }

  async removeVlan(id: string): Promise<boolean> {
    const current = await this.opts.store.get(id);
    if (!current) return false;
    await this.opts.transport.executePrivileged(deleteVlanCommand(current.tag));
    await this.opts.store.removeById(id);
    return true;
  }

  /**
   * Asigna un puerto de acceso a una VLAN (`switchport access vlan`). Fuera del
   * contrato `VlanManager` porque KrakenOS no rastrea el puerto físico de cada
   * dispositivo; queda disponible para cuando se conozca el puerto (baseline).
   */
  async assignPortToVlan(port: string, tag: number): Promise<void> {
    await this.opts.transport.executePrivileged(assignPortToVlanCommand(port, tag));
  }
}
