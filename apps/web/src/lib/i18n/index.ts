import { useSyncExternalStore } from 'react';
import type { Locale } from '@krakenos/types';
import { es, type TranslationKey } from './catalog/es';
import { getLocale, setLocale, subscribeLocale } from './locale';

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

/**
 * Catálogos ya disponibles en memoria. `es` viaja **siempre** en el bundle: es
 * la fuente del copy y el fallback de `t()`, así que no puede ser perezoso.
 */
const CATALOGS: Partial<Record<Locale, Record<TranslationKey, string>>> = { es };

/**
 * El idioma **fuente** del copy (`catalog/es.ts`). No es lo mismo que
 * `DEFAULT_LOCALE`: aquel es el default en runtime, este es un hecho de build
 * —de él se traduce todo lo demás y a él cae `t()` cuando falta una clave—, y es
 * la razón por la que `es` no puede ser perezoso aunque hoy coincidan.
 */
type SourceLocale = 'es';

/**
 * Cargadores perezosos de los demás idiomas (US-262). El mapa es **exhaustivo**
 * sobre `Locale` menos el idioma fuente: añadir un idioma a `LOCALES` no compila
 * hasta darle su cargador, en vez de fallar en silencio cayendo al español.
 */
const LOADERS: Record<
  Exclude<Locale, SourceLocale>,
  () => Promise<Record<TranslationKey, string>>
> = {
  en: () => import('./catalog/en').then((m) => m.en),
};

/** Cargas en vuelo, para que N llamadas concurrentes hagan **un** `import()`. */
const enVuelo = new Map<Locale, Promise<void>>();

/**
 * Garantiza que el catálogo de `locale` está en memoria. Idempotente y
 * single-flight. Para `es` resuelve al instante (ya está en el bundle).
 *
 * Existe porque `t()` es **síncrono** y lo llaman ~90 componentes: en vez de
 * volverlo asíncrono —que obligaría a decidir qué se pinta mientras carga, en
 * cada pantalla—, el catálogo se asegura **antes** de que el idioma pase a estar
 * activo. Ver `changeLocale`.
 */
export function ensureCatalog(locale: Locale): Promise<void> {
  if (CATALOGS[locale]) return Promise.resolve();
  const cargando = enVuelo.get(locale);
  if (cargando) return cargando;

  const loader = LOADERS[locale as Exclude<Locale, SourceLocale>];
  if (!loader) return Promise.resolve();

  const promesa = loader()
    .then((catalogo) => {
      CATALOGS[locale] = catalogo;
    })
    .catch(() => {
      // Un chunk que no llega (red caída, despliegue a medias) NO puede tumbar
      // la app: `t()` sigue cayendo al español, que es texto real y no una
      // pantalla en blanco ni una clave cruda.
    })
    .finally(() => {
      enVuelo.delete(locale);
    });
  enVuelo.set(locale, promesa);
  return promesa;
}

/**
 * Cambia el idioma activo **con su catálogo ya cargado**, para que ningún
 * componente llegue a renderizarse con el idioma nuevo y el catálogo viejo.
 * Es la puerta que deben usar los cambios de idioma en runtime; `setLocale` a
 * secas solo mueve el estado y se quedaría sin traducciones.
 */
export async function changeLocale(
  locale: Locale,
  opts?: { persist?: boolean },
): Promise<void> {
  await ensureCatalog(locale);
  setLocale(locale, opts);
}

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
