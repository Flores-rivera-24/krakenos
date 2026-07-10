import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import type { HardwareDriver, UserRole, VpnManager } from '@krakenos/types';
import bcrypt from 'bcrypt';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { io as ioClient, type Socket } from 'socket.io-client';
import { MockDriver } from '../../src/drivers/mock.driver.js';
import { wrapDriverErrors } from '../../src/drivers/driver-error.js';
import { auditRoutes } from '../../src/modules/audit/audit.routes.js';
import { authRoutes } from '../../src/modules/auth/auth.routes.js';
import { webauthnRoutes } from '../../src/modules/webauthn/webauthn.routes.js';
import { BackupCodeService } from '../../src/webauthn/backup-codes.service.js';
import { WebAuthnService } from '../../src/webauthn/webauthn.service.js';
import { camerasRoutes } from '../../src/modules/cameras/cameras.routes.js';
import { dnsRoutes } from '../../src/modules/dns/dns.routes.js';
import { firewallRoutes } from '../../src/modules/firewall/firewall.routes.js';
import { qosRoutes } from '../../src/modules/qos/qos.routes.js';
import { vlanRoutes } from '../../src/modules/vlan/vlan.routes.js';
import { inventoryRoutes } from '../../src/modules/inventory/inventory.routes.js';
import { InventoryService } from '../../src/modules/inventory/inventory.service.js';
import { accessRoutes } from '../../src/modules/access/access.routes.js';
import { AccessScheduleService } from '../../src/modules/access/access.service.js';
import { roomsRoutes } from '../../src/modules/rooms/rooms.routes.js';
import { RoomService } from '../../src/modules/rooms/rooms.service.js';
import { favoritesRoutes } from '../../src/modules/favorites/favorites.routes.js';
import { scenesRoutes } from '../../src/modules/scenes/scenes.routes.js';
import { SceneService } from '../../src/modules/scenes/scenes.service.js';
import { iotScheduleRoutes } from '../../src/modules/iot-schedule/iot-schedule.routes.js';
import { IotScheduleService } from '../../src/modules/iot-schedule/iot-schedule.service.js';
import { HomeEventBus } from '../../src/automations/event-bus.js';
import { automationsRoutes } from '../../src/modules/automations/automations.routes.js';
import { AutomationService } from '../../src/modules/automations/automations.service.js';
import { presenceRoutes } from '../../src/modules/presence/presence.routes.js';
import { PresenceService } from '../../src/modules/presence/presence.service.js';
import { discoveryRoutes } from '../../src/modules/discovery/discovery.routes.js';
import { DiscoveryService } from '../../src/modules/discovery/discovery.service.js';
import { pushRoutes } from '../../src/modules/push/push.routes.js';
import { PushService } from '../../src/modules/push/push.service.js';
import { alertsRoutes } from '../../src/modules/alerts/alerts.routes.js';
import { AlertConfigService } from '../../src/alerts/alert-config.js';
import { iotRoutes } from '../../src/modules/iot/iot.routes.js';
import { tuyaConfigRoutes } from '../../src/modules/iot/tuya-config.routes.js';
import { setupRoutes } from '../../src/modules/setup/setup.routes.js';
import { usersRoutes } from '../../src/modules/users/users.routes.js';
import { systemRoutes } from '../../src/modules/system/system.routes.js';
import { TrafficService } from '../../src/modules/traffic/traffic.service.js';
import { trafficRoutes } from '../../src/modules/traffic/traffic.routes.js';
import { EnergyService } from '../../src/modules/energy/energy.service.js';
import { energyRoutes } from '../../src/modules/energy/energy.routes.js';
import { EnergyAlertService } from '../../src/modules/energy/energy-alerts.service.js';
import { energyAlertsRoutes } from '../../src/modules/energy/energy-alerts.routes.js';
import { WellbeingService } from '../../src/modules/wellbeing/wellbeing.service.js';
import { wellbeingRoutes } from '../../src/modules/wellbeing/wellbeing.routes.js';
import { ReportsService } from '../../src/modules/reports/reports.service.js';
import { reportsRoutes } from '../../src/modules/reports/reports.routes.js';
import { vpnRoutes } from '../../src/modules/vpn/vpn.routes.js';
import { wifiRoutes } from '../../src/modules/wifi/wifi.routes.js';
import { coverageRoutes } from '../../src/modules/coverage/coverage.routes.js';
import { MockCameraManager } from '../../src/cameras/mock.cameras.js';
import { MockDnsManager } from '../../src/dns/mock.dns.js';
import { MockFirewallManager } from '../../src/firewall/mock.firewall.js';
import { MockIotManager } from '../../src/iot/mock.iot.js';
import type { TuyaDeviceRecord } from '../../src/iot/tuya.store.js';
import type { CameraDefinition } from '../../src/cameras/rtsp.cameras.js';
import { MemoryJsonStore, type JsonStore } from '../../src/store/json-store.js';
import { MockQosManager } from '../../src/qos/mock.qos.js';
import { MockVlanManager } from '../../src/vlan/mock.vlan.js';
import { MockVpnManager } from '../../src/vpn/mock.vpn.js';
import { auditPlugin } from '../../src/plugins/audit.js';
import { authPlugin } from '../../src/plugins/auth.js';
import { healthRoutes } from '../../src/plugins/health.js';
import { prismaPlugin } from '../../src/plugins/prisma.js';
import { socketioPlugin } from '../../src/plugins/socketio.js';
import { createSecretbox, generateSecretboxKey } from '../../src/config/secretbox.js';
import { IntegrationConfigStore } from '../../src/integrations/integration-config.store.js';
import { buildIntegrationRuntime } from '../../src/integrations/runtime.js';
import { integrationsRoutes } from '../../src/modules/integrations/integrations.routes.js';

