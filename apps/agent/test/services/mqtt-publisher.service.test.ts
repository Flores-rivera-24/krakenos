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
    { id: 'light/salon', name: 'Salón', on: true, brightness: 80, powerW: 9 },
    { id: 'plug-1', name: 'Enchufe', on: false, powerW: 0 },
  ],
  energy: { todayKwh: 1.23, todayCost: 0.3, currency: '€' },
  devicesOnline: 5,
};

function fakeTransport() {
  const published: [string, string][] = [];
  const transport: MqttTransport = {
    subscribe: vi.fn(async () => undefined),
    publish: vi.fn(async (topic: string, payload: string) => {
      published.push([topic, payload]);
    }),
    dispose: vi.fn(async () => undefined),
  };
  return { transport, published };
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
      const topics = published.map((p) => p[0]);
      expect(topics).toContain('casa/status');
      expect(topics).toContain('casa/iot/light_salon'); // '/' saneado a '_'
      expect(topics).toContain('casa/energy');
      expect(topics).toContain('casa/devices/online');
      // Ni la contraseña ni el token secreto aparecen en NINGÚN payload.
      const allPayloads = published.map((p) => p[1]).join('\n');
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
});
