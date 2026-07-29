import { createReadStream } from 'node:fs';
import type {
  CameraManager,
  CreateCameraRequest,
  RecordingConfig,
  StreamTokenClaims,
  UpdateCameraRequest,
  UpdateMotionConfigRequest,
} from '@krakenos/types';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { toCameraRecord, toManagedCamera, type CameraStore } from '../../cameras/camera.store.js';
import { FRIGATE_RECORDING_PREFIX, segmentContentType } from '../../cameras/frigate.parsers.js';
import { StreamLimitError } from '../../cameras/hls-stream.js';
import type { MotionService } from './motion.service.js';
import type { RecordingService } from './recording.service.js';
import {
  createCameraSchema,
  downloadRecordingSchema,
  getMotionConfigSchema,
  getRecordingConfigSchema,
  listCamerasSchema,
  listRecordingsSchema,
  motionEventsSchema,
  removeCameraSchema,
  removeRecordingSchema,
  snapshotSchema,
  startStreamSchema,
  stopStreamSchema,
  streamPlaylistSchema,
  streamSegmentSchema,
  updateCameraSchema,
  updateMotionConfigSchema,
  updateRecordingConfigSchema,
} from './cameras.schemas.js';

interface CameraRoutesOpts {
  cameras: CameraManager;
  /** Store de gestión de cámaras (alta/baja desde la UI, US-148). Sin él, solo lectura. */
  store?: CameraStore;
  /** Servicio de movimiento (US-186). Sin él, no se exponen sus rutas. */
  motion?: MotionService;
  /** Servicio de grabación (US-187). Sin él, no se exponen sus rutas. */
  recording?: RecordingService;
}

/** Vida del token de stream (US-185): corta, el reproductor lo refresca solo. */
const STREAM_TOKEN_TTL_SEC = 300;

