import type { HardwareDriver, UpdateDeviceRequest } from '@krakenos/types';
import { INVENTORY_ROOM } from '@krakenos/types';
import type { FastifyPluginAsync } from 'fastify';
import { InventoryService } from './inventory.service.js';
import {
  blockDeviceSchema,
  listDevicesSchema,
  rescanSchema,
  updateDeviceSchema,
} from './inventory.schemas.js';

interface InventoryRoutesOpts {
  driver: HardwareDriver;
}

export const inventoryRoutes: FastifyPluginAsync<InventoryRoutesOpts> = async (app, opts) => {
  const service = new InventoryService(app, opts.driver);

  // Todas las rutas de inventario requieren autenticación.
  app.addHook('preHandler', app.authenticate);

  app.get('/devices', { schema: listDevicesSchema }, async () => {
    return service.list();
  });

  app.patch<{ Params: { id: string }; Body: UpdateDeviceRequest }>(
    '/devices/:id',
    { schema: updateDeviceSchema },
    async (req, reply) => {
      const device = await service.updateMetadata(req.params.id, req.body);
      if (!device) {
        return reply.code(404).send({ code: 'DEVICE_NOT_FOUND', message: 'Dispositivo no encontrado' });
      }
      return reply.send(device);
    },
  );

  app.post('/rescan', { schema: rescanSchema }, async () => {
    return service.scan();
  });

  // Bloqueo de dispositivos — operación privilegiada (solo admin).
  const adminOnly = app.requireRole('admin');

  app.post<{ Params: { id: string } }>(
    '/devices/:id/block',
    { schema: blockDeviceSchema, preHandler: adminOnly },
    async (req, reply) => {
      const device = await service.setBlocked(req.params.id, true);
      if (!device) {
        return reply.code(404).send({ code: 'DEVICE_NOT_FOUND', message: 'Dispositivo no encontrado' });
      }
      app.audit({ action: 'device.block', userId: req.user.sub, detail: device.mac, ip: req.ip });
      return reply.send(device);
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/devices/:id/block',
    { schema: blockDeviceSchema, preHandler: adminOnly },
    async (req, reply) => {
      const device = await service.setBlocked(req.params.id, false);
      if (!device) {
        return reply.code(404).send({ code: 'DEVICE_NOT_FOUND', message: 'Dispositivo no encontrado' });
      }
      app.audit({ action: 'device.unblock', userId: req.user.sub, detail: device.mac, ip: req.ip });
      return reply.send(device);
    },
  );

  // Entrega un snapshot a cada cliente que se une al room de inventario.
  app.io.on('connection', (socket) => {
    socket.on('inventory:rescan', () => {
      void service.scan();
    });
    void socket.join(INVENTORY_ROOM);
    void service.list().then((devices) => socket.emit('inventory:snapshot', devices));
  });
};
