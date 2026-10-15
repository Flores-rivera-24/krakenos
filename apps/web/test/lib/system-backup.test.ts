import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { changeLocale, setLocale } from '@/lib/i18n';
import { downloadBackup, restoreBackup } from '@/lib/system-backup';
import { useAuthStore } from '@/store/auth.store';

/**
 * Cliente de copia de seguridad (US-103/104 · streaming en US-233).
 *
 * Lo que atan estos tests: la restauración sube el archivo **en binario** con la
 * contraseña en cabecera. Antes iba en base64 dentro de un JSON, lo que inflaba el
 * cuerpo un 33 % y topaba con el `bodyLimit` del servidor → una copia grande se podía
 * crear pero no restaurar (AUD3-15). Si alguien vuelve al base64, esto se pone rojo.
 */
describe('cliente de copia de seguridad', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    useAuthStore.setState({ tokens: { accessToken: 'tok-1', expiresIn: 900 } } as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setLocale('es', { persist: false });
  });

  it('restore sube el fichero en binario con la contraseña en cabecera', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ staged: 3 }) });
    const file = new File([new Uint8Array([1, 2, 3])], 'copia.kbk');

    expect(await restoreBackup(file, 'passphrase-larga-1')).toEqual({ staged: 3 });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/system/restore/upload');
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/octet-stream');
    expect(headers['X-Restore-Passphrase']).toBe('passphrase-larga-1');
    expect(headers.Authorization).toBe('Bearer tok-1');
    // El cuerpo es el fichero tal cual: ni base64 ni JSON.
    expect(init.body).toBe(file);
    expect(typeof init.body).not.toBe('string');
  });

  it('la contraseña NO viaja en la URL (acabaría en los logs del proxy)', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ staged: 1 }) });
    await restoreBackup(new File(['x'], 'c.kbk'), 'passphrase-larga-1');
    expect(fetchMock.mock.calls[0]![0]).not.toContain('passphrase');
  });

  it('propaga el mensaje del servidor cuando falla', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ message: 'Contraseña incorrecta o backup dañado' }),
    });
    await expect(restoreBackup(new File(['x'], 'c.kbk'), 'passphrase-larga-1')).rejects.toThrow(
      /Contraseña incorrecta/,
    );
  });

  it('la descarga pide el blob al endpoint de backup', async () => {
    const blob = new Blob(['binario']);
    fetchMock.mockResolvedValue({ ok: true, blob: async () => blob });
    expect(await downloadBackup('passphrase-larga-1')).toBe(blob);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/system/backup');
  });

  it('un fallo es un ApiRequestError con status y code: la UI lo traduce, no lo pinta crudo', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ code: 'VALIDATION', message: 'Revisa los datos e inténtalo de nuevo.' }),
    });
    const err = await restoreBackup(new File(['x'], 'c.kbk'), 'passphrase-larga-1').catch((e) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err.status).toBe(400);
    expect(err.body.code).toBe('VALIDATION');
    // En español sale el mensaje del agente; en inglés, el del catálogo para ese code.
    expect(describeError(err, 'No se pudo restaurar la copia de seguridad')).toBe(
      'Revisa los datos e inténtalo de nuevo.',
    );
    await changeLocale('en', { persist: false });
    expect(describeError(err, 'x')).toBe('Check the details and try again.');
  });

  it('sin cuerpo JSON el error no inventa texto: describeError usa el fallback del idioma', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('no es json');
      },
    });
    const err = await downloadBackup('passphrase-larga-1').catch((e) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err.body).toEqual({ code: 'UNKNOWN', message: '' });
    expect(describeError(err, 'No se pudo generar la copia de seguridad')).toBe(
      'No se pudo generar la copia de seguridad (error 500).',
    );
  });
});
