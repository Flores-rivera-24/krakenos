import type {
  CreateFloorPlanRequest,
  CreateSurveyScanRequest,
  HardwareDriver,
  RecordSurveySampleRequest,
  UpdateFloorPlanRequest,
  WifiBand,
} from '@krakenos/types';
import type { FastifyPluginAsync } from 'fastify';
import { CoverageService } from './coverage.service.js';
import {
  accessPointsSchema,
  createFloorPlanSchema,
  createScanSchema,
  deleteFloorPlanSchema,
  deleteScanSchema,
  getFloorPlanSchema,
  getScanSchema,
  heatmapSchema,
  listFloorPlansSchema,
  listScansSchema,
  measuredHeatmapSchema,
  recordSampleSchema,
  updateFloorPlanSchema,
} from './coverage.schemas.js';

interface CoverageRoutesOpts {
  driver: HardwareDriver;
}

/**
 * Rutas de cobertura WiFi (US-151), prefijo `/api/coverage`. Lectura para
 * cualquier usuario autenticado; escritura solo `admin` y auditada.
 */
export const coverageRoutes: FastifyPluginAsync<CoverageRoutesOpts> = async (app, opts) => {
  const service = new CoverageService(app, opts.driver);
  const adminOnly = app.requireRole('admin');

  // ---- Planos ----

  app.get(
    '/floorplans',
    { schema: listFloorPlansSchema, preHandler: app.authenticate },
    async () => service.listFloorPlans(),
  );

  app.post<{ Body: CreateFloorPlanRequest }>(
    '/floorplans',
    { schema: createFloorPlanSchema, preHandler: adminOnly },
    async (req, reply) => {
      const plan = await service.createFloorPlan(req.body);
      app.audit({
        action: 'coverage.floorplan.create',
        userId: req.user.sub,
        detail: plan.id,
        ip: req.ip,
      });
      return reply.code(201).send(plan);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/floorplans/:id',
    { schema: getFloorPlanSchema, preHandler: app.authenticate },
    async (req, reply) => {
      const plan = await service.getFloorPlan(req.params.id);
      if (!plan) {
        return reply.code(404).send({ code: 'FLOORPLAN_NOT_FOUND', message: 'Plano no encontrado' });
      }
      return reply.send(plan);
    },
  );

  app.patch<{ Params: { id: string }; Body: UpdateFloorPlanRequest }>(
    '/floorplans/:id',
    { schema: updateFloorPlanSchema, preHandler: adminOnly },
    async (req, reply) => {
      const plan = await service.updateFloorPlan(req.params.id, req.body);
      if (!plan) {
        return reply.code(404).send({ code: 'FLOORPLAN_NOT_FOUND', message: 'Plano no encontrado' });
      }
      app.audit({
        action: 'coverage.floorplan.update',
        userId: req.user.sub,
        detail: plan.id,
        ip: req.ip,
      });
      return reply.send(plan);
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/floorplans/:id',
    { schema: deleteFloorPlanSchema, preHandler: adminOnly },
    async (req, reply) => {
      const deleted = await service.deleteFloorPlan(req.params.id);
      if (!deleted) {
        return reply.code(404).send({ code: 'FLOORPLAN_NOT_FOUND', message: 'Plano no encontrado' });
      }
      app.audit({
        action: 'coverage.floorplan.delete',
        userId: req.user.sub,
        detail: req.params.id,
        ip: req.ip,
      });
      return reply.code(204).send();
    },
  );

  app.get<{ Params: { id: string }; Querystring: { band: WifiBand } }>(
    '/floorplans/:id/heatmap',
    { schema: heatmapSchema, preHandler: app.authenticate },
    async (req, reply) => {
      const heatmap = await service.predictedHeatmap(req.params.id, req.query.band);
      if (!heatmap) {
        return reply.code(404).send({ code: 'FLOORPLAN_NOT_FOUND', message: 'Plano no encontrado' });
      }
      return reply.send(heatmap);
    },
  );

  // ---- APs colocables (en vivo desde el driver) ----

  app.get(
    '/access-points',
    { schema: accessPointsSchema, preHandler: app.authenticate },
    async () => service.listPlaceableAccessPoints(),
  );

  // ---- Surveys ----

  app.get<{ Params: { id: string } }>(
    '/floorplans/:id/scans',
    { schema: listScansSchema, preHandler: app.authenticate },
    async (req, reply) => {
      const scans = await service.listScans(req.params.id);
      if (!scans) {
        return reply.code(404).send({ code: 'FLOORPLAN_NOT_FOUND', message: 'Plano no encontrado' });
      }
      return reply.send(scans);
    },
  );

  app.post<{ Params: { id: string }; Body: CreateSurveyScanRequest }>(
    '/floorplans/:id/scans',
    { schema: createScanSchema, preHandler: adminOnly },
    async (req, reply) => {
      const scan = await service.createScan(req.params.id, req.body);
      if (!scan) {
        return reply.code(404).send({ code: 'FLOORPLAN_NOT_FOUND', message: 'Plano no encontrado' });
      }
      app.audit({
        action: 'coverage.scan.create',
        userId: req.user.sub,
        detail: scan.id,
        ip: req.ip,
      });
      return reply.code(201).send(scan);
    },
  );

  app.get<{ Params: { scanId: string } }>(
    '/scans/:scanId',
    { schema: getScanSchema, preHandler: app.authenticate },
    async (req, reply) => {
      const scan = await service.getScanDetail(req.params.scanId);
      if (!scan) {
        return reply.code(404).send({ code: 'SCAN_NOT_FOUND', message: 'Survey no encontrado' });
      }
      return reply.send(scan);
    },
  );

  app.delete<{ Params: { scanId: string } }>(
    '/scans/:scanId',
    { schema: deleteScanSchema, preHandler: adminOnly },
    async (req, reply) => {
      const deleted = await service.deleteScan(req.params.scanId);
      if (!deleted) {
        return reply.code(404).send({ code: 'SCAN_NOT_FOUND', message: 'Survey no encontrado' });
      }
      app.audit({
        action: 'coverage.scan.delete',
        userId: req.user.sub,
        detail: req.params.scanId,
        ip: req.ip,
      });
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { scanId: string }; Body: RecordSurveySampleRequest }>(
    '/scans/:scanId/samples',
    { schema: recordSampleSchema, preHandler: adminOnly },
    async (req, reply) => {
      const outcome = await service.recordSample(req.params.scanId, req.body);
      if (outcome.status === 'scan-not-found') {
        return reply.code(404).send({ code: 'SCAN_NOT_FOUND', message: 'Survey no encontrado' });
      }
      if (outcome.status === 'no-source') {
        return reply.code(400).send({
          code: 'NO_MEASUREMENT_SOURCE',
          message: 'Sin rssiDbm en la petición y el survey no tiene deviceMac con el que medir',
        });
      }
      app.audit({
        action: 'coverage.sample.record',
        userId: req.user.sub,
        detail: req.params.scanId,
        ip: req.ip,
      });
      return reply.send(outcome.result);
    },
  );

  app.get<{ Params: { scanId: string } }>(
    '/scans/:scanId/heatmap',
    { schema: measuredHeatmapSchema, preHandler: app.authenticate },
    async (req, reply) => {
      const heatmap = await service.measuredHeatmap(req.params.scanId);
      if (!heatmap) {
        return reply.code(404).send({ code: 'SCAN_NOT_FOUND', message: 'Survey no encontrado' });
      }
      return reply.send(heatmap);
    },
  );
};
