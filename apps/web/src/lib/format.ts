import { getLocale } from '@/lib/i18n';

/** Formatea bytes a una unidad legible (GB/MB). */
export function formatBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
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
  if (bits >= 1_000_000) return `${(bits / 1_000_000).toFixed(1)} Mbps`;
  if (bits >= 1_000) return `${(bits / 1_000).toFixed(0)} Kbps`;
  return `${Math.round(bits)} bps`;
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