export interface BuildTestAppOptions {
  /** Registra también las rutas HTTP (para tests de integración con inject). */
  routes?: boolean;
  /**
   * Driver a inyectar en las rutas; por defecto un `MockDriver` nuevo. Acepta
   * cualquier `HardwareDriver` (p. ej. `FailingDriver`) para probar caminos de fallo.
   */
  driver?: HardwareDriver;
  /** Gestor de VPN a inyectar; por defecto un `MockVpnManager` nuevo. */
  vpn?: VpnManager;
  /** Registra `@fastify/rate-limit` (global:false) como en producción. */
  rateLimit?: boolean;
  /** Store inyectado en las rutas de config Tuya; por defecto uno en memoria nuevo. */
  tuyaStore?: JsonStore<TuyaDeviceRecord>;
  /** Store inyectado en la gestión de cámaras (US-148); por defecto uno en memoria. */
  cameraStore?: JsonStore<CameraDefinition>;
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
  await app.register(cookie); // refresh token en cookie httpOnly (US-91)
  await app.register(prismaPlugin);
  await app.register(auditPlugin);
  await app.register(authPlugin);
  await app.register(socketioPlugin);
  await app.register(healthRoutes);

  if (opts.routes) {
    // Mismo envoltorio que producción: fallos del driver → 502 tipados (US-98).
    const driver = wrapDriverErrors(opts.driver ?? new MockDriver());
    // Instancia compartida (no arrancamos su barrido en tests: sin timers).
    const inventoryService = new InventoryService(app, driver);
    // Push: decorado como en producción (las claves VAPID se generan al vuelo).
    const pushService = new PushService(app);
    app.decorate('push', pushService);
    await app.register(setupRoutes, { prefix: '/api/setup' });
    await app.register(authRoutes, { prefix: '/api/auth' });
    await app.register(usersRoutes, { prefix: '/api/users' });
    await app.register(webauthnRoutes, {
      prefix: '/api/webauthn',
      service: new WebAuthnService(app.prisma, {
        rpName: 'KrakenOS',
        rpID: 'localhost',
        origin: 'http://localhost:5173',
      }),
      backupCodes: new BackupCodeService(app.prisma),
    });
    await app.register(inventoryRoutes, { prefix: '/api/inventory', driver, service: inventoryService });
    await app.register(accessRoutes, {
      prefix: '/api/access',
      service: new AccessScheduleService(app, driver),
    });
    // Habitaciones/grupos (US-165) + favoritos (US-170). El `RoomService` comparte
    // el mismo `MockIotManager` que las rutas IoT para que la acción de grupo y el
    // estado agregado reflejen los mismos dispositivos.
    const sharedIot = new MockIotManager();
    await app.register(roomsRoutes, {
      prefix: '/api/rooms',
      service: new RoomService(app, sharedIot, inventoryService),
    });
    await app.register(favoritesRoutes, { prefix: '/api/favorites' });
    const sceneServiceForTests = new SceneService(app, sharedIot);
    await app.register(scenesRoutes, { prefix: '/api/scenes', service: sceneServiceForTests });
    // Horarios IoT (US-168). No arrancamos el barrido en tests (sin timers).
    await app.register(iotScheduleRoutes, {
      prefix: '/api/iot-schedules',
      service: new IotScheduleService(app, sharedIot, sceneServiceForTests),
    });
    // Automatizaciones (US-167). Sin timers ni watcher: los tests publican en el
    // bus o llaman a `tick()` a mano. El bus se comparte con presencia (US-169),
    // como en producción.
    const homeBus = new HomeEventBus();
    await app.register(automationsRoutes, {
      prefix: '/api/automations',
      service: new AutomationService(app, {
        iot: sharedIot,
        scenes: sceneServiceForTests,
        inventory: inventoryService,
        access: new AccessScheduleService(app, driver),
        bus: homeBus,
      }),
    });
    // Presencia + modos del hogar (US-169). Sin timers: los tests llaman a
    // `onEvent()`/`tick()` a mano o publican en el bus.
    await app.register(presenceRoutes, {
      prefix: '/api/presence',
      service: new PresenceService(app, homeBus),
    });
    // Auto-descubrimiento (US-175) con transporte inerte: los tests nunca abren
    // sockets multicast reales (los de comportamiento inyectan un fake propio).
    await app.register(discoveryRoutes, {
      prefix: '/api/discovery',
      service: new DiscoveryService(app, { probe: async () => [] }),
    });
    await app.register(wifiRoutes, { prefix: '/api/wifi', driver });
    await app.register(coverageRoutes, { prefix: '/api/coverage', driver });
    await app.register(systemRoutes, { prefix: '/api/system', driver, inventoryService });
    const vpn = opts.vpn ?? new MockVpnManager({ endpoint: 'vpn.test', listenPort: 51820 });
    await app.register(vpnRoutes, { prefix: '/api/vpn', vpn });
    await app.register(auditRoutes, { prefix: '/api/audit' });
    await app.register(pushRoutes, { prefix: '/api/push', service: pushService });
    await app.register(alertsRoutes, { prefix: '/api/alerts', service: new AlertConfigService(app) });
    // Sin arrancar el intervalo: los tests muestrean manualmente vía el servicio.
    await app.register(trafficRoutes, { prefix: '/api/traffic', service: new TrafficService(app, driver) });
    // Energía (US-181/182): sin arrancar timers; los tests consultan vía servicio.
    const energyService = new EnergyService(app, new MockIotManager());
    await app.register(energyRoutes, { prefix: '/api/energy', service: energyService });
    // Alertas de energía (US-183): sin arrancar el timer; el tick se invoca a mano.
    await app.register(energyAlertsRoutes, {
      prefix: '/api/energy/alerts',
      service: new EnergyAlertService(app, sharedIot, homeBus),
    });
    await app.register(wellbeingRoutes, {
      prefix: '/api/wellbeing',
      service: new WellbeingService(app),
    });
    await app.register(reportsRoutes, {
      prefix: '/api/reports',
      service: new ReportsService(app, new TrafficService(app, driver), energyService),
    });
    await app.register(iotRoutes, { prefix: '/api/iot', iot: new MockIotManager() });
    await app.register(tuyaConfigRoutes, {
      prefix: '/api/iot/tuya',
      store: opts.tuyaStore ?? new MemoryJsonStore<TuyaDeviceRecord>(),
    });
    await app.register(camerasRoutes, {
      prefix: '/api/cameras',
      cameras: new MockCameraManager(),
      store: opts.cameraStore ?? new MemoryJsonStore<CameraDefinition>(),
    });
    await app.register(firewallRoutes, { prefix: '/api/firewall', firewall: new MockFirewallManager() });
    await app.register(vlanRoutes, { prefix: '/api/vlans', vlan: new MockVlanManager() });
    await app.register(qosRoutes, { prefix: '/api/qos', qos: new MockQosManager() });
    await app.register(dnsRoutes, { prefix: '/api/dns', dns: new MockDnsManager() });
    // Configuración de integraciones (US-142): runtime + store propios para el test app.
    const integrationStore = new IntegrationConfigStore(
      app.prisma,
      createSecretbox(generateSecretboxKey()),
    );
    const runtime = await buildIntegrationRuntime(app, integrationStore);
    await app.register(integrationsRoutes, {
      prefix: '/api/integrations',
      runtime,
      store: integrationStore,
    });
  }

