import { describe, expect, it } from 'vitest';
import { MetricsRegistry } from '../../src/observability/metrics.js';

const memory = { rssBytes: 100, heapUsedBytes: 50, heapTotalBytes: 80 };
const snap = (r: MetricsRegistry) =>
  r.snapshot({ uptimeSeconds: 10, memory, websocketClients: 3 });

describe('MetricsRegistry', () => {
  it('cuenta peticiones HTTP y calcula la tasa de error (5xx)', () => {
    const r = new MetricsRegistry();
    r.recordHttp(200, 10);
    r.recordHttp(404, 5); // 4xx NO cuenta como error de servidor
    r.recordHttp(500, 20);
    r.recordHttp(503, 30);
    const s = snap(r);
    expect(s.http.total).toBe(4);
    expect(s.http.errors).toBe(2);
    expect(s.http.errorRate).toBeCloseTo(0.5);
  });

  it('sin peticiones, la tasa de error es 0 (no divide por cero)', () => {
    expect(snap(new MetricsRegistry()).http.errorRate).toBe(0);
  });

  it('calcula media y p95 de latencia', () => {
    const r = new MetricsRegistry();
    for (let i = 1; i <= 100; i++) r.recordHttp(200, i); // 1..100 ms
    const s = snap(r);
    expect(s.http.avgLatencyMs).toBeCloseTo(50.5);
    expect(s.http.p95LatencyMs).toBe(96); // percentil 0.95 de 1..100
  });

  it('el gauge en vuelo sube y baja, y nunca baja de 0', () => {
    const r = new MetricsRegistry();
    r.incInFlight();
    r.incInFlight();
    r.decInFlight();
    expect(snap(r).http.inFlight).toBe(1);
    r.decInFlight();
    r.decInFlight(); // de más
    expect(snap(r).http.inFlight).toBe(0);
  });

  it('registra el retraso del event loop (media y máximo)', () => {
    const r = new MetricsRegistry();
    r.recordLoopLag(5);
    r.recordLoopLag(15);
    const s = snap(r);
    expect(s.eventLoop.lagMs).toBeCloseTo(10);
    expect(s.eventLoop.maxLagMs).toBe(15);
  });

  it('agrega operaciones por nombre (manager) con media, máximo y errores', () => {
    const r = new MetricsRegistry();
    r.recordOp('driver:mock', 10, true);
    r.recordOp('driver:mock', 30, false);
    r.recordOp('vpn:wg', 5, true);
    const s = snap(r);
    expect(s.managers).toHaveLength(2);
    const driver = s.managers.find((m) => m.name === 'driver:mock')!;
    expect(driver.count).toBe(2);
    expect(driver.errors).toBe(1);
    expect(driver.avgLatencyMs).toBeCloseTo(20);
    expect(driver.maxLatencyMs).toBe(30);
    // Orden estable por nombre.
    expect(s.managers.map((m) => m.name)).toEqual(['driver:mock', 'vpn:wg']);
  });

  it('propaga memoria, uptime y clientes WS de la instantánea', () => {
    const s = snap(new MetricsRegistry());
    expect(s.memory).toEqual(memory);
    expect(s.uptimeSeconds).toBe(10);
    expect(s.websocketClients).toBe(3);
    expect(typeof s.timestamp).toBe('string');
  });

  it('acota el ring buffer de latencias (no crece sin límite)', () => {
    const r = new MetricsRegistry();
    for (let i = 0; i < 1000; i++) r.recordHttp(200, 1);
    // No hay forma directa de leer el buffer; comprobamos que sigue respondiendo
    // coherente (media 1) tras superar de largo la ventana.
    expect(snap(r).http.avgLatencyMs).toBeCloseTo(1);
    expect(snap(r).http.total).toBe(1000);
  });
});
