import type { WifiSecurity } from '@krakenos/types';

/**
 * Builders de comandos **puros** para OpenWrt. No ejecutan nada: devuelven la
 * cadena de shell que el `OpenWrtTransport` correrá en el router. Aislarlos así
 * los hace testeables sin hardware.
 */

/** MAC normalizada (minúsculas, `:`), o lanza si no es válida. */
export function normalizeMac(mac: string): string {
  const m = mac.trim().toLowerCase();
  if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(m)) {
    throw new Error(`MAC inválida: ${mac}`);
  }
  return m;
}

/** Tabla ARP del kernel (universal en Linux/OpenWrt). */
export const ARP_TABLE = 'cat /proc/net/arp';

/** Contadores por interfaz (rx/tx bytes acumulados). */
export const PROC_NET_DEV = 'cat /proc/net/dev';

/** Comando trivial para el healthcheck (uptime del kernel). */
export const UPTIME = 'cat /proc/uptime';

/** Concesiones DHCP de dnsmasq (hostnames); puede no existir. */
export const DHCP_LEASES = 'cat /tmp/dhcp.leases 2>/dev/null';

/** Vuelca la config inalámbrica en formato `uci show`. */
export const UCI_SHOW_WIRELESS = 'uci show wireless';

/** Hostname configurado del sistema. */
export const SYSTEM_HOSTNAME = 'uci -q get system.@system[0].hostname';

/** Lista de clientes asociados a una interfaz radio (vía iwinfo). */
export function iwinfoAssoc(ifname: string): string {
  return `iwinfo ${shellArg(ifname)} assoclist`;
}

/** Aplica un cambio UCI: `uci set wireless.<section>.<option>='<value>'`. */
export function uciSet(section: string, option: string, value: string): string {
  return `uci set wireless.${section}.${option}=${shellArg(value)}`;
}

/** Confirma los cambios pendientes de la config wireless. */
export const UCI_COMMIT_WIRELESS = 'uci commit wireless';

/** Recarga la configuración WiFi para aplicar los cambios. */
export const WIFI_RELOAD = 'wifi reload';

/**
 * Regla de bloqueo: descarta el reenvío del tráfico de una MAC. Usa la cadena
 * FORWARD vía `iptables` (compat iptables-nft en OpenWrt fw4). `-w` espera el
 * lock para evitar carreras.
 */
export function blockMacCommand(mac: string): string {
  const m = normalizeMac(mac);
  // `-C` evita duplicar la regla; si no existe, `-I` la inserta.
  return `iptables -w -C FORWARD -m mac --mac-source ${m} -j DROP 2>/dev/null || iptables -w -I FORWARD -m mac --mac-source ${m} -j DROP`;
}

/** Quita la regla de bloqueo de una MAC (idempotente). */
export function unblockMacCommand(mac: string): string {
  const m = normalizeMac(mac);
  return `iptables -w -D FORWARD -m mac --mac-source ${m} -j DROP 2>/dev/null || true`;
}

/** Mapea la seguridad de KrakenOS al valor `encryption` de UCI. */
export function uciEncryptionFromSecurity(security: WifiSecurity): string {
  switch (security) {
    case 'open':
      return 'none';
    case 'wpa2':
      return 'psk2';
    case 'wpa3':
      return 'sae';
    case 'wpa2/wpa3':
      return 'sae-mixed';
  }
}

/** Mapea la banda de KrakenOS al valor `band` de UCI (radio). */
export function uciBandFromBand(band: '2.4GHz' | '5GHz' | '6GHz'): string {
  switch (band) {
    case '2.4GHz':
      return '2g';
    case '5GHz':
      return '5g';
    case '6GHz':
      return '6g';
  }
}

/** Entrecomilla un argumento de shell de forma segura (comillas simples). */
export function shellArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
