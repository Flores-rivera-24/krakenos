import type { DnsHistoryResponse, DnsManager } from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import { DNS_QUERY_RETENTION_DAYS, pruneDnsQueryLog } from '../../config/retention.js';
import {
  MARCA_INICIAL,
  aparatosSinConsultas,
  macDelCliente,
  seleccionarNuevas,
  type MarcaDeIngesta,
} from '../../dns/history.js';
import { createTickLoop, type TickLoop } from '../../system/tick-loop.js';
import type { NewDestinationService } from './new-destination.service.js';

/** Cada cuánto se pregunta al resolver por sus consultas recientes. */
const DEFAULT_INGEST_MS = 60_000;

/**
 * Cuántas consultas se piden al resolver por barrido, y cuántas entran como
 * máximo. Acota dos cosas a la vez: lo que se trae a memoria y lo que se escribe
 * de un golpe. Con 60 s entre barridos, 500 consultas cubren un hogar cargado con
 * holgura; lo que no entre se recoge en el siguiente.
 */
const DEFAULT_BATCH = 500;

/** Cuántas entradas devuelve la lectura como máximo si nadie pide otra cosa. */
export const DEFAULT_HISTORY_LIMIT = 100;

/** Ventana que cubre la vista de cobertura (aparatos callados). */
const COVERAGE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Vista mínima del solicitante para aplicar la privacidad por rol. */
export interface Viewer {
  sub: string;
  role: string;
}

/**
 * Histórico DNS (US-252). Dos responsabilidades:
 *
 * 1. **Ingerir**: sondear el resolver, resolver la IP al aparato **en ese
 *    momento** y persistir lo nuevo, con marca de agua para no duplicar.
 * 2. **Leer con privacidad por rol**: un admin ve el hogar; cualquier otro rol ve
 *    **solo sus propios aparatos** —los que tienen su `ownerId`—, nunca los de
 *    otros ni los que no se pudieron atribuir. La autoridad es del servidor, igual
 *    que en el bienestar digital: la capacidad `home.activity` protege el registro
 *    en vivo, y esta es su versión con privacidad.
 */
export class DnsHistoryService {
  private loop: TickLoop | null = null;
  private marca: MarcaDeIngesta = MARCA_INICIAL;

  constructor(
    private readonly app: FastifyInstance,
    private readonly dns: DnsManager,
    private readonly intervalMs = DEFAULT_INGEST_MS,
    private readonly batch = DEFAULT_BATCH,
    /** Aviso de destino nuevo (US-253). Opcional: sin él la ingesta funciona igual. */
    private readonly destinos?: NewDestinationService,
  ) {}

  /** Ingiere una tanda. No propaga errores: un resolver caído no tumba el barrido. */
  async ingestOnce(): Promise<number> {
    try {
      const consultas = await this.dns.recentQueries(this.batch);
      const { nuevas, marca } = seleccionarNuevas(consultas, this.marca, this.batch);
      if (nuevas.length === 0) return 0;

      // El cruce IP→MAC se hace AHORA, con el inventario de ahora: la fila guarda a
      // quién pertenecía la IP en el momento de la consulta. Resolverlo al leer
      // atribuiría la navegación de ayer a quien tenga esa IP hoy.
      const devices = await this.app.prisma.device.findMany({ select: { mac: true, ip: true } });
      const macPorIp = new Map<string, string>();
      for (const d of devices) if (d.ip) macPorIp.set(d.ip, d.mac);

      await this.app.prisma.dnsQueryLog.createMany({
        data: nuevas.map((q) => ({
          timestamp: new Date(q.timestamp),
          domain: q.domain,
          client: q.client,
          blocked: q.blocked,
          mac: macDelCliente(q.client, macPorIp),
        })),
      });

      // La marca avanza DESPUÉS de que la escritura haya salido bien: moverla antes
      // deja ese tramo sin ingerir para siempre y sin un solo error visible.
      this.marca = marca;

      // Aviso de destino nuevo (US-253) sobre ESTA tanda, ya atribuida: releer la
      // tabla obligaría a rehacer el cruce IP→MAC, que no se puede rehacer sin
      // atribuirle a alguien la navegación de otro. No puede tumbar la ingesta.
      if (this.destinos) {
        const atribuidas = nuevas
          .map((q) => ({
            mac: macDelCliente(q.client, macPorIp),
            domain: q.domain,
            // `timestamp` viaja como ISO; el núcleo puro trabaja en ms epoch.
            at: new Date(q.timestamp).getTime(),
          }))
          // Una consulta sin MAC no se puede atribuir a un aparato, y un aviso que
          // no dice de quién es no sirve para nada.
          .filter((c): c is { mac: string; domain: string; at: number } => c.mac !== null);
        await this.destinos.procesar(atribuidas);
      }
      return nuevas.length;
    } catch (err) {
      this.app.log.error({ err }, '[dns-history] la ingesta de consultas falló');
      return 0;
    }
  }

