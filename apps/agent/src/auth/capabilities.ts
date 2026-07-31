import type { UserRole } from '@krakenos/types';

/**
 * Mapa de capacidades por rol (US-179) — **puro y testeable**. Generaliza el
 * binario admin/viewer sin romper la regla vigente («lectura = autenticado,
 * escritura = admin»): las rutas de gestión siguen con `requireRole('admin')`/
 * `requireActiveAdmin`, y las de **uso cotidiano del hogar** (toggle IoT,
 * ejecutar escena, acción de grupo) pasan a `requireCapability('home.control')`
 * para que un `member` opere su casa sin poder tocar la red.
 */
export const CAPABILITIES = [
  /** Ver el hogar (lecturas; hoy toda lectura autenticada lo permite). */
  'home.view',
  /** Operar lo cotidiano: encender/apagar IoT, ejecutar escenas, acción de grupo. */
  'home.control',
  /**
   * Ver vídeo e histórico de las cámaras (US-227/AUD3-02): listar, snapshot, abrir
   * stream en vivo, eventos de movimiento y grabaciones. Es una lectura, pero **no**
   * es «lectura general»: enseña el interior de la casa en directo, así que se saca
   * de `home.view` y se le niega a `kid` y `guest` (a quienes la UI ya se la ocultaba
   * sin que el servidor lo impusiera).
   */
  'home.cameras',
  /**
   * Ver la **actividad de red por aparato** (US-250): a qué dominios habla cada
   * dispositivo (`GET /api/dns/queries`) y cuánto consume cada uno
   * (`GET /api/traffic/devices`). Como `home.cameras`, es una lectura que **no**
   * es «lectura general» y por eso sale de `home.view`.
   *
   * A diferencia de `home.cameras`, esta es **solo de admin**, y no por ser más
   * invasiva en abstracto sino por coherencia con una decisión ya entregada:
   * US-184 (bienestar digital) decidió que un no-admin ve **solo su propio** uso
   * (`wellbeing.service.ts::usageByPerson`). Pero `/traffic/devices` devuelve el
   * desglose por MAC y el inventario da la etiqueta del aparato («Tablet de
   * Marta»), así que dársela a `member`/`viewer` reconstruiría por la puerta de
   * atrás exactamente lo que el bienestar les niega por la principal. La vista
   * con privacidad ya existe y es `GET /api/wellbeing/usage`: quien no es admin
   * va por ahí y ve lo suyo.
   */
  'home.activity',
  /** Gestionar la red (WiFi, VPN, firewall, VLAN, QoS, DNS, integraciones). */
  'network.manage',
  /** Gestionar usuarios del hogar. */
  'users.manage',
  /** Sistema: ajustes, backup/restore, actualizaciones. */
  'system.manage',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/**
 * ⚠️ `home.activity` la tiene **solo `admin`**, y la omisión en los otros cuatro
 * roles es deliberada, no un olvido (US-250): ver el historial de navegación y el
 * consumo aparato a aparato es vigilar a la familia, no usar la casa. El no-admin
 * que quiera saber cuánto ha gastado **él** tiene `GET /api/wellbeing/usage`, que
 * ya filtra por rol en el servidor.
 */
const MATRIX: Record<UserRole, ReadonlySet<Capability>> = {
  admin: new Set(CAPABILITIES),
  member: new Set(['home.view', 'home.control', 'home.cameras']),
  // `kid`: ve el hogar (UI reducida en el cliente); su internet lo rigen los
  // horarios/parental (US-108). No opera dispositivos **ni ve las cámaras**.
  kid: new Set(['home.view']),
  // `guest`: visibilidad mínima y temporal (expira vía `User.expiresAt`).
  guest: new Set(['home.view']),
  // `viewer`: adulto de solo lectura — sí ve las cámaras, no opera nada.
  viewer: new Set(['home.view', 'home.cameras']),
};

/** ¿Puede el rol ejecutar la acción? Rol desconocido (dato legado) → nada. */
export function can(role: UserRole, action: Capability): boolean {
  return MATRIX[role]?.has(action) ?? false;
}
