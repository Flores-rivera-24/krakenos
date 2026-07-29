import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { decryptArchive, unpackArchive } from '../../src/system/backup.js';
import {
  authHeader,
  buildTestApp,
  eventually,
  resetDb,
  seedUser,
  signAccess,
} from '../helpers/app.js';

/** Copia de seguridad real (US-103): el endpoint produce un archivo cifrado restaurable. */
describe('backup del sistema (US-103)', () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildTestApp({ routes: true });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
    const admin = await seedUser(app, { role: 'admin' });
    adminToken = signAccess(app, admin);
    // Un dato real para comprobar que el snapshot de la DB lo contiene.
    await app.prisma.setting.create({ data: { key: 'homeName', value: 'Casa Kraken' } });
  });

  it('descarga un archivo cifrado que descifra e incluye la base de datos', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/system/backup',
      headers: authHeader(adminToken),
      payload: { passphrase: 'copia-larga-1' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/octet-stream');

    const blob = res.rawPayload;
    // Sin la passphrase correcta no se puede abrir.
    expect(() => decryptArchive(blob, 'incorrecta-1')).toThrow();

    const entries = unpackArchive(decryptArchive(blob, 'copia-larga-1'));
    const db = entries.find((e) => e.name === 'db/app.db');
    expect(db).toBeDefined();
    // El snapshot es un fichero SQLite real y contiene el valor sembrado.
    expect(db!.data.subarray(0, 16).toString('utf8')).toContain('SQLite format 3');
    expect(db!.data.includes(Buffer.from('Casa Kraken'))).toBe(true);
  });

  it('rechaza a un viewer (403)', async () => {
    const viewer = await seedUser(app, { email: 'v@krakenos.test', role: 'viewer' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/system/backup',
      headers: authHeader(signAccess(app, viewer)),
      payload: { passphrase: 'copia-larga-1' },
    });
    expect(res.statusCode).toBe(403);
  });
});

/**
 * Copias automáticas (US-233 / AUD3-21): antes la única red de seguridad era el
 * botón manual, así que un aparato 24/7 sobre una SD dependía de la memoria del
 * dueño. Todo es admin (lectura incluida): es superficie de seguridad.
 */
describe('copias de seguridad automáticas (US-233)', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let backupDir: string;

  beforeAll(async () => {
    backupDir = join(mkdtempSync(join(tmpdir(), 'krakenos-auto-routes-')), 'backups');
    app = await buildTestApp({ routes: true, autoBackupDir: backupDir });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
    const admin = await seedUser(app, { role: 'admin' });
    adminToken = signAccess(app, admin);
  });

  it('el estado arranca desactivado y sin contraseña', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/system/backup/auto',
      headers: authHeader(adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      frequency: 'off',
      passphraseSet: false,
      count: 0,
      stale: false, // desactivada no reprocha nada
    });
  });

  it('un viewer no puede ni LEER el estado (es superficie de seguridad)', async () => {
    const viewer = await seedUser(app, { email: 'v3@krakenos.test', role: 'viewer' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/system/backup/auto',
      headers: authHeader(signAccess(app, viewer)),
    });
    expect(res.statusCode).toBe(403);
  });

  it('genera la contraseña una vez, la deja consultable y hace una copia', async () => {
    const gen = await app.inject({
      method: 'POST',
      url: '/api/system/backup/auto/passphrase',
      headers: authHeader(adminToken),
      payload: {},
    });
    expect(gen.statusCode).toBe(200);
    const generated = gen.json().generated as string;
    expect(generated).toBeTruthy();

    // Se puede volver a consultar: una copia indescifrable no es una copia.
    const reveal = await app.inject({
      method: 'POST',
      url: '/api/system/backup/auto/passphrase/reveal',
      headers: authHeader(adminToken),
    });
    expect(reveal.json().passphrase).toBe(generated);

    // Y «copiar ahora» produce un archivo de verdad, restaurable con esa contraseña.
    const run = await app.inject({
      method: 'POST',
      url: '/api/system/backup/auto/run',
      headers: authHeader(adminToken),
    });
    expect(run.statusCode).toBe(200);
    expect(run.json().lastError).toBeNull();
    expect(run.json().count).toBe(1);

    const files = readdirSync(backupDir);
    expect(files).toHaveLength(1);
    const entries = unpackArchive(decryptArchive(readFileSync(join(backupDir, files[0]!)), generated));
    expect(entries.some((e) => e.name === 'db/app.db')).toBe(true);

    // Queda auditado (fire-and-forget).
    await eventually(async () => {
      const audit = await app.prisma.auditLog.findFirst({
        where: { action: 'system.backup.passphrase' },
      });
      expect(audit).not.toBeNull();
    });
  });

  it('sin contraseña, «copiar ahora» responde el fallo en vez de romper', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/system/backup/auto/run',
      headers: authHeader(adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().lastError).toMatch(/contraseña/i);
  });
});

