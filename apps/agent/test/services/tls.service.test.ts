import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { TlsService } from '../../src/modules/system/tls.service.js';

/**
 * Vigilancia del certificado TLS (US-241). Lo que se ata aquí es lo que rompía la
 * instalación a los 90 días **sin un solo error**: el certificado del disco se
 * renovaba y el proceso seguía presentando el viejo, porque solo se leía al
 * arrancar.
 */

/** Genera un par cert/clave con la validez pedida y devuelve sus rutas. */
function generarPar(dias: number, cn = 'krakenos.local'): { cert: string; key: string } {
  const dir = mkdtempSync(join(tmpdir(), 'krakenos-tlssvc-'));
  const cert = join(dir, 'cert.pem');
  const key = join(dir, 'key.pem');
  execFileSync(
    'openssl',
    ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
      '-days', String(dias), '-subj', `/CN=${cn}`],
    { stdio: 'pipe' },
  );
  return { cert, key };
}

/** Fastify falso: solo lo que toca el servicio. */
function fakeApp(server: unknown = {}) {
  const audits: { action: string; detail?: string }[] = [];
  const app = {
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    audit: (entry: { action: string; detail?: string }) => audits.push(entry),
    server,
  } as unknown as FastifyInstance;
  return { app, audits };
}

describe('TlsService (US-241)', () => {
  it('sin TLS propio declara qué funciones quedan inertes', () => {
    const { app } = fakeApp();
    const svc = new TlsService(app, { certPath: null, keyPath: null, behindProxy: false });
    const status = svc.getStatus();
    expect(status.enabled).toBe(false);
    // Tres features entregadas que no arrancan, nombradas una a una.
    expect(status.disabledFeatures).toEqual(['pwa', 'push', 'passkeys']);
  });

  it('tras un proxy que termina TLS, no se declaran funciones caídas', () => {
    const { app } = fakeApp();
    const svc = new TlsService(app, { certPath: null, keyPath: null, behindProxy: true });
    expect(svc.getStatus().disabledFeatures).toEqual([]);
  });

  it('lee el certificado del disco y publica su validez y origen', async () => {
    const { cert, key } = generarPar(90, 'casa.tailnet-abc.ts.net');
    const { app } = fakeApp();
    const svc = new TlsService(app, { certPath: cert, keyPath: key, behindProxy: false });

    const status = await svc.check();
    expect(status.enabled).toBe(true);
    expect(status.source).toBe('tailscale');
    expect(status.notAfter).not.toBeNull();
    expect(status.daysLeft).toBeGreaterThan(80);
    expect(status.expiring).toBe(false);
    expect(status.disabledFeatures).toEqual([]);
  });

  it('aplica EN CALIENTE el certificado renovado, sin reiniciar', async () => {
    const { cert, key } = generarPar(30);
    const setSecureContext = vi.fn();
    const { app, audits } = fakeApp({ setSecureContext });
    const svc = new TlsService(app, { certPath: cert, keyPath: key, behindProxy: false });

    // Primera lectura: fija la base, no re-aplica nada (el servidor ya arrancó con él).
    await svc.check();
    expect(setSecureContext).not.toHaveBeenCalled();

    // Alguien (el timer de `tailscale cert`) renueva el fichero.
    const renovado = generarPar(90);
    writeFileSync(cert, readFileSync(renovado.cert, 'utf8'));
    writeFileSync(key, readFileSync(renovado.key, 'utf8'));

    const status = await svc.check();
    expect(setSecureContext).toHaveBeenCalledTimes(1);
    expect(status.daysLeft).toBeGreaterThan(80);
    expect(audits.some((a) => a.action === 'system.tls_reloaded')).toBe(true);
  });

  it('no re-aplica el contexto si el fichero no cambió', async () => {
    const { cert, key } = generarPar(30);
    const setSecureContext = vi.fn();
    const { app } = fakeApp({ setSecureContext });
    const svc = new TlsService(app, { certPath: cert, keyPath: key, behindProxy: false });

    await svc.check();
    await svc.check();
    await svc.check();
    expect(setSecureContext).not.toHaveBeenCalled();
  });

  it('avisa por el catálogo de alertas cuando entra en la ventana', async () => {
    const { cert, key } = generarPar(10); // dentro de los 21 días de aviso
    const { app, audits } = fakeApp();
    const svc = new TlsService(app, { certPath: cert, keyPath: key, behindProxy: false });

    await svc.check();
    const aviso = audits.find((a) => a.action === 'system.tls_expiring');
    expect(aviso).toBeDefined();
    expect(aviso?.detail).toMatch(/caduca en \d+ día/);
  });

  it('no repite el aviso en cada barrido (cooldown diario)', async () => {
    const { cert, key } = generarPar(10);
    let ahora = new Date('2026-07-30T00:00:00.000Z');
    const { app, audits } = fakeApp();
    const svc = new TlsService(app, {
      certPath: cert,
      keyPath: key,
      behindProxy: false,
      now: () => ahora,
    });

    await svc.check();
    ahora = new Date(ahora.getTime() + 60 * 60_000); // +1 h (el barrido es horario)
    await svc.check();
    expect(audits.filter((a) => a.action === 'system.tls_expiring')).toHaveLength(1);

    // Al día siguiente sí vuelve a avisar: sigue sin renovarse.
    ahora = new Date(ahora.getTime() + 25 * 60 * 60_000);
    await svc.check();
    expect(audits.filter((a) => a.action === 'system.tls_expiring')).toHaveLength(2);
  });

  it('un fichero ilegible conserva el último estado conocido, no lo borra', async () => {
    const { cert, key } = generarPar(90);
    const { app } = fakeApp();
    const svc = new TlsService(app, { certPath: cert, keyPath: key, behindProxy: false });
    const bueno = await svc.check();

    // El fichero desaparece a mitad de una renovación.
    const svcRoto = new TlsService(app, {
      certPath: join(tmpdir(), 'no-existe-krakenos.pem'),
      keyPath: key,
      behindProxy: false,
    });
    const status = await svcRoto.check();
    // El servidor sigue sirviendo con lo que tenía: no se inventa un estado peor.
    expect(status.enabled).toBe(true);
    expect(status.expired).toBe(false);
    expect(bueno.daysLeft).toBeGreaterThan(80);
  });

  it('un certificado corrupto no tumba el barrido', async () => {
    const { cert, key } = generarPar(90);
    const { app } = fakeApp();
    const svc = new TlsService(app, { certPath: cert, keyPath: key, behindProxy: false });
    await svc.check();

    writeFileSync(cert, 'esto ya no es un certificado');
    await expect(svc.check()).resolves.toBeDefined();
  });

  it('sin soporte de recarga lo DICE, en vez de fingir que aplicó', async () => {
    const { cert, key } = generarPar(30);
    const { app } = fakeApp({}); // servidor sin `setSecureContext` (HTTP puro)
    const svc = new TlsService(app, { certPath: cert, keyPath: key, behindProxy: false });
    await svc.check();

    const renovado = generarPar(90);
    writeFileSync(cert, readFileSync(renovado.cert, 'utf8'));
    await svc.check();

    expect(app.log.warn).toHaveBeenCalledWith(expect.stringContaining('recarga en caliente'));
  });
});
