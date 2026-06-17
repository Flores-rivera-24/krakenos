import rateLimit from '@fastify/rate-limit';
import type { UserRole, VpnManager } from '@krakenos/types';
import bcrypt from 'bcrypt';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { MockDriver } from '../../src/drivers/mock.driver.js';
import { auditRoutes } from '../../src/modules/audit/audit.routes.js';
import { authRoutes } from '../../src/modules/auth/auth.routes.js';
import { inventoryRoutes } from '../../src/modules/inventory/inventory.routes.js';
import { iotRoutes } from '../../src/modules/iot/iot.routes.js';
import { setupRoutes } from '../../src/modules/setup/setup.routes.js';
import { systemRoutes } from '../../src/modules/system/system.routes.js';
import { TrafficService } from '../../src/modules/traffic/traffic.service.js';
import { trafficRoutes } from '../../src/modules/traffic/traffic.routes.js';
import { vpnRoutes } from '../../src/modules/vpn/vpn.routes.js';
import { wifiRoutes } from '../../src/modules/wifi/wifi.routes.js';
import { MockIotManager } from '../../src/iot/mock.iot.js';
import { MockVpnManager } from '../../src/vpn/mock.vpn.js';
import { auditPlugin } from '../../src/plugins/audit.js';
import { authPlugin } from '../../src/plugins/auth.js';
import { prismaPlugin } from '../../src/plugins/prisma.js';
import { socketioPlugin } from '../../src/plugins/socketio.js';

export interface BuildTestAppOptions {
  /** Registra también las rutas HTTP (para tests de integración con inject). */
  routes?: boolean;
  /** Driver a inyectar en las rutas; por defecto un `MockDriver` nuevo. */
  driver?: MockDriver;
  /** Gestor de VPN a inyectar; por defecto un `MockVpnManager` nuevo. */
  vpn?: VpnManager;
  /** Registra `@fastify/rate-limit` (global:false) como en producción. */
  rateLimit?: boolean;
}

/**
 * Construye una instancia de Fastify para pruebas: mismos plugins que el
 * servidor real (prisma, audit, auth JWT, socket.io) pero sin logger,
 * rate-limit ni CORS. Con `routes: true` monta además los módulos HTTP.
 */
export async function buildTestApp(opts: BuildTestAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  if (opts.rateLimit) {
    await app.register(rateLimit, { global: false });
  }
  await app.register(prismaPlugin);
  await app.register(auditPlugin);
  await app.register(authPlugin);
  await app.register(socketioPlugin);

  if (opts.routes) {
    const driver = opts.driver ?? new MockDriver();
    await app.register(setupRoutes, { prefix: '/api/setup' });
    await app.register(authRoutes, { prefix: '/api/auth' });
    await app.register(inventoryRoutes, { prefix: '/api/inventory', driver });
    await app.register(wifiRoutes, { prefix: '/api/wifi', driver });
    await app.register(systemRoutes, { prefix: '/api/system' });
    const vpn = opts.vpn ?? new MockVpnManager({ endpoint: 'vpn.test', listenPort: 51820 });
    await app.register(vpnRoutes, { prefix: '/api/vpn', vpn });
    await app.register(auditRoutes, { prefix: '/api/audit' });
    // Sin arrancar el intervalo: los tests muestrean manualmente vía el servicio.
    await app.register(trafficRoutes, { prefix: '/api/traffic', service: new TrafficService(app, driver) });
    await app.register(iotRoutes, { prefix: '/api/iot', iot: new MockIotManager() });
  }

  await app.ready();
  return app;
}

/** Vacía todas las tablas para aislar cada test. */
export async function resetDb(app: FastifyInstance): Promise<void> {
  await app.prisma.refreshToken.deleteMany();
  await app.prisma.auditLog.deleteMany();
  await app.prisma.device.deleteMany();
  await app.prisma.setting.deleteMany();
  await app.prisma.user.deleteMany();
}

export interface SeedUserOptions {
  email?: string;
  password?: string;
  displayName?: string;
  role?: UserRole;
}

/** Crea un usuario con contraseña hasheada y lo devuelve junto a la contraseña en claro. */
export async function seedUser(
  app: FastifyInstance,
  opts: SeedUserOptions = {},
): Promise<{ id: string; email: string; role: UserRole; password: string }> {
  const email = opts.email ?? 'admin@krakenos.test';
  const password = opts.password ?? 'password123';
  const role = opts.role ?? 'admin';
  const passwordHash = await bcrypt.hash(password, 4); // cost bajo: tests rápidos
  const user = await app.prisma.user.create({
    data: { email, displayName: opts.displayName ?? 'Tester', passwordHash, role },
  });
  return { id: user.id, email, role, password };
}

/** Firma un access token válido para el usuario dado. */
export function signAccess(
  app: FastifyInstance,
  user: { id: string; email: string; role: UserRole },
): string {
  return app.jwt.sign({ sub: user.id, email: user.email, role: user.role, type: 'access' });
}

/** Header de autorización `Bearer` listo para inject. */
export function authHeader(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

/** Pausa `ms` milisegundos. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reintenta `fn` hasta que no lance o se agote `timeout`. Útil para asertar
 * efectos asíncronos best-effort (p. ej. el audit log se escribe sin await).
 */
export async function eventually<T>(
  fn: () => Promise<T> | T,
  timeout = 2000,
  interval = 25,
): Promise<T> {
  const start = Date.now();
  let lastErr: unknown;
  do {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      await sleep(interval);
    }
  } while (Date.now() - start < timeout);
  throw lastErr;
}

/** Arranca el servidor en un puerto efímero local y devuelve la URL base. */
export async function listenOnEphemeralPort(app: FastifyInstance): Promise<string> {
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (!address || typeof address === 'string') {
    throw new Error('No se pudo determinar el puerto del servidor de pruebas');
  }
  return `http://127.0.0.1:${address.port}`;
}
