import { getLocale } from '@/lib/i18n';
import type { GuideCategory, GuideDomain, IntegrationGuide } from './types';
import { DRIVER_GUIDES } from './integrations/drivers';
import { LIGHT_GUIDES } from './integrations/lights';
import { PLUG_GUIDES } from './integrations/plugs';
import { CAMERA_GUIDES } from './integrations/cameras';
import { NETWORK_GUIDES } from './integrations/network';
import { DRIVER_GUIDES_EN } from './integrations/en/drivers';
import { LIGHT_GUIDES_EN } from './integrations/en/lights';
import { PLUG_GUIDES_EN } from './integrations/en/plugs';
import { CAMERA_GUIDES_EN } from './integrations/en/cameras';
import { NETWORK_GUIDES_EN } from './integrations/en/network';

/**
 * Punto de entrada de las guías de conexión in-app (US-144).
 *
 * Agrega todas las guías de `integrations/` en un único `GUIDES` y ofrece
 * ayudantes para que el asistente (wizard) y el backend las consulten por id,
 * categoría o dominio. Reexporta también los tipos y el glosario para que los
 * consumidores solo necesiten importar desde `@/lib/guides`.
 */

export type {
  GuideCategory,
  GuideDomain,
  GuideField,
  GuideFieldType,
  GuideStep,
  IntegrationGuide,
} from './types';

export { GLOSSARY, getGlossaryEntry, glossaryEntries } from './glossary';
export type { GlossaryEntry } from './glossary';

export {
  DRIVER_GUIDES,
  LIGHT_GUIDES,
  PLUG_GUIDES,
  CAMERA_GUIDES,
  NETWORK_GUIDES,
};

/**
 * Todas las guías en español, ordenadas por familia
 * (drivers → luces → enchufes → cámaras → red). `GUIDES` mantiene el catálogo
 * en español como fuente/compatibilidad; los accesores devuelven el idioma
 * activo (US-177).
 */
export const GUIDES: IntegrationGuide[] = [
  ...DRIVER_GUIDES,
  ...LIGHT_GUIDES,
  ...PLUG_GUIDES,
  ...CAMERA_GUIDES,
  ...NETWORK_GUIDES,
];

/** Gemelo inglés (misma estructura/ids; solo la prosa cambia, US-177). */
const GUIDES_EN: IntegrationGuide[] = [
  ...DRIVER_GUIDES_EN,
  ...LIGHT_GUIDES_EN,
  ...PLUG_GUIDES_EN,
  ...CAMERA_GUIDES_EN,
  ...NETWORK_GUIDES_EN,
];

/** Índices por id por idioma para búsquedas O(1). */
const BY_ID_ES = new Map(GUIDES.map((g) => [g.id, g]));
const BY_ID_EN = new Map(GUIDES_EN.map((g) => [g.id, g]));

/** Catálogo del idioma activo (español por defecto). */
function activeGuides(): IntegrationGuide[] {
  return getLocale() === 'en' ? GUIDES_EN : GUIDES;
}

/** Devuelve una guía por su id (slug) en el idioma activo, o undefined. */
export function getGuide(id: string): IntegrationGuide | undefined {
  return (getLocale() === 'en' ? BY_ID_EN : BY_ID_ES).get(id);
}

/** Devuelve la guía cuyo `kind` de backend coincide (idioma activo), o undefined. */
export function getGuideByKind(kind: string): IntegrationGuide | undefined {
  return activeGuides().find((g) => g.kind === kind);
}

/** Todas las guías de una categoría (idioma activo). */
export function guidesByCategory(category: GuideCategory): IntegrationGuide[] {
  return activeGuides().filter((g) => g.category === category);
}

/** Todas las guías de un dominio funcional del backend (idioma activo). */
export function guidesByDomain(domain: GuideDomain): IntegrationGuide[] {
  return activeGuides().filter((g) => g.domain === domain);
}

/** Guías ordenadas de más fácil (tier 1) a más avanzada (tier 4), idioma activo. */
export function guidesByTier(): IntegrationGuide[] {
  return [...activeGuides()].sort((a, b) => a.tier - b.tier);
}
