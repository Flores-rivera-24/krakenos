import type { Locale } from '@krakenos/types';
import { getLocale } from '@/lib/i18n';

/**
 * Etiqueta BCP 47 que `Intl` usa para cada idioma de la app. El mapa es
 * **exhaustivo** sobre `Locale`: añadir un idioma no compila hasta decidir cómo
 * se escriben sus números y fechas.
 */
const INTL_LOCALES: Record<Locale, string> = { es: 'es-ES', en: 'en-US' };

/**
 * Locale de `Intl` del idioma ACTIVO de la app, no el del navegador: con la app
 * en inglés sobre un navegador en español, una fecha salía «14/10/2026, 20:53:28»
 * y un decimal con punto en español. Todo número o fecha visible pasa por los
 * formateadores de este fichero; un gate (`test/lib/formato-intl.test.ts`) impide
 * llamar a `toLocale*String()`/`Intl.*` sin locale en el resto de `src/`.
 */
export function intlLocale(): string {
  return INTL_LOCALES[getLocale()];
}

/** Número con el separador decimal y de millares del idioma activo. */
export function formatNumber(n: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(intlLocale(), options).format(n);
}

/** Número con exactamente `digits` decimales (el `toFixed` localizado). */
export function formatFixed(n: number, digits: number): string {
  return formatNumber(n, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

type Instante = Date | string | number;

/** Fecha y hora completas en el idioma activo («14/10/2026, 20:53:28» · «10/14/2026, 8:53:28 PM»). */
export function formatDateTime(value: Instante, options?: Intl.DateTimeFormatOptions): string {
  return new Date(value).toLocaleString(intlLocale(), options);
}

/** Solo la fecha, en el idioma activo. */
export function formatDate(value: Instante, options?: Intl.DateTimeFormatOptions): string {
  return new Date(value).toLocaleDateString(intlLocale(), options);
}

/** Solo la hora, en el idioma activo. */
export function formatTime(value: Instante, options?: Intl.DateTimeFormatOptions): string {
  return new Date(value).toLocaleTimeString(intlLocale(), options);
}

/** Formatea bytes a una unidad legible (GB/MB). */
export function formatBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${formatFixed(gb, 1)} GB`;
  return `${formatFixed(bytes / 1024 ** 2, 0)} MB`;
}

/** Formatea segundos de uptime como "Xd Yh Zm". */
export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [d ? `${d}d` : '', h ? `${h}h` : '', `${m}m`].filter(Boolean);
  return parts.join(' ');
}

/** Formatea bytes/seg como tasa de red en bits ("12.3 Mbps", "850 Kbps"). */
export function formatRate(bytesPerSec: number): string {
  const bits = bytesPerSec * 8;
  if (bits >= 1_000_000) return `${formatFixed(bits / 1_000_000, 1)} Mbps`;
  if (bits >= 1_000) return `${formatFixed(bits / 1_000, 0)} Kbps`;
  return `${Math.round(bits)} bps`;
}

/**
 * Tasa en bits para la marca de un eje: «80M», «512K», «0». Sin espacio ni la
 * unidad entera: «32.0 Mbps» se partía en dos líneas en un eje de 70 px (390 px
 * de pantalla) y la marca más alta se cortaba. La cifra exacta vive en el
 * tooltip y en la cabecera del widget, con `formatRate`.
 */
export function formatRateCompact(bytesPerSec: number): string {
  const bits = bytesPerSec * 8;
  const digits = { maximumFractionDigits: 1 };
  if (bits >= 1_000_000_000) return `${formatNumber(bits / 1_000_000_000, digits)}G`;
  if (bits >= 1_000_000) return `${formatNumber(bits / 1_000_000, digits)}M`;
  if (bits >= 1_000) return `${formatNumber(bits / 1_000, digits)}K`;
  return formatNumber(Math.round(bits));
}

/**
 * Tiempo relativo con unidades completas, localizado (US-177):
 * es → "hace 3 días" · en → "3 days ago". El texto en español es idéntico al
 * de antes (los tests lo asertan).
 */
export function formatRelative(date: Date): string {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  const en = getLocale() === 'en';
  if (s < 60) return en ? 'just now' : 'hace un momento';
  const units: [number, string, string, string, string][] = [
    [86400, 'día', 'días', 'day', 'days'],
    [3600, 'hora', 'horas', 'hour', 'hours'],
    [60, 'minuto', 'minutos', 'minute', 'minutes'],
  ];
  for (const [secs, sing, plur, singEn, plurEn] of units) {
    const n = Math.floor(s / secs);
    if (n >= 1) {
      return en ? `${n} ${n === 1 ? singEn : plurEn} ago` : `hace ${n} ${n === 1 ? sing : plur}`;
    }
  }
  return en ? 'just now' : 'hace un momento';
}

/**
 * Tiempo relativo corto, localizado (US-177): es → "hace 3m" · en → "3m ago".
 * Las unidades (m/h/d) son neutras; solo cambia el envoltorio.
 */
export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  const en = getLocale() === 'en';
  const wrap = (body: string) => (en ? `${body} ago` : `hace ${body}`);
  if (s < 60) return en ? 'just now' : 'hace un momento';
  const m = Math.floor(s / 60);
  if (m < 60) return wrap(`${m}m`);
  const h = Math.floor(m / 60);
  if (h < 24) return wrap(`${h}h`);
  return wrap(`${Math.floor(h / 24)}d`);
}

/**
 * Tiempo que falta hasta un instante FUTURO, localizado: es → "en 24 h" · en →
 * "in 24 h". `timeAgo` solo sabe del pasado: con una diferencia negativa caía en
 * la rama «menos de un minuto» y una invitación recién creada decía «Caduca hace
 * un momento». Redondea (no trunca): una caducidad a 24 h leída unos segundos
 * después seguiría diciendo «23 h».
 */
export function timeUntil(iso: string): string {
  const s = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const en = getLocale() === 'en';
  const wrap = (body: string) => (en ? `in ${body}` : `en ${body}`);
  if (s < 60) return en ? 'in a moment' : 'en un momento';
  const m = Math.round(s / 60);
  if (m < 60) return wrap(`${m} min`);
  const h = Math.round(m / 60);
  if (h < 48) return wrap(`${h} h`);
  return wrap(`${Math.round(h / 24)} d`);
}

/** `timeUntil` para una fecha futura y `timeAgo` para una pasada. */
export function timeFromNow(iso: string): string {
  return new Date(iso).getTime() > Date.now() ? timeUntil(iso) : timeAgo(iso);
}
