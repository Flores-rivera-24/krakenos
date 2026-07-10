import { DEFAULT_LOCALE, LOCALES, type Locale } from '@krakenos/types';

/** Clave de persistencia del idioma en localStorage (device-level, US-177). */
const STORAGE_KEY = 'krakenos-locale';

function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Lee el idioma persistido en el dispositivo, o `null` si no hay/está corrupto. */
export function readStoredLocale(): Locale | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isLocale(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Detecta el idioma inicial del navegador (US-177): `en` si el navegador está en
 * inglés, `es` en cualquier otro caso (el default seguro del proyecto).
 */
export function detectBrowserLocale(): Locale {
  try {
    const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const lang of langs) {
      if (typeof lang === 'string' && lang.toLowerCase().startsWith('en')) return 'en';
    }
  } catch {
    // navigator no disponible (SSR/test): cae al default.
  }
  return DEFAULT_LOCALE;
}

/**
 * Idioma inicial del dispositivo antes de restaurar la sesión: preferencia
 * persistida > detección del navegador > `es`. La preferencia del usuario del
 * servidor (`user.locale`) prima después, al restaurar la sesión.
 */
export function resolveInitialLocale(): Locale {
  return readStoredLocale() ?? detectBrowserLocale();
}

// --- Store observable a nivel de módulo (el idioma es global a la app) ---

let current: Locale = DEFAULT_LOCALE;
const listeners = new Set<() => void>();

/** Idioma activo. Lo lee `t()` en cada llamada. */
export function getLocale(): Locale {
  return current;
}

/** Sincroniza el atributo `<html lang>` para accesibilidad y `Intl`. */
function syncHtmlLang(locale: Locale): void {
  try {
    document.documentElement.lang = locale;
  } catch {
    // document no disponible (test sin jsdom): no-op.
  }
}

/**
 * Fija el idioma activo, actualiza `<html lang>`, notifica a los suscriptores y
 * (por defecto) lo persiste en el dispositivo. `persist: false` para aplicar la
 * preferencia del servidor sin pisar la elección explícita del dispositivo.
 */
export function setLocale(locale: Locale, { persist = true }: { persist?: boolean } = {}): void {
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // almacenamiento no disponible: el idioma queda solo en memoria.
    }
  }
  if (locale === current) {
    syncHtmlLang(locale);
    return;
  }
  current = locale;
  syncHtmlLang(locale);
  for (const fn of listeners) fn();
}

/**
 * Inicializa el idioma del dispositivo al arrancar (antes del bootstrap de
 * sesión). No re-persiste la detección: solo aplica el valor resuelto.
 */
export function initLocale(): void {
  setLocale(resolveInitialLocale(), { persist: false });
}

/** Suscribe a cambios de idioma. Devuelve la función para desuscribir. */
export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
