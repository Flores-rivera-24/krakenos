import type { TelemetrySnapshot } from '@krakenos/types';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

const supportMock = vi.hoisted(() => ({ downloadSupportBundle: vi.fn() }));
vi.mock('@/lib/support', () => supportMock);

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/store/toast.store', () => ({ toast: toastMock }));

import { SupportCard } from '@/components/settings/SupportCard';

const OFF: TelemetrySnapshot = { enabled: false, version: '1.0.0' };
const ON: TelemetrySnapshot = {
  enabled: true,
  version: '1.0.0',
  counts: { devices: 5, rooms: 2, scenes: 1, automations: 3, iotSchedules: 0, users: 2 },
};

const PLAN = { current: '0.1.0', mode: 'systemd' };

describe('SupportCard — telemetría opt-in + bundle (US-192)', () => {
  beforeEach(() => {
    apiMock.get.mockReset().mockImplementation((path: string) => {
      if (path === '/system/update/plan') return Promise.resolve(PLAN);
      return Promise.resolve(OFF);
    });
    apiMock.patch.mockReset().mockResolvedValue({});
    supportMock.downloadSupportBundle.mockReset().mockResolvedValue(new Blob(['{}']));
    toastMock.success.mockReset();
    toastMock.error.mockReset();
  });

  it('muestra la telemetría desactivada por defecto (opt-in)', async () => {
    render(<SupportCard />);
    expect(await screen.findByRole('button', { name: 'Activar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Activar' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('activa la telemetría vía el ajuste telemetryEnabled', async () => {
    render(<SupportCard />);
    const btn = await screen.findByRole('button', { name: 'Activar' });
    apiMock.get.mockResolvedValueOnce(ON); // el refetch tras activar
    fireEvent.click(btn);
    await waitFor(() =>
      expect(apiMock.patch).toHaveBeenCalledWith('/system/settings', {
        key: 'telemetryEnabled',
        value: 'on',
      }),
    );
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
  });

  it('descarga el bundle de soporte', async () => {
    // jsdom no implementa createObjectURL; lo stubbeamos.
    const createUrl = vi.fn(() => 'blob:x');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: revoke });
    render(<SupportCard />);
    const dl = await screen.findByRole('button', { name: /Descargar paquete de soporte/ });
    fireEvent.click(dl);
    await waitFor(() => expect(supportMock.downloadSupportBundle).toHaveBeenCalled());
  });

  it('«Reportar un problema» abre el issue pre-rellenado; nada se envía solo (US-218)', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<SupportCard />);
    // Espera a que el plan (versión/modo) esté cargado antes de pulsar.
    await screen.findByRole('button', { name: 'Activar' });
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith('/system/update/plan'));

    fireEvent.click(screen.getByRole('button', { name: /Reportar un problema/ }));
    expect(open).toHaveBeenCalledTimes(1);
    const url = String(open.mock.calls[0]![0]);
    expect(url).toContain('github.com/Flores-rivera-24/krakenos/issues/new');
    expect(url).toContain('template=bug.yml');
    expect(url).toContain('version=0.1.0');
    expect(url).toContain('deploy=systemd');
    // Ninguna petición POST salió del agente: el usuario pega, no la app.
    expect(apiMock.post).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Informe de hardware/ }));
    expect(String(open.mock.calls[1]![0])).toContain('template=hardware-report.yml');
    fireEvent.click(screen.getByRole('button', { name: /Proponer una mejora/ }));
    expect(String(open.mock.calls[2]![0])).toContain('template=feature.yml');
    open.mockRestore();
  });
});
