import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerWebStatic } from '../../src/plugins/web.js';

let app: FastifyInstance;
let dist: string;

beforeAll(async () => {
  dist = mkdtempSync(join(tmpdir(), 'krakenos-web-'));
  mkdirSync(join(dist, 'assets'), { recursive: true });
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>KrakenOS</title>');
  writeFileSync(join(dist, 'assets', 'app.js'), 'console.log("hola")');

  app = Fastify();
  // Una ruta de API real para comprobar que tiene prioridad sobre el comodín.
  app.get('/api/ping', async () => ({ pong: true }));
  registerWebStatic(app, dist);
  await app.ready();
});

afterAll(async () => app.close());

describe('registerWebStatic', () => {
  it('sirve index.html en la raíz', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('KrakenOS');
  });

  it('sirve un asset con su content-type', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('javascript');
    expect(res.body).toContain('hola');
  });

  it('cae a index.html en rutas desconocidas (SPA)', async () => {
    const res = await app.inject({ method: 'GET', url: '/dashboard/algo' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('KrakenOS');
  });

  it('deja las rutas de API al backend (prioridad y 404 para inexistentes)', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/ping' })).json()).toEqual({ pong: true });
    const missing = await app.inject({ method: 'GET', url: '/api/no-existe' });
    expect(missing.statusCode).toBe(404);
    expect(missing.headers['content-type']).toContain('application/json');
  });

  it('no escapa del directorio del build', async () => {
    const res = await app.inject({ method: 'GET', url: '/../../../../etc/passwd' });
    // No expone ficheros del sistema: cae al index.html.
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('KrakenOS');
  });
});
