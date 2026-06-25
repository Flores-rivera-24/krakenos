import type { FastifyInstance } from 'fastify';
import { afterAll, describe, expect, it } from 'vitest';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';
import { FailingDriver } from '../helpers/failing-driver.js';

/**
 * Ramas `ok:false` de `POST /api/system/connectivity-test` que el driver mock
 * (healthcheck siempre `true`) nunca toca (US-99). Se ejercen con el
 * `FailingDriver` de US-98:
 *  - healthcheck que devuelve `false` → `{ ok:false, error:'…no respondió…' }`.
 *  - healthcheck que lanza → rama `catch` → `{ ok:false, error:<mensaje> }`.
 */
describe('POST /api/system/connectivity-test — ramas de fallo (US-99)', () => {
  const apps: FastifyInstance[] = [];

  async function appWith(driver: FailingDriver): Promise<{ app: FastifyInstance; token: string }> {
    const app = await buildTestApp({ routes: true, driver });
    apps.push(app);
    await resetDb(app);
    const admin = await seedUser(app, { role: 'admin' });
    return { app, token: signAccess(app, admin) };
  }

  afterAll(async () => {
    await Promise.all(apps.map((a) => a.close()));
  });

  it('healthcheck que devuelve false → ok:false con mensaje de "no respondió"', async () => {
    const { app, token } = await appWith(new FailingDriver('empty'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/system/connectivity-test',
      headers: authHeader(token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: false });
    expect(res.json().error).toMatch(/no respondió/i);
  });

  it('healthcheck que lanza → rama catch → ok:false con el mensaje del error', async () => {
    const { app, token } = await appWith(new FailingDriver('throw'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/system/connectivity-test',
      headers: authHeader(token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(false);
    expect(typeof res.json().error).toBe('string');
    expect(res.json().error.length).toBeGreaterThan(0);
  });
});
