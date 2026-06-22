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

  it('connect-src se restringe al mismo origen, sin comodín ws:/wss: (anti-exfil, US-90)', () => {
    expect(DEFAULT_CSP).toContain("connect-src 'self'");
    // El comodín de esquema permitía exfiltrar el token a cualquier host por WebSocket.
    expect(DEFAULT_CSP).not.toMatch(/connect-src[^;]*\bws:/);
    expect(DEFAULT_CSP).not.toMatch(/connect-src[^;]*\bwss:/);
  });

  it('no permite scripts inline ni eval (script-src acotado a self)', () => {
    expect(DEFAULT_CSP).toContain("script-src 'self'");
    expect(DEFAULT_CSP).not.toContain("script-src 'unsafe-inline'");
    expect(DEFAULT_CSP).not.toContain('unsafe-eval');
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
