import { useAuthStore } from '@/store/auth.store';

/**
 * Descarga la copia de seguridad cifrada (US-103). El endpoint devuelve binario
 * (no JSON), así que se llama con `fetch` directo en vez del cliente `api`. El
 * `Blob` resultante lo guarda el navegador como archivo.
 */
export async function downloadBackup(passphrase: string): Promise<Blob> {
  const token = useAuthStore.getState().tokens?.accessToken;
  const res = await fetch('/api/system/backup', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ passphrase }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(err?.message ?? 'No se pudo generar la copia de seguridad');
  }
  return res.blob();
}
