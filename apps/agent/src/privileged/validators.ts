/**
 * Validadores **puros** anti-inyección para los argumentos que llegan a una
 * operación privilegiada — el helper sudoers (`wg`/`iptables`/`tc`, vía
 * {@link file://./runner.ts SudoHelperRunner}) o una sesión CLI/SNMP de Cisco
 * (`cisco-ios.commands.ts`, `q-bridge.ts`).
 *
 * **Rechazan, no sanean:** un valor sospechoso lanza `InvalidArgumentError` y
 * aborta la operación **antes** de cualquier `exec`/sesión; nunca se "arregla"
 * recortando caracteres (eso enmascara el ataque y deja comportamiento ambiguo).
 *
 * Modelo de amenaza concreto:
 * - El `SudoHelperRunner` usa `execFile` (sin shell) y el helper hace
 *   `exec wg "$@"` (sin re-split), así que **no** hay inyección de shell por el
 *   runner. El vector real es la **inyección de banderas**: un argv que empieza
 *   por `-`/`--` que `wg`/`iptables`/`tc` interpretarían como opción.
 * - La VLAN Cisco se aplica por **CLI multi-línea sobre SSH**
 *   (`transport.executePrivileged([...])`): aquí un salto de línea o retorno de
 *   carro dentro de un nombre **inyecta comandos IOS adicionales** en la sesión
 *   privilegiada. Por eso se rechazan también los caracteres de control.
 *
 * Las validaciones viven en los **constructores de argv/CLI** (el cuello de
 * botella justo antes de ejecutar), de modo que protegen *todas* las rutas de
 * llamada — incluida una procedente del store en disco o de una variable de
 * entorno — sin depender de que cada llamante valide.
 */

/** Argumento privilegiado que no supera la validación anti-inyección. */
export class InvalidArgumentError extends Error {
  constructor(
    readonly label: string,
    readonly value: string,
    readonly reason: string,
  ) {
    super(`Argumento privilegiado inválido (${label}): ${reason}`);
    this.name = 'InvalidArgumentError';
  }
}

/** Caracteres de control ASCII (incluye `\t \n \r`) y DEL: jamás en un arg legítimo. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

function fail(label: string, value: unknown, reason: string): never {
  throw new InvalidArgumentError(label, typeof value === 'string' ? value : String(value), reason);
}

/** Comprueba que es una cadena no vacía, sin caracteres de control ni espacios. */
function assertCleanString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string') fail(label, value, 'no es una cadena');
  if (value.length === 0) fail(label, value, 'está vacío');
  if (CONTROL_CHARS.test(value)) fail(label, value, 'contiene caracteres de control (posible inyección)');
  if (/\s/.test(value)) fail(label, value, 'contiene espacios en blanco');
}

/** Entero finito no negativo (rate/classid/prio de `tc`, puertos, etc.). */
export function assertNonNegativeInteger(value: number, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    fail(label, value, 'no es un entero no negativo');
  }
  return value;
}

/**
 * Nombre de interfaz de red de Linux (`wg0`, `eth0`, `wan`…). Allowlist estricta:
 * empieza por alfanumérico, ≤ 15 caracteres (IFNAMSIZ), sin `-` inicial → cierra
 * la inyección de banderas en `tc dev <iface>` / `wg show <iface>`.
 */
export function assertInterfaceName(value: string, label = 'interfaz'): string {
  assertCleanString(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._@-]{0,14}$/.test(value)) {
    fail(label, value, 'no es un nombre de interfaz de red válido');
  }
  return value;
}

/**
 * Nombre de interfaz Cisco (`GigabitEthernet0/1`, `Gi1/0/24`…): admite `/` y es
 * más largo que una interfaz de Linux. Sigue rechazando espacios, control y `-` inicial.
 */
export function assertCiscoInterface(value: string, label = 'puerto Cisco'): string {
  assertCleanString(value, label);
  if (value.startsWith('-')) fail(label, value, 'empieza por "-" (posible inyección de bandera)');
  if (!/^[A-Za-z0-9][A-Za-z0-9/._-]{0,31}$/.test(value)) {
    fail(label, value, 'no es un nombre de interfaz Cisco válido');
  }
  return value;
}

/** Clave pública/privada WireGuard: base64 de 32 bytes (`[A-Za-z0-9+/]{43}=`). */
export function assertWireguardKey(value: string, label = 'clave WireGuard'): string {
  assertCleanString(value, label);
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    fail(label, value, 'no es una clave WireGuard base64 de 32 bytes');
  }
  return value;
}

/** ¿Cada octeto de `a.b.c.d` está en 0..255? (el regex solo limita a 1-3 dígitos). */
function octetsInRange(quad: string): boolean {
  return quad.split('.').every((o) => Number(o) <= 255);
}

/** Dirección IPv4 escueta (`10.8.0.2`), octetos 0..255 y sin máscara. */
export function assertIpv4(value: string, label = 'dirección IPv4'): string {
  assertCleanString(value, label);
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(value) || !octetsInRange(value)) {
    fail(label, value, 'no es una dirección IPv4 válida');
  }
  return value;
}

/** IPv4 con máscara CIDR opcional (`10.0.0.0/24`), octetos 0..255 y prefijo 0..32. */
export function assertIpv4Cidr(value: string, label = 'IPv4/CIDR'): string {
  assertCleanString(value, label);
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})(?:\/(\d{1,2}))?$/.exec(value);
  if (!match || !octetsInRange(match[1]!) || (match[2] !== undefined && Number(match[2]) > 32)) {
    fail(label, value, 'no es una dirección o red IPv4/CIDR válida');
  }
  return value;
}

/** Tag 802.1Q como entero (1..4094). */
export function assertVlanTag(value: number, label = 'tag de VLAN'): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 4094) {
    fail(label, value, 'no es un tag 802.1Q válido (1..4094)');
  }
  return value;
}

/** Tag 802.1Q recibido como cadena (p. ej. variable de entorno): solo dígitos, 1..4094. */
export function assertVlanTagString(value: string, label = 'tag de VLAN'): string {
  assertCleanString(value, label);
  if (!/^\d{1,4}$/.test(value)) fail(label, value, 'no es un tag 802.1Q numérico');
  assertVlanTag(Number(value), label);
  return value;
}

/**
 * Nombre de VLAN para CLI IOS / OctetString SNMP. Allowlist estricta
 * (`[A-Za-z0-9_.-]`, 1..32): rechaza espacios, control y metacaracteres, lo que
 * cierra tanto la inyección de comandos IOS por salto de línea como argumentos raros.
 */
export function assertVlanName(value: string, label = 'nombre de VLAN'): string {
  assertCleanString(value, label);
  // Primer carácter alfanumérico/`_`/`.` (no `-`, para no parecer una bandera).
  if (!/^[A-Za-z0-9_.][A-Za-z0-9_.-]{0,31}$/.test(value)) {
    fail(label, value, 'solo admite letras, dígitos, "_", "." y "-" (máx. 32, sin "-" inicial)');
  }
  return value;
}
