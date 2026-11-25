import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { downloadReport } from '@/lib/reports';
import { downloadSupportBundle } from '@/lib/support';

function stubFetch(status: number, body: unknown = null) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      json: async () => body,
    } as Response),
  );
}

describe('descargas por fetch directo: el error HTTP no se pinta como «sin conexión»', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('el paquete de soporte lanza ApiRequestError con el estado y el mensaje del agente', async () => {
    stubFetch(403, { code: 'FORBIDDEN', message: 'Solo un administrador.' });
    const err = await downloadSupportBundle().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect((err as ApiRequestError).status).toBe(403);
    expect(describeError(err, 'No se pudo generar el paquete')).toBe('Solo un administrador.');
  });

  it('el informe CSV lanza ApiRequestError con el estado (500 → «error 500», no red)', async () => {
    stubFetch(500);
    const err = await downloadReport('/energy/export.csv', 'x.csv').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect((err as ApiRequestError).status).toBe(500);
    expect(describeError(err, 'No se pudo generar el informe')).toContain('error 500');
  });
});
