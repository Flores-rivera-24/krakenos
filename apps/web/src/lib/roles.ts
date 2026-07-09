import type { UserRole } from '@krakenos/types';

/**
 * Capa cosmética de los roles del hogar (US-179). La autoridad es del servidor
 * (`auth/capabilities.ts` en el agente); aquí solo se decide qué controles se
 * muestran/habilitan para no invitar a clics que acabarían en 403.
 */

/** ¿Puede operar el hogar (toggle IoT, escenas, acción de grupo)? admin y member. */
export function canControlHome(role: UserRole | undefined): boolean {
  return role === 'admin' || role === 'member';
}

/** Etiquetas humanas de los roles para la gestión de usuarios. */
export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador',
  member: 'Miembro',
  kid: 'Menor',
  guest: 'Invitado',
  viewer: 'Observador',
};