export const camerasRoutes: FastifyPluginAsync<CameraRoutesOpts> = async (app, opts) => {
  const { cameras, store, motion, recording } = opts;

  /**
   * Valida el token de stream de la query (`?st=`) para **una** cámara. A
   * diferencia del resto de rutas, la playlist y los segmentos HLS **no** pueden
   * llevar el access token en una cabecera (ni hls.js ni el `<video>` nativo
   * añaden cabeceras a la carga de segmentos), así que se autentica con un token
   * efímero acotado a la cámara que viaja en la URL. Devuelve `false` (y responde
   * 401) si el token falta, no valida, no es de tipo `stream` o es de otra cámara.
   */
  /**
   * Nombre de fichero seguro para `Content-Disposition`: el id de la grabación viaja
   * en la URL, así que no se interpola crudo en una cabecera (AUD3-05).
   */
  const safeFilename = (id: string): string => id.replace(/[^\w.-]/g, '_').slice(0, 64) || 'clip';

  const authorizeStream = (req: FastifyRequest, reply: FastifyReply, cameraId: string): boolean => {
    const token = (req.query as { st?: string }).st;
    if (!token) {
      reply.code(401).send({ code: 'STREAM_UNAUTHORIZED', message: 'Falta el token de stream' });
      return false;
    }
    try {
      const claims = app.verifyToken<StreamTokenClaims>(token);
      if (claims.type !== 'stream' || claims.cam !== cameraId) {
        reply.code(401).send({ code: 'STREAM_UNAUTHORIZED', message: 'Token de stream inválido' });
        return false;
      }
    } catch {
      reply.code(401).send({ code: 'STREAM_UNAUTHORIZED', message: 'Token de stream inválido' });
      return false;
    }
    return true;
  };

  // Lecturas de vídeo: capacidad `home.cameras` (admin/member/viewer), NO «cualquier
  // autenticado» (AUD3-02). `kid` y `guest` quedan fuera —la UI ya se lo ocultaba,
  // pero el servidor no lo imponía— y un token de API tampoco alcanza (sus scopes
  // son `home.view`/`home.control`): el vídeo del interior de la casa no se opera
  // con una credencial de automatización.
  const canWatch = app.requireCapability('home.cameras');

  app.get('/', { schema: listCamerasSchema, preHandler: canWatch }, async () => {
    return cameras.listCameras();
  });

  app.get<{ Params: { id: string } }>(
    '/:id/snapshot',
    { schema: snapshotSchema, preHandler: canWatch },
    async (req, reply) => {
      const snapshot = await cameras.getSnapshot(req.params.id);
      if (!snapshot) {
        return reply
          .code(404)
          .send({ code: 'CAMERA_UNAVAILABLE', message: 'Cámara no encontrada o sin señal' });
      }
      return reply.send(snapshot);
    },
  );

  // --- Streaming HLS en vivo (US-185) ---

  // Arranca (o reutiliza) la sesión y devuelve un token de stream para la playlist.
  app.post<{ Params: { id: string } }>(
    '/:id/stream',
    { schema: startStreamSchema, preHandler: canWatch },
    async (req, reply) => {
      let session;
      try {
        session = await cameras.startStream(req.params.id);
      } catch (err) {
        if (err instanceof StreamLimitError) {
          return reply.code(429).send({
            code: 'STREAM_LIMIT_REACHED',
            message: 'Demasiados streams simultáneos; cierra otra cámara e inténtalo de nuevo',
          });
        }
        throw err;
      }
      if (!session) {
        return reply
          .code(404)
          .send({ code: 'CAMERA_UNAVAILABLE', message: 'Cámara no encontrada o sin señal' });
      }
      const token = app.jwt.sign(
        { sub: req.user.sub, cam: req.params.id, type: 'stream' },
        { expiresIn: STREAM_TOKEN_TTL_SEC },
      );
      app.audit({ action: 'camera.stream', userId: req.user.sub, detail: req.params.id, ip: req.ip });
      return reply
        .code(201)
        .send({ ...session, token, expiresIn: STREAM_TOKEN_TTL_SEC });
    },
  );

  // Para la sesión bajo demanda (al cerrar el reproductor).
  app.delete<{ Params: { id: string } }>(
    '/:id/stream',
    { schema: stopStreamSchema, preHandler: canWatch },
    async (req, reply) => {
      await cameras.stopStream(req.params.id);
      return reply.code(204).send();
    },
  );

  // Playlist HLS: autenticada por el token de stream (no por el access token).
  // Reescribe cada segmento con `?st=` para que hls.js/`<video>` los pidan con token.
  app.get<{ Params: { id: string }; Querystring: { st: string } }>(
    '/:id/stream/index.m3u8',
    { schema: streamPlaylistSchema },
    async (req, reply) => {
      if (!authorizeStream(req, reply, req.params.id)) return reply;
      const playlist = await cameras.readStreamPlaylist(req.params.id);
      if (playlist === null) {
        return reply
          .code(404)
          .send({ code: 'STREAM_NOT_READY', message: 'El stream aún no está listo' });
      }
      const token = req.query.st;
      const rewritten = playlist
        .split('\n')
        .map((line) => {
          const trimmed = line.trim();
          // Solo las líneas de segmento (no comentarios `#`, no vacías) llevan token.
          if (!trimmed || trimmed.startsWith('#')) return line;
          const sep = trimmed.includes('?') ? '&' : '?';
          return `${trimmed}${sep}st=${encodeURIComponent(token)}`;
        })
        .join('\n');
      return reply
        .header('Cache-Control', 'no-store')
        .type('application/vnd.apple.mpegurl')
        .send(rewritten);
    },
  );

  // Segmento .ts: mismo token de stream; nombre validado contra path traversal.
  app.get<{ Params: { id: string; segment: string }; Querystring: { st: string } }>(
    '/:id/stream/:segment',
    { schema: streamSegmentSchema },
    async (req, reply) => {
      if (!authorizeStream(req, reply, req.params.id)) return reply;
      const bytes = await cameras.readStreamSegment(req.params.id, req.params.segment);
      if (!bytes) {
        return reply
          .code(404)
          .send({ code: 'STREAM_SEGMENT_NOT_FOUND', message: 'Segmento no encontrado' });
      }
      return reply
        .header('Cache-Control', 'no-store')
        // .ts → MPEG-TS; los backends que proxyean fMP4 (Frigate/go2rtc, US-214)
        // sirven segmentos .m4s/.mp4 → video/mp4.
        .type(segmentContentType(req.params.segment))
        .send(Buffer.from(bytes));
    },
  );

  // --- Detección de movimiento (US-186) ---
  if (motion) {
    // Eventos recientes **con snapshot** (línea de tiempo, US-187): son fotogramas
    // del interior, así que van con `home.cameras` como el resto del vídeo.
    app.get<{ Querystring: { cameraId?: string } }>(
      '/motion/events',
      { schema: motionEventsSchema, preHandler: canWatch },
      async (req) => motion.recentEvents(req.query.cameraId),
    );

    // Config de movimiento por cámara: lectura con `home.cameras`, escritura admin.
    app.get<{ Params: { id: string } }>(
      '/:id/motion',
      { schema: getMotionConfigSchema, preHandler: canWatch },
      async (req) => motion.getConfig(req.params.id),
    );

    app.put<{ Params: { id: string }; Body: UpdateMotionConfigRequest }>(
      '/:id/motion',
      { schema: updateMotionConfigSchema, preHandler: app.requireRole('admin') },
      async (req) => {
        const updated = await motion.setConfig(req.params.id, req.body);
        app.audit({
          action: 'camera.motion_config',
          userId: req.user.sub,
          detail: req.params.id,
          ip: req.ip,
        });
        return updated;
      },
    );
  }

  // --- Grabación de clips (US-187) ---
  if (recording) {
    // Config global de grabación: lectura auth, escritura admin. Las rutas `config`
    // son estáticas → ganan a `/:id` en el router.
    app.get(
      '/recordings/config',
      { schema: getRecordingConfigSchema, preHandler: canWatch },
      async () => recording.getConfig(),
    );
    app.put<{ Body: Partial<RecordingConfig> }>(
      '/recordings/config',
      { schema: updateRecordingConfigSchema, preHandler: app.requireRole('admin') },
      async (req) => {
        const updated = await recording.setConfig(req.body);
        app.audit({ action: 'camera.recording_config', userId: req.user.sub, ip: req.ip });
        return updated;
      },
    );

    // Lista de clips (timeline) — cualquier rol autenticado; sin la ruta en disco.
    // Con un NVR delegado (Frigate, US-214) los clips viven allí: se listan por
    // proxy y `RecordingService` no graba (no se duplica lo que el NVR ya hace).
    app.get<{ Querystring: { cameraId?: string } }>(
      '/recordings',
      { schema: listRecordingsSchema, preHandler: canWatch },
      async (req) =>
        cameras.listNativeRecordings
          ? cameras.listNativeRecordings(req.query.cameraId)
          : recording.list(req.query.cameraId),
    );

    // Descarga autenticada del clip (fichero local, o proxy del NVR — la URL de
    // Frigate nunca sale al cliente, US-214).
    app.get<{ Params: { id: string } }>(
      '/recordings/:id/download',
      { schema: downloadRecordingSchema, preHandler: canWatch },
      async (req, reply) => {
        if (req.params.id.startsWith(FRIGATE_RECORDING_PREFIX) && cameras.readNativeRecording) {
          const bytes = await cameras.readNativeRecording(req.params.id);
          if (!bytes) {
            return reply
              .code(404)
              .send({ code: 'RECORDING_NOT_FOUND', message: 'Grabación no encontrada' });
          }
          return reply
            .header('Content-Type', 'video/mp4')
            .header('Content-Disposition', `attachment; filename="${safeFilename(req.params.id)}.mp4"`)
            .send(Buffer.from(bytes));
        }
        const row = await recording.getRow(req.params.id);
        if (!row) {
          return reply
            .code(404)
            .send({ code: 'RECORDING_NOT_FOUND', message: 'Grabación no encontrada' });
        }
        const stream = createReadStream(recording.absPath(row));
        return reply
          .header('Content-Type', 'video/mp4')
          .header('Content-Disposition', `attachment; filename="${safeFilename(row.id)}.mp4"`)
          .send(stream);
      },
    );

    // Borrado de un clip — admin. Los clips del NVR no se borran desde aquí:
    // su retención la gobierna Frigate (honesto, no fingimos gestionarla).
    app.delete<{ Params: { id: string } }>(
      '/recordings/:id',
      { schema: removeRecordingSchema, preHandler: app.requireRole('admin') },
      async (req, reply) => {
        if (req.params.id.startsWith(FRIGATE_RECORDING_PREFIX)) {
          return reply.code(400).send({
            code: 'RECORDING_MANAGED_BY_NVR',
            message: 'Esta grabación la gestiona Frigate; su retención se configura allí',
          });
        }
        const ok = await recording.remove(req.params.id);
        if (!ok) {
          return reply
            .code(404)
            .send({ code: 'RECORDING_NOT_FOUND', message: 'Grabación no encontrada' });
        }
        app.audit({ action: 'camera.recording_delete', userId: req.user.sub, detail: req.params.id, ip: req.ip });
        return reply.code(204).send();
      },
    );
  }

  // Gestión de cámaras (alta/edición/baja) — solo admin, si hay store. La `rtspUrl`
  // (con credenciales) se acepta pero **nunca** se devuelve.
  if (store) {
    const adminOnly = app.requireRole('admin');

    app.post<{ Body: CreateCameraRequest }>(
      '/',
      { schema: createCameraSchema, preHandler: adminOnly },
      async (req, reply) => {
        const record = toCameraRecord(req.body);
        await store.upsert(record);
        app.audit({ action: 'camera.add', userId: req.user.sub, detail: record.id, ip: req.ip });
        return reply.code(201).send(toManagedCamera(record));
      },
    );

    app.patch<{ Params: { id: string }; Body: UpdateCameraRequest }>(
      '/:id',
      { schema: updateCameraSchema, preHandler: adminOnly },
      async (req, reply) => {
        const existing = await store.get(req.params.id);
        if (!existing) {
          return reply.code(404).send({ code: 'CAMERA_NOT_FOUND', message: 'Cámara no encontrada' });
        }
        const updated = { ...existing, ...req.body };
        await store.upsert(updated);
        app.audit({ action: 'camera.update', userId: req.user.sub, detail: updated.id, ip: req.ip });
        return toManagedCamera(updated);
      },
    );

    app.delete<{ Params: { id: string } }>(
      '/:id',
      { schema: removeCameraSchema, preHandler: adminOnly },
      async (req, reply) => {
        // Detiene un stream vivo antes de borrar la cámara (no dejar ffmpeg huérfano).
        await cameras.stopStream(req.params.id);
        const removed = await store.removeById(req.params.id);
        if (!removed) {
          return reply.code(404).send({ code: 'CAMERA_NOT_FOUND', message: 'Cámara no encontrada' });
        }
        app.audit({ action: 'camera.remove', userId: req.user.sub, detail: req.params.id, ip: req.ip });
        return reply.code(204).send();
      },
    );
  }
};
