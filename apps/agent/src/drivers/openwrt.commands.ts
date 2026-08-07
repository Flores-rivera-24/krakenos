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

/**
 * ¿Está `nlbw` (cliente de nlbwmon) instalado en el router? (US-251).
 *
 * `command -v` es POSIX y lo trae el `ash` de BusyBox — `which` no está garantizado
 * en una imagen mínima de OpenWrt. Se responde por **stdout** y no por código de
 * salida porque el driver ya trata el código ≠ 0 como error de transporte, y aquí
 * «no está instalado» no es un fallo: es una respuesta.
 */
export const NLBW_PRESENT = 'command -v nlbw >/dev/null 2>&1 && echo si || echo no';

/**
 * Contadores acumulados por dispositivo, agrupados por MAC e IP (US-251).
 *
 * `nlbwmon` acumula por **periodo de contabilidad** (mensual por defecto), así que
 * esto son totales del periodo, no tasas: el driver deriva bytes/seg restando dos
 * lecturas, igual que hace con `/proc/net/dev`.
 */
export const NLBW_JSON = 'nlbw -c json -g mac,ip';

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
  const ipt = `iptables -w -C FORWARD -m mac --mac-source ${m} -j DROP 2>/dev/null || iptables -w -I FORWARD -m mac --mac-source ${m} -j DROP`;
  return `if command -v iptables >/dev/null 2>&1; then ${ipt}; else ${nftInsert(m)}; fi`;
}

/** Quita la regla de bloqueo de una MAC (idempotente). */
export function unblockMacCommand(mac: string): string {
  const m = normalizeMac(mac);
  const ipt = `iptables -w -D FORWARD -m mac --mac-source ${m} -j DROP 2>/dev/null || true`;
  return `if command -v iptables >/dev/null 2>&1; then ${ipt}; else ${nftDelete(m)}; fi`;
}

/**
 * Tabla y cadena de **fw4**, el cortafuegos por defecto de OpenWrt desde 22.03.
 * Se inserta en su cadena `forward` en vez de crear una propia: una cadena nuestra
 * no la salta nadie salvo que además la enganchemos, y enganchar cadenas en el
 * cortafuegos de otro es la clase de cambio que sobrevive a la desinstalación.
 */
const NFT_CHAIN = 'inet fw4 forward';

/**
 * Inserta la regla de descarte con nftables, de forma idempotente.
 *
 * `insert` y no `add`: `add` la pone al **final** de la cadena, detrás de las
 * reglas de aceptación que fw4 ya trae, así que el paquete se aceptaría antes de
 * llegar a la nuestra y el bloqueo «se aplicaría» sin cortar nada. Es el mismo
 * motivo por el que la rama iptables usa `-I` y no `-A`.
 */
function nftInsert(m: string): string {
  return `nft list chain ${NFT_CHAIN} 2>/dev/null | grep -q ${shellArg(m)} || nft insert rule ${NFT_CHAIN} ether saddr ${m} drop`;
}

/**
 * Borra la regla por **handle**, que es la única forma que da nftables: no existe
 * un `-D` que case por contenido. `nft -a` imprime `… # handle N` al final de cada
 * línea, de ahí el `$NF`. Si no hay handle, no había regla y no es un error.
 */
function nftDelete(m: string): string {
  return `h=$(nft -a list chain ${NFT_CHAIN} 2>/dev/null | awk ${shellArg(`/${m}/ {print $NF}`)} | head -n1); [ -n "$h" ] && nft delete rule ${NFT_CHAIN} handle "$h" || true`;
}

/**
 * Qué pila de filtrado tiene el router. OpenWrt 22.03+ trae **fw4/nftables** y ya
 * no instala `iptables` de serie; la compatibilidad `iptables-nft` existe pero
 * **nadie garantiza que esté**, que es justo lo que este proyecto daba por hecho en
 * un comentario. Sin ninguna de las dos, bloquear no corta nada y hay que decirlo
 * en vez de dejar el panel diciendo «Bloqueado».
 */
export const FIREWALL_STACK_PROBE =
  'if command -v iptables >/dev/null 2>&1; then echo iptables; elif command -v nft >/dev/null 2>&1; then echo nft; else echo none; fi';

export type FirewallStack = 'iptables' | 'nft' | 'none';

/** Lee la salida de {@link FIREWALL_STACK_PROBE}. Desconocido → `none` (falla cerrado). */
export function parseFirewallStack(out: string | null): FirewallStack {
  const v = (out ?? '').trim();
  return v === 'iptables' || v === 'nft' ? v : 'none';
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
