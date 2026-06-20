import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CSP, securityHeadersPlugin } from '../../src/plugins/security-headers.js';

async function appWith(opts: { csp?: string; hsts?: boolean } = {}) {
  const app = Fastify({ logger: false });
  await app.register(securityHeadersPlugin, opts);
  app.get('/x', async () => ({ ok: true }));
  await app.ready();
  return app;
}

describe('securityHeadersPlugin', () => {
  it('añade las cabeceras de seguridad por defecto', async () => {
    const app = await appWith();
    const res = await app.inject({ method: 'GET', url: '/x' });
    expect(res.headers['content-security-policy']).toBe(DEFAULT_CSP);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(res.headers['permissions-policy']).toContain('camera=()');
    await app.close();
  });

  it('no envía HSTS salvo que se active', async () => {
    const app = await appWith();
    const res = await app.inject({ method: 'GET', url: '/x' });
    expect(res.headers['strict-transport-security']).toBeUndefined();
    await app.close();
  });

  it('envía HSTS y CSP personalizada cuando se configuran', async () => {
    const csp = "default-src 'self'";
    const app = await appWith({ hsts: true, csp });
    const res = await app.inject({ method: 'GET', url: '/x' });
    expect(res.headers['strict-transport-security']).toContain('max-age=');
    expect(res.headers['content-security-policy']).toBe(csp);
    await app.close();
  });

  it('aplica las cabeceras también a respuestas 404', async () => {
    const app = await appWith();
    const res = await app.inject({ method: 'GET', url: '/no-existe' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['x-frame-options']).toBe('DENY');
    await app.close();
  });
});
