import type { GuideTranslations } from '../localize';
import { CAMERA_GUIDES_EN } from './cameras';
import { DRIVERS_GUIDES_EN } from './drivers';
import { LIGHTS_GUIDES_EN } from './lights';
import { NETWORK_GUIDES_EN } from './network';
import { PLUGS_GUIDES_EN } from './plugs';

export { GLOSSARY_EN } from './glossary';

/**
 * Superposiciones de traducción al inglés de todas las guías (US-177), indexadas
 * por `guide.id`. La fuente en español sigue siendo la estructura canónica; esto
 * solo aporta el texto visible por idioma.
 */
export const GUIDE_TRANSLATIONS_EN: GuideTranslations = {
  ...DRIVERS_GUIDES_EN,
  ...LIGHTS_GUIDES_EN,
  ...PLUGS_GUIDES_EN,
  ...CAMERA_GUIDES_EN,
  ...NETWORK_GUIDES_EN,
};
