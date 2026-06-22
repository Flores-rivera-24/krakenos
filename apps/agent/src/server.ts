import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { env } from './config/env.js';
import { createCameraManager } from './cameras/index.js';
import { createDnsManager } from './dns/index.js';
import { createDriver } from './drivers/index.js';
import { createFirewallManager } from './firewall/index.js';
import { createIotManager, startIotManager } from './iot/index.js';
import { createQosManager } from './qos/index.js';
import { createVlanManager } from './vlan/index.js';
import { createVpnManager } from './vpn/index.js';
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
import { camerasRoutes } from './modules/cameras/cameras.routes.js';
import { dnsRoutes } from './modules/dns/dns.routes.js';
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

  // Infra
  await app.register(securityHeadersPlugin, { csp: env.security.csp, hsts: env.security.hsts });
  await app.register(cors, { origin: env.webOrigin, credentials: true });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(prismaPlugin);
  await app.register(auditPlugin);
  await app.register(authPlugin);
  await app.register(socketioPlugin);

  // Driver de hardware compartido por los módulos que lo necesitan.
  const driver = createDriver({
    kind: env.driver.kind,
    host: env.driver.host,
    openwrt: env.driver.openwrt,
    pfsense: env.driver.pfsense,
    ciscoIos: env.driver.ciscoIos,
    ciscoNetconf: env.driver.ciscoNetconf,
    unifi: env.driver.unifi,
    mikrotik: env.driver.mikrotik,
    omada: env.driver.omada,
    asus: env.driver.asus,
  });
  const vpn = createVpnManager({
    kind: env.vpn.kind,
    endpoint: env.vpn.endpoint,
    listenPort: env.vpn.listenPort,
    wireguard: env.vpn.wireguard,
  });
  // El store de config Tuya lo crea la factory (única instancia, compartida con
  // las rutas `/api/iot/tuya` vía el bundle) — sin duplicar la instancia (US-63).
  const { manager: iot, tuyaStore } = createIotManager({
    kind: env.iot.kind,
    zigbee: env.iot.zigbee,
    matter: env.iot.matter,
    hue: env.iot.hue,
    govee: env.iot.govee,
    tuya: env.iot.tuya,
    kasa: env.iot.kasa,
    shelly: env.iot.shelly,
  });
  // Arranca la conexión en segundo plano de los managers que la necesiten (zigbee/govee).
  startIotManager(iot, (msg) => app.log.error(`[iot] no se pudo arrancar la integración: ${msg}`));
  const cameras = createCameraManager({ kind: env.cameras.kind, rtsp: env.cameras.rtsp });
  const firewall = createFirewallManager({
    kind: env.firewall.kind,
    iptables: env.firewall.iptables,
  });
  const vlan = createVlanManager({
    kind: env.vlan.kind,
    switch: env.vlan.switch,
    cisco: env.vlan.cisco,
  });
  const qos = createQosManager({ kind: env.qos.kind, tc: env.qos.tc });
  const dns = createDnsManager({ kind: env.dns.kind, pihole: env.dns.pihole });

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
    secureContext: env.https !== null || env.trustProxy,
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
  await app.register(camerasRoutes, { prefix: '/api/cameras', cameras });
  await app.register(firewallRoutes, { prefix: '/api/firewall', firewall });
  await app.register(vlanRoutes, { prefix: '/api/vlans', vlan });
  await app.register(qosRoutes, { prefix: '/api/qos', qos });
  await app.register(dnsRoutes, { prefix: '/api/dns', dns });
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

  // Sirve el frontend compilado en el mismo puerto (si está activado y construido).
  if (env.web.serve && existsSync(resolve(env.web.distPath, 'index.html'))) {
    registerWebStatic(app, env.web.distPath);
    app.log.info(`Sirviendo frontend desde ${env.web.distPath}`);
  } else if (env.web.serve) {
    app.log.warn(`SERVE_WEB activo pero no hay build en ${env.web.distPath} (ejecuta "pnpm build")`);
  }

  return app;
}
