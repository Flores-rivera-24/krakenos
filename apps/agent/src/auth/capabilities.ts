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
  /** Gestionar la red (WiFi, VPN, firewall, VLAN, QoS, DNS, integraciones). */
  'network.manage',
  /** Gestionar usuarios del hogar. */
  'users.manage',
  /** Sistema: ajustes, backup/restore, actualizaciones. */
  'system.manage',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const MATRIX: Record<UserRole, ReadonlySet<Capability>> = {
  admin: new Set(CAPABILITIES),
  member: new Set(['home.view', 'home.control']),
  // `kid`: ve el hogar (UI reducida en el cliente); su internet lo rigen los
  // horarios/parental (US-108). No opera dispositivos.
  kid: new Set(['home.view']),
  // `guest`: visibilidad mínima y temporal (expira vía `User.expiresAt`).
  guest: new Set(['home.view']),
  viewer: new Set(['home.view']),
};

/** ¿Puede el rol ejecutar la acción? Rol desconocido (dato legado) → nada. */
export function can(role: UserRole, action: Capability): boolean {
  return MATRIX[role]?.has(action) ?? false;
}
