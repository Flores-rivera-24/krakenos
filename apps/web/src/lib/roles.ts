import type { UserRole } from '@krakenos/types';
import type { TranslationKey, TranslationParams } from '@/lib/i18n';

/**
 * Capa cosmética de los roles del hogar (US-179). La autoridad es del servidor
 * (`auth/capabilities.ts` en el agente); aquí solo se decide qué controles se
 * muestran/habilitan para no invitar a clics que acabarían en 403.
 */

/** ¿Puede operar el hogar (toggle IoT, escenas, acción de grupo)? admin y member. */
export function canControlHome(role: UserRole | undefined): boolean {
  return role === 'admin' || role === 'member';
}

/**
 * Etiqueta humana de cada rol: la **clave** del catálogo, no el texto (una
 * constante de módulo con el texto ya resuelto se congelaría con el idioma que
 * hubiera al importar el módulo).
 */
export const ROLE_LABEL_KEYS: Record<UserRole, TranslationKey> = {
  admin: 'people.role.admin',
  member: 'people.role.member',
  kid: 'people.role.kid',
  guest: 'people.role.guest',
  viewer: 'people.role.viewer',
};

/**
 * Nombre visible de un rol que llega del servidor (`string`). Un rol que esta web no
 * conoce (un agente más nuevo) se **declara** en vez de pintar el valor interno
 * («admin») o dejar `undefined` en el catálogo.
 */
export function etiquetaDeRol(
  role: string,
  t: (key: TranslationKey, params?: TranslationParams) => string,
): string {
  return Object.prototype.hasOwnProperty.call(ROLE_LABEL_KEYS, role)
    ? t(ROLE_LABEL_KEYS[role as UserRole])
    : t('people.role.unknown', { role });
}