  await app.ready();
  return app;
}

/** Vacía todas las tablas para aislar cada test. */
export async function resetDb(app: FastifyInstance): Promise<void> {
  await app.prisma.refreshToken.deleteMany();
  await app.prisma.auditLog.deleteMany();
  await app.prisma.trafficSample.deleteMany();
  await app.prisma.deviceTrafficSample.deleteMany();
  await app.prisma.pushSubscription.deleteMany();
  await app.prisma.webAuthnCredential.deleteMany();
  await app.prisma.backupCode.deleteMany();
  await app.prisma.favorite.deleteMany();
  await app.prisma.iotRoomMember.deleteMany();
  await app.prisma.device.deleteMany();
  await app.prisma.room.deleteMany();
  await app.prisma.scene.deleteMany();
  await app.prisma.iotSchedule.deleteMany();
  await app.prisma.automationRun.deleteMany();
  await app.prisma.automationRule.deleteMany();
  await app.prisma.presenceEvent.deleteMany();
  await app.prisma.accessSchedule.deleteMany();
  await app.prisma.alertRule.deleteMany();
  await app.prisma.floorPlan.deleteMany(); // cascada a SurveyScan y SurveySample
  await app.prisma.integrationConfig.deleteMany();
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

/**
 * Firma un token efímero `mfa-pending` (US-51) para un usuario. Con `expired: true`
 * usa `clockTimestamp` (una hora en el pasado) para situar `iat`/`exp` en el pasado y
 * producir un token ya expirado, sin esperas reales en el test.
 */
export function signMfaPending(
  app: FastifyInstance,
  userId: string,
  opts: { expired?: boolean; jti?: string } = {},
): string {
  const signOptions = opts.expired
    ? { expiresIn: 120, clockTimestamp: Date.now() - 60 * 60 * 1000 }
    : { expiresIn: 120 };
  // `jti` único (anti-replay, US-88); se puede fijar para tests de replay.
  return app.jwt.sign({ sub: userId, type: 'mfa-pending', jti: opts.jti ?? randomUUID() }, signOptions);
}

/** Header de autorización `Bearer` listo para inject. */
export function authHeader(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

/** Extrae el valor de la cookie del refresh token de una respuesta de inject (US-91). */
export function refreshCookie(res: { cookies: Array<{ name: string; value: string }> }): string {
  return res.cookies.find((c) => c.name === 'krakenos_rt')?.value ?? '';
}

/** Cookies para inject que envían el refresh token (US-91). */
export function refreshCookieHeader(token: string): { krakenos_rt: string } {
  return { krakenos_rt: token };
}

/**
 * Conecta un cliente Socket.io **autenticado**: firma un access token al vuelo y
 * lo envía en el handshake (`auth.token`), como exige el middleware del agente.
 * El middleware solo valida la firma/tipo del JWT, así que no hace falta que el
 * usuario exista en la DB.
 */
export function connectSocket(
  app: FastifyInstance,
  baseUrl: string,
  user: { id: string; email: string; role: UserRole } = {
    id: 'sock-user',
    email: 'sock@krakenos.test',
    role: 'admin',
  },
): Socket {
  return ioClient(baseUrl, {
    transports: ['websocket'],
    forceNew: true,
    auth: { token: signAccess(app, user) },
  });
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
