import type { MetricsSnapshot } from '@krakenos/types';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => {
  // `getList` delega en `get` para que los mocks por ruta que ya existen
  // sigan valiendo tal cual: es el mismo GET, con la forma comprobada.
  const get = vi.fn();
  return { get, getList: vi.fn((path: string) => get(path)), post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() };
});
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { HealthCard } from '@/components/settings/HealthCard';

const snapshot: MetricsSnapshot = {
  uptimeSeconds: 3720, // 1 h 2 min
  memory: { rssBytes: 120 * 1024 * 1024, heapUsedBytes: 60 * 1024 * 1024, heapTotalBytes: 90 * 1024 * 1024 },
  http: { total: 42, errors: 3, errorRate: 3 / 42, avgLatencyMs: 12.4, p95LatencyMs: 55, inFlight: 2 },
  eventLoop: { lagMs: 4, maxLagMs: 9 },
  websocketClients: 5,
  storage: {
    dbBytes: 42 * 1024 * 1024,
    diskFreeBytes: 3 * 1024 ** 3,
    diskTotalBytes: 12 * 1024 ** 3,
    diskUsedPercent: 75,
  },
  managers: [{ name: 'driver:mock', count: 7, errors: 1, avgLatencyMs: 8.2, maxLatencyMs: 20 }],
  timestamp: '2026-07-13T10:00:00.000Z',
};

describe('HealthCard — observabilidad (US-191)', () => {
  beforeEach(() => {
    apiMock.get.mockReset().mockResolvedValue(snapshot);
  });

  it('muestra las métricas del agente', async () => {
    render(<HealthCard />);
    expect(await screen.findByText('1 h 2 min')).toBeInTheDocument();
    expect(screen.getByText('120 / 90 MB')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('7.1%')).toBeInTheDocument(); // 3/42
    expect(screen.getByText('12 / 55 ms')).toBeInTheDocument();
    expect(screen.getByText('driver:mock')).toBeInTheDocument();
    expect(apiMock.get).toHaveBeenCalledWith('/system/metrics');
  });

  // US-233: el disco es el fallo más probable de un aparato sobre tarjeta SD.
  it('muestra el disco libre y el tamaño de la base', async () => {
    render(<HealthCard />);
    expect(await screen.findByText('3.0 GB · 75%')).toBeInTheDocument();
    expect(screen.getByText('42 MB')).toBeInTheDocument();
  });

  it('no se rompe si el agente no manda el bloque de almacenamiento', async () => {
    const { storage: _omitted, ...withoutStorage } = snapshot;
    apiMock.get.mockReset().mockResolvedValue(withoutStorage);
    render(<HealthCard />);
    // La tarjeta sigue pintando el resto y el disco sale como desconocido.
    expect(await screen.findByText('1 h 2 min')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('muestra un error si no se pueden cargar las métricas', async () => {
    apiMock.get.mockReset().mockRejectedValue(new Error('boom'));
    render(<HealthCard />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudo cargar las métricas/);
  });

  it('indica cuando aún no hay muestras de manager', async () => {
    apiMock.get.mockReset().mockResolvedValue({ ...snapshot, managers: [] });
    render(<HealthCard />);
    expect(await screen.findByText(/Aún sin muestras de manager/)).toBeInTheDocument();
  });
});
