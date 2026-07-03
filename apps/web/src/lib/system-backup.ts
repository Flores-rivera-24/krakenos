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

/** Convierte un `File` a base64 (por trozos, para no reventar la pila con archivos grandes). */
async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Sube un backup cifrado + su passphrase (US-104). El servidor lo valida y lo deja
 * preparado; se aplica al **reiniciar** el agente.
 */
export async function restoreBackup(file: File, passphrase: string): Promise<{ staged: number }> {
  const token = useAuthStore.getState().tokens?.accessToken;
  const res = await fetch('/api/system/restore', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ passphrase, data: await fileToBase64(file) }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(err?.message ?? 'No se pudo restaurar el backup');
  }
  return res.json() as Promise<{ staged: number }>;
}
