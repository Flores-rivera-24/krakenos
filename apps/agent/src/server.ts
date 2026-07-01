import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { env, trustProxyWarnings } from './config/env.js';
import { checkSecretFilePermissions } from './config/secret-permissions.js';
import { loadOrCreateSecretbox } from './config/secretbox.js';
import { IntegrationConfigStore } from './integrations/integration-config.store.js';
import { buildIntegrationRuntime } from './integrations/runtime.js';
import { FileJsonStore } from './store/json-store.js';
import type { CameraDefinition } from './cameras/rtsp.cameras.js';
import { auditPlugin } from './plugins/audit.js';
import { authPlugin } from './plugins/auth.js';
import { healthRoutes } from './plugins/health.js';
import { prismaPlugin } from './plugins/prisma.js';
import { securityHeadersPlugin } from './plugins/security-headers.js';
import { socketioPlugin } from './plugins/socketio.js';
import { registerWebStatic } from './plugins/web.js';
import { auditRoutes } from './modules/audit/audit.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { webauthnRoutes } from './modules/webauthn/webauthn.routes.js';
import { BackupCodeService } from './webauthn/backup-codes.service.js';
import { WebAuthnService, webauthnConfigWarnings } from './webauthn/webauthn.service.js';
import { inventoryRoutes } from './modules/inventory/inventory.routes.js';
import { InventoryService } from './modules/inventory/inventory.service.js';
import { pushRoutes } from './modules/push/push.routes.js';
import { PushService } from './modules/push/push.service.js';
import { setupRoutes } from './modules/setup/setup.routes.js';
import { setupToken } from './modules/setup/setup-token.js';
import { camerasRoutes } from './modules/cameras/cameras.routes.js';
import { dnsRoutes } from './modules/dns/dns.routes.js';
import { integrationsRoutes } from './modules/integrations/integrations.routes.js';
import { firewallRoutes } from './modules/firewall/firewall.routes.js';
import { iotRoutes } from './modules/iot/iot.routes.js';
import { tuyaConfigRoutes } from './modules/iot/tuya-config.routes.js';
import { qosRoutes } from './modules/qos/qos.routes.js';
import { vlanRoutes } from './modules/vlan/vlan.routes.js';
import { systemRoutes } from './modules/system/system.routes.js';
import { TrafficService } from './modules/traffic/traffic.service.js';
import { trafficRoutes } from './modules/traffic/traffic.routes.js';
import { vpnRoutes } from './modules/vpn/vpn.routes.js';
import { wifiRoutes } from './modules/wifi/wifi.routes.js';

