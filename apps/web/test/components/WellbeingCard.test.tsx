import type { WellbeingUsage } from '@krakenos/types';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => {
  // `getList` delega en `get` para que los mocks por ruta que ya existen
  // sigan valiendo tal cual: es el mismo GET, con la forma comprobada.
  const get = vi.fn();
  return { get, getList: vi.fn((path: string) => get(path)) };
});
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { WellbeingCard } from '@/components/wellbeing/WellbeingCard';
import { useAuthStore } from '@/store/auth.store';

const usage: WellbeingUsage = {
  range: 'week',
  people: [
    {
      userId: 'u1',
      name: 'Ana',
      rxBytes: 2_000_000,
      txBytes: 500_000,
      totalBytes: 2_500_000,
      deviceCount: 3,
      buckets: [],
    },
    {
      userId: null,
      name: null,
      rxBytes: 100,
      txBytes: 0,
      totalBytes: 100,
      deviceCount: 1,
      buckets: [],
    },
  ],
  perDeviceTraffic: { status: 'supported' as const },
  devicesWithOwner: 4,
};

describe('WellbeingCard (US-184)', () => {
  beforeEach(() => {
    apiMock.get.mockReset().mockResolvedValue(usage);
  });

  it('muestra el uso por persona con nombre y total', async () => {
    render(<WellbeingCard />);
    expect(await screen.findByText('Ana')).toBeInTheDocument();
    // El grupo sin dueño se localiza a partir de userId === null.
    expect(screen.getByText('Sin asignar')).toBeInTheDocument();
  });

  it('un dueño sin nombre se llama «Desconocido», no vacío ni null', async () => {
    apiMock.get.mockResolvedValue({
      ...usage,
      people: [{ ...usage.people[0]!, userId: 'u-borrado', name: null }],
    });
    render(<WellbeingCard />);
    expect(await screen.findByText('Desconocido')).toBeInTheDocument();
    expect(screen.queryByText('null')).not.toBeInTheDocument();
  });

  it('concuerda en número: «3 dispositivos» y «1 dispositivo»', async () => {
    render(<WellbeingCard />);
    expect(await screen.findByText('3 dispositivos')).toBeInTheDocument();
    expect(screen.getByText('1 dispositivo')).toBeInTheDocument();
    expect(screen.queryByText(/dispositivo\(s\)/)).not.toBeInTheDocument();
  });

  it('estado vacío cuando no hay datos', async () => {
    apiMock.get.mockResolvedValue({ range: 'week', people: [] });
    render(<WellbeingCard />);
    expect(await screen.findByText(/Sin datos de uso todavía/)).toBeInTheDocument();
  });

  it('una respuesta con forma rara es un fallo, no «sin datos»', async () => {
    apiMock.get.mockResolvedValue({});
    render(<WellbeingCard />);
    expect(await screen.findByText('No se pudo cargar el uso de internet.')).toBeInTheDocument();
    expect(screen.queryByText(/Sin datos de uso todavía/)).not.toBeInTheDocument();
  });

  it('un fallo de red se dice, con «Reintentar», y no cae a «asigna un dueño»', async () => {
    apiMock.get.mockRejectedValue(new Error('caído'));
    render(<WellbeingCard />);
    expect(await screen.findByText('No se pudo cargar el uso de internet.')).toBeInTheDocument();
    expect(screen.queryByText(/Asigna un dueño|Todavía no hay datos|Sin datos de uso/i)).toBeNull();
    apiMock.get.mockReset().mockResolvedValue(usage);
    await userEvent.click(screen.getByRole('button', { name: /Reintentar/ }));
    expect(await screen.findByText('Ana')).toBeInTheDocument();
  });

  it('al cambiar de rango no enseña el dato del rango anterior mientras falla el nuevo', async () => {
    render(<WellbeingCard />);
    await screen.findByText('Ana');
    apiMock.get.mockReset().mockRejectedValue(new Error('caído'));
    await userEvent.click(screen.getByRole('button', { name: '24h' }));
    expect(await screen.findByText('No se pudo cargar el uso de internet.')).toBeInTheDocument();
    expect(screen.queryByText('Ana')).not.toBeInTheDocument();
  });

  // --- US-263: tres motivos distintos para no ver nada ---

  it('driver SIN desglose: dice que el router no lo reporta, NO «asigna un dueño»', async () => {
    apiMock.get.mockResolvedValue({
      range: 'week',
      people: [],
      perDeviceTraffic: { status: 'unsupported' as const },
      devicesWithOwner: 0,
    });
    render(<WellbeingCard />);
    expect(await screen.findByText(/no reparte el tráfico por dispositivo/i)).toBeInTheDocument();
    // Lo que esta historia arregla: ya NO se manda al usuario a asignar dueños,
    // porque asignarlos no cambiaría nada.
    expect(screen.queryByText(/Asigna un dueño/i)).not.toBeInTheDocument();
  });

  it('driver CON desglose y sin dueños: sí pide asignar dueños', async () => {
    apiMock.get.mockResolvedValue({
      range: 'week',
      people: [],
      perDeviceTraffic: { status: 'supported' as const },
      devicesWithOwner: 0,
    });
    render(<WellbeingCard />);
    expect(await screen.findByText(/Asigna un dueño/i)).toBeInTheDocument();
    expect(screen.queryByText(/no reparte el tráfico/i)).not.toBeInTheDocument();
  });

  it('driver CON desglose y con dueños: solo «todavía no hay datos»', async () => {
    apiMock.get.mockResolvedValue({
      range: 'week',
      people: [],
      perDeviceTraffic: { status: 'supported' as const },
      devicesWithOwner: 3,
    });
    render(<WellbeingCard />);
    expect(await screen.findByText(/Todavía no hay datos de uso/i)).toBeInTheDocument();
    expect(screen.queryByText(/Asigna un dueño/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no reparte el tráfico/i)).not.toBeInTheDocument();
  });

  // --- Un estado vacío no culpa a quien no puede arreglarlo ---

  const sinDueños = {
    range: 'week',
    people: [],
    perDeviceTraffic: { status: 'supported' as const },
    devicesWithOwner: 0,
  };
  const como = (role: 'admin' | 'member') =>
    useAuthStore.setState({
      user: { id: 'u', email: 'u@t', displayName: 'U', role } as never,
    });

  it('un no-admin sin aparatos propios NO ve «asigna un dueño» (no puede hacerlo)', async () => {
    como('member');
    apiMock.get.mockResolvedValue(sinDueños);
    render(<WellbeingCard />);
    expect(await screen.findByText(/Aún no tienes dispositivos asignados/)).toBeInTheDocument();
    expect(screen.queryByText(/Asigna un dueño/i)).not.toBeInTheDocument();
    useAuthStore.setState({ user: null });
  });

  it('un admin sin dueños sigue viendo «asigna un dueño»', async () => {
    como('admin');
    apiMock.get.mockResolvedValue(sinDueños);
    render(<WellbeingCard />);
    expect(await screen.findByText(/Asigna un dueño/i)).toBeInTheDocument();
    expect(screen.queryByText(/Aún no tienes dispositivos/)).not.toBeInTheDocument();
    useAuthStore.setState({ user: null });
  });
});