/**
 * Restauración por subida en streaming (US-233 / AUD3-15): antes solo se podía
 * restaurar por base64 con `bodyLimit` de 64 MB, mientras la creación no tenía tope
 * → un backup grande era **creable pero no restaurable**.
 */
describe('restauración por subida directa (US-233)', () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildTestApp({ routes: true });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
    const admin = await seedUser(app, { role: 'admin' });
    adminToken = signAccess(app, admin);
    await app.prisma.setting.create({ data: { key: 'homeName', value: 'Casa Kraken' } });
  });

  /** Descarga un backup real por la ruta de backup, para restaurarlo después. */
  async function makeBackup(passphrase: string): Promise<Buffer> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/system/backup',
      headers: authHeader(adminToken),
      payload: { passphrase },
    });
    expect(res.statusCode).toBe(200);
    return res.rawPayload;
  }

  it('acepta el archivo binario y deja la restauración preparada', async () => {
    const blob = await makeBackup('copia-larga-1');
    const res = await app.inject({
      method: 'POST',
      url: '/api/system/restore/upload',
      headers: {
        ...authHeader(adminToken),
        'content-type': 'application/octet-stream',
        'x-restore-passphrase': 'copia-larga-1',
      },
      payload: blob,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().restartRequired).toBe(true);
    // La copia lleva al menos la DB; keys/ y data/ dependen del entorno de test.
    expect(res.json().staged).toBeGreaterThanOrEqual(1);
  });

  it('con la contraseña incorrecta responde 400 sin decir por qué falló el cifrado', async () => {
    const blob = await makeBackup('copia-larga-1');
    const res = await app.inject({
      method: 'POST',
      url: '/api/system/restore/upload',
      headers: {
        ...authHeader(adminToken),
        'content-type': 'application/octet-stream',
        'x-restore-passphrase': 'otra-passphrase-1',
      },
      payload: blob,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('RESTORE_INVALID');
  });

  it('sin la cabecera de contraseña responde 400 (y ya autenticado)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/system/restore/upload',
      headers: { ...authHeader(adminToken), 'content-type': 'application/octet-stream' },
      payload: Buffer.from('lo que sea'),
    });
    expect(res.statusCode).toBe(400);
  });

  it('una subida por encima del tope responde 413, no 400', async () => {
    // App aparte con un tope bajísimo: así se ejerce la cota sin subir 2 GB.
    const capped = await buildTestApp({ routes: true, maxRestoreBytes: 4096 });
    try {
      const admin = await seedUser(capped, { email: 'cap@krakenos.test', role: 'admin' });
      const res = await capped.inject({
        method: 'POST',
        url: '/api/system/restore/upload',
        headers: {
          ...authHeader(signAccess(capped, admin)),
          'content-type': 'application/octet-stream',
          'x-restore-passphrase': 'copia-larga-1',
        },
        payload: Buffer.alloc(8192, 1), // el doble del tope inyectado
      });
      expect(res.statusCode).toBe(413);
      expect(res.json().code).toBe('RESTORE_TOO_LARGE');
    } finally {
      await capped.close();
    }
  });

  it('rechaza a un viewer (403) antes de leer el cuerpo', async () => {
    const viewer = await seedUser(app, { email: 'v2@krakenos.test', role: 'viewer' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/system/restore/upload',
      headers: {
        ...authHeader(signAccess(app, viewer)),
        'content-type': 'application/octet-stream',
        'x-restore-passphrase': 'copia-larga-1',
      },
      payload: Buffer.from('x'),
    });
    expect(res.statusCode).toBe(403);
  });
});
