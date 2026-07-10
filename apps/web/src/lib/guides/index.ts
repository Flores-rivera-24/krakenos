import { getLocale } from '@/lib/i18n';
import type { GuideCategory, GuideDomain, IntegrationGuide } from './types';
import { DRIVER_GUIDES } from './integrations/drivers';
import { LIGHT_GUIDES } from './integrations/lights';
import { PLUG_GUIDES } from './integrations/plugs';
import { CAMERA_GUIDES } from './integrations/cameras';
import { NETWORK_GUIDES } from './integrations/network';
import { GUIDE_TRANSLATIONS_EN } from './en';
import { localizeGuide } from './localize';

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
 * Todas las guías en su **fuente canónica en español**, ordenadas por familia
 * (drivers → luces → enchufes → cámaras → red). Los getters de abajo devuelven la
 * variante localizada al idioma activo; esta constante es la base estructural.
 */
export const GUIDES: IntegrationGuide[] = [
  ...DRIVER_GUIDES,
  ...LIGHT_GUIDES,
  ...PLUG_GUIDES,
  ...CAMERA_GUIDES,
  ...NETWORK_GUIDES,
];

/** Índice por id para búsquedas O(1) (sobre la fuente en español). */
const GUIDES_BY_ID: Map<string, IntegrationGuide> = new Map(GUIDES.map((g) => [g.id, g]));

/**
 * Localiza una guía al idioma activo. En español devuelve la fuente sin tocar; en
 * otro idioma superpone su traducción (texto ausente → español). Se lee el idioma
 * en cada llamada: los componentes que consumen guías se suscriben al idioma
 * (`useLocale`/`useT`) y re-renderizan al cambiarlo.
 */
function localize(guide: IntegrationGuide): IntegrationGuide {
  if (getLocale() === 'es') return guide;
  return localizeGuide(guide, GUIDE_TRANSLATIONS_EN[guide.id]);
}

/** Devuelve una guía por su id (slug), localizada, o undefined si no existe. */
export function getGuide(id: string): IntegrationGuide | undefined {
  const guide = GUIDES_BY_ID.get(id);
  return guide && localize(guide);
}

/** Devuelve la guía (localizada) cuyo `kind` de backend coincide, o undefined. */
export function getGuideByKind(kind: string): IntegrationGuide | undefined {
  const guide = GUIDES.find((g) => g.kind === kind);
  return guide && localize(guide);
}

/** Todas las guías (localizadas) de una categoría (lo que la persona conecta). */
export function guidesByCategory(category: GuideCategory): IntegrationGuide[] {
  return GUIDES.filter((g) => g.category === category).map(localize);
}

/** Todas las guías (localizadas) de un dominio funcional del backend. */
export function guidesByDomain(domain: GuideDomain): IntegrationGuide[] {
  return GUIDES.filter((g) => g.domain === domain).map(localize);
}

/** Guías (localizadas) ordenadas de más fácil (tier 1) a más avanzada (tier 4). */
export function guidesByTier(): IntegrationGuide[] {
  return [...GUIDES].sort((a, b) => a.tier - b.tier).map(localize);
}