  /**
   * Histórico legible por `viewer`, con su cobertura. Un no-admin solo ve las
   * consultas de los aparatos que le pertenecen; si no tiene ninguno, ve una lista
   * vacía y **no** un error: no le falta permiso, le faltan aparatos.
   */
  async history(viewer: Viewer, limit = DEFAULT_HISTORY_LIMIT): Promise<DnsHistoryResponse> {
    const isAdmin = viewer.role === 'admin';

    const devices = await this.app.prisma.device.findMany({
      select: { mac: true, label: true, hostname: true, ownerId: true, online: true },
    });
    const visibles = isAdmin ? devices : devices.filter((d) => d.ownerId === viewer.sub);
    const macsVisibles = visibles.map((d) => d.mac);

    // El filtro por MAC va en la CONSULTA, no después de traer las filas: filtrar en
    // memoria significa que el servidor leyó de todas formas el historial de otra
    // persona, y basta un `console.log` de más para que salga.
    const where = isAdmin ? {} : { mac: { in: macsVisibles } };
    const rows = await this.app.prisma.dnsQueryLog.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: limit,
    });

    const nombrePorMac = new Map(devices.map((d) => [d.mac, d.label ?? d.hostname ?? null]));

    // Cobertura: aparatos EN LÍNEA sin ni una consulta en la ventana. Es la respuesta
    // medible a «¿y los que usan DoH?», y se calcula sobre lo que este rol puede ver.
    const desde = new Date(Date.now() - COVERAGE_WINDOW_MS);
    const conActividad = await this.app.prisma.dnsQueryLog.findMany({
      where: { timestamp: { gte: desde }, ...(isAdmin ? {} : { mac: { in: macsVisibles } }) },
      select: { mac: true },
      distinct: ['mac'],
    });
    const macsConConsultas = new Set(
      conActividad.map((r) => r.mac).filter((m): m is string => m !== null),
    );
    const enLinea = visibles.filter((d) => d.online).map((d) => d.mac);

    const total = await this.app.prisma.dnsQueryLog.count();

    return {
      entries: rows.map((r) => ({
        id: r.id,
        timestamp: r.timestamp.toISOString(),
        domain: r.domain,
        blocked: r.blocked,
        mac: r.mac,
        deviceLabel: r.mac ? (nombrePorMac.get(r.mac) ?? null) : null,
      })),
      coverage: {
        recording: total > 0,
        silentDevices: aparatosSinConsultas(enLinea, macsConConsultas),
        onlineDevices: enLinea.length,
        retentionDays: DNS_QUERY_RETENTION_DAYS,
      },
    };
  }

  /** Borra el histórico entero. Lo usa la acción manual de un admin (auditada). */
  async clear(): Promise<number> {
    const res = await this.app.prisma.dnsQueryLog.deleteMany();
    this.marca = MARCA_INICIAL;
    return res.count;
  }

  start(): void {
    this.loop ??= createTickLoop({
      intervalMs: this.intervalMs,
      tick: async () => {
        await this.ingestOnce();
        await pruneDnsQueryLog(this.app.prisma);
      },
      onError: (err) => this.app.log.error({ err }, '[dns-history] barrido fallido'),
      onSkip: () => this.app.log.warn('[dns-history] barrido saltado por solape'),
    });
    this.loop.start();
  }

  stop(): void {
    this.loop?.stop();
  }
}
