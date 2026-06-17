import type {
  HardwareDriver,
  UpdateGuestNetworkRequest,
  UpdateWifiRequest,
} from '@krakenos/types';
import type { FastifyPluginAsync } from 'fastify';
import {
  getGuestSchema,
  getWifiSchema,
  updateGuestSchema,
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
      return driver.updateWifi(req.body);
    },
  );

  app.get('/guest', { schema: getGuestSchema, preHandler: app.authenticate }, async () => {
    return driver.getGuestNetwork();
  });

  app.put<{ Body: UpdateGuestNetworkRequest }>(
    '/guest',
    { schema: updateGuestSchema, preHandler: adminOnly },
    async (req) => {
      return driver.updateGuestNetwork(req.body);
    },
  );
};
