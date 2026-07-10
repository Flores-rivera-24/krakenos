import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TelegramNotifier,
  decodeImageDataUrl,
  maskSensitive,
  telegramConfigFromEnv,
} from '../../src/alerts/telegram.js';

function fakeApp(channels?: { telegram: boolean }): FastifyInstance {
  return {
    log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
    ...(channels
      ? { alertConfig: { channelsFor: () => ({ push: false, email: false, ...channels }) } }
      : {}),
  } as unknown as FastifyInstance;
}

/** Canal Telegram (US-180): opt-in por entorno, sender inyectable. */
describe('alerts/telegram', () => {
  afterEach(() => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  });

  it('sin TELEGRAM_BOT_TOKEN/CHAT_ID el canal no existe (off por defecto)', () => {
    expect(telegramConfigFromEnv()).toBeNull();
    process.env.TELEGRAM_BOT_TOKEN = 'abc';
    expect(telegramConfigFromEnv()).toBeNull(); // falta el chat id
    process.env.TELEGRAM_CHAT_ID = '123';
    expect(telegramConfigFromEnv()).toEqual({ botToken: 'abc', chatId: '123' });
  });

  it('deshabilitado no envía nada aunque se le pida', () => {
    const notifier = new TelegramNotifier(fakeApp(), null);
    expect(notifier.enabled).toBe(false);
    notifier.notify('Hola', 'mundo'); // no lanza, no hace nada
    notifier.notifyForAudit('device.block', 'aa:bb');
  });

  it('notify envía título y cuerpo por el sender inyectado', async () => {
    const sent: string[] = [];
    const notifier = new TelegramNotifier(fakeApp(), { botToken: 't', chatId: 'c' }, async (t) => {
      sent.push(t);
    });
    notifier.notify('Resumen', 'línea 1');
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toContain('Resumen');
    expect(sent[0]).toContain('línea 1');
  });

  it('notifyForAudit respeta la regla del evento (canal telegram OFF → nada)', async () => {
    const sent: string[] = [];
    const send = async (t: string) => {
      sent.push(t);
    };

    const off = new TelegramNotifier(fakeApp({ telegram: false }), { botToken: 't', chatId: 'c' }, send);
    off.notifyForAudit('device.block', 'aa:bb:cc:dd:ee:ff');
    await new Promise((r) => setTimeout(r, 20));
    expect(sent).toHaveLength(0);

    const on = new TelegramNotifier(fakeApp({ telegram: true }), { botToken: 't', chatId: 'c' }, send);
    on.notifyForAudit('device.block', 'aa:bb:cc:dd:ee:ff');
    await vi.waitFor(() => expect(sent).toHaveLength(1));
  });

  it('lo que sale hacia Telegram va con MAC e IP enmascaradas (postura US-85)', async () => {
    expect(maskSensitive('Se bloqueó aa:bb:cc:dd:ee:ff desde 192.168.1.77')).toBe(
      'Se bloqueó …:ee:ff desde la red local',
    );
    const sent: string[] = [];
    const notifier = new TelegramNotifier(fakeApp({ telegram: true }), { botToken: 't', chatId: 'c' }, async (t) => {
      sent.push(t);
    });
    notifier.notifyForAudit('device.block', 'aa:bb:cc:dd:ee:ff');
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).not.toContain('aa:bb:cc:dd:ee:ff');
    expect(sent[0]).toContain('…:ee:ff');
  });

  it('un evento fuera del catálogo de alertas no genera mensaje', async () => {
    const sent: string[] = [];
    const notifier = new TelegramNotifier(fakeApp({ telegram: true }), { botToken: 't', chatId: 'c' }, async (t) => {
      sent.push(t);
    });
    notifier.notifyForAudit('rooms.create', 'x');
    await new Promise((r) => setTimeout(r, 20));
    expect(sent).toHaveLength(0);
  });

  // --- Foto de movimiento (US-186) ---

  it('decodeImageDataUrl acepta JPEG/PNG base64 y rechaza SVG u otros', () => {
    const jpeg = decodeImageDataUrl('data:image/jpeg;base64,/9j/');
    expect(jpeg?.mime).toBe('image/jpeg');
    expect(jpeg?.bytes).toBeInstanceOf(Uint8Array);
    expect(decodeImageDataUrl('data:image/svg+xml;base64,AAAA')).toBeNull();
    expect(decodeImageDataUrl('not a data url')).toBeNull();
  });

  it('sendPhotoForAudit envía la foto por el sender inyectado (canal ON)', async () => {
    const photos: { caption: string; mime: string }[] = [];
    const notifier = new TelegramNotifier(
      fakeApp({ telegram: true }),
      { botToken: 't', chatId: 'c' },
      undefined,
      async (caption, _bytes, mime) => {
        photos.push({ caption, mime });
      },
    );
    notifier.sendPhotoForAudit('camera.motion', '📷 Entrada', 'data:image/jpeg;base64,/9j/');
    await vi.waitFor(() => expect(photos).toHaveLength(1));
    expect(photos[0]!.mime).toBe('image/jpeg');
    expect(photos[0]!.caption).toContain('Entrada');
  });

  it('sendPhotoForAudit no envía si el canal telegram está OFF o la imagen no es rasterizable', async () => {
    const photos: unknown[] = [];
    const sendPhoto = async () => {
      photos.push(1);
    };
    const off = new TelegramNotifier(fakeApp({ telegram: false }), { botToken: 't', chatId: 'c' }, undefined, sendPhoto);
    off.sendPhotoForAudit('camera.motion', 'x', 'data:image/jpeg;base64,/9j/');
    const on = new TelegramNotifier(fakeApp({ telegram: true }), { botToken: 't', chatId: 'c' }, undefined, sendPhoto);
    on.sendPhotoForAudit('camera.motion', 'x', 'data:image/svg+xml;base64,AAAA'); // SVG no rasterizable
    await new Promise((r) => setTimeout(r, 20));
    expect(photos).toHaveLength(0);
  });
});
