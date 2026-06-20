import type { Id, IsoDateTime } from './common.js';

/** Implementaciones de gestor de VLANs disponibles. */
export type VlanKind = 'mock' | 'switch' | 'cisco';

/**
 * VLAN (segmento de red 802.1Q). El `tag` (1-4094) es la clave natural por la
 * que se asignan los dispositivos.
 */
export interface Vlan {
  id: Id;
  /** ID de VLAN 802.1Q (1-4094), único. */
  tag: number;
  name: string;
  /** Subred en notación CIDR, p. ej. `10.0.30.0/24`; `null` si no se define. */
  subnet: string | null;
  /** `true` si la VLAN está aislada del resto de la red. */
  isolated: boolean;
  createdAt: IsoDateTime;
}

/** VLAN con el número de dispositivos asignados (para listados). */
export interface VlanWithCount extends Vlan {
  deviceCount: number;
}

export interface CreateVlanRequest {
  tag: number;
  name: string;
  subnet?: string | null;
  /** Por defecto `false`. */
  isolated?: boolean;
}

/** Cambios parciales aplicables a una VLAN existente (el `tag` no se cambia). */
export interface UpdateVlanRequest {
  name?: string;
  subnet?: string | null;
  isolated?: boolean;
}

/**
 * Gestor de VLANs intercambiable. La implementación real (`switch`) configura
 * el switch/router gestionado vía su API o un helper privilegiado; `mock`
 * mantiene las definiciones en memoria.
 */
export interface VlanManager {
  listVlans(): Promise<Vlan[]>;
  getVlan(id: Id): Promise<Vlan | null>;
  /** Busca por tag 802.1Q; `null` si no existe. */
  getByTag(tag: number): Promise<Vlan | null>;
  /** Crea una VLAN. Lanza si el `tag` ya está en uso. */
  createVlan(input: CreateVlanRequest): Promise<Vlan>;
  updateVlan(id: Id, patch: UpdateVlanRequest): Promise<Vlan | null>;
  removeVlan(id: Id): Promise<boolean>;
}
