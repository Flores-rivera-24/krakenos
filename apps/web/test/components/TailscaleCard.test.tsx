import type { TailscaleStatus } from '@krakenos/types';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { MobileAccessCard } from '@/components/vpn/MobileAccessCard';
import { TailscaleCard } from '@/components/vpn/TailscaleCard';

const status = (partial: Partial<TailscaleStatus>): TailscaleStatus => ({
  state: 'not-installed',
  tailscaleIp: null,
  magicDnsName: null,
  version: null,
  ...partial,
});

describe('TailscaleCard (US-215)', () => {
  beforeEach(() => {
    apiMock.get.mockReset();
  });

  it('activo: muestra el nombre MagicDNS, la IP del tailnet y la nota de passkeys', async () => {
    apiMock.get.mockResolvedValue(
      status({
        state: 'running',
        tailscaleIp: '100.101.102.103',
        magicDnsName: 'krakenos.tail1234.ts.net',
        version: '1.66.4',
      }),
    );
    render(<TailscaleCard />);

    expect(await screen.findByText('Activo')).toBeInTheDocument();
    expect(screen.getByText('krakenos.tail1234.ts.net')).toBeInTheDocument();
    expect(screen.getByText('100.101.102.103')).toBeInTheDocument();
    expect(screen.getByText(/WEBAUTHN_RP_ID/)).toBeInTheDocument();
    expect(apiMock.get).toHaveBeenCalledWith('/vpn/tailscale');
  });

  it('no detectado: guía con el comando de instalación y la nota de WireGuard', async () => {
    apiMock.get.mockResolvedValue(status({ state: 'not-installed' }));
    render(<TailscaleCard />);

    expect(await screen.findByText('No detectado')).toBeInTheDocument();
    expect(screen.getByText(/tailscale\.com\/install\.sh/)).toBeInTheDocument();
    expect(screen.getByText(/WireGuard de arriba sigue siendo la vía recomendada/)).toBeInTheDocument();
  });

  it('falta iniciar sesión: muestra el comando `tailscale up`', async () => {
    apiMock.get.mockResolvedValue(status({ state: 'needs-login' }));
    render(<TailscaleCard />);

    expect(await screen.findByText('Falta iniciar sesión')).toBeInTheDocument();
    expect(screen.getByText('sudo tailscale up')).toBeInTheDocument();
  });

  it('instalado sin responder: ofrece arrancar el daemon', async () => {
    apiMock.get.mockResolvedValue(status({ state: 'stopped' }));
    render(<TailscaleCard />);

    expect(await screen.findByText('Instalado, sin responder')).toBeInTheDocument();
    expect(screen.getByText('sudo systemctl start tailscaled')).toBeInTheDocument();
  });

  it('respuesta rara o fallo de red degrada al mensaje de error, sin romper', async () => {
    apiMock.get.mockResolvedValue([]);
    render(<TailscaleCard />);
    expect(await screen.findByText('No se pudo consultar Tailscale')).toBeInTheDocument();
  });
});

describe('MobileAccessCard (US-215)', () => {
  it('muestra los 3 pasos de la guía móvil', () => {
    render(<MobileAccessCard />);

    expect(screen.getByText('Tu móvil en 3 pasos')).toBeInTheDocument();
    expect(screen.getByText('Instala la app (PWA)')).toBeInTheDocument();
    expect(screen.getByText('Túnel automático')).toBeInTheDocument();
    expect(screen.getByText('Una sola dirección')).toBeInTheDocument();
    // Honestidad de plataforma: el matiz de push en iPhone está en el paso 1.
    expect(screen.getByText(/solo llegan con la app instalada/)).toBeInTheDocument();
    // El invariante técnico del paso 3: un nombre, no la IP.
    expect(screen.getByText(/usa un nombre \(no la IP\)/)).toBeInTheDocument();
  });
});
