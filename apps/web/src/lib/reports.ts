import { ApiRequestError } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

/**
 * Descarga un informe CSV (US-109). El endpoint responde texto CSV, no JSON, así
 * que se pide con `fetch` (bearer en memoria) y el navegador lo guarda como archivo.
 */
export async function downloadReport(path: string, filename: string): Promise<void> {
  const token = useAuthStore.getState().tokens?.accessToken;
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiRequestError(res.status, { code: 'DOWNLOAD_FAILED', message: '' });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
