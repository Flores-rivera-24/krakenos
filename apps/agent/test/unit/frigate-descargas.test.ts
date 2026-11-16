import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FRIGATE_DOWNLOAD_TIMEOUT_MS, frigateFetch } from '../../src/cameras/index.js';
import { SAFE_FETCH_TIMEOUT_MS, safeFetch } from '../../src/net/egress.js';

/**
 * Un clip de Frigate tarda más que el tope general de `safeFetch`: el adaptador
 * lleva su propio `signal`. Los topes se escalan (10 s → 300 ms, 120 s → 3 s) para
 * no esperar tiempos reales; el servidor manda las cabeceras ya y el cuerpo a 800 ms.
 */
describe('descargas de Frigate: tope propio', () => {
  let server: Server;
  let url = '';

  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'video/mp4' });
      res.write('inicio-');
      setTimeout(() => res.end('fin'), 800);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/clip.mp4`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });
  afterEach(() => vi.restoreAllMocks());

  const escalaTopes = () => {
    const real = AbortSignal.timeout.bind(AbortSignal);
    return vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      if (ms === SAFE_FETCH_TIMEOUT_MS) return real(300);
      if (ms === FRIGATE_DOWNLOAD_TIMEOUT_MS) return real(3000);
      return real(ms);
    });
  };

  it('el cuerpo que llega tras el tope general se descarga completo por el adaptador', async () => {
    const spy = escalaTopes();
    const res = await frigateFetch(url);
    expect(await res.text()).toBe('inicio-fin');
    expect(spy).toHaveBeenCalledWith(FRIGATE_DOWNLOAD_TIMEOUT_MS);
  });

  it('la misma URL por safeFetch a secas se aborta al llegar al tope general', async () => {
    escalaTopes();
    const res = await safeFetch(url);
    await expect(res.text()).rejects.toThrow();
  });
});
