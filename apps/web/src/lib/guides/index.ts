import type { GuideCategory, GuideDomain, IntegrationGuide } from './types';
import { DRIVER_GUIDES } from './integrations/drivers';
import { LIGHT_GUIDES } from './integrations/lights';
import { PLUG_GUIDES } from './integrations/plugs';
import { CAMERA_GUIDES } from './integrations/cameras';
import { NETWORK_GUIDES } from './integrations/network';

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

/** Todas las guías, ordenadas por familia (drivers → luces → enchufes → cámaras → red). */
export const GUIDES: IntegrationGuide[] = [
  ...DRIVER_GUIDES,
  ...LIGHT_GUIDES,
  ...PLUG_GUIDES,
  ...CAMERA_GUIDES,
  ...NETWORK_GUIDES,
];

/** Índice por id para búsquedas O(1). */
const GUIDES_BY_ID: Map<string, IntegrationGuide> = new Map(GUIDES.map((g) => [g.id, g]));

/** Devuelve una guía por su id (slug), o undefined si no existe. */
export function getGuide(id: string): IntegrationGuide | undefined {
  return GUIDES_BY_ID.get(id);
}

/** Devuelve la guía cuyo `kind` de backend coincide, o undefined. */
export function getGuideByKind(kind: string): IntegrationGuide | undefined {
  return GUIDES.find((g) => g.kind === kind);
}

/** Todas las guías de una categoría (lo que la persona está conectando). */
export function guidesByCategory(category: GuideCategory): IntegrationGuide[] {
  return GUIDES.filter((g) => g.category === category);
}

/** Todas las guías de un dominio funcional del backend. */
export function guidesByDomain(domain: GuideDomain): IntegrationGuide[] {
  return GUIDES.filter((g) => g.domain === domain);
}

/** Guías ordenadas de más fácil (tier 1) a más avanzada (tier 4). */
export function guidesByTier(): IntegrationGuide[] {
  return [...GUIDES].sort((a, b) => a.tier - b.tier);
}
