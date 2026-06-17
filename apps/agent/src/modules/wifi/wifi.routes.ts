import type {
  HardwareDriver,
  UpdateGuestNetworkRequest,
  UpdateWifiNetworkRequest,
  UpdateWifiRequest,
} from '@krakenos/types';
import type { FastifyPluginAsync } from 'fastify';
import {
  accessPointsSchema,
  getGuestSchema,
  getNetworkSchema,
  getWifiSchema,
  networkClientsSchema,
  networksSchema,
  updateGuestSchema,
  updateNetworkSchema,
  updateWifiSchema,
} from './wifi.schemas.js';

interface WifiRoutesOpts {
  driver: HardwareDriver;
}

export const wifiRoutes: FastifyPluginAsync<WifiRoutesOpts> = async (app, opts) => {
  const { driver } = opts;
  const adminOnly = app.requireRole('admin');

  app.get('/', { schema: getWifiSchema, preHandler: app.authenticate }, async () => {
    return driver.getWifi();
  });

  app.put<{ Body: UpdateWifiRequest }>(
    '/',
    { schema: updateWifiSchema, preHandler: adminOnly },
    async (req) => {
      const result = await driver.updateWifi(req.body);
      app.audit({ action: 'wifi.update', userId: req.user.sub, ip: req.ip });
      return result;
    },
  );

  app.get('/guest', { schema: getGuestSchema, preHandler: app.authenticate }, async () => {
    return driver.getGuestNetwork();
  });

  app.put<{ Body: UpdateGuestNetworkRequest }>(
    '/guest',
    { schema: updateGuestSchema, preHandler: adminOnly },
    async (req) => {
      const result = await driver.updateGuestNetwork(req.body);
      app.audit({ action: 'wifi.guest.update', userId: req.user.sub, ip: req.ip });
      return result;
    },
  );

  // ---- Multi-AP (Fase 2) ----

  app.get('/access-points', { schema: accessPointsSchema, preHandler: app.authenticate }, async () => {
    return driver.listAccessPoints();
  });

  app.get('/networks', { schema: networksSchema, preHandler: app.authenticate }, async () => {
    return driver.listWifiNetworks();
  });

  app.get<{ Params: { id: string } }>(
    '/networks/:id',
    { schema: getNetworkSchema, preHandler: app.authenticate },
    async (req, reply) => {
      const network = await driver.getWifiNetwork(req.params.id);
      if (!network) {
        return reply.code(404).send({ code: 'NETWORK_NOT_FOUND', message: 'Red no encontrada' });
      }
      return reply.send(network);
    },
  );

  app.put<{ Params: { id: string }; Body: UpdateWifiNetworkRequest }>(
    '/networks/:id',
    { schema: updateNetworkSchema, preHandler: adminOnly },
    async (req, reply) => {
      const network = await driver.updateWifiNetwork(req.params.id, req.body);
      if (!network) {
        return reply.code(404).send({ code: 'NETWORK_NOT_FOUND', message: 'Red no encontrada' });
      }
      app.audit({ action: 'wifi.network.update', userId: req.user.sub, detail: network.id, ip: req.ip });
      return reply.send(network);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/networks/:id/clients',
    { schema: networkClientsSchema, preHandler: app.authenticate },
    async (req, reply) => {
      const clients = await driver.listNetworkClients(req.params.id);
      if (!clients) {
        return reply.code(404).send({ code: 'NETWORK_NOT_FOUND', message: 'Red no encontrada' });
      }
      return reply.send(clients);
    },
  );
};
