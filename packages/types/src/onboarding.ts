import type { Id, IsoDateTime } from './common.js';
import type { UserRole } from './auth.js';

/**
 * Las dos formas de que alguien nuevo entre en el hogar, sin abrir la puerta a
 * cualquiera (US-272 / US-273).
 *
 * El autorregistro está descartado a propósito: KrakenOS controla el firewall, las
 * cámaras y las cerraduras, y hasta un rol `viewer` ve el inventario de red entero.
 * Un botón «crear cuenta» significaría que cualquiera que alcance la IP —un invitado
 * en el WiFi, un aparato IoT comprometido— se da de alta solo. Así que hay dos
 * caminos y en los dos **decide un administrador**:
 *
 * - **Invitación** (US-272): el admin la emite y comparte el enlace. Quien lo abre
 *   elige *su* contraseña.
 * - **Solicitud** (US-273): la persona la pide desde la pantalla de entrada y el
 *   admin la aprueba eligiendo el rol.
 */

// ---------------------------------------------------------------------------
// Invitaciones (US-272)
// ---------------------------------------------------------------------------

/** Invitación tal y como la ve el admin en la lista. Nunca incluye el token. */
export interface Invitation {
  id: Id;
  email: string;
  displayName: string;
  role: UserRole;
  /** Caducidad del ENLACE (no la de la cuenta que se cree). */
  expiresAt: IsoDateTime;
  /** Caducidad de la cuenta resultante (invitados, US-179); `null` = sin caducidad. */
  accountExpiresAt: IsoDateTime | null;
  usedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  /**
   * Estado derivado, calculado en el servidor para que la interfaz no tenga que
   * comparar fechas ella misma (y no pueda equivocarse de zona horaria).
   */
  status: 'pending' | 'used' | 'expired';
}

export interface CreateInvitationRequest {
  email: string;
  displayName: string;
  role: UserRole;
  /** Vida del enlace en horas. Por defecto 24. */
  expiresInHours?: number;
  /** Caducidad de la cuenta que se cree (US-179). */
  accountExpiresAt?: IsoDateTime;
}

/**
 * Respuesta al crear una invitación. `token` viaja **una sola vez**: solo se guarda
 * su hash, así que ni el servidor puede volver a enseñarlo. Si se pierde, se emite
 * otra — mismo trato que los códigos de recuperación.
 */
export interface CreateInvitationResponse {
  invitation: Invitation;
  token: string;
  /** Ruta relativa lista para compartir, p. ej. `/invitacion/<token>`. */
  path: string;
}

/** Lo que ve quien abre el enlace, ANTES de aceptar. Deliberadamente escueto. */
export interface InvitationPreview {
  email: string;
  displayName: string;
  role: UserRole;
  homeName: string;
}

/** Aceptación: la persona elige su propia contraseña. */
export interface AcceptInvitationRequest {
  password: string;
  /** Puede corregir el nombre que puso el admin. */
  displayName?: string;
}

// ---------------------------------------------------------------------------
// Solicitudes de acceso (US-273)
// ---------------------------------------------------------------------------

export type AccessRequestStatus = 'pending' | 'approved' | 'rejected';

export interface AccessRequest {
  id: Id;
  email: string;
  displayName: string;
  status: AccessRequestStatus;
  note: string | null;
  createdAt: IsoDateTime;
  decidedAt: IsoDateTime | null;
}

/** Lo que manda quien pide entrar. Sin contraseña: todavía no hay cuenta. */
export interface CreateAccessRequestRequest {
  email: string;
  displayName: string;
  note?: string;
}

/**
 * Decisión del admin. Aprobar **no** crea la cuenta con una contraseña puesta a
 * dedo: emite una invitación, de modo que la contraseña la siga eligiendo quien la
 * va a usar y no viaje por ningún chat.
 */
export interface DecideAccessRequestRequest {
  decision: 'approve' | 'reject';
  /** Rol a conceder al aprobar. Obligatorio en `approve`. */
  role?: UserRole;
}

/** Al aprobar se devuelve la invitación recién emitida, con su token de un solo uso. */
export interface DecideAccessRequestResponse {
  request: AccessRequest;
  invitation?: CreateInvitationResponse;
}
