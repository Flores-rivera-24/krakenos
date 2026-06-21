import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BackupCodeService } from '../../src/webauthn/backup-codes.service.js';
import { buildTestApp, resetDb, seedUser } from '../helpers/app.js';

describe('BackupCodeService', () => {
  let app: FastifyInstance;
  let service: BackupCodeService;
  let userId: string;

  beforeAll(async () => {
    app = await buildTestApp();
    service = new BackupCodeService(app.prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
    userId = (await seedUser(app, { email: 'bc@krakenos.test' })).id;
  });

  it('genera 10 códigos y persiste solo el hash, nunca el texto plano (US-59)', async () => {
    const codes = await service.generate(userId);
    expect(codes).toHaveLength(10);

    const rows = await app.prisma.backupCode.findMany({ where: { userId } });
    expect(rows).toHaveLength(10);
    const hashes = rows.map((r) => r.codeHash);
    expect(hashes).not.toContain(codes[0]); // no se guarda en claro
    expect(hashes).toContain(createHash('sha256').update(codes[0]!).digest('hex'));
  });

  it('consume un código válido (true) y lo invalida: segundo intento false (US-59)', async () => {
    const codes = await service.generate(userId);
    expect(await service.remaining(userId)).toBe(10);

    expect(await service.consume(userId, codes[0]!)).toBe(true);
    expect(await service.remaining(userId)).toBe(9);
    // De un solo uso: el mismo código ya no vale.
    expect(await service.consume(userId, codes[0]!)).toBe(false);
  });

  it('rechaza un código inexistente (US-59)', async () => {
    await service.generate(userId);
    expect(await service.consume(userId, 'no-existe')).toBe(false);
  });

  it('generateIfNone solo genera si no hay; regenerar reemplaza el lote anterior (US-59)', async () => {
    const first = await service.generateIfNone(userId);
    expect(first).toHaveLength(10);
    expect(await service.generateIfNone(userId)).toBeNull(); // ya tenía

    await service.generate(userId); // regenera
    expect(await app.prisma.backupCode.count({ where: { userId } })).toBe(10); // reemplazo, no acumulación
    expect(await service.consume(userId, first![0]!)).toBe(false); // los viejos ya no valen
  });
});
