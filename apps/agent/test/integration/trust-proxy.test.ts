import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { parseTrustProxy } from '../../src/config/env.js';

/**
 * Verifica que el valor parseado de `TRUST_PROXY` (US-76, F2) gobierna `req.ip`:
 * sin confianza, una `X-Forwarded-For` falsificada NO altera la IP; con un nº de
 * hops o una lista de proxies de confianza, sí se honra. Así un cliente no puede
 * suplantar su IP (rate limit / auditoría) salvo que haya un proxy declarado.
 */
async function ipFor(trustProxyRaw: string | undefined, xff: string): Promise<string> {
  const app = Fastify({ trustProxy: parseTrustProxy(trustProxyRaw) });
  app.get('/ip', async (req) => ({ ip: req.ip }));
  try {
    const res = await app.inject({
      method: 'GET',
      url: '/ip',
      headers: { 'x-forwarded-for': xff },
      remoteAddress: '127.0.0.1',
    });
    return res.json().ip as string;
  } finally {
    await app.close();
  }
}

describe('trustProxy gobierna req.ip (US-76, F2)', () => {
  it('sin confianza ignora X-Forwarded-For (no se puede falsificar la IP)', async () => {
    expect(await ipFor('false', '1.2.3.4')).toBe('127.0.0.1');
    expect(await ipFor(undefined, '1.2.3.4')).toBe('127.0.0.1');
  });

  it('con nº de hops honra la IP real del cliente vía XFF', async () => {
    expect(await ipFor('1', '1.2.3.4')).toBe('1.2.3.4');
  });

  it('con lista de proxies de confianza honra XFF si el peer está en la lista', async () => {
    expect(await ipFor('127.0.0.1', '1.2.3.4')).toBe('1.2.3.4');
  });

  it('con una lista que NO incluye al peer, ignora XFF', async () => {
    expect(await ipFor('10.0.0.1', '1.2.3.4')).toBe('127.0.0.1');
  });
});
