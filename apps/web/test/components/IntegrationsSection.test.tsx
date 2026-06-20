import type { IotDevice } from '@krakenos/types';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { IntegrationsSection } from '@/components/settings/IntegrationsSection';

function iot(over: Partial<IotDevice>): IotDevice {
  return {
    id: 'x', name: 'Luz', kind: 'light', room: null, reachable: true, on: true,
    brightness: 80, color: null, reading: null, ...over,
  };
}

const DEVICES: IotDevice[] = [
  iot({ id: 'hue:1', reachable: true }),
  iot({ id: 'govee:1', reachable: false }),
  iot({ id: 'tuya:abc', reachable: true }),
];

describe('IntegrationsSection', () => {
  beforeEach(() => {
    apiMock.get.mockReset().mockImplementation((path: string) =>
      path === '/iot/devices' ? Promise.resolve(DEVICES) : Promise.resolve([]),
    );
    apiMock.post.mockReset().mockResolvedValue({ ok: true, latencyMs: 2 });
  });

  it('renderiza las cards de Hue/Govee/Tuya con datos de /iot/devices', async () => {
    render(<IntegrationsSection driver="mock" isAdmin />);
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith('/iot/devices'));
    expect(screen.getByText('Philips Hue')).toBeInTheDocument();
    expect(screen.getByText('Govee')).toBeInTheDocument();
    expect(screen.getByText('Tuya')).toBeInTheDocument();
    // Hue y Tuya: 1/1 en línea (Govee 0/1).
    await waitFor(() => expect(screen.getAllByText('1/1 en línea').length).toBeGreaterThanOrEqual(1));
    expect(screen.getByText('0/1 en línea')).toBeInTheDocument();
  });

  it('la card de Cisco solo aparece con un driver cisco-*', async () => {
    const { rerender } = render(<IntegrationsSection driver="mock" isAdmin />);
    expect(screen.queryByText('Cisco')).not.toBeInTheDocument();
    rerender(<IntegrationsSection driver="cisco-ios" isAdmin />);
    expect(screen.getByText('Cisco')).toBeInTheDocument();
  });

  it('"Gestionar focos" despliega el gestor Tuya (admin)', async () => {
    const user = userEvent.setup();
    render(<IntegrationsSection driver="mock" isAdmin />);
    await screen.findByText('Tuya');
    await user.click(screen.getByRole('button', { name: 'Gestionar focos' }));
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith('/iot/tuya/devices'));
    expect(screen.getByText('Focos Tuya')).toBeInTheDocument();
  });

  it('"Añadir integración" abre el modal con las guías', async () => {
    const user = userEvent.setup();
    render(<IntegrationsSection driver="mock" isAdmin />);
    await user.click(screen.getByRole('button', { name: /Añadir integración/ }));
    expect(screen.getByRole('heading', { name: 'Añadir integración' })).toBeInTheDocument();
    expect(screen.getByText('docs/tuya-setup.md')).toBeInTheDocument();
  });
});
