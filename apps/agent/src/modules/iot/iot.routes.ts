import type { IotManager, UpdateIotStateRequest } from '@krakenos/types';
import { IOT_ROOM } from '@krakenos/types';
import type { FastifyPluginAsync } from 'fastify';
import { IotError } from '../../iot/index.js';
import { MatterCommissionError } from '../../iot/matter.iot.js';
import { commissionMatterSchema, listIotSchema, updateIotSchema } from './iot.schemas.js';

interface IotRoutesOpts {
  iot: IotManager;
}

export const iotRoutes: FastifyPluginAsync<IotRoutesOpts> = async (app, opts) => {
  const { iot } = opts;

  app.addHook('preHandler', app.authenticate);

  app.get('/devices', { schema: listIotSchema }, async () => {
    return iot.listDevices();
  });

  // Operar el hogar (encender/apagar/atenuar) es capacidad `home.control`
  // (US-179): admin y member; kid/guest/viewer siguen en solo-lectura.
  app.patch<{ Params: { id: string }; Body: UpdateIotStateRequest }>(
    '/devices/:id',
    { schema: updateIotSchema, preHandler: app.requireCapability('home.control') },
    async (req, reply) => {
      try {
        const device = await iot.setState(req.params.id, req.body);
        app.io.to(IOT_ROOM).emit('iot:device-updated', device);
        app.audit({ action: 'iot.device.update', userId: req.user.sub, detail: device.id, ip: req.ip });
        return reply.send(device);
      } catch (err) {
        if (err instanceof IotError) {
          const status = err.code === 'IOT_NOT_FOUND' ? 404 : 400;
          return reply.code(status).send({ code: err.code, message: err.message });
        }
        throw err;
      }
    },
  );

  // Comisionar un dispositivo Matter nuevo desde la app (US-172). Solo admin y
  // auditado. Disponible únicamente si la integración IoT activa soporta Matter
  // (`commission`); si no, 409 con un mensaje claro. Los fallos del controlador se
  // devuelven con un código estable que la UI traduce a un mensaje amable.
  app.post<{ Body: { code: string } }>(
    '/matter/commission',
    { schema: commissionMatterSchema, preHandler: app.requireRole('admin') },
    async (req, reply) => {
      if (typeof iot.commission !== 'function') {
        return reply
          .code(409)
          .send({ code: 'MATTER_UNAVAILABLE', message: 'No hay una integración Matter activa' });
      }
      try {
        const result = await iot.commission(req.body.code);
        app.audit({
          action: 'iot.matter.commission',
          userId: req.user.sub,
          detail: result.deviceId,
          ip: req.ip,
        });
        return reply.code(201).send(result);
      } catch (err) {
        if (err instanceof MatterCommissionError) {
          return reply.code(400).send({ code: err.code, message: err.message });
        }
        throw err;
      }
    },
  );

  // Snapshot de IoT a cada cliente que se conecta. El `.catch()` es CRÍTICO: si el
  // driver IoT real está caído/timeout (MQTT desconectado, bridge sin responder),
  // `listDevices()` rechaza; sin capturar, sería un `unhandledRejection` que en
  // Node 20 **termina el proceso** → bucle de crash cada vez que un cliente
  // reconecta mientras el IoT siga mal. Se degrada como en inventario.
  app.io.on('connection', (socket) => {
    void socket.join(IOT_ROOM);
    void iot
      .listDevices()
      .then((devices) => socket.emit('iot:snapshot', devices))
      .catch((err) => app.log.error({ err }, '[iot] no se pudo enviar el snapshot inicial'));
  });
};
