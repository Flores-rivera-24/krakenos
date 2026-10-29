import type { MetricsSnapshot } from '@krakenos/types';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => {
  // `getList` delega en `get` para que los mocks por ruta que ya existen
  // sigan valiendo tal cual: es el mismo GET, con la forma comprobada.
  const get = vi.fn();
  return {
    get,
    getList: vi.fn((path: string) => get(path)),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
  };
});
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { HealthCard } from '@/components/settings/HealthCard';

const snapshot: MetricsSnapshot = {
  uptimeSeconds: 3720, // 1 h 2 min
  memory: {
    rssBytes: 120 * 1024 * 1024,
    heapUsedBytes: 60 * 1024 * 1024,
    heapTotalBytes: 90 * 1024 * 1024,
  },
  http: {
    total: 42,
    errors: 3,
    errorRate: 3 / 42,
    avgLatencyMs: 12.4,
    p95LatencyMs: 55,
    inFlight: 2,
  },
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
    expect(screen.getByText('120 MB')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('7,1%')).toBeInTheDocument(); // 3/42
    expect(screen.getByText('12 / 55 ms')).toBeInTheDocument();
    expect(screen.getByText('driver:mock')).toBeInTheDocument();
    expect(apiMock.get).toHaveBeenCalledWith('/system/metrics');
  });

  // La memoria del agente es UNA magnitud con nombre (el RSS); el heap de V8 va
  // aparte y rotulado. «120 / 90 MB» se leía como usado/total con el usado mayor.
  it('rotula la memoria del agente y el heap por separado', async () => {
    render(<HealthCard />);
    expect(await screen.findByText('Memoria del agente')).toBeInTheDocument();
    expect(screen.getByText('120 MB')).toBeInTheDocument();
    expect(screen.getByText('Heap de V8 (usado / reservado)')).toBeInTheDocument();
    expect(screen.getByText('60 / 90 MB')).toBeInTheDocument();
    expect(screen.queryByText('120 / 90 MB')).not.toBeInTheDocument();
  });

  it('concuerda en número: «1 llamada» y «7 llamadas»', async () => {
    apiMock.get.mockReset().mockResolvedValue({
      ...snapshot,
      managers: [
        { name: 'driver:mock', count: 1, errors: 0, avgLatencyMs: 0, maxLatencyMs: 0 },
        { name: 'iot:mock', count: 7, errors: 0, avgLatencyMs: 8, maxLatencyMs: 9 },
      ],
    });
    render(<HealthCard />);
    expect(await screen.findByText('1 llamada')).toBeInTheDocument();
    expect(screen.getByText('7 llamadas')).toBeInTheDocument();
    expect(screen.queryByText('1 llamadas')).not.toBeInTheDocument();
  });

  it('dice que el porcentaje de disco es el USADO (los GB son los libres)', async () => {
    render(<HealthCard />);
    // diskUsedPercent = (total - libre) / total: 75 % usado, 3 GB libres.
    expect(await screen.findByText('3,0 GB · 75% usado')).toBeInTheDocument();
  });

  // US-233: el disco es el fallo más probable de un aparato sobre tarjeta SD.
  it('muestra el disco libre y el tamaño de la base', async () => {
    render(<HealthCard />);
    expect(await screen.findByText('3,0 GB · 75% usado')).toBeInTheDocument();
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

describe('HealthCard: sondeo que falla con métricas ya pintadas', () => {
  it('conserva las cifras y las marca como viejas', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      apiMock.get.mockReset().mockResolvedValueOnce(snapshot);
      apiMock.get.mockRejectedValue(new Error('red'));
      render(<HealthCard />);
      expect(await screen.findByText('1 h 2 min')).toBeInTheDocument();
      expect(screen.queryByText('Datos obsoletos')).not.toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(5100);
      expect(await screen.findByText('Datos obsoletos')).toBeInTheDocument();
      expect(screen.getByText('1 h 2 min')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('una cifra en alarma lleva texto además del color', async () => {
    apiMock.get
      .mockReset()
      .mockResolvedValue({ ...snapshot, http: { ...snapshot.http, errorRate: 0.2 } });
    render(<HealthCard />);
    expect(await screen.findByText('20,0%')).toBeInTheDocument();
    expect(screen.getByText('Fuera de lo normal')).toBeInTheDocument();
  });
});

describe('HealthCard · errores de un gestor', () => {
  it('dice «2 errores» y «1 error» en texto, no con un glifo', async () => {
    apiMock.get.mockReset().mockResolvedValue({
      ...snapshot,
      managers: [
        { name: 'driver:mock', count: 7, errors: 2, avgLatencyMs: 8, maxLatencyMs: 9 },
        { name: 'iot:mock', count: 7, errors: 1, avgLatencyMs: 8, maxLatencyMs: 9 },
      ],
    });
    render(<HealthCard />);
    expect(await screen.findByText(/2 errores/)).toBeInTheDocument();
    expect(screen.getByText(/1 error(?!es)/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('✕');
  });
});
