import { randomUUID } from 'node:crypto';
import type {
  CreateVlanRequest,
  UpdateVlanRequest,
  Vlan,
  VlanManager,
} from '@krakenos/types';

/** Error de dominio de VLANs con código estable. */
export class VlanError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Gestor de VLANs en memoria para desarrollo. Mantiene las definiciones de
 * segmentos 802.1Q sin tocar el switch/router real. Sembrado con una red
 * principal y dos VLANs aisladas (IoT, invitados).
 */
export class MockVlanManager implements VlanManager {
  readonly kind = 'mock' as const;
  private readonly vlans = new Map<string, Vlan>();
  private seq = 0;

  constructor() {
    const seed: Omit<Vlan, 'id' | 'createdAt'>[] = [
      { tag: 1, name: 'Principal', subnet: '10.0.0.0/24', isolated: false },
      { tag: 30, name: 'IoT', subnet: '10.0.30.0/24', isolated: true },
      { tag: 40, name: 'Invitados', subnet: '10.0.40.0/24', isolated: true },
    ];
    for (const v of seed) this.insert(v);
  }

  private insert(input: Omit<Vlan, 'id' | 'createdAt'>): Vlan {
    const vlan: Vlan = {
      ...input,
      id: randomUUID(),
      // Timestamp determinista y creciente, sin depender del reloj.
      createdAt: new Date(++this.seq * 1000).toISOString(),
    };
    this.vlans.set(vlan.id, vlan);
    return vlan;
  }

  async listVlans(): Promise<Vlan[]> {
    return [...this.vlans.values()].sort((a, b) => a.tag - b.tag);
  }

  async getVlan(id: string): Promise<Vlan | null> {
    return this.vlans.get(id) ?? null;
  }

  async getByTag(tag: number): Promise<Vlan | null> {
    return [...this.vlans.values()].find((v) => v.tag === tag) ?? null;
  }

  async createVlan(input: CreateVlanRequest): Promise<Vlan> {
    if (await this.getByTag(input.tag)) {
      throw new VlanError('VLAN_TAG_TAKEN', `El tag ${input.tag} ya está en uso`);
    }
    return this.insert({
      tag: input.tag,
      name: input.name,
      subnet: input.subnet ?? null,
      isolated: input.isolated ?? false,
    });
  }

  async updateVlan(id: string, patch: UpdateVlanRequest): Promise<Vlan | null> {
    const current = this.vlans.get(id);
    if (!current) return null;
    const next: Vlan = { ...current, ...patch };
    this.vlans.set(id, next);
    return next;
  }

  async removeVlan(id: string): Promise<boolean> {
    return this.vlans.delete(id);
  }
}
