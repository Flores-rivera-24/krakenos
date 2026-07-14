/**
 * Registro de métricas internas en memoria (US-191). Fuente única de la
 * observabilidad del agente: latencia y errores HTTP, concurrencia en vuelo
 * («cola»), retraso del event loop, conexiones WebSocket y latencia por manager.
 *
 * Puro y sin dependencias de Fastify: el plugin (`plugins/metrics.ts`) lo alimenta
 * desde los hooks y la ruta lee `snapshot()`. Así se testea el cálculo (medias,
 * p95, tasa de error) con datos inyectados, sin levantar un servidor.
 *
 * Todo es **efímero** (se reinicia con el proceso) y **acotado** (ring buffers de
 * tamaño fijo): observar el estado nunca debe hacer crecer la memoria sin límite.
 */

/** Ventana de muestras recientes para percentiles de latencia y lag del loop. */
const HTTP_SAMPLES = 512;
const LAG_SAMPLES = 64;

/** Métricas acumuladas de una operación con nombre (p. ej. un manager). */
interface OpStat {
  count: number;
  errors: number;
  totalMs: number;
  maxMs: number;
}

export interface ManagerMetric {
  name: string;
  count: number;
  errors: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
}

export interface MetricsSnapshot {
  /** Uptime del proceso del agente en segundos. */
  uptimeSeconds: number;
  memory: {
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
  };
  http: {
    total: number;
    /** Respuestas 5xx. */
    errors: number;
    /** Errores / total en [0, 1] (0 si no hubo peticiones). */
    errorRate: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
    /** Peticiones en curso ahora mismo (gauge de concurrencia = «cola»). */
    inFlight: number;
  };
  eventLoop: {
    /** Retraso medio reciente del event loop en ms. */
    lagMs: number;
    /** Retraso máximo reciente en ms. */
    maxLagMs: number;
  };
  /** Clientes WebSocket conectados. */
  websocketClients: number;
  /** Latencia/errores por manager (p. ej. el driver de red). */
  managers: ManagerMetric[];
  timestamp: string;
}

/** Media de un array (0 si está vacío). */
function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Percentil `p` (0..1) de un array (0 si vacío). No muta el original. */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx]!;
}

export class MetricsRegistry {
  private httpTotal = 0;
  private httpErrors = 0;
  private inFlight = 0;
  private readonly latencies: number[] = [];
  private readonly lags: number[] = [];
  private readonly ops = new Map<string, OpStat>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  /** Añade a un ring buffer acotado (descarta el más viejo al llegar al tope). */
  private push(buf: number[], value: number, max: number): void {
    buf.push(value);
    if (buf.length > max) buf.shift();
  }

  recordHttp(statusCode: number, latencyMs: number): void {
    this.httpTotal++;
    if (statusCode >= 500) this.httpErrors++;
    if (Number.isFinite(latencyMs) && latencyMs >= 0) {
      this.push(this.latencies, latencyMs, HTTP_SAMPLES);
    }
  }

  incInFlight(): void {
    this.inFlight++;
  }

  decInFlight(): void {
    // No baja de 0 (un onResponse sin su onRequest no debe romper el gauge).
    if (this.inFlight > 0) this.inFlight--;
  }

  recordLoopLag(ms: number): void {
    if (Number.isFinite(ms) && ms >= 0) this.push(this.lags, ms, LAG_SAMPLES);
  }

  /** Registra la latencia de una operación con nombre (manager, tarea…). */
  recordOp(name: string, latencyMs: number, ok: boolean): void {
    const stat = this.ops.get(name) ?? { count: 0, errors: 0, totalMs: 0, maxMs: 0 };
    stat.count++;
    if (!ok) stat.errors++;
    if (Number.isFinite(latencyMs) && latencyMs >= 0) {
      stat.totalMs += latencyMs;
      stat.maxMs = Math.max(stat.maxMs, latencyMs);
    }
    this.ops.set(name, stat);
  }

  snapshot(input: {
    uptimeSeconds: number;
    memory: { rssBytes: number; heapUsedBytes: number; heapTotalBytes: number };
    websocketClients: number;
  }): MetricsSnapshot {
    const managers: ManagerMetric[] = [...this.ops.entries()]
      .map(([name, s]) => ({
        name,
        count: s.count,
        errors: s.errors,
        avgLatencyMs: s.count > 0 ? s.totalMs / s.count : 0,
        maxLatencyMs: s.maxMs,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      uptimeSeconds: input.uptimeSeconds,
      memory: input.memory,
      http: {
        total: this.httpTotal,
        errors: this.httpErrors,
        errorRate: this.httpTotal > 0 ? this.httpErrors / this.httpTotal : 0,
        avgLatencyMs: avg(this.latencies),
        p95LatencyMs: percentile(this.latencies, 0.95),
        inFlight: this.inFlight,
      },
      eventLoop: {
        lagMs: avg(this.lags),
        maxLagMs: this.lags.length > 0 ? Math.max(...this.lags) : 0,
      },
      websocketClients: input.websocketClients,
      managers,
      timestamp: this.now().toISOString(),
    };
  }
}
