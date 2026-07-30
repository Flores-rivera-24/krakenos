import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSecretbox, generateSecretboxKey } from '../../src/config/secretbox.js';
import {
  MqttPublisher,
  type StateSnapshot,
} from '../../src/modules/interop/mqtt-publisher.service.js';
import type { MqttTransport } from '../../src/iot/mqtt.transport.js';
import { buildTestApp, resetDb } from '../helpers/app.js';

const SNAP: StateSnapshot = {
  iot: [
    { id: 'light/salon', name: 'Salón', kind: 'light', on: true, brightness: 80, color: null, powerW: 9 },
    { id: 'plug-1', name: 'Enchufe', kind: 'plug', on: false, brightness: null, color: null, powerW: 0 },
  ],
  energy: { todayKwh: 1.23, todayCost: 0.3, currency: '€' },
  devicesOnline: 5,
  homeMode: 'home',
  alarmPhase: 'disarmed',
  blockedDevices: [{ id: 'dev-abc', name: 'Tablet', blocked: true, reasons: ['paused'] }],
  roomSignals: [{ id: 'room-1', name: 'Salon', worstDbm: -70 }],
};

interface Sent {
  topic: string;
  payload: string;
  retain: boolean;
}

function fakeTransport() {
  const published: Sent[] = [];
  const handlers = new Map<string, (topic: string, payload: string) => void>();
  const transport: MqttTransport = {
    subscribe: vi.fn(async (filter: string, handler: (t: string, p: string) => void) => {
      handlers.set(filter, handler);
    }),
    publish: vi.fn(async (topic: string, payload: string, opts?: { retain?: boolean }) => {
      published.push({ topic, payload, retain: opts?.retain === true });
    }),
    dispose: vi.fn(async () => undefined),
  };
  return { transport, published, handlers };
}

function makePublisher(app: FastifyInstance, transport: MqttTransport, snapshot = SNAP) {
  return new MqttPublisher({
    prisma: app.prisma,
    secretbox: createSecretbox(generateSecretboxKey()),
    snapshot: async () => snapshot,
    transportFactory: () => transport,
  });
}

