import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import QRCode from 'qrcode';
import type { FastifyInstance } from 'fastify';
import { env, trustProxyWarnings } from './config/env.js';
import { checkSecretFilePermissions } from './config/secret-permissions.js';
import { loadOrCreateSecretbox } from './config/secretbox.js';
import { SETTING_BOUNDS, clampToBound } from './config/settings-bounds.js';
import { IntegrationConfigStore } from './integrations/integration-config.store.js';
import { buildIntegrationRuntime } from './integrations/runtime.js';
import { FileJsonStore } from './store/json-store.js';
import type { CameraDefinition } from './cameras/rtsp.cameras.js';
import { AlertConfigService } from './alerts/alert-config.js';
import { Mailer, smtpConfigFromEnv } from './alerts/mailer.js';
import { TelegramNotifier, telegramConfigFromEnv } from './alerts/telegram.js';
import { DigestService } from './alerts/digest.js';
import { alertsRoutes } from './modules/alerts/alerts.routes.js';
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
import { accessRoutes } from './modules/access/access.routes.js';
import { AccessScheduleService } from './modules/access/access.service.js';
import { roomsRoutes } from './modules/rooms/rooms.routes.js';
import { RoomService } from './modules/rooms/rooms.service.js';
import { favoritesRoutes } from './modules/favorites/favorites.routes.js';
import { scenesRoutes } from './modules/scenes/scenes.routes.js';
import { SceneService } from './modules/scenes/scenes.service.js';
import { iotScheduleRoutes } from './modules/iot-schedule/iot-schedule.routes.js';
import { IotScheduleService } from './modules/iot-schedule/iot-schedule.service.js';
import { HomeEventBus } from './automations/event-bus.js';
import { IotWatcher } from './automations/iot-watcher.js';
import { AutomationService } from './modules/automations/automations.service.js';
import { automationsRoutes } from './modules/automations/automations.routes.js';
import { PresenceService } from './modules/presence/presence.service.js';
import { presenceRoutes } from './modules/presence/presence.routes.js';
import { DgramDiscoveryTransport } from './discovery/transport.js';
import { DiscoveryService } from './modules/discovery/discovery.service.js';
import { discoveryRoutes } from './modules/discovery/discovery.routes.js';
import { pushRoutes } from './modules/push/push.routes.js';
import { PushService } from './modules/push/push.service.js';
import { setupRoutes } from './modules/setup/setup.routes.js';
import { setupToken } from './modules/setup/setup-token.js';
import { buildSetupUrl, firstLanIpv4 } from './modules/setup/setup-url.js';
import { usersRoutes } from './modules/users/users.routes.js';
import { camerasRoutes } from './modules/cameras/cameras.routes.js';
import { dnsRoutes } from './modules/dns/dns.routes.js';
import { integrationsRoutes } from './modules/integrations/integrations.routes.js';
import { firewallRoutes } from './modules/firewall/firewall.routes.js';
import { iotRoutes } from './modules/iot/iot.routes.js';
import { tuyaConfigRoutes } from './modules/iot/tuya-config.routes.js';
import { qosRoutes } from './modules/qos/qos.routes.js';
import { vlanRoutes } from './modules/vlan/vlan.routes.js';
import { systemRoutes } from './modules/system/system.routes.js';
import { RetentionService } from './modules/system/retention.service.js';
import { TrafficService } from './modules/traffic/traffic.service.js';
import { trafficRoutes } from './modules/traffic/traffic.routes.js';
import { EnergyService } from './modules/energy/energy.service.js';
import { energyRoutes } from './modules/energy/energy.routes.js';
import { EnergyAlertService } from './modules/energy/energy-alerts.service.js';
import { energyAlertsRoutes } from './modules/energy/energy-alerts.routes.js';
import { ReportsService } from './modules/reports/reports.service.js';
import { reportsRoutes } from './modules/reports/reports.routes.js';
import { vpnRoutes } from './modules/vpn/vpn.routes.js';
import { wifiRoutes } from './modules/wifi/wifi.routes.js';
import { coverageRoutes } from './modules/coverage/coverage.routes.js';

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

  // Aviso si en producción la cookie de refresh viajaría SIN `Secure` (sin TLS
  // nativo ni proxy de confianza): sobre HTTP plano el refresh token sería
  // interceptable en la red. El modelo asume TLS/VPN; si no lo hay, es un riesgo real.
  if (env.isProd && env.https === null && !env.behindProxy) {
    app.log.warn(
      '[config] NODE_ENV=production sin HTTPS ni TRUST_PROXY: la cookie de refresh se ' +
        'emite sin `Secure` y viajaría en claro sobre HTTP. Termina TLS (HTTPS_ENABLED) ' +
        'o sitúa el agente tras un proxy de confianza / WireGuard.',
    );
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

  // Horarios de acceso / control parental (US-108): CRUD + barrido que aplica el
  // bloqueo por horario vía driver. Le da al inventario la comprobación de "¿hay
  // horario activo?" para que un desbloqueo manual no anule el control parental.
  const accessService = new AccessScheduleService(app, driver);
  inventoryService.setScheduleGuard((mac) => accessService.isBlockedNow(mac));

  // Notificaciones push (US-45): decorado en `app.push` para que el plugin de
  // auditoría dispare avisos de eventos de alta prioridad.
  const pushService = new PushService(app);
  app.decorate('push', pushService);

  // Reglas de alerta configurables (US-112): qué eventos alertan y por qué canal.
  const alertConfig = new AlertConfigService(app);
  app.decorate('alertConfig', alertConfig);

  // Alertas por email (US-110): mismo conjunto de eventos que push, si hay SMTP.
  const mailer = new Mailer(app, smtpConfigFromEnv());
  app.decorate('mailer', mailer);
  if (mailer.enabled) app.log.info('[alerts] alertas por email habilitadas (SMTP configurado)');

  // Canal Telegram (US-180): bot opt-in por entorno; todo egress va por safeFetch.
  const telegram = new TelegramNotifier(app, telegramConfigFromEnv());
  app.decorate('telegram', telegram);
  if (telegram.enabled) app.log.info('[alerts] alertas por Telegram habilitadas (bot configurado)');

  // Módulos del MVP.
  await app.register(setupRoutes, { prefix: '/api/setup' });
  await app.register(authRoutes, { prefix: '/api/auth' });
  // Gestión de usuarios (US-101): alta/edición/baja + roles, admin-only y auditada.
  await app.register(usersRoutes, { prefix: '/api/users' });
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
  await app.register(accessRoutes, { prefix: '/api/access', service: accessService });
  // Habitaciones y grupos (US-165): organiza los dispositivos por estancia + acción
  // de grupo sobre los IoT. Reusa el inventario para asignar dispositivos de red.
  const roomService = new RoomService(app, iot, inventoryService);
  await app.register(roomsRoutes, { prefix: '/api/rooms', service: roomService });
  // Favoritos por usuario (US-170): acceso rápido a lo cotidiano en el dashboard.
  await app.register(favoritesRoutes, { prefix: '/api/favorites' });
  // Escenas de un toque (US-166): deja N dispositivos IoT en un estado con un toque.
  const sceneService = new SceneService(app, iot);
  await app.register(scenesRoutes, { prefix: '/api/scenes', service: sceneService });
  // Horarios para IoT/escenas (US-168): CRUD + barrido por minuto que dispara la
  // acción a hora fija o solar (amanecer/atardecer con la lat/long del hogar).
  const iotScheduleService = new IotScheduleService(app, iot, sceneService);
  await app.register(iotScheduleRoutes, { prefix: '/api/iot-schedules', service: iotScheduleService });
  // Automatizaciones «si X→Y» (US-167): bus de eventos del hogar (inventario +
  // watcher IoT) + motor puro + barrido de hora. El inventario publica
  // dispositivo nuevo/online/offline; el watcher, transiciones de estado IoT.
  const homeBus = new HomeEventBus((err, event) =>
    app.log.error({ err, event: event.type }, '[automations] un handler del bus falló'),
  );
  inventoryService.setEventSink((event) => homeBus.publish(event));
  const iotWatcher = new IotWatcher(iot, homeBus, app.log);
  const automationService = new AutomationService(app, {
    iot,
    scenes: sceneService,
    inventory: inventoryService,
    access: accessService,
    bus: homeBus,
    watcher: iotWatcher,
  });
  await app.register(automationsRoutes, { prefix: '/api/automations', service: automationService });
  // Modos del hogar + presencia por WiFi (US-169): deriva llegadas/salidas de los
  // eventos device-online/offline del bus sobre `Device.ownerId`, con ventana de
  // gracia; el modo es estado global observable y trigger de automatización.
  const presenceService = new PresenceService(app, homeBus);
  await app.register(presenceRoutes, { prefix: '/api/presence', service: presenceService });
  // Auto-descubrimiento de IoT (US-175): sondeo mDNS/SSDP solo-LAN con huellas
  // por integración; alimenta las tarjetas de sugerencia de «Conectar».
  const discoveryService = new DiscoveryService(app, new DgramDiscoveryTransport());
  await app.register(discoveryRoutes, { prefix: '/api/discovery', service: discoveryService });
  await app.register(wifiRoutes, { prefix: '/api/wifi', driver });
  // Cobertura WiFi (US-151…159): planos + heatmap predicho + survey de medición real.
  await app.register(coverageRoutes, { prefix: '/api/coverage', driver });
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
  // Reglas de alerta configurables (US-112).
  await app.register(alertsRoutes, { prefix: '/api/alerts', service: alertConfig });

  // Monitor de tráfico: muestrea vía driver y emite por Socket.io.
  const trafficService = new TrafficService(app, driver);
  await app.register(trafficRoutes, { prefix: '/api/traffic', service: trafficService });

  // Medición de consumo eléctrico (US-181): sondea la potencia de los IoT que la
  // reportan y persiste un rollup por minuto por dispositivo. La energía/coste se
  // integran al consultar; la poda de retención es red de seguridad del barrido.
  const energyService = new EnergyService(app, iot);
  await app.register(energyRoutes, { prefix: '/api/energy', service: energyService });

  // Alertas de consumo (US-183): evalúa umbrales por dispositivo y, al cruzarse,
  // publica un evento `energy-threshold` al bus (disparador de automatización) y
  // lo audita para el despacho multicanal (US-180).
  const energyAlertService = new EnergyAlertService(app, iot, homeBus);
  await app.register(energyAlertsRoutes, { prefix: '/api/energy/alerts', service: energyAlertService });

  // Informes exportables en CSV (US-109/182): auditoría, inventario, tráfico, energía.
  await app.register(reportsRoutes, {
    prefix: '/api/reports',
    service: new ReportsService(app, trafficService, energyService),
  });
  trafficService.start();
  app.addHook('onClose', async () => trafficService.stop());
  energyService.start();
  app.addHook('onClose', async () => energyService.stop());
  energyAlertService.start();
  app.addHook('onClose', async () => energyAlertService.stop());

  // Barrido periódico de inventario: usa el intervalo persistido (`scanIntervalSec`,
  // por defecto 60 s) y se reprograma en caliente desde Ajustes (US-47).
  const scanRow = await app.prisma.setting.findUnique({ where: { key: 'scanIntervalSec' } });
  // Acota en lectura (defensa en profundidad, US-75): aunque un valor abusivo se
  // colara por otra vía (escritura directa en la DB, un backup antiguo), el runtime
  // nunca arranca un `setInterval` fuera de [min, max]. Un valor ausente/no numérico
  // recurre a 60 s.
  const rawScan = Number(scanRow?.value);
  const scanSec = Number.isFinite(rawScan) && rawScan > 0
    ? (clampToBound(rawScan, SETTING_BOUNDS.scanIntervalSec) ?? 60)
    : 60;
  inventoryService.setScanInterval(scanSec * 1000);
  app.addHook('onClose', async () => inventoryService.stopScan());

  // Retención de datos (US-102): poda periódica del registro de auditoría según
  // `auditRetentionDays` (antes crecía sin límite). El tráfico ya poda en su rollup.
  const retentionService = new RetentionService(app);
  retentionService.start();
  app.addHook('onClose', async () => retentionService.stop());

  // Aplica los horarios de control parental cada minuto (US-108).
  accessService.start();
  app.addHook('onClose', async () => accessService.stop());

  // Dispara los horarios IoT/escenas cada minuto (US-168).
  iotScheduleService.start();
  app.addHook('onClose', async () => iotScheduleService.stop());

  // Automatizaciones (US-167): sondeo de transiciones IoT + barrido de hora.
  iotWatcher.start();
  app.addHook('onClose', async () => iotWatcher.stop());
  automationService.start();
  app.addHook('onClose', async () => automationService.stop());

  // Presencia (US-169): reconcilia el timeline al arrancar y confirma salidas
  // pendientes (ventana de gracia) cada minuto.
  presenceService.start();
  app.addHook('onClose', async () => presenceService.stop());

  // Auto-descubrimiento (US-175): barrido periódico suave (10 min) + bajo demanda.
  discoveryService.start();
  app.addHook('onClose', async () => discoveryService.stop());

  // Resumen del hogar diario/semanal (US-180): barrido horario, envía a las 08:00
  // por los canales configurados (push + email + Telegram, los que existan).
  const digestService = new DigestService(app, {
    push: (title, body) => pushService.sendToAll(title, body, '/'),
    email: (subject, text) => mailer.sendRaw(subject, text),
    telegram: (title, body) => telegram.notify(title, body),
  });
  digestService.start();
  app.addHook('onClose', async () => digestService.stop());

  // Genera y persiste las claves VAPID al arrancar si aún no existen (US-45).
  await pushService.ensureKeys();

  // Siembra las reglas de alerta por defecto y carga su caché (US-112).
  await alertConfig.ensureDefaults();

  // Ventana de primer admin (US-81, F10): si no hay usuarios, genera un token de
  // configuración y lo imprime en el log/CLI (canal out-of-band). `/setup/init`
  // lo exigirá, de modo que solo quien tiene acceso al servidor crea el admin.
  if ((await app.prisma.user.count()) === 0) {
    const token = setupToken.ensure();
    const setupUrl = buildSetupUrl({
      scheme: env.https ? 'https' : 'http',
      host: firstLanIpv4(),
      port: env.port,
      token,
    });
    // Onboarding (US-105): además del token, imprime la URL lista para abrir y un
    // QR escaneable, para que un usuario no técnico no tenga que buscar en el log.
    app.log.warn(`[setup] Sistema sin administrador. Abre en tu navegador:\n    ${setupUrl}`);
    try {
      const qr = await QRCode.toString(setupUrl, { type: 'terminal', small: true });
      app.log.warn(`[setup] O escanéalo con tu móvil (mismo WiFi):\n${qr}`);
    } catch {
      // El QR es opcional; si falla, la URL de arriba basta.
    }
    app.log.warn(`[setup] (token de configuración: ${token})`);
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
