import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { decryptArchive, unpackArchive } from '../../src/system/backup.js';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

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
