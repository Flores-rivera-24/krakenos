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

  it('/health/ready comprueba la base de datos (US-115)', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ready' });
  });

  // US-233 / AUD3-21: con la SD en solo-lectura o el disco lleno, un `SELECT 1`
  // responde 200 mientras nada se persiste. La sonda ESCRIBE una fila canario, que
  // es la misma ruta (SQLite → WAL → fsync) que usa guardar cualquier cosa.
  it('/health/ready escribe de verdad, no solo lee (canario)', async () => {
    await app.prisma.setting.deleteMany({ where: { key: 'health.canary' } });
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    const canary = await app.prisma.setting.findUnique({ where: { key: 'health.canary' } });
    expect(canary).not.toBeNull();
    expect(Number.isNaN(Date.parse(canary!.value))).toBe(false);
  });

  it('el canario NO aparece entre los ajustes del sistema (no es un ajuste de usuario)', async () => {
    await app.inject({ method: 'GET', url: '/health/ready' });
    // `SYSTEM_SETTING_KEYS` es la allowlist de la API de ajustes; la clave del
    // canario vive fuera a propósito (como `alarm.pin` o `backup.autoPassphrase`).
    const { SYSTEM_SETTING_KEYS } = await import('@krakenos/types');
    expect(SYSTEM_SETTING_KEYS as readonly string[]).not.toContain('health.canary');
  });
});
