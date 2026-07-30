import type { TlsStatus } from '@krakenos/types';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { TlsCard } from '@/components/settings/TlsCard';

/**
 * US-241. Lo que se prueba es que la tarjeta **nombre la consecuencia**: hasta
 * ahora tres features entregadas (PWA, push, passkeys) estaban inertes sobre HTTP
 * y no había ni una pista de por qué. Un «se recomienda HTTPS» genérico no sirve:
 * nadie lo relaciona con su aviso que no llega.
 */
function status(over: Partial<TlsStatus> = {}): TlsStatus {
  return {
    enabled: true,
    behindProxy: false,
    source: 'tailscale',
    notAfter: new Date(Date.now() + 60 * 86_400_000).toISOString(),
    daysLeft: 60,
    expiring: false,
    expired: false,
    disabledFeatures: [],
    ...over,
  };
}

describe('TlsCard (US-241)', () => {
  beforeEach(() => {
    apiMock.get.mockReset().mockResolvedValue(status());
  });

  it('con HTTPS muestra el origen del certificado y cuándo caduca', async () => {
    render(<TlsCard />);
    expect(await screen.findByText('Tu instalación se sirve por HTTPS.')).toBeInTheDocument();
    expect(screen.getByText("Let's Encrypt (Tailscale)")).toBeInTheDocument();
    expect(screen.getByText('(quedan 60 días)')).toBeInTheDocument();
  });

  it('sin HTTPS nombra UNA A UNA las funciones que no arrancan', async () => {
    apiMock.get.mockResolvedValue(
      status({
        enabled: false,
        source: null,
        notAfter: null,
        daysLeft: null,
        disabledFeatures: ['pwa', 'push', 'passkeys'],
      }),
    );
    render(<TlsCard />);

    expect(await screen.findByText('Tu instalación se sirve por HTTP, sin cifrar.')).toBeInTheDocument();
    expect(screen.getByText('Instalar KrakenOS como app en el móvil.')).toBeInTheDocument();
    expect(screen.getByText('Recibir avisos en el móvil.')).toBeInTheDocument();
    expect(screen.getByText('Entrar con passkey (segundo factor).')).toBeInTheDocument();
    // Y dice que NO se arregla desde la app: se arregla al instalar.
    expect(screen.getByText(/--tls tailscale/)).toBeInTheDocument();
  });

  it('avisa antes de que caduque, con los días que quedan', async () => {
    apiMock.get.mockResolvedValue(status({ daysLeft: 9, expiring: true }));
    render(<TlsCard />);
    expect(await screen.findByText('El certificado va a caducar')).toBeInTheDocument();
    expect(screen.getByText(/Quedan 9 días/)).toBeInTheDocument();
  });

  it('un certificado caducado se anuncia como error, no como advertencia', async () => {
    apiMock.get.mockResolvedValue(status({ daysLeft: -2, expiring: true, expired: true }));
    render(<TlsCard />);
    // Cuando pasa, deja de entrar todo el mundo: no es una nota al pie.
    expect(await screen.findByText('El certificado ha caducado')).toBeInTheDocument();
    // Y NO se pinta el contador de días restantes, que sería absurdo en negativo.
    expect(screen.queryByText(/quedan -2/)).not.toBeInTheDocument();
  });

  it('con un autofirmado avisa de que cada dispositivo protestará', async () => {
    apiMock.get.mockResolvedValue(status({ source: 'self-signed' }));
    render(<TlsCard />);
    expect(await screen.findByText(/instales la CA en él/)).toBeInTheDocument();
  });

  it('tras un proxy que termina TLS no acusa de falta de cifrado', async () => {
    apiMock.get.mockResolvedValue(
      status({ enabled: false, behindProxy: true, source: null, notAfter: null, daysLeft: null }),
    );
    render(<TlsCard />);
    expect(await screen.findByText(/el cifrado lo termina el proxy/)).toBeInTheDocument();
    expect(screen.queryByText('Recibir avisos en el móvil.')).not.toBeInTheDocument();
  });

  it('si el endpoint falla, la tarjeta no se pinta a medias', async () => {
    apiMock.get.mockRejectedValue(new Error('boom'));
    const { container } = render(<TlsCard />);
    expect(container).toBeEmptyDOMElement();
  });
});
