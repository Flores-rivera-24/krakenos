import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

interface WriteEndpoint {
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  url: string;
  /** Payload VÁLIDO: la validación de schema corre antes del preHandler de rol, así
   * que un cuerpo inválido daría 400 y no llegaríamos a comprobar la autorización. */
  payload?: Record<string, unknown>;
}

/**
 * TODAS las rutas mutantes que exigen rol **admin** (escritura de red/sistema),
 * enumeradas de forma exhaustiva por módulo (US-89; antes solo se probaba una por
 * módulo, US-61). Cada una debe: 403 para un viewer y 401 sin token.
 *
 * Excluidas por diseño: las públicas (auth/setup/login/refresh y webauthn
 * authenticate/* + backup-codes/verify, ver US-88) y las de auto-servicio de
 * cualquier usuario autenticado (ver `AUTHED_WRITES`).
 */
const ADMIN_WRITES: WriteEndpoint[] = [
  // inventory
  { method: 'PATCH', url: '/api/inventory/devices/x', payload: { label: 'Salón' } },
  { method: 'POST', url: '/api/inventory/devices/x/block' },
  { method: 'DELETE', url: '/api/inventory/devices/x/block' },
  { method: 'PUT', url: '/api/inventory/devices/x/vlan', payload: { tag: 100 } },
  // wifi
  { method: 'PUT', url: '/api/wifi', payload: { ssid: 'MiWifi', password: 'secure123' } },
  { method: 'PUT', url: '/api/wifi/guest', payload: { enabled: true } },
  { method: 'PUT', url: '/api/wifi/networks/x', payload: { ssid: 'Red2' } },
  // vpn
  { method: 'POST', url: '/api/vpn/peers', payload: { name: 'Peer' } },
  { method: 'DELETE', url: '/api/vpn/peers/x' },
  // firewall
  { method: 'POST', url: '/api/firewall/rules', payload: { name: 'Regla', action: 'deny' } },
  { method: 'PATCH', url: '/api/firewall/rules/x', payload: { enabled: false } },
  { method: 'DELETE', url: '/api/firewall/rules/x' },
  // qos
  { method: 'POST', url: '/api/qos/rules', payload: { name: 'Regla', target: '192.168.1.10' } },
  { method: 'PATCH', url: '/api/qos/rules/x', payload: { priority: 'high' } },
  { method: 'DELETE', url: '/api/qos/rules/x' },
  // vlan
  { method: 'POST', url: '/api/vlans', payload: { tag: 100, name: 'Invitados' } },
  { method: 'PATCH', url: '/api/vlans/x', payload: { name: 'Renombrada' } },
  { method: 'DELETE', url: '/api/vlans/x' },
  // dns
  { method: 'POST', url: '/api/dns/blocklist', payload: { domain: 'ads.example.com' } },
  { method: 'DELETE', url: '/api/dns/blocklist/x' },
  { method: 'PATCH', url: '/api/dns/feeds/ads', payload: { enabled: true } },
  // Borrar el histórico de navegación del hogar es gestión, no operar el hogar (US-252).
  { method: 'DELETE', url: '/api/dns/history' },
  // access schedules / control parental (US-108)
  {
    method: 'POST',
    url: '/api/access/schedules',
    payload: { name: 'Noche', mac: 'aa:bb:cc:dd:ee:ff', days: [1], startMinute: 1260, endMinute: 420 },
  },
  { method: 'PATCH', url: '/api/access/schedules/x', payload: { enabled: false } },
  { method: 'DELETE', url: '/api/access/schedules/x' },
  { method: 'POST', url: '/api/access/pause', payload: { mac: 'aa:bb:cc:dd:ee:ff', minutes: 30 } },
  { method: 'POST', url: '/api/access/resume', payload: { mac: 'aa:bb:cc:dd:ee:ff' } },
  // personas: el mismo parental, por persona (US-240). Admin, no `home.control`:
  // dejar a alguien sin internet no es «operar lo cotidiano» del hogar.
  { method: 'POST', url: '/api/people/x/pause', payload: { minutes: 30 } },
  { method: 'POST', url: '/api/people/x/resume' },
  {
    method: 'PUT',
    url: '/api/people/x/bedtime',
    payload: { days: [1], startMinute: 1260, endMinute: 420 },
  },
  { method: 'DELETE', url: '/api/people/x/bedtime' },
  // reglas de alerta (US-112)
  { method: 'PATCH', url: '/api/alerts/rules/device.block', payload: { email: true } },

  // habitaciones y grupos (US-165)
  { method: 'POST', url: '/api/rooms', payload: { name: 'Salón' } },
  { method: 'PATCH', url: '/api/rooms/x', payload: { name: 'Salón' } },
  { method: 'DELETE', url: '/api/rooms/x' },
  { method: 'PUT', url: '/api/rooms/assign', payload: { kind: 'iot', ref: 'light-salon', roomId: null } },
  { method: 'POST', url: '/api/rooms/x/action', payload: { on: false } },

  // escenas (US-166)
  { method: 'POST', url: '/api/scenes', payload: { name: 'Noche', actions: [] } },
  { method: 'PATCH', url: '/api/scenes/x', payload: { name: 'Noche' } },
  { method: 'DELETE', url: '/api/scenes/x' },
  { method: 'POST', url: '/api/scenes/x/run' },

  // automatizaciones (US-167)
  {
    method: 'POST',
    url: '/api/automations',
    payload: {
      name: 'Regla',
      trigger: { type: 'device-new' },
      actions: [{ type: 'notify', message: 'x' }],
    },
  },
  { method: 'PATCH', url: '/api/automations/x', payload: { enabled: false } },
  { method: 'DELETE', url: '/api/automations/x' },
  // tiempo exterior (US-254): activar esto manda la ubicación del hogar a un
  // tercero, así que es admin — aunque la LECTURA del estado sea de cualquier rol.
  { method: 'PUT', url: '/api/weather', payload: { enabled: false } },
  // auto-descubrimiento (US-175)
  { method: 'POST', url: '/api/discovery/scan' },
  { method: 'DELETE', url: '/api/discovery/suggestions/hue%3A192.168.1.2' },
  // alta de un toque (US-249): escribe config de integración → admin, como el asistente
  { method: 'POST', url: '/api/discovery/suggestions/hue%3A192.168.1.2/adopt' },
  // iot
  { method: 'PATCH', url: '/api/iot/devices/x', payload: { on: true } },
  // comisionado Matter (US-172): admin-only (el mock no lo soporta → 409, no 403)
  { method: 'POST', url: '/api/iot/matter/commission', payload: { code: 'MT:ABC123XYZ' } },
  // iot tuya (config de credenciales)
  {
    method: 'POST',
    url: '/api/iot/tuya/devices',
    payload: { deviceId: 'd1', localKey: 'k1', ip: '192.168.1.5', name: 'Enchufe' },
  },
  { method: 'PATCH', url: '/api/iot/tuya/devices/d1', payload: { name: 'Nuevo' } },
  { method: 'DELETE', url: '/api/iot/tuya/devices/d1' },
  // energía (US-182): precio del kWh / moneda del hogar
  { method: 'PUT', url: '/api/energy/config', payload: { pricePerKwh: 0.15 } },
  // alertas de energía (US-183)
  {
    method: 'POST',
    url: '/api/energy/alerts',
    payload: { deviceId: 'plug-tv', metric: 'sustained-power', threshold: 500 },
  },
  { method: 'PATCH', url: '/api/energy/alerts/x', payload: { enabled: false } },
  { method: 'DELETE', url: '/api/energy/alerts/x' },
  // puente Matter (US-171)
  { method: 'PUT', url: '/api/matter-bridge', payload: { enabled: false } },
  // system
  { method: 'PATCH', url: '/api/system/settings', payload: { key: 'homeName', value: 'Hogar' } },
  { method: 'POST', url: '/api/system/connectivity-test' },
  { method: 'POST', url: '/api/system/regen-keys' },
  { method: 'POST', url: '/api/system/backup', payload: { passphrase: 'passphrase-123' } },
  { method: 'POST', url: '/api/system/restore', payload: { passphrase: 'passphrase-123', data: 'AAAA' } },
  { method: 'POST', url: '/api/system/update/apply', payload: {} },
  { method: 'POST', url: '/api/system/update/cancel' },
  { method: 'POST', url: '/api/system/restore/upload' },
  { method: 'POST', url: '/api/system/backup/auto/run' },
  { method: 'POST', url: '/api/system/backup/auto/passphrase', payload: {} },
  { method: 'POST', url: '/api/system/backup/auto/passphrase/reveal' },
  { method: 'POST', url: '/api/system/support-bundle', payload: {} },
  // interop MQTT (US-174)
  { method: 'PUT', url: '/api/interop/mqtt', payload: { enabled: false } },
  // users (US-101)
  {
    method: 'POST',
    url: '/api/users',
    payload: { email: 'nuevo@krakenos.test', displayName: 'Nuevo', password: 'password123', role: 'viewer' },
  },
  { method: 'PATCH', url: '/api/users/x', payload: { displayName: 'Cambiado' } },
  { method: 'POST', url: '/api/users/x/password', payload: { password: 'password123' } },
  { method: 'DELETE', url: '/api/users/x' },
];

