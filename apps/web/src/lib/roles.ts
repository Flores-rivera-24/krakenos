import type { UserRole } from '@krakenos/types';
import type { TranslationKey } from '@/lib/i18n';

/**
 * Capa cosmética de los roles del hogar (US-179). La autoridad es del servidor
 * (`auth/capabilities.ts` en el agente); aquí solo se decide qué controles se
 * muestran/habilitan para no invitar a clics que acabarían en 403.
 */

/** ¿Puede operar el hogar (toggle IoT, escenas, acción de grupo)? admin y member. */
export function canControlHome(role: UserRole | undefined): boolean {
  return role === 'admin' || role === 'member';
}

/** Etiquetas humanas de los roles (claves i18n) para la gestión de usuarios. */
export const ROLE_LABELS: Record<UserRole, TranslationKey> = {
  admin: 'role.admin',
  member: 'role.member',
  kid: 'role.kid',
  guest: 'role.guest',
  viewer: 'role.viewer',
};
