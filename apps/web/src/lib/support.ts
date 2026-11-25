import { ApiRequestError } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

/**
 * Descarga el bundle de soporte sanitizado (US-192). Devuelve JSON como descarga
 * (attachment), así que se pide con `fetch` directo (no el cliente `api`) para
 * obtener el `Blob`. El token va en cabecera (vive en memoria).
 */
export async function downloadSupportBundle(): Promise<Blob> {
  const token = useAuthStore.getState().tokens?.accessToken;
  const res = await fetch('/api/system/support-bundle', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
    throw new ApiRequestError(res.status, {
      code: err?.code ?? 'UNKNOWN',
      message: err?.message ?? '',
    });
  }
  return res.blob();
}
