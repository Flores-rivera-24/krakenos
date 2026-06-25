import type { DeviceTrafficSample, TrafficSampleResult } from '@krakenos/types';

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Endurece la **frontera del driver** para `getTrafficSample` (US-98). Si la
 * forma del WAN es inválida (driver con bug/respuesta corrupta) **lanza** un
 * error descriptivo en vez de dejar que `result.wan.rxBytesPerSec` reviente con
 * un `TypeError`: el `sampleCycle` lo captura y omite el ciclo, evitando además
 * meter datos falsos (un 0 inventado) en el histórico. El desglose por
 * dispositivo se sanea entrada a entrada (las inválidas se descartan).
 */
export function normalizeTrafficSample(raw: unknown): TrafficSampleResult {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('getTrafficSample devolvió una forma inválida (no es un objeto)');
  }
  const r = raw as Record<string, unknown>;
  const wan = r.wan;
  if (typeof wan !== 'object' || wan === null) {
    throw new Error('getTrafficSample devolvió una forma inválida (wan ausente)');
  }
  const w = wan as Record<string, unknown>;
  if (!isFiniteNumber(w.rxBytesPerSec) || !isFiniteNumber(w.txBytesPerSec)) {
    throw new Error('getTrafficSample devolvió una forma inválida (wan rx/tx no numérico)');
  }

  const devices: DeviceTrafficSample[] = [];
  if (Array.isArray(r.devices)) {
    for (const entry of r.devices) {
      const sample = toDeviceSample(entry);
      if (sample) devices.push(sample);
    }
  }

  return { wan: { rxBytesPerSec: w.rxBytesPerSec, txBytesPerSec: w.txBytesPerSec }, devices };
}

/** Convierte una entrada de desglose desconocida en `DeviceTrafficSample`, o `null`. */
function toDeviceSample(entry: unknown): DeviceTrafficSample | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const e = entry as Record<string, unknown>;
  if (typeof e.mac !== 'string' || e.mac.length === 0) return null;
  if (!isFiniteNumber(e.rxBytesPerSec) || !isFiniteNumber(e.txBytesPerSec)) return null;
  return {
    mac: e.mac,
    ip: typeof e.ip === 'string' ? e.ip : '',
    rxBytesPerSec: e.rxBytesPerSec,
    txBytesPerSec: e.txBytesPerSec,
  };
}
