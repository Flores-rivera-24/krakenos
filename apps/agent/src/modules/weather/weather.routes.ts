import type { FastifyPluginAsync } from 'fastify';
import type { UpdateWeatherConfigRequest } from '@krakenos/types';
import type { WeatherService } from './weather.service.js';
import { getWeatherSchema, updateWeatherSchema } from './weather.schemas.js';

interface WeatherRoutesOpts {
  service: WeatherService;
}

/**
 * Tiempo exterior (US-254). Lectura = autenticado: el estado dice si está
 * activo, a quién se pregunta y **qué coordenada se envía**, y eso es
 * precisamente lo que cualquiera que viva en la casa tiene derecho a ver sin
 * pedirle permiso al admin.
 *
 * ⚠️ Lo que sale en `sentLatitude`/`sentLongitude` es la ubicación **que ya se
 * está enviando a un tercero**, no un dato nuevo: si está apagado son `null`.
 * Por eso esta lectura no necesita el guard de admin que sí llevan las
 * coordenadas crudas de `/api/system/settings` (AUD3-02) — declarar lo que se
 * envía es lo contrario de filtrarlo.
 *
 * Escritura = admin y auditada: activar esto manda la ubicación del hogar fuera.
 */
export const weatherRoutes: FastifyPluginAsync<WeatherRoutesOpts> = async (app, opts) => {
  const { service } = opts;

  app.get('/', { schema: getWeatherSchema, preHandler: app.authenticate }, async () =>
    service.getStatus(),
  );

  app.put<{ Body: UpdateWeatherConfigRequest }>(
    '/',
    { schema: updateWeatherSchema, preHandler: app.requireRole('admin') },
    async (req) => {
      const before = await service.getConfig();
      const config = await service.saveConfig(req.body);
      // El detalle nombra el consentimiento y su alcance, que es lo que un día
      // habrá que poder demostrar: quién lo activó, cuándo y con qué precisión.
      app.audit({
        action: 'weather.config',
        userId: req.user.sub,
        detail: `enabled=${config.enabled} precision=${config.precision}`,
        ip: req.ip,
      });
      // Al encender, una lectura inmediata: si no, la primera llegaría una hora
      // después y parecería que no funciona.
      if (config.enabled && !before.enabled) {
        void service.refresh().catch(() => undefined);
      }
      return service.getStatus();
    },
  );
};
