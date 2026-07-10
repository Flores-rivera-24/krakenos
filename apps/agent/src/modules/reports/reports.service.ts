import type { EnergyRange, TrafficRange } from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import type { EnergyService } from '../energy/energy.service.js';
import type { TrafficService } from '../traffic/traffic.service.js';
import { toCsv } from './csv.js';

/** Nº máximo de filas de auditoría exportadas (evita CSVs enormes). */
const AUDIT_EXPORT_LIMIT = 10_000;

/**
 * Informes exportables en CSV (US-109): auditoría, inventario y tráfico. Datos de
 * solo lectura sobre tablas/servicios existentes — para entregar a un auditor o a
 * una revisión mensual (algo que hoy no existía: solo había dashboards en vivo).
 */
export class ReportsService {
  constructor(
    private readonly app: FastifyInstance,
    private readonly traffic: TrafficService,
    private readonly energy: EnergyService,
  ) {}

  async auditCsv(): Promise<string> {
    const rows = await this.app.prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: AUDIT_EXPORT_LIMIT,
    });
    return toCsv(
      ['fecha', 'accion', 'usuario', 'ip', 'detalle'],
      rows.map((r) => [r.createdAt.toISOString(), r.action, r.userId ?? '', r.ip ?? '', r.detail ?? '']),
    );
  }

  async devicesCsv(): Promise<string> {
    const rows = await this.app.prisma.device.findMany({ orderBy: { lastSeen: 'desc' } });
    return toCsv(
      ['mac', 'ip', 'hostname', 'nombre', 'fabricante', 'tipo', 'bloqueado', 'en_linea', 'vlan', 'ultima_vez'],
      rows.map((d) => [
        d.mac,
        d.ip,
        d.hostname ?? '',
        d.label ?? '',
        d.vendor ?? '',
        d.type,
        d.isBlocked,
        d.online,
        d.vlanTag ?? '',
        d.lastSeen.toISOString(),
      ]),
    );
  }

  async trafficCsv(range: TrafficRange): Promise<string> {
    const stats = await this.traffic.getStats(range);
    return toCsv(
      ['timestamp', 'rx_bytes_por_seg', 'tx_bytes_por_seg'],
      stats.buckets.map((b) => [b.timestamp, Math.round(b.rxBytesPerSec), Math.round(b.txBytesPerSec)]),
    );
  }

  /** Consumo por dispositivo en la ventana: energía (Wh) y coste estimado (US-182). */
  async energyCsv(range: EnergyRange): Promise<string> {
    const stats = await this.energy.getStats(range);
    return toCsv(
      ['dispositivo', 'estancia', 'energia_wh', `coste_${stats.currency}`],
      stats.devices.map((d) => [
        d.name ?? d.deviceId,
        d.room ?? '',
        Math.round(d.energyWh * 100) / 100,
        d.cost ?? '',
      ]),
    );
  }
}
