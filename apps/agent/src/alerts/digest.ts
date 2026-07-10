import type { DigestFrequency } from '@krakenos/types';
import { DIGEST_FREQUENCIES } from '@krakenos/types';
import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { ALERT_EVENTS } from './alert-config.js';

/**
 * Resumen del hogar (US-180): un mensaje diario o semanal con lo relevante del
 * periodo (dispositivos nuevos, eventos de seguridad, automatizaciones). Se
 * envía por los canales configurados del hogar (push, email y/o Telegram) a las
 * 08:00 locales; el barrido es horario y dispara por **cruce** (patrón US-168,
 * `prevTick`: nada atrasado al arrancar). **Sin PII en claro**: el texto lleva
 * recuentos y nombres amables de aparatos, nunca emails ni IPs.
 */

/** Hora local de envío (minuto del día): 08:00. */
const SEND_MINUTE = 8 * 60;

type PrismaLike = Pick<
  PrismaClient,
  'device' | 'auditLog' | 'automationRun' | 'setting' | 'trafficSample'
>;

/** Intervalo (s) que representa cada rollup de tráfico (media × segundos = bytes). */
const ROLLUP_SECONDS = 60;

/** Formatea bytes de forma legible para el resumen (GB/MB, sin decimales de más). */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

export interface DigestContent {
  title: string;
  body: string;
}

function isFrequency(value: unknown): value is DigestFrequency {
  return typeof value === 'string' && (DIGEST_FREQUENCIES as readonly string[]).includes(value);
}

/** Compone el resumen del periodo [since, now). Devuelve `null` si no pasó nada. */
export async function buildDigest(
  prisma: PrismaLike,
  since: Date,
  now: Date,
  period: 'daily' | 'weekly',
): Promise<DigestContent | null> {
  const [newDevices, securityEvents, runs, failedRuns] = await Promise.all([
    prisma.device.findMany({
      where: { firstSeen: { gte: since, lt: now } },
      select: { label: true, hostname: true },
      take: 10,
    }),
    prisma.auditLog.count({
      where: {
        createdAt: { gte: since, lt: now },
        action: { in: ALERT_EVENTS.map((e) => e.event) },
      },
    }),
    prisma.automationRun.count({ where: { createdAt: { gte: since, lt: now } } }),
    prisma.automationRun.count({ where: { createdAt: { gte: since, lt: now }, ok: false } }),
  ]);

  // Uso de internet del hogar en el periodo (US-184): solo en el resumen semanal
  // y a nivel de hogar (WAN), nunca desglosado por persona — el detalle por
  // persona es privado por rol y vive en la UI autenticada, no en un broadcast.
  let usageBytes = 0;
  if (period === 'weekly') {
    const samples = await prisma.trafficSample.findMany({
      where: { timestamp: { gte: since, lt: now } },
      select: { rxBytesPerSec: true, txBytesPerSec: true },
    });
    usageBytes = samples.reduce(
      (sum, s) => sum + (s.rxBytesPerSec + s.txBytesPerSec) * ROLLUP_SECONDS,
      0,
    );
  }

  if (newDevices.length === 0 && securityEvents === 0 && runs === 0 && usageBytes === 0) return null;

  const lines: string[] = [];
  if (newDevices.length > 0) {
    // Nombres amables (label/hostname); nunca MACs ni emails (sin PII, US-85).
    // Saneados: el hostname lo elige el propio aparato — uno hostil podría
    // colar texto de phishing en un canal de confianza. Se colapsa y trunca.
    const names = newDevices
      .map((d) => (d.label ?? d.hostname ?? 'sin nombre').replace(/\s+/g, ' ').slice(0, 32))
      .join(', ');
    lines.push(`• ${newDevices.length} dispositivo(s) nuevo(s) en la red: ${names}`);
  }
  if (securityEvents > 0) {
    lines.push(`• ${securityEvents} evento(s) de seguridad (detalle en Ajustes → Auditoría)`);
  }
  if (runs > 0) {
    lines.push(
      `• ${runs} automatización(es) ejecutada(s)${failedRuns > 0 ? ` · ${failedRuns} con fallos` : ''}`,
    );
  }
  if (usageBytes > 0) {
    lines.push(`• Uso de internet esta semana: ${formatBytes(usageBytes)}`);
  }

  return {
    title: period === 'daily' ? 'Tu resumen diario del hogar' : 'Tu resumen semanal del hogar',
    body: lines.join('\n'),
  };
}

/** Canales de salida del resumen (inyectables; en producción, los reales). */
export interface DigestChannels {
  push?: (title: string, body: string) => Promise<void>;
  email?: (subject: string, text: string) => void;
  telegram?: (title: string, body: string) => void;
}

export class DigestService {
  private timer: NodeJS.Timeout | null = null;
  /** Instante del barrido anterior; el envío es por cruce de las 08:00. */
  private prevTick: Date | null = null;

  constructor(
    private readonly app: FastifyInstance,
    private readonly channels: DigestChannels,
  ) {}

  /** Frecuencia configurada (`Setting` `digestFrequency`); inválida → off. */
  private async frequency(): Promise<DigestFrequency> {
    const row = await this.app.prisma.setting.findUnique({ where: { key: 'digestFrequency' } });
    return isFrequency(row?.value) ? row.value : 'off';
  }

  /** ¿El barrido cruza las 08:00 del día de envío en (prev, now]? */
  static due(frequency: DigestFrequency, prev: Date, now: Date): boolean {
    if (frequency === 'off') return false;
    for (const base of [prev, now]) {
      const at = new Date(base);
      at.setHours(Math.floor(SEND_MINUTE / 60), SEND_MINUTE % 60, 0, 0);
      if (frequency === 'weekly' && at.getDay() !== 1) continue; // lunes
      if (at > prev && at <= now) return true;
    }
    return false;
  }

  async tick(now: Date = new Date()): Promise<void> {
    const prev = this.prevTick;
    this.prevTick = now;
    if (!prev) return; // primer barrido: fija la base, no envía nada atrasado

    const frequency = await this.frequency();
    if (!DigestService.due(frequency, prev, now)) return;

    const days = frequency === 'weekly' ? 7 : 1;
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const digest = await buildDigest(
      this.app.prisma,
      since,
      now,
      frequency === 'weekly' ? 'weekly' : 'daily',
    );
    if (!digest) return; // periodo sin novedades: no hacer ruido

    // Best-effort por canal: un canal caído no frena a los demás.
    try {
      await this.channels.push?.(digest.title, digest.body);
    } catch (err) {
      this.app.log.warn({ err }, '[digest] no se pudo enviar el resumen por push');
    }
    this.channels.email?.(digest.title, digest.body);
    this.channels.telegram?.(digest.title, digest.body);
    this.app.log.info('[digest] resumen del hogar enviado');
  }

  private async tickCycle(): Promise<void> {
    try {
      await this.tick();
    } catch (err) {
      this.app.log.error({ err }, '[digest] el barrido falló; se omite este ciclo');
    }
  }

  start(intervalMs = 60 * 60 * 1000): void {
    if (this.timer) return;
    void this.tickCycle(); // fija prevTick
    this.timer = setInterval(() => void this.tickCycle(), intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
