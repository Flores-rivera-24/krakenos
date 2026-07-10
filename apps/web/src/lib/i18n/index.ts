import { useSyncExternalStore } from 'react';
import type { Locale } from '@krakenos/types';
import { en } from './catalog/en';
import { es, type TranslationKey } from './catalog/es';
import { getLocale, subscribeLocale } from './locale';

export type { TranslationKey };
export {
  getLocale,
  setLocale,
  initLocale,
  resolveInitialLocale,
  readStoredLocale,
  detectBrowserLocale,
  subscribeLocale,
} from './locale';

const CATALOGS: Record<Locale, Record<TranslationKey, string>> = { es, en };

/** Valores interpolables en una traducción (`{nombre}` → valor). */
export type TranslationParams = Record<string, string | number>;

/** Reemplaza `{clave}` por su valor en `params` (deja intacto lo no provisto). */
function interpolate(template: string, params?: TranslationParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  );
}

/**
 * Traduce `key` al idioma activo con interpolación opcional. Si faltara la clave
 * en el idioma activo (no debería: la paridad la garantiza el tipo), cae al
 * español y, en último término, a la propia clave — nunca lanza.
 */
export function t(key: TranslationKey, params?: TranslationParams): string {
  const locale = getLocale();
  const template = CATALOGS[locale]?.[key] ?? es[key] ?? key;
  return interpolate(template, params);
}

/**
 * Elige la forma singular/plural según `n` en el idioma activo. Inglés y español
 * comparten la regla "1 = singular, resto = plural" (suficiente para esta app).
 */
export function plural(n: number, forms: { one: string; other: string }): string {
  return Math.abs(n) === 1 ? forms.one : forms.other;
}

/**
 * Suscribe el componente al idioma activo: re-renderiza al cambiarlo. Devuelve
 * el idioma actual.
 */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}

/**
 * Hook de traducción: devuelve `t` y re-renderiza el componente cuando cambia el
 * idioma. Uso: `const t = useT(); return <span>{t('nav.settings')}</span>`.
 */
export function useT(): typeof t {
  useLocale();
  return t;
}
