import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../helpers/app.js';

describe('GET /health', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('responde solo { status: ok }, sin filtrar driver ni uptime (US-58)', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    // Igualdad exacta: no debe exponer driver.kind ni uptime del proceso.
    expect(res.json()).toEqual({ status: 'ok' });
  });
});
