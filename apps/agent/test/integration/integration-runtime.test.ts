import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSecretbox, generateSecretboxKey } from '../../src/config/secretbox.js';
import { IntegrationConfigStore } from '../../src/integrations/integration-config.store.js';
import { buildIntegrationRuntime } from '../../src/integrations/runtime.js';
import { buildTestApp } from '../helpers/app.js';

describe('IntegrationRuntime — hidratación DB/env + recarga en caliente (US-141)', () => {
  let app: FastifyInstance;
  let store: IntegrationConfigStore;

  beforeAll(async () => {
    app = await buildTestApp();
    store = new IntegrationConfigStore(app.prisma, createSecretbox(generateSecretboxKey()));
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await app.prisma.integrationConfig.deleteMany();
  });

  it('sin config guardada hidrata desde env (mock) y el handle responde', async () => {
    const rt = await buildIntegrationRuntime(app, store);
    expect(rt.driver.handle.kind).toBe('mock');
    // El handle delega en la instancia viva: un método del driver mock responde.
    await expect(rt.driver.handle.getWifi()).resolves.toBeTruthy();
  });

  it('reconfigure intercambia el driver en caliente sin re-registrar nada', async () => {
    const rt = await buildIntegrationRuntime(app, store);
    expect(rt.driver.handle.kind).toBe('mock');

    await store.save('driver', 'openwrt', {
      host: '192.168.1.1',
      username: 'root',
      password: 'x',
      sshPort: 22,
    });
    await rt.reconfigure('driver');

    // El MISMO handle (ya inyectado en las rutas) ahora apunta al driver OpenWrt.
    expect(rt.driver.handle.kind).toBe('openwrt');
  });

  it('una config guardada pero deshabilitada usa el fallback de env', async () => {
    await store.save('driver', 'openwrt', { host: '1.2.3.4', password: 'x' }, false);
    const rt = await buildIntegrationRuntime(app, store);
    expect(rt.driver.handle.kind).toBe('mock'); // ignora la config no activa
  });

  it('reconfigure reporta fallback:true si la config guardada no se puede aplicar (US-205)', async () => {
    const rt = await buildIntegrationRuntime(app, store);

    // Config guardada que hace lanzar a la factory (kind desconocido para el driver).
    await store.save('driver', 'kind-inexistente', { host: 'x' });
    const bad = await rt.reconfigure('driver');
    expect(bad.fallback).toBe(true);
    expect(rt.driver.handle.kind).toBe('mock'); // el vivo es el de .env

    // Con una config válida el flag vuelve a false.
    await store.save('driver', 'openwrt', { host: '192.168.1.1', username: 'root', password: 'x', sshPort: 22 });
    const ok = await rt.reconfigure('driver');
    expect(ok.fallback).toBe(false);
    expect(rt.driver.handle.kind).toBe('openwrt');
  });

  /**
   * US-229 / AUD3-16: recargar una integración cambiaba la instancia viva pero
   * nunca cerraba la saliente (los managers de red no exponían limpieza), y el
   * `onClose` del agente solo apagaba las cámaras. Cada «Probar conexión» y cada
   * reinicio dejaban sesiones SSH/SNMP abiertas contra el equipo del usuario.
   */
  it('reconfigure cierra el manager saliente y stopAll apaga todos los dominios', async () => {
    const rt = await buildIntegrationRuntime(app, store);

    const stops: string[] = [];
    const stub = (domain: string): { stop: () => Promise<void> } => ({
      stop: async () => {
        stops.push(domain);
      },
    });
    // Instancias vivas que registran su cierre (el swap cierra las originales).
    rt.driver.swap({ ...stub('driver'), kind: 'mock' } as never);
    rt.vpn.swap(stub('vpn') as never);
    rt.dns.swap(stub('dns') as never);

    // Recargar el driver cierra la instancia que sale.
    await store.save('driver', 'openwrt', { host: '192.168.1.1', username: 'root', password: 'x', sshPort: 22 });
    await rt.reconfigure('driver');
    expect(stops).toEqual(['driver']);

    // El apagado del agente cierra el resto de dominios vivos, no solo cámaras.
    await rt.stopAll();
    expect(stops).toContain('vpn');
    expect(stops).toContain('dns');
  });

  it('stopAll no se cuelga si un transporte muerto nunca devuelve el cierre', async () => {
    const rt = await buildIntegrationRuntime(app, store);
    // Un `stop()` que no resuelve jamás (socket SSH a un router que ya no está).
    rt.vpn.swap({ stop: () => new Promise<void>(() => undefined) } as never);

    // Sin la espera acotada, esto no volvería y el agente se quedaría cerrando.
    await expect(
      Promise.race([
        rt.stopAll().then(() => 'apagado'),
        new Promise((resolve) => setTimeout(() => resolve('colgado'), 8_000)),
      ]),
    ).resolves.toBe('apagado');
  }, 15_000);
});
