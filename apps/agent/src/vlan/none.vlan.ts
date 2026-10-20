import type { CreateVlanRequest, UpdateVlanRequest, Vlan, VlanManager } from '@krakenos/types';
import { DomainNotConfiguredError } from '../integrations/not-configured.js';

/** VLANs «sin configurar» (`VLAN_KIND=none`): sin VLANs; escribir es un 409. */
export class NoneVlanManager implements VlanManager {
  readonly kind = 'none' as const;
  readonly notConfigured = true as const;

  async listVlans(): Promise<Vlan[]> {
    return [];
  }

  async getVlan(_id: string): Promise<Vlan | null> {
    return null;
  }

  async getByTag(_tag: number): Promise<Vlan | null> {
    return null;
  }

  async createVlan(_input: CreateVlanRequest): Promise<Vlan> {
    throw new DomainNotConfiguredError('vlan');
  }

  async updateVlan(_id: string, _patch: UpdateVlanRequest): Promise<Vlan | null> {
    throw new DomainNotConfiguredError('vlan');
  }

  async removeVlan(_id: string): Promise<boolean> {
    throw new DomainNotConfiguredError('vlan');
  }
}
