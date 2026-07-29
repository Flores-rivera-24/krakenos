import type { AutoBackupStatus } from '@krakenos/types';
import { api } from '@/lib/api';
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

/**
 * Sube un backup cifrado + su passphrase (US-104). El servidor lo valida y lo deja
 * preparado; se aplica al **reiniciar** el agente.
 *
 * Desde US-233 el archivo se envía **en binario** (`application/octet-stream`) en vez
 * de en base64 dentro de un JSON: el base64 lo inflaba un 33 % y topaba con el
 * `bodyLimit` de 64 MB del servidor, así que una copia grande se podía crear pero no
 * restaurar (AUD3-15). La contraseña va en cabecera, nunca en la URL.
 */
export async function restoreBackup(file: File, passphrase: string): Promise<{ staged: number }> {
  const token = useAuthStore.getState().tokens?.accessToken;
  const res = await fetch('/api/system/restore/upload', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Restore-Passphrase': passphrase,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: file,
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(err?.message ?? 'No se pudo restaurar la copia de seguridad');
  }
  return res.json() as Promise<{ staged: number }>;
}

/* ─────────────── Copias automáticas (US-233) ─────────────── */

export function getAutoBackupStatus(): Promise<AutoBackupStatus> {
  return api.get<AutoBackupStatus>('/system/backup/auto');
}

/** Lanza una copia automática ahora. Devuelve el estado ya actualizado. */
export function runAutoBackup(): Promise<AutoBackupStatus> {
  return api.post<AutoBackupStatus>('/system/backup/auto/run');
}

/**
 * Fija la contraseña de las copias automáticas, o **genera** una si no se pasa
 * ninguna (en ese caso viene en `generated`: es la única vez que se devuelve así,
 * aunque después se puede consultar con `revealAutoBackupPassphrase`).
 */
export function setAutoBackupPassphrase(
  passphrase?: string,
): Promise<{ passphraseSet: boolean; generated: string | null }> {
  return api.post('/system/backup/auto/passphrase', passphrase ? { passphrase } : {});
}

/** Muestra la contraseña guardada (admin activo; queda auditado). */
export function revealAutoBackupPassphrase(): Promise<{ passphrase: string | null }> {
  return api.post('/system/backup/auto/passphrase/reveal');
}