/**
 * Rutas mutantes de **auto-servicio**: cualquier usuario autenticado (incluido un
 * viewer) puede usarlas para gestionar lo suyo, o son acciones de refresco. Deben:
 * exigir token (401 sin él) pero **no** bloquear a un viewer por rol (≠ 401 y ≠ 403).
 */
const AUTHED_WRITES: WriteEndpoint[] = [
  // refresco de inventario (equivalente al evento de socket `inventory:rescan`)
  { method: 'POST', url: '/api/inventory/rescan' },
  // captura del estado IoT actual para el editor de escenas (solo lee, US-166)
  { method: 'POST', url: '/api/scenes/capture', payload: { deviceIds: ['light-salon'] } },
  // push: gestionar la propia suscripción (US-45)
  {
    method: 'POST',
    url: '/api/push/subscribe',
    payload: { endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' } },
  },
  { method: 'DELETE', url: '/api/push/subscribe', payload: { endpoint: 'https://push.example/abc' } },
  // webauthn: gestionar las propias passkeys / códigos (US-50/US-59)
  { method: 'POST', url: '/api/webauthn/register/options' },
  { method: 'POST', url: '/api/webauthn/register/verify', payload: { response: { id: 'x' }, name: 'Llave' } },
  { method: 'POST', url: '/api/webauthn/backup-codes' },
  { method: 'PATCH', url: '/api/webauthn/credentials/x', payload: { name: 'Nuevo' } },
  { method: 'DELETE', url: '/api/webauthn/credentials/x' },
  // tokens de API: gestionar los propios (US-174, autoservicio)
  { method: 'POST', url: '/api/tokens', payload: { name: 'HA', scopes: ['home.view'] } },
  { method: 'DELETE', url: '/api/tokens/x' },
  // favoritos: gestionar los propios (US-170)
  { method: 'POST', url: '/api/favorites', payload: { kind: 'iot', ref: 'light-salon' } },
  { method: 'DELETE', url: '/api/favorites/x' },
  { method: 'PUT', url: '/api/favorites/order', payload: { ids: [] } },
  // auth: gestionar las propias sesiones (US-41)
  { method: 'DELETE', url: '/api/auth/sessions/x' },
  // Body {} válido: la ruta valida un objeto antes de autenticar; sin cuerpo daría 400.
  { method: 'DELETE', url: '/api/auth/sessions', payload: {} },
  // auth: cambiar la propia contraseña (US-101). La contraseña actual coincide con
  // la del viewer sembrado (seedUser → 'password123'), así el viewer no se bloquea.
  {
    method: 'POST',
    url: '/api/auth/change-password',
    payload: { currentPassword: 'password123', newPassword: 'nuevaClave123' },
  },
  // auth: cambiar el propio modo de interfaz (US-176)
  { method: 'PATCH', url: '/api/auth/ui-mode', payload: { uiMode: 'simple' } },
  // auth: cambiar el propio idioma de interfaz (US-177)
  { method: 'PATCH', url: '/api/auth/locale', payload: { locale: 'en' } },
];

describe('autorización exhaustiva de escritura (US-89)', () => {
  let app: FastifyInstance;
  let viewerToken: string;

  beforeAll(async () => {
    app = await buildTestApp({ routes: true });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
    const viewer = await seedUser(app, { email: 'viewer@krakenos.test', role: 'viewer' });
    viewerToken = signAccess(app, viewer);
  });

  describe('rutas admin-only', () => {
    it.each(ADMIN_WRITES)('$method $url → 403 para un viewer', async ({ method, url, payload }) => {
      const res = await app.inject({ method, url, headers: authHeader(viewerToken), payload });
      expect(res.statusCode).toBe(403);
    });

    it.each(ADMIN_WRITES)('$method $url → 401 sin token', async ({ method, url, payload }) => {
      const res = await app.inject({ method, url, payload });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('rutas de auto-servicio (cualquier usuario autenticado)', () => {
    it.each(AUTHED_WRITES)('$method $url → 401 sin token', async ({ method, url, payload }) => {
      const res = await app.inject({ method, url, payload });
      expect(res.statusCode).toBe(401);
    });

    it.each(AUTHED_WRITES)(
      '$method $url NO bloquea a un viewer por rol (≠401, ≠403)',
      async ({ method, url, payload }) => {
        const res = await app.inject({ method, url, headers: authHeader(viewerToken), payload });
        expect(res.statusCode).not.toBe(401);
        expect(res.statusCode).not.toBe(403);
      },
    );
  });

  // Barrido automático (AUD-22): en vez de enumerar a mano las rutas admin (y
  // arriesgarse a olvidar una nueva), recolecta la tabla de rutas REAL y exige que
  // toda ruta de escritura bajo /api esté clasificada — como admin/autoservicio o
  // en el allowlist explícito de rutas públicas/`home.control`. Una ruta mutante
  // nueva sin clasificar rompe este test hasta que se decida su autorización.
  describe('cobertura de rutas de escritura (AUD-22)', () => {
    /**
     * Rutas de escritura bajo /api que NO se enumeran en ADMIN_WRITES/AUTHED_WRITES
     * de arriba, pero cuya autorización está cubierta por el test de authz de su
     * propio módulo (o son públicas por diseño). Este allowlist las **reconoce
     * explícitamente**: el barrido de abajo exige que toda ruta de escritura esté
     * aquí o en las listas de arriba, así una ruta NUEVA sin clasificar rompe el test.
     */
    const KNOWN_UNSWEPT = new Set<string>([
      // Públicas (sin token; probadas en sus módulos).
      'POST /api/setup/init',
      'POST /api/auth/login',
      'POST /api/auth/refresh',
      'POST /api/auth/logout',
      'POST /api/webauthn/authenticate/options',
      'POST /api/webauthn/authenticate/verify',
      'POST /api/webauthn/backup-codes/verify',
      // Capacidad home.control (admin+member): probadas por capacidad.
      'PATCH /api/iot/devices/:p',
      'POST /api/iot/matter/commission',
      'POST /api/scenes/:p/run',
      'POST /api/rooms/:p/action',
      'POST /api/alarm/arm',
      'POST /api/alarm/disarm',
      'POST /api/presence/mode',
      // Admin, cubiertas por el test de authz de su propio módulo.
      'POST /api/coverage/floorplans',
      'PATCH /api/coverage/floorplans/:p',
      'DELETE /api/coverage/floorplans/:p',
      'POST /api/coverage/floorplans/:p/scans',
      'DELETE /api/coverage/scans/:p',
      'POST /api/coverage/scans/:p/samples',
      'POST /api/cameras',
      'PATCH /api/cameras/:p',
      'DELETE /api/cameras/:p',
      'POST /api/cameras/:p/stream',
      'DELETE /api/cameras/:p/stream',
      'PUT /api/cameras/:p/motion',
      'PUT /api/cameras/recordings/config',
      'DELETE /api/cameras/recordings/:p',
      'PATCH /api/iot/tuya/devices/:p',
      'DELETE /api/iot/tuya/devices/:p',
      'PATCH /api/alerts/rules/:p',
      'PUT /api/alarm/config',
      'PATCH /api/dns/feeds/:p',
      'PUT /api/integrations/:p',
      'POST /api/integrations/:p/test',
      'DELETE /api/integrations/:p',
      'DELETE /api/discovery/suggestions/:p',
      'POST /api/discovery/suggestions/:p/adopt',
    ]);

    /** Normaliza una URL concreta de las listas a su patrón (`:p` en los params). */
    const toPattern = (method: string, url: string): string => {
      const path = url
        .split('/')
        .map((seg) => (/^(x|nope|no-existe|[0-9a-f-]{8,}|aa:bb:cc:dd:ee:ff)$/i.test(seg) ? ':p' : seg))
        .join('/');
      return `${method.toUpperCase()} ${path}`;
    };
    const normalizeRoute = (method: string, url: string): string =>
      `${method.toUpperCase()} ${url.replace(/:[^/]+/g, ':p')}`;

    it('toda ruta de escritura /api está clasificada', () => {
      const collected = (app as unknown as { collectedRoutes: { method: string; url: string }[] })
        .collectedRoutes;
      // Guard: si `onRoute` dejara de poblar la tabla (upgrade de Fastify), la lista
      // quedaría vacía y este barrido pasaría **sin comprobar nada** (AUD3-32).
      expect(collected.length).toBeGreaterThan(50);
      const classified = new Set<string>([
        ...ADMIN_WRITES.map((w) => toPattern(w.method, w.url)),
        ...AUTHED_WRITES.map((w) => toPattern(w.method, w.url)),
        ...KNOWN_UNSWEPT,
      ]);

      const writeMethods = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
      const unclassified = collected
        .filter((r) => writeMethods.has(r.method.toUpperCase()) && r.url.startsWith('/api'))
        .map((r) => normalizeRoute(r.method, r.url))
        .filter((key, i, arr) => arr.indexOf(key) === i)
        .filter((key) => !classified.has(key));

      expect(unclassified).toEqual([]);
    });
  });

  /**
   * Lecturas sensibles (AUD3-02, US-227).
   *
   * El barrido de escrituras de arriba (AUD-22) dejó fuera **las lecturas**, y por
   * ahí se coló que `GET /api/cameras/*` sirviera vídeo en vivo, eventos con
   * snapshot y grabaciones a **cualquier** autenticado —`kid`, `guest` y cualquier
   * token de API—: la navegación del cliente lo ocultaba, el servidor no. Aquí se
   * clasifica cada lectura de cámaras y se comprueba dónde manda: en el servidor.
   */
  describe('lecturas sensibles (AUD3-02)', () => {
    /** Lecturas de vídeo: exigen la capacidad `home.cameras`. */
    const CAMERA_READS = [
      { url: '/api/cameras', pattern: 'GET /api/cameras' },
      { url: '/api/cameras/cam-entrada/snapshot', pattern: 'GET /api/cameras/:p/snapshot' },
      { url: '/api/cameras/motion/events', pattern: 'GET /api/cameras/motion/events' },
      { url: '/api/cameras/cam-entrada/motion', pattern: 'GET /api/cameras/:p/motion' },
      { url: '/api/cameras/recordings', pattern: 'GET /api/cameras/recordings' },
      { url: '/api/cameras/recordings/config', pattern: 'GET /api/cameras/recordings/config' },
      { url: '/api/cameras/recordings/x/download', pattern: 'GET /api/cameras/recordings/:p/download' },
    ];

    /**
     * Playlist y segmentos: NO llevan preHandler de sesión a propósito (US-185) —
     * los autentica el token de stream de `?st=`, que solo emite `POST /:id/stream`,
     * que sí exige la capacidad. Se listan aquí para que el barrido no las marque
     * como sin clasificar.
     */
    const STREAM_TOKEN_READS = [
      'GET /api/cameras/:p/stream/index.m3u8',
      'GET /api/cameras/:p/stream/:p',
    ];

    const normalizeRoute = (method: string, url: string): string =>
      `${method.toUpperCase()} ${url.replace(/:[^/]+/g, ':p')}`;

    it('toda lectura de /api/cameras está clasificada', () => {
      const collected = (app as unknown as { collectedRoutes: { method: string; url: string }[] })
        .collectedRoutes;
      expect(collected.length).toBeGreaterThan(50);
      const classified = new Set<string>([
        ...CAMERA_READS.map((r) => r.pattern),
        ...STREAM_TOKEN_READS,
      ]);

      const unclassified = collected
        .filter((r) => r.method.toUpperCase() === 'GET' && r.url.startsWith('/api/cameras'))
        .map((r) => normalizeRoute(r.method, r.url))
        .filter((key, i, arr) => arr.indexOf(key) === i)
        .filter((key) => !classified.has(key));

      expect(unclassified).toEqual([]);
    });

    it('kid y guest no pueden leer nada de cámaras (403)', async () => {
      for (const role of ['kid', 'guest'] as const) {
        const token = signAccess(app, await seedUser(app, { email: `${role}@cam.test`, role }));
        for (const { url } of CAMERA_READS) {
          const res = await app.inject({ method: 'GET', url, headers: authHeader(token) });
          expect(`${role} ${url} → ${res.statusCode}`).toBe(`${role} ${url} → 403`);
        }
      }
    });

    it('un viewer sigue viendo las cámaras (no es una regresión de solo-lectura)', async () => {
      const token = signAccess(app, await seedUser(app, { email: 'viewer@cam.test', role: 'viewer' }));
      const res = await app.inject({
        method: 'GET',
        url: '/api/cameras',
        headers: authHeader(token),
      });
      expect(res.statusCode).toBe(200);
    });

    it('la ubicación del hogar solo viaja a un admin', async () => {
      await app.prisma.setting.upsert({
        where: { key: 'homeLatitude' },
        create: { key: 'homeLatitude', value: '40.4168' },
        update: { value: '40.4168' },
      });
      await app.prisma.setting.upsert({
        where: { key: 'homeLongitude' },
        create: { key: 'homeLongitude', value: '-3.7038' },
        update: { value: '-3.7038' },
      });

      const kid = signAccess(app, await seedUser(app, { email: 'kid@loc.test', role: 'kid' }));
      const asKid = await app.inject({
        method: 'GET',
        url: '/api/system/settings',
        headers: authHeader(kid),
      });
      expect(asKid.statusCode).toBe(200);
      const kidBody = asKid.json() as { settings: Record<string, string> };
      expect(kidBody.settings.homeLatitude).toBe('');
      expect(kidBody.settings.homeLongitude).toBe('');
      // No basta con mirar el campo: la coordenada no puede estar en ninguna parte.
      expect(asKid.body).not.toContain('40.4168');
      expect(asKid.body).not.toContain('-3.7038');

      const admin = signAccess(app, await seedUser(app, { email: 'admin@loc.test', role: 'admin' }));
      const asAdmin = await app.inject({
        method: 'GET',
        url: '/api/system/settings',
        headers: authHeader(admin),
      });
      const adminBody = asAdmin.json() as { settings: Record<string, string> };
      expect(adminBody.settings.homeLatitude).toBe('40.4168');
    });
  });

  /**
   * US-250 — GATE del epic K5. Mismo fallo que AUD3-02 con las cámaras, en otra
   * superficie: el registro de consultas DNS y el desglose de tráfico por aparato
   * los leía **cualquier autenticado** (incluidos `kid` y `guest`) y cualquier
   * token de API con `home.view`. Juntos son el historial de navegación de la
   * familia; la UI lo escondía y el servidor no.
   *
   * Se clasifica por sensibilidad en vez de cerrar los dos módulos enteros: los
   * agregados (totales WAN, cifras de DNS, blocklist, feeds) son cifras y
   * configuración y siguen siendo lectura autenticada. Lo que se acota es lo que
   * habla de **una persona**.
   */
  describe('actividad por aparato: DNS y tráfico (US-250)', () => {
    /** Lecturas que exigen `home.activity` (solo admin). */
    const ACTIVITY_READS = [
      { url: '/api/dns/queries', pattern: 'GET /api/dns/queries' },
      { url: '/api/traffic/devices', pattern: 'GET /api/traffic/devices' },
    ];

    /**
     * Agregados que **siguen** siendo lectura autenticada. Se enumeran para que el
     * barrido de abajo falle si alguien mueve una de ellas de lado sin decidirlo, y
     * para dejar por escrito que la historia acotó dos rutas, no dos módulos.
     */
    const AGGREGATE_READS = [
      'GET /api/dns/stats',
      'GET /api/dns/blocklist',
      'GET /api/dns/feeds',
      'GET /api/traffic/history',
      'GET /api/traffic/stats',
    ];

    /**
     * Tercera categoría (US-252): lectura de **cualquier rol** cuya privacidad la
     * aplica el servidor, filtrando a los aparatos de quien pregunta. No es un
     * agregado —habla de personas— pero tampoco puede exigir `home.activity`, o el
     * dueño de un aparato no podría ver ni lo suyo. Es el reparto del bienestar
     * digital, y quien lo ejerce es `dns-history.routes.test.ts`.
     */
    const OWNER_FILTERED_READS = ['GET /api/dns/history'];

    it('toda lectura de /api/dns y /api/traffic está clasificada', () => {
      const collected = (app as unknown as { collectedRoutes: { method: string; url: string }[] })
        .collectedRoutes;
      expect(collected.length).toBeGreaterThan(50);
      const classified = new Set<string>([
        ...ACTIVITY_READS.map((r) => r.pattern),
        ...AGGREGATE_READS,
        ...OWNER_FILTERED_READS,
      ]);

      const unclassified = collected
        .filter(
          (r) =>
            r.method.toUpperCase() === 'GET' &&
            (r.url.startsWith('/api/dns') || r.url.startsWith('/api/traffic')),
        )
        .map((r) => `${r.method.toUpperCase()} ${r.url.replace(/:[^/]+/g, ':p')}`)
        .filter((key, i, arr) => arr.indexOf(key) === i)
        .filter((key) => !classified.has(key));

      expect(unclassified).toEqual([]);
    });

    it('ningún rol salvo admin lee la actividad por aparato (403)', async () => {
      for (const role of ['member', 'viewer', 'kid', 'guest'] as const) {
        const token = signAccess(app, await seedUser(app, { email: `${role}@act.test`, role }));
        for (const { url } of ACTIVITY_READS) {
          const res = await app.inject({ method: 'GET', url, headers: authHeader(token) });
          expect(`${role} ${url} → ${res.statusCode}`).toBe(`${role} ${url} → 403`);
        }
      }
    });

    it('un admin sí la lee (la historia acota, no rompe la función)', async () => {
      const token = signAccess(app, await seedUser(app, { email: 'admin@act.test', role: 'admin' }));
      for (const { url } of ACTIVITY_READS) {
        const res = await app.inject({ method: 'GET', url, headers: authHeader(token) });
        expect(`${url} → ${res.statusCode}`).toBe(`${url} → 200`);
      }
    });

    it('los agregados siguen siendo lectura de cualquier autenticado', async () => {
      const token = signAccess(app, await seedUser(app, { email: 'kid@agg.test', role: 'kid' }));
      for (const pattern of AGGREGATE_READS) {
        const url = pattern.slice('GET '.length);
        const res = await app.inject({ method: 'GET', url, headers: authHeader(token) });
        expect(`${url} → ${res.statusCode}`).toBe(`${url} → 200`);
      }
    });
  });
});