describe('MqttPublisher (US-174)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDb(app);
  });

  it('cifra la contraseña en reposo y NUNCA la devuelve por la API', async () => {
    const { transport } = fakeTransport();
    const pub = makePublisher(app, transport);
    await pub.setConfig({ enabled: false, url: 'mqtt://192.168.1.10:1883', username: 'ha', password: 'secreto123' });
    try {
      const cfg = await pub.getConfig();
      expect(cfg.hasPassword).toBe(true);
      expect(cfg).not.toHaveProperty('password');

      // Lo guardado en Setting está cifrado (no aparece el texto en claro).
      const row = await app.prisma.setting.findUnique({ where: { key: 'interop.mqtt' } });
      expect(row?.value).not.toContain('secreto123');
      expect(row?.value).toContain('kbx1.'); // token de secretbox
    } finally {
      await pub.stop();
    }
  });

  it('publica estado en los topics y NINGÚN payload lleva secretos', async () => {
    const { transport, published } = fakeTransport();
    const pub = makePublisher(app, transport);
    await pub.setConfig({
      enabled: true,
      url: 'mqtt://192.168.1.10:1883',
      username: 'ha',
      password: 'secreto123',
      topicPrefix: 'casa',
    });
    try {
      await pub.publishOnce();
      const topics = published.map((p) => p.topic);
      expect(topics).toContain('casa/status');
      expect(topics).toContain('casa/iot/light_salon'); // '/' saneado a '_'
      expect(topics).toContain('casa/energy');
      expect(topics).toContain('casa/devices/online');
      // Ni la contraseña ni el token secreto aparecen en NINGÚN payload.
      const allPayloads = published.map((p) => p.payload).join('\n');
      expect(allPayloads).not.toContain('secreto123');
      expect(allPayloads).not.toContain('kbx1.');
      expect(pub.getStatus().connected).toBe(true);
    } finally {
      await pub.stop();
    }
  });

  it('bloquea un broker que apunta a metadata de nube/link-local (egress)', async () => {
    const { transport, published } = fakeTransport();
    const pub = makePublisher(app, transport);
    await pub.setConfig({ enabled: true, url: 'mqtt://169.254.169.254:1883' });
    try {
      // start() ya lo intentó al guardar; no conecta y deja constancia del error.
      expect(pub.getStatus().enabled).toBe(false); // no arrancó el barrido
      expect(pub.getStatus().lastError).toBeTruthy();
      await pub.publishOnce();
      expect(published).toHaveLength(0); // no publicó nada
    } finally {
      await pub.stop();
    }
  });

  it('desactivado: no publica nada', async () => {
    const { transport, published } = fakeTransport();
    const pub = makePublisher(app, transport);
    await pub.setConfig({ enabled: false, url: 'mqtt://192.168.1.10:1883' });
    try {
      await pub.publishOnce();
      expect(published).toHaveLength(0);
      expect(pub.getStatus().enabled).toBe(false);
    } finally {
      await pub.stop();
    }
  });

  it('acota el intervalo al rango permitido', async () => {
    const { transport } = fakeTransport();
    const pub = makePublisher(app, transport);
    await pub.setConfig({ url: 'mqtt://192.168.1.10:1883', intervalSec: 999999 });
    try {
      expect((await pub.getConfig()).intervalSec).toBe(3600);
    } finally {
      await pub.stop();
    }
  });

  // --- MQTT Discovery de Home Assistant (US-213) ---

  it('discovery ON: publica configs retained bajo homeassistant/ y estado', async () => {
    const { transport, published } = fakeTransport();
    const pub = makePublisher(app, transport);
    await pub.setConfig({
      enabled: true,
      url: 'mqtt://192.168.1.10:1883',
      topicPrefix: 'casa',
      discovery: true,
    });
    try {
      await pub.publishOnce();
      const configs = published.filter((p) => p.topic.startsWith('homeassistant/'));
      // Luz salón → light o switch; enchufe → switch; + sensores del hub.
      expect(configs.some((p) => p.topic.includes('/iot_light_salon/config'))).toBe(true);
      expect(configs.some((p) => p.topic.includes('/iot_plug-1/config'))).toBe(true);
      expect(configs.some((p) => p.topic === 'homeassistant/sensor/krakenos/home_mode/config')).toBe(true);
      expect(configs.some((p) => p.topic === 'homeassistant/sensor/krakenos/alarm/config')).toBe(true);
      expect(configs.some((p) => p.topic === 'homeassistant/sensor/krakenos/devices_online/config')).toBe(true);
      // TODAS las configs son retained.
      expect(configs.every((p) => p.retain)).toBe(true);
      // El estado que las configs referencian se publica.
      expect(published.some((p) => p.topic === 'casa/iot/light_salon/state')).toBe(true);
      expect(published.some((p) => p.topic === 'casa/home/mode' && p.payload === 'home')).toBe(true);
    } finally {
      await pub.stop();
    }
  });

  it('NUNCA publica personas/PII, solo el modo del hogar', async () => {
    const { transport, published } = fakeTransport();
    const pub = makePublisher(app, transport);
    await pub.setConfig({ enabled: true, url: 'mqtt://192.168.1.10:1883', topicPrefix: 'casa', discovery: true });
    try {
      await pub.publishOnce();
      const all = published.map((p) => `${p.topic} ${p.payload}`).join('\n');
      expect(all).not.toMatch(/person|people|displayName/i);
      expect(published.some((p) => p.topic === 'casa/home/mode')).toBe(true);
    } finally {
      await pub.stop();
    }
  });

  it('limpia la config retained cuando el dispositivo desaparece', async () => {
    const { transport, published } = fakeTransport();
    const snapWith: StateSnapshot = { ...SNAP };
    const pub = new MqttPublisher({
      prisma: app.prisma,
      secretbox: createSecretbox(generateSecretboxKey()),
      snapshot: async () => snapWith,
      transportFactory: () => transport,
    });
    await pub.setConfig({ enabled: true, url: 'mqtt://192.168.1.10:1883', topicPrefix: 'casa', discovery: true });
    try {
      await pub.publishOnce();
      published.length = 0;
      // El enchufe se va del hogar → su config debe borrarse (payload '' retained).
      snapWith.iot = snapWith.iot.filter((d) => d.id !== 'plug-1');
      await pub.publishOnce();
      const removal = published.find((p) => p.topic.includes('/iot_plug-1/config'));
      expect(removal).toBeDefined();
      expect(removal?.payload).toBe('');
      expect(removal?.retain).toBe(true);
    } finally {
      await pub.stop();
    }
  });

  // --- Control entrante (US-213) ---

  it('control OFF por defecto: no se suscribe a comandos', async () => {
    const { transport } = fakeTransport();
    const onCommand = vi.fn(async () => undefined);
    const pub = new MqttPublisher({
      prisma: app.prisma,
      secretbox: createSecretbox(generateSecretboxKey()),
      snapshot: async () => SNAP,
      transportFactory: () => transport,
      onCommand,
    });
    await pub.setConfig({ enabled: true, url: 'mqtt://192.168.1.10:1883', topicPrefix: 'casa' });
    try {
      expect(transport.subscribe).not.toHaveBeenCalled();
    } finally {
      await pub.stop();
    }
  });

  // --- Disponibilidad honesta y pausa entrante (US-236) ---

  it('declara el testamento (LWT) al conectar: sin él HA nunca ve la casa caída', async () => {
    const { transport } = fakeTransport();
    let opts: { will?: { topic: string; payload: string; retain?: boolean } } | null = null;
    const pub = new MqttPublisher({
      prisma: app.prisma,
      secretbox: createSecretbox(generateSecretboxKey()),
      snapshot: async () => SNAP,
      transportFactory: (o) => {
        opts = o;
        return transport;
      },
    });
    await pub.setConfig({ enabled: true, url: 'mqtt://192.168.1.10:1883', topicPrefix: 'casa' });
    try {
      expect(opts).not.toBeNull();
      expect(opts!.will).toEqual({ topic: 'casa/status', payload: 'offline', retain: true });
    } finally {
      await pub.stop();
    }
  });

  it('se despide con `offline` retenido al parar (el LWT solo cubre la caída abrupta)', async () => {
    const { transport, published } = fakeTransport();
    const pub = makePublisher(app, transport);
    await pub.setConfig({ enabled: true, url: 'mqtt://192.168.1.10:1883', topicPrefix: 'casa' });
    published.length = 0;
    await pub.stop();
    const bye = published.find((p) => p.topic === 'casa/status');
    expect(bye).toEqual({ topic: 'casa/status', payload: 'offline', retain: true });
  });

  it('pausa OFF por defecto: no se suscribe al botón aunque el control de IoT esté ON', async () => {
    const { transport, handlers } = fakeTransport();
    const pub = new MqttPublisher({
      prisma: app.prisma,
      secretbox: createSecretbox(generateSecretboxKey()),
      snapshot: async () => SNAP,
      transportFactory: () => transport,
      onCommand: vi.fn(async () => undefined),
      onPause: vi.fn(async () => undefined),
    });
    await pub.setConfig({ enabled: true, url: 'mqtt://192.168.1.10:1883', topicPrefix: 'casa', control: true });
    try {
      expect(handlers.has('casa/iot/+/set')).toBe(true);
      expect(handlers.has('casa/device/+/pause/set')).toBe(false);
    } finally {
      await pub.stop();
    }
  });

  it('pausa ON: el botón de HA aplica la pausa por su propio toggle', async () => {
    const { transport, handlers } = fakeTransport();
    const onPause = vi.fn(async () => undefined);
    const pub = new MqttPublisher({
      prisma: app.prisma,
      secretbox: createSecretbox(generateSecretboxKey()),
      snapshot: async () => SNAP,
      transportFactory: () => transport,
      onPause,
    });
    await pub.setConfig({
      enabled: true,
      url: 'mqtt://192.168.1.10:1883',
      topicPrefix: 'casa',
      pauseControl: true,
    });
    try {
      const h = handlers.get('casa/device/+/pause/set');
      expect(h).toBeDefined();
      h?.('casa/device/dev-abc/pause/set', '30');
      await new Promise((r) => setImmediate(r));
      expect(onPause).toHaveBeenCalledWith('dev-abc', 30);
    } finally {
      await pub.stop();
    }
  });

  it('publica la cuña: bloqueo por dispositivo y señal por habitación', async () => {
    const { transport, published } = fakeTransport();
    const pub = makePublisher(app, transport);
    await pub.setConfig({ enabled: true, url: 'mqtt://192.168.1.10:1883', topicPrefix: 'casa', discovery: true });
    try {
      await pub.publishOnce();
      const topics = published.map((p) => p.topic);
      expect(topics).toContain('homeassistant/binary_sensor/krakenos/device_dev-abc_blocked/config');
      expect(topics).toContain('homeassistant/sensor/krakenos/room_room-1_signal/config');
      expect(published.find((p) => p.topic === 'casa/device/dev-abc/blocked')?.payload).toBe('ON');
      expect(published.find((p) => p.topic === 'casa/room/room-1/signal')?.payload).toBe('-70');
      // Sin el toggle de pausa, ningún botón.
      expect(topics.some((t) => t.includes('/button/'))).toBe(false);
    } finally {
      await pub.stop();
    }
  });

  it('no reenvía una config que no ha cambiado, pero el estado sí va siempre', async () => {
    const { transport, published } = fakeTransport();
    const pub = makePublisher(app, transport);
    await pub.setConfig({ enabled: true, url: 'mqtt://192.168.1.10:1883', topicPrefix: 'casa', discovery: true });
    try {
      await pub.publishOnce();
      const configsPrimera = published.filter((p) => p.topic.startsWith('homeassistant/')).length;
      expect(configsPrimera).toBeGreaterThan(0);

      published.length = 0;
      await pub.publishOnce(); // nada ha cambiado
      expect(published.filter((p) => p.topic.startsWith('homeassistant/'))).toHaveLength(0);
      // El estado, en cambio, se republica: es lo que se mueve.
      expect(published.some((p) => p.topic === 'casa/device/dev-abc/blocked')).toBe(true);
    } finally {
      await pub.stop();
    }
  });

  it('control ON: un comando /set aplica setState (anti-bucle en el callback)', async () => {
    const { transport, handlers } = fakeTransport();
    const onCommand = vi.fn(async () => undefined);
    const pub = new MqttPublisher({
      prisma: app.prisma,
      secretbox: createSecretbox(generateSecretboxKey()),
      snapshot: async () => SNAP,
      transportFactory: () => transport,
      onCommand,
    });
    await pub.setConfig({ enabled: true, url: 'mqtt://192.168.1.10:1883', topicPrefix: 'casa', control: true });
    try {
      expect(transport.subscribe).toHaveBeenCalled();
      const setHandler = handlers.get('casa/iot/+/set');
      expect(setHandler).toBeDefined();
      setHandler?.('casa/iot/plug-1/set', 'ON');
      await new Promise((r) => setImmediate(r));
      expect(onCommand).toHaveBeenCalledWith('plug-1', { on: true });
    } finally {
      await pub.stop();
    }
  });
});
