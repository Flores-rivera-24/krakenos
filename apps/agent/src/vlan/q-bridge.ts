import { assertVlanName, assertVlanTag } from '../privileged/validators.js';
import type { SnmpVarbind } from './snmp.transport.js';

/**
 * Builders **puros** de varbinds SNMP para la gestión de VLANs 802.1Q vía
 * Q-BRIDGE-MIB (`dot1qVlanStaticTable`). No ejecutan nada: devuelven los
 * varbinds que el `SnmpTransport` aplicará al switch. El índice de fila es el
 * propio `tag` de VLAN.
 */

/** `dot1qVlanStaticName` (OCTET STRING): nombre de la VLAN. */
const DOT1Q_VLAN_STATIC_NAME = '1.3.6.1.2.1.17.7.1.4.3.1.1';
/** `dot1qVlanStaticRowStatus` (RowStatus): alta/baja de la fila de VLAN. */
const DOT1Q_VLAN_STATIC_ROW_STATUS = '1.3.6.1.2.1.17.7.1.4.3.1.5';

/** Valores de RowStatus (RFC 2579) usados para crear/borrar VLANs. */
export const RowStatus = {
  active: 1,
  createAndGo: 4,
  destroy: 6,
} as const;

export function vlanNameOid(tag: number): string {
  return `${DOT1Q_VLAN_STATIC_NAME}.${assertVlanTag(tag)}`;
}

export function vlanRowStatusOid(tag: number): string {
  return `${DOT1Q_VLAN_STATIC_ROW_STATUS}.${assertVlanTag(tag)}`;
}

/** Varbinds para crear una VLAN (createAndGo) y fijar su nombre. */
export function createVlanVarbinds(tag: number, name: string): SnmpVarbind[] {
  return [
    { oid: vlanRowStatusOid(tag), type: 'Integer', value: RowStatus.createAndGo },
    { oid: vlanNameOid(tag), type: 'OctetString', value: assertVlanName(name) },
  ];
}

/** Varbinds para renombrar una VLAN existente. */
export function renameVlanVarbinds(tag: number, name: string): SnmpVarbind[] {
  return [{ oid: vlanNameOid(tag), type: 'OctetString', value: assertVlanName(name) }];
}

/** Varbinds para destruir una VLAN (destroy). */
export function destroyVlanVarbinds(tag: number): SnmpVarbind[] {
  return [{ oid: vlanRowStatusOid(tag), type: 'Integer', value: RowStatus.destroy }];
}
