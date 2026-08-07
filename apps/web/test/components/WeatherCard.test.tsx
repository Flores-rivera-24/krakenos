import type { WeatherStatus } from '@krakenos/types';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock }));

import { WeatherCard } from '@/components/settings/WeatherCard';

/**
 * US-254. Lo que se prueba no es que pinte una temperatura: es que el
 * **consentimiento** esté informado — que diga a quién se pregunta antes de
 * poder activarlo, y que enseñe la coordenada que de verdad sale de casa.
 */
const base: WeatherStatus = {
  enabled: false,
  precision: 'rounded',
  provider: 'api.open-meteo.com',
  locationConfigured: true,
  sentLatitude: null,
  sentLongitude: null,
  readings: [],
  lastFetchAt: null,
  lastError: null,
};

const activo: WeatherStatus = {
  ...base,
  enabled: true,
  sentLatitude: 41.4,
  sentLongitude: 2.2,
  readings: [
    { metric: 'temperature', value: 4.2 },
    { metric: 'wind', value: 11.5 },
  ],
};

describe('WeatherCard (US-254)', () => {
  beforeEach(() => {
    apiMock.get.mockReset().mockResolvedValue(base);
    apiMock.put.mockReset().mockResolvedValue(activo);
  });

  it('nombra al tercero al que se envía la ubicación ANTES de poder activarlo', async () => {
    render(<WeatherCard />);

    // El aviso y el proveedor concreto, con el botón todavía en «Activar»:
    // enterarse después de activarlo es enterarse tarde.
    expect(await screen.findByText(/api\.open-meteo\.com/)).toBeInTheDocument();
    expect(screen.getByText(/envía la ubicación de tu casa/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Activar' })).toBeInTheDocument();
  });

  it('apagado dice que no se hace ninguna petición', async () => {
    render(<WeatherCard />);
    expect(await screen.findByText(/no se hace ninguna petición/i)).toBeInTheDocument();
    // Y no ofrece la precisión: no hay nada que ajustar si no se envía nada.
    expect(screen.queryByText(/Precisión de la ubicación/i)).not.toBeInTheDocument();
  });

  it('activar manda el opt-in explícito al servidor', async () => {
    render(<WeatherCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Activar' }));

    await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith('/api/weather', { enabled: true }));
  });

  it('encendido ENSEÑA la coordenada que se envía, no la guardada', async () => {
    apiMock.get.mockResolvedValue(activo);
    render(<WeatherCard />);

    // La aserción que sostiene la promesa de «aproximada»: sin esto, el ajuste
    // de privacidad sería una etiqueta que el usuario no puede comprobar.
    expect(await screen.findByText(/41\.4, 2\.2/)).toBeInTheDocument();
  });

  it('muestra las lecturas con su unidad', async () => {
    apiMock.get.mockResolvedValue(activo);
    render(<WeatherCard />);

    // Conteos asimétricos: 4,2 °C y 11,5 km/h no se pueden confundir entre sí.
    expect(await screen.findByText(/4\.2 °C/)).toBeInTheDocument();
    expect(screen.getByText(/11\.5 km\/h/)).toBeInTheDocument();
  });

  it('cambiar a exacta lo pide al servidor', async () => {
    apiMock.get.mockResolvedValue(activo);
    render(<WeatherCard />);

    fireEvent.click(await screen.findByRole('radio', { name: /Exacta/ }));

    await waitFor(() =>
      expect(apiMock.put).toHaveBeenCalledWith('/api/weather', { precision: 'exact' }),
    );
  });

  it('sin ubicación configurada manda a Ajustes en vez de culpar al proveedor', async () => {
    apiMock.get.mockResolvedValue({ ...base, locationConfigured: false });
    render(<WeatherCard />);

    expect(await screen.findByText(/no has indicado dónde está la casa/i)).toBeInTheDocument();
  });

  it('un fallo de la última consulta se declara', async () => {
    apiMock.get.mockResolvedValue({
      ...activo,
      lastError: 'No se pudo contactar con el proveedor del tiempo.',
    });
    render(<WeatherCard />);

    expect(await screen.findByText(/No se pudo contactar con el proveedor/i)).toBeInTheDocument();
  });
});
