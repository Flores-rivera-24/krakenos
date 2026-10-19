import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureLocalCa } from '../../src/crypto/local-ca.js';
import { buildTestApp } from '../helpers/app.js';

/**
 * `GET /api/system/ca-cert`: el certificado PÚBLICO de la CA local. Sin auth, y
 * jamás una clave privada — ni aunque haya una al lado, ni aunque la ruta
 * configurada apunte por error a un fichero que la contiene.
 */
describe('GET /api/system/ca-cert', () => {
  let dir: string;
  let caPath: string;
  let keyPath: string;
  let app: FastifyInstance;
  let appSinCa: FastifyInstance;
  let appMezclado: FastifyInstance;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'kraken-cacert-'));
    await ensureLocalCa({
      certsDir: join(dir, 'certs'),
      keysDir: join(dir, 'keys'),
      hostname: 'casa',
      lanIps: ['192.168.1.50'],
    });
    caPath = join(dir, 'certs', 'krakenos-ca.pem');
    keyPath = join(dir, 'keys', 'krakenos-ca-key.pem');

    // Fichero «malo»: el certificado de la CA con una clave privada ANEXADA.
    const mezclado = join(dir, 'mezclado.pem');
    writeFileSync(mezclado, readFileSync(caPath, 'utf8') + readFileSync(keyPath, 'utf8'));

    app = await buildTestApp({ routes: true, caCertPath: caPath });
    appSinCa = await buildTestApp({ routes: true, caCertPath: join(dir, 'no-existe.pem') });
    appMezclado = await buildTestApp({ routes: true, caCertPath: mezclado });
  });

  afterAll(async () => {
    await app.close();
    await appSinCa.close();
    await appMezclado.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('sin token devuelve el PEM de la CA como descarga', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/system/ca-cert' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/x-x509-ca-cert');
    expect(res.headers['content-disposition']).toBe('attachment; filename="krakenos-ca.crt"');
    expect(res.body).toContain('BEGIN CERTIFICATE');
    expect(res.body.trim()).toBe(readFileSync(caPath, 'utf8').trim());
  });

  it('NO contiene ninguna clave privada aunque haya una en el disco', async () => {
    // Control positivo: la clave existe de verdad y es privada.
    expect(readFileSync(keyPath, 'utf8')).toContain('PRIVATE KEY');
    const res = await app.inject({ method: 'GET', url: '/api/system/ca-cert' });
    expect(res.body).not.toContain('PRIVATE KEY');
  });

  it('si la ruta configurada contiene además una clave, solo sale el certificado', async () => {
    const res = await appMezclado.inject({ method: 'GET', url: '/api/system/ca-cert' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('BEGIN CERTIFICATE');
    expect(res.body).not.toContain('PRIVATE KEY');
  });

  it('404 con el error compartido si no hay CA (instalación con Tailscale o sin HTTPS)', async () => {
    const res = await appSinCa.inject({ method: 'GET', url: '/api/system/ca-cert' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: 'CA_CERT_NOT_FOUND' });
  });
});