/** Construye la instancia de Fastify con todos los plugins y rutas. */
export async function buildServer(): Promise<FastifyInstance> {
  const logger = {
    level: env.isProd ? 'info' : 'debug',
    transport: env.isProd ? undefined : { target: 'pino-pretty' },
  };

  // TLS opcional: si hay cert/clave, el agente sirve HTTPS.
  const app: FastifyInstance = env.https
    ? (Fastify({ logger, https: env.https, trustProxy: env.trustProxy }) as unknown as FastifyInstance)
    : Fastify({ logger, trustProxy: env.trustProxy });

  // Aviso si TRUST_PROXY confía en XFF de cualquier origen (US-76, F2).
  for (const w of trustProxyWarnings(env.trustProxy)) {
    app.log.warn(`[config] ${w}`);
  }

  // Aviso si los ficheros con secretos (.env, clave privada RS256) son legibles
  // por grupo u otros (US-79, F8): la única protección es el permiso del SO.
  const secretPaths = [
    resolve('.env'),
    ...(process.env.JWT_PRIVATE_KEY_PATH ? [resolve(process.env.JWT_PRIVATE_KEY_PATH)] : []),
  ];
  for (const w of checkSecretFilePermissions(secretPaths)) {
    app.log.warn(
      `[config] El fichero con secretos ${w.path} es legible por grupo/otros (modo ${w.mode}); ` +
        'restríngelo con `chmod 600`.',
    );
  }

  // Infra
  await app.register(securityHeadersPlugin, { csp: env.security.csp, hsts: env.security.hsts });
  await app.register(cors, { origin: env.webOrigin, credentials: true });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(prismaPlugin);
  await app.register(auditPlugin);
  await app.register(authPlugin);
  await app.register(socketioPlugin);

  // Sistema de configuración de integraciones (US-139/140/141): cada manager se
  // hidrata desde la config guardada en la DB (con `.env` de fallback) y es
  // **recargable en caliente**. Las rutas reciben un `handle` transparente que delega
  // en la instancia viva, así reconfigurar una integración solo intercambia la
  // instancia — sin reiniciar el agente ni re-registrar plugins/rutas de Fastify.
  const secretbox = loadOrCreateSecretbox(env.secretboxKeyPath);
  const integrationStore = new IntegrationConfigStore(app.prisma, secretbox);
  const runtime = await buildIntegrationRuntime(app, integrationStore);
  const driver = runtime.driver.handle;
  const vpn = runtime.vpn.handle;
  const iot = runtime.iot.handle;
  const cameras = runtime.cameras.handle;
  const firewall = runtime.firewall.handle;
  const vlan = runtime.vlan.handle;
  const qos = runtime.qos.handle;
  const dns = runtime.dns.handle;
  const tuyaStore = runtime.tuyaStore;

  // Healthcheck público y mínimo (US-58): solo `{ status: 'ok' }`.
  await app.register(healthRoutes);

  // Servicio de inventario compartido: lo usan las rutas de inventario y las de
  // sistema (para reprogramar el barrido en caliente al cambiar `scanIntervalSec`).
  const inventoryService = new InventoryService(app, driver);

  // Notificaciones push (US-45): decorado en `app.push` para que el plugin de
  // auditoría dispare avisos de eventos de alta prioridad.
  const pushService = new PushService(app);
  app.decorate('push', pushService);

  // Módulos del MVP.
  await app.register(setupRoutes, { prefix: '/api/setup' });
  await app.register(authRoutes, { prefix: '/api/auth' });
  const webAuthnService = new WebAuthnService(app.prisma, {
    rpName: env.webauthn.rpName,
    rpID: env.webauthn.rpID,
    origin: env.webauthn.origin,
  });
  await app.register(webauthnRoutes, {
    prefix: '/api/webauthn',
    service: webAuthnService,
    backupCodes: new BackupCodeService(app.prisma),
  });
  // Aviso temprano si la config de passkeys no cumple los requisitos (Escenario A:
  // TLS nativo + hostname). No bloquea el arranque; el resto del agente funciona igual.
  for (const w of webauthnConfigWarnings({
    rpID: env.webauthn.rpID,
    origin: env.webauthn.origin,
    isProd: env.isProd,
    secureContext: env.https !== null || env.behindProxy,
  })) {
    app.log.warn(`[webauthn] ${w}`);
  }
  await app.register(inventoryRoutes, { prefix: '/api/inventory', driver, service: inventoryService });
  await app.register(wifiRoutes, { prefix: '/api/wifi', driver });
  await app.register(systemRoutes, { prefix: '/api/system', driver, inventoryService });
  await app.register(vpnRoutes, { prefix: '/api/vpn', vpn });
  await app.register(iotRoutes, { prefix: '/api/iot', iot });
  // Solo si hay store Tuya (config presente); con `env.iot.tuya` siempre lo hay.
  if (tuyaStore) {
    await app.register(tuyaConfigRoutes, { prefix: '/api/iot/tuya', store: tuyaStore });
  }
  // Store de cámaras (US-148): alta/baja desde la UI; el RtspCameraManager lee el
  // mismo fichero en vivo, así los cambios se reflejan sin reiniciar.
  const cameraStore = new FileJsonStore<CameraDefinition>(env.cameras.rtsp.configPath);
  await app.register(camerasRoutes, { prefix: '/api/cameras', cameras, store: cameraStore });
  await app.register(firewallRoutes, { prefix: '/api/firewall', firewall });
  await app.register(vlanRoutes, { prefix: '/api/vlans', vlan });
  await app.register(qosRoutes, { prefix: '/api/qos', qos });
  await app.register(dnsRoutes, { prefix: '/api/dns', dns });
  // Configuración de integraciones desde la UI (US-142): catálogo + guardar + probar
  // conexión + revertir; recarga el manager en caliente vía el runtime (US-141).
  await app.register(integrationsRoutes, {
    prefix: '/api/integrations',
    runtime,
    store: integrationStore,
  });
  await app.register(auditRoutes, { prefix: '/api/audit' });
  await app.register(pushRoutes, { prefix: '/api/push', service: pushService });

  // Monitor de tráfico: muestrea vía driver y emite por Socket.io.
  const trafficService = new TrafficService(app, driver);
  await app.register(trafficRoutes, { prefix: '/api/traffic', service: trafficService });
  trafficService.start();
  app.addHook('onClose', async () => trafficService.stop());

  // Barrido periódico de inventario: usa el intervalo persistido (`scanIntervalSec`,
  // por defecto 60 s) y se reprograma en caliente desde Ajustes (US-47).
  const scanRow = await app.prisma.setting.findUnique({ where: { key: 'scanIntervalSec' } });
  const scanSec = Number(scanRow?.value) > 0 ? Number(scanRow!.value) : 60;
  inventoryService.setScanInterval(scanSec * 1000);
  app.addHook('onClose', async () => inventoryService.stopScan());

  // Genera y persiste las claves VAPID al arrancar si aún no existen (US-45).
  await pushService.ensureKeys();

  // Ventana de primer admin (US-81, F10): si no hay usuarios, genera un token de
  // configuración y lo imprime en el log/CLI (canal out-of-band). `/setup/init`
  // lo exigirá, de modo que solo quien tiene acceso al servidor crea el admin.
  if ((await app.prisma.user.count()) === 0) {
    const token = setupToken.ensure();
    app.log.warn(
      `[setup] Sistema sin administrador. Token de configuración para POST /api/setup/init: ${token}`,
    );
  }

  // Sirve el frontend compilado en el mismo puerto (si está activado y construido).
  if (env.web.serve && existsSync(resolve(env.web.distPath, 'index.html'))) {
    registerWebStatic(app, env.web.distPath);
    app.log.info(`Sirviendo frontend desde ${env.web.distPath}`);
  } else if (env.web.serve) {
    app.log.warn(`SERVE_WEB activo pero no hay build en ${env.web.distPath} (ejecuta "pnpm build")`);
  }

  return app;
}
