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

/** Tiempo relativo corto en español ("hace 3m", "hace 2h"). */
export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'hace un momento';
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h}h`;
  return `hace ${Math.floor(h / 24)}d`;
}
