/**
 * Builders de comandos **puros** para Cisco IOS / IOS-XE. No ejecutan nada:
 * devuelven la cadena (o secuencia) de CLI que el `CiscoTransport` correrá en el
 * switch/router. Aislarlos así los hace testeables sin hardware.
 */

/** Normaliza una MAC estándar (`xx:xx:xx:xx:xx:xx`) al formato Cisco `xxxx.xxxx.xxxx`. */
export function toCiscoMac(mac: string): string {
  const hex = mac.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  if (hex.length !== 12) throw new Error(`MAC inválida: ${mac}`);
  return `${hex.slice(0, 4)}.${hex.slice(4, 8)}.${hex.slice(8, 12)}`;
}

/** Tabla ARP del dispositivo. */
export function showArpCommand(): string {
  return 'show arp';
}

/** Tabla de direcciones MAC aprendidas por el switch. */
export function showMacAddressTableCommand(): string {
  return 'show mac address-table';
}

/** Detalle de una interfaz (incluye contadores rx/tx). */
export function showInterfacesCommand(iface: string): string {
  return `show interfaces ${iface}`;
}

/** Versión de software/hardware y uptime. */
export function showVersionCommand(): string {
  return 'show version';
}

/** Resumen de VLANs configuradas. */
export function showVlanCommand(): string {
  return 'show vlan brief';
}

/**
 * Secuencia para bloquear una MAC: entra en config, añade una entrada estática
 * `drop` en la VLAN indicada y sale. La MAC se emite en formato Cisco.
 */
export function configureBlockMacCommand(mac: string, vlan: string): string[] {
  return [
    'configure terminal',
    `mac address-table static ${toCiscoMac(mac)} vlan ${vlan} drop`,
    'end',
  ];
}

/** Secuencia para quitar la entrada estática `drop` de una MAC. */
export function removeBlockMacCommand(mac: string, vlan: string): string[] {
  return [
    'configure terminal',
    `no mac address-table static ${toCiscoMac(mac)} vlan ${vlan} drop`,
    'end',
  ];
}
