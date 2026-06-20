import { toCiscoMac } from './cisco-ios.commands.js';

/**
 * Builders **puros** de NETCONF para IOS-XE: filtros `<get>` (modelos YANG
 * operacionales) y configuraciones `<edit-config>` (ACL de bloqueo). Devuelven
 * el XML que el `NetconfTransport` enviará; no tocan la red.
 */

/** Nombre de la ACL de KrakenOS para el bloqueo por MAC. */
export const BLOCK_ACL_NAME = 'KRAKENOS-BLOCK';

/** Filtro para la tabla ARP operacional (`Cisco-IOS-XE-arp-oper`). */
export function arpFilter(): string {
  return '<arp-data xmlns="http://cisco.com/ns/yang/Cisco-IOS-XE-arp-oper"/>';
}

/** Filtro para los contadores de interfaces (`Cisco-IOS-XE-interfaces-oper`). */
export function interfacesFilter(): string {
  return '<interfaces xmlns="http://cisco.com/ns/yang/Cisco-IOS-XE-interfaces-oper"/>';
}

/**
 * `edit-config` que añade una ACL MAC que descarta el tráfico de una MAC. El
 * `operation` por defecto (`merge`) crea/actualiza la regla.
 */
export function blockMacConfig(mac: string): string {
  const m = toCiscoMac(mac);
  return [
    '<acl xmlns="http://cisco.com/ns/yang/Cisco-IOS-XE-acl">',
    `<access-list-mac><name>${BLOCK_ACL_NAME}</name>`,
    `<access-list-entries-mac><ace-rule><sequence>10</sequence>`,
    `<action>deny</action><source-mac>${m}</source-mac></ace-rule></access-list-entries-mac>`,
    '</access-list-mac></acl>',
  ].join('');
}

/** `edit-config` que elimina (operation="delete") la regla de bloqueo de la MAC. */
export function unblockMacConfig(mac: string): string {
  const m = toCiscoMac(mac);
  return [
    '<acl xmlns="http://cisco.com/ns/yang/Cisco-IOS-XE-acl">',
    `<access-list-mac><name>${BLOCK_ACL_NAME}</name>`,
    `<access-list-entries-mac xmlns:nc="urn:ietf:params:xml:ns:netconf:base:1.0" nc:operation="delete">`,
    `<ace-rule><sequence>10</sequence><source-mac>${m}</source-mac></ace-rule>`,
    '</access-list-entries-mac></access-list-mac></acl>',
  ].join('');
}
