import type { FastifyInstance } from 'fastify';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HomeEvent } from '@krakenos/types';
import { buildTestApp, resetDb } from '../helpers/app.js';
import { HomeEventBus } from '../../src/automations/event-bus.js';
import {
  WeatherService,
  WEATHER_SETTING_KEY,
  type WeatherFetch,
} from '../../src/modules/weather/weather.service.js';

/**
 * Tiempo exterior (US-254). Lo que se prueba aquí no es «trae la temperatura»:
 * es que **apagado no pregunta**, que lo que sale es la coordenada acordada, y
 * que un fallo se declara en vez de quedarse mudo.
 */

let app: FastifyInstance;

/** Fetch que registra las URL pedidas: el contador ES la aserción del opt-in. */
function fetchEspia(body: unknown = { current: { temperature_2m: 4.2 } }, ok = true) {
  const urls: string[] = [];
  const fn: WeatherFetch = async (url) => {
    urls.push(url);
    return { ok, json: async () => body };
  };
  return { fn, urls };
}

async function conUbicacion(lat = 41.38879, lon = 2.15899): Promise<void> {
  for (const [key, value] of [
    ['homeLatitude', String(lat)],
    ['homeLongitude', String(lon)],
  ] as const) {
    await app.prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
}

beforeEach(async () => {
  app = app ?? (await buildTestApp());
  await resetDb(app);
});

afterAll(async () => {
  await app?.close();
});

describe('opt-in duro', () => {
  it('APAGADO no hace ni una petición, aunque haya ubicación', async () => {
    await conUbicacion();
    const espia = fetchEspia();
    const service = new WeatherService(app, { fetchFn: espia.fn });

    await service.refresh();

    // Si esto sube de 0, la ubicación del hogar salió de casa sin permiso.
    expect(espia.urls).toEqual([]);
  });

  it('viene apagado y con la precisión protectora por defecto', async () => {
    const config = await new WeatherService(app).getConfig();
    expect(config).toEqual({ enabled: false, precision: 'rounded' });
  });

  it('una configuración corrompida NO degrada a encendido', async () => {
    await app.prisma.setting.create({
      data: { key: WEATHER_SETTING_KEY, value: '{no es json' },
    });
    const espia = fetchEspia();
    await conUbicacion();
    const service = new WeatherService(app, { fetchFn: espia.fn });

    expect((await service.getConfig()).enabled).toBe(false);
    await service.refresh();
    expect(espia.urls).toEqual([]);
  });

  it('apagar borra las lecturas ya traídas', async () => {
    await conUbicacion();
    const espia = fetchEspia();
    const service = new WeatherService(app, { fetchFn: espia.fn });
    await service.saveConfig({ enabled: true });
    await service.refresh();
    expect((await service.getStatus()).readings).toHaveLength(1);

    await service.saveConfig({ enabled: false });

    // Dejar el dato de ayer en pantalla tras revocar el permiso parecería que se
    // sigue consultando.
    const status = await service.getStatus();
    expect(status.readings).toEqual([]);
    expect(status.sentLatitude).toBeNull();
  });
});

describe('qué coordenada sale de casa', () => {
  it('con la precisión protegida envía la redondeada, no la exacta', async () => {
    await conUbicacion(41.38879, 2.15899);
    const espia = fetchEspia();
    const service = new WeatherService(app, { fetchFn: espia.fn });
    await service.saveConfig({ enabled: true, precision: 'rounded' });

    await service.refresh();

    expect(espia.urls).toHaveLength(1);
    expect(espia.urls[0]).toContain('latitude=41.4');
    // La aserción que de verdad protege: la exacta NO viaja.
    expect(espia.urls[0]).not.toContain('41.38879');
  });

  it('en modo exacto envía la exacta (el ajuste hace algo distinto)', async () => {
    await conUbicacion(41.38879, 2.15899);
    const espia = fetchEspia();
    const service = new WeatherService(app, { fetchFn: espia.fn });
    await service.saveConfig({ enabled: true, precision: 'exact' });

    await service.refresh();

    expect(espia.urls[0]).toContain('41.38879');
  });

  it('el estado publica la coordenada que se envía, no la guardada', async () => {
    await conUbicacion(41.38879, 2.15899);
    const service = new WeatherService(app, { fetchFn: fetchEspia().fn });
    await service.saveConfig({ enabled: true, precision: 'rounded' });

    const status = await service.getStatus();

    expect(status.sentLatitude).toBe(41.4);
    expect(status.sentLongitude).toBe(2.2);
  });
});

describe('flanco y publicación en el bus', () => {
  it('la primera lectura lleva prevValue null y la siguiente el valor anterior', async () => {
    await conUbicacion();
    const eventos: HomeEvent[] = [];
    const bus = new HomeEventBus();
    bus.subscribe((e) => void eventos.push(e));

    let temp = 9;
    const fn: WeatherFetch = async () => ({
      ok: true,
      json: async () => ({ current: { temperature_2m: temp } }),
    });
    const service = new WeatherService(app, { bus, fetchFn: fn });
    await service.saveConfig({ enabled: true });

    await service.refresh();
    temp = 3;
    await service.refresh();

    expect(eventos).toHaveLength(2);
    expect(eventos[0]).toMatchObject({ type: 'weather-reading', value: 9, prevValue: null });
    expect(eventos[1]).toMatchObject({ type: 'weather-reading', value: 3, prevValue: 9 });
  });

  it('un fallo NO pisa el prevValue ni el instante de la última lectura', async () => {
    await conUbicacion();
    const eventos: HomeEvent[] = [];
    const bus = new HomeEventBus();
    bus.subscribe((e) => void eventos.push(e));

    let falla = false;
    const fn: WeatherFetch = async () => {
      if (falla) throw new Error('red caída');
      return { ok: true, json: async () => ({ current: { temperature_2m: 9 } }) };
    };
    const service = new WeatherService(app, { bus, fetchFn: fn });
    await service.saveConfig({ enabled: true });
    await service.refresh();
    const tras1 = await service.getStatus();

    falla = true;
    await service.refresh();
    const tras2 = await service.getStatus();

    // Solo el evento de la lectura buena, y la marca no avanzó con el fallo.
    expect(eventos).toHaveLength(1);
    expect(tras2.lastFetchAt).toBe(tras1.lastFetchAt);
    expect(tras2.lastError).toBe('No se pudo contactar con el proveedor del tiempo.');
  });
});

describe('errores que se declaran', () => {
  it('sin ubicación no culpa al proveedor: manda a Ajustes', async () => {
    const espia = fetchEspia();
    const service = new WeatherService(app, { fetchFn: espia.fn });
    await service.saveConfig({ enabled: true });

    await service.refresh();

    expect(espia.urls).toEqual([]);
    expect((await service.getStatus()).lastError).toMatch(/ubicación del hogar/i);
    expect((await service.getStatus()).locationConfigured).toBe(false);
  });

  it('una respuesta sin medidas reconocibles se dice', async () => {
    await conUbicacion();
    const service = new WeatherService(app, { fetchFn: fetchEspia({ current: {} }).fn });
    await service.saveConfig({ enabled: true });

    await service.refresh();

    expect((await service.getStatus()).lastError).toMatch(/ninguna medida/i);
  });

  it('un error del proveedor se distingue de una caída de red', async () => {
    await conUbicacion();
    const service = new WeatherService(app, { fetchFn: fetchEspia({}, false).fn });
    await service.saveConfig({ enabled: true });

    await service.refresh();

    expect((await service.getStatus()).lastError).toMatch(/respondió con un error/i);
  });
});

describe('barrido', () => {
  it('start() no consulta por sí mismo si el opt-in está apagado', async () => {
    vi.useFakeTimers();
    try {
      await conUbicacion();
      const espia = fetchEspia();
      const service = new WeatherService(app, { fetchFn: espia.fn });
      service.start(1000);
      await vi.advanceTimersByTimeAsync(3500);
      service.stop();
      expect(espia.urls).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
