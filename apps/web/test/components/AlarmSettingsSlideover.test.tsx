import type { AlarmConfig, IotDevice } from '@krakenos/types';
import { render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

const alarmMock = vi.hoisted(() => ({ getAlarmConfig: vi.fn(), updateAlarmConfig: vi.fn() }));
vi.mock('@/lib/alarm', () => alarmMock);

const camerasMock = vi.hoisted(() => ({ listCameras: vi.fn() }));
vi.mock('@/lib/cameras', () => camerasMock);

import { AlarmSettingsSlideover } from '@/components/dashboard/AlarmSettingsSlideover';

const aparato = (id: string, name: string, kind: IotDevice['kind']): IotDevice => ({
  id,
  name,
  kind,
  room: null,
  reachable: true,
  on: kind === 'plug' || kind === 'light' ? false : null,
  brightness: null,
  color: null,
  readings: [],
});

const config: AlarmConfig = {
  sirenDeviceId: null,
  lightDeviceIds: [],
  sensorDeviceIds: [],
  cameraIds: [],
  exitDelaySec: 30,
  entryDelaySec: 30,
  autoArmAway: false,
  hasPin: false,
};

describe('AlarmSettingsSlideover (US-188 · US-245)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    alarmMock.getAlarmConfig.mockResolvedValue(config);
    camerasMock.listCameras.mockResolvedValue([]);
  });

  /**
   * ⚠️ Regresión de US-244, cazada en US-245. La lista de sensores vigilados
   * filtraba por `kind === 'sensor'`, y US-244 partió esa categoría en `contact`
   * y `smoke`: desde entonces **un sensor de apertura desaparecía de aquí**, así
   * que la alarma no se podía configurar con lo único que la dispara. No lo vio
   * nadie porque una lista vacía se lee como «no tengo sensores».
   */
  it('los sensores de apertura y los detectores de humo se pueden vigilar', async () => {
    apiMock.get.mockResolvedValue([
      aparato('c1', 'Puerta de entrada', 'contact'),
      aparato('h1', 'Detector de la cocina', 'smoke'),
      aparato('s1', 'Movimiento del pasillo', 'sensor'),
      aparato('p1', 'Enchufe del salón', 'plug'),
    ]);

    render(<AlarmSettingsSlideover onClose={() => {}} />);

    // Las tres categorías que puede vigilar la alarma, cada una con su casilla.
    expect(await screen.findByLabelText('Puerta de entrada')).toBeInTheDocument();
    expect(screen.getByLabelText('Detector de la cocina')).toBeInTheDocument();
    expect(screen.getByLabelText('Movimiento del pasillo')).toBeInTheDocument();
    expect(screen.getByText('Sensores vigilados (apertura, movimiento, humo)')).toBeInTheDocument();
  });

  it('el enchufe no aparece como sensor vigilado (sigue siendo sirena/luz)', async () => {
    apiMock.get.mockResolvedValue([
      aparato('c1', 'Puerta de entrada', 'contact'),
      aparato('p1', 'Enchufe del salón', 'plug'),
    ]);
    render(<AlarmSettingsSlideover onClose={() => {}} />);

    await waitFor(() => expect(screen.getByLabelText('Puerta de entrada')).toBeInTheDocument());
    // El enchufe sale una vez en «luces» y otra en el desplegable de sirena, pero
    // NO como casilla de sensor: si estuviera, habría dos casillas con su nombre.
    const casillas = screen
      .getAllByRole('checkbox')
      .filter((el) => el.closest('label')?.textContent?.includes('Enchufe del salón'));
    expect(casillas).toHaveLength(1);
  });

  it('declara que el humo y el CO avisan aunque la alarma esté desarmada (US-245)', async () => {
    apiMock.get.mockResolvedValue([aparato('h1', 'Detector de la cocina', 'smoke')]);
    render(<AlarmSettingsSlideover onClose={() => {}} />);

    const nota = await screen.findByText(/El humo y el CO avisan siempre/i);
    const caja = nota.closest('[role="note"]')!;
    expect(within(caja as HTMLElement).getByText(/aunque la alarma esté desarmada/i)).toBeInTheDocument();
    // Aviso permanente: `note`, nunca `alert` (US-235) — no debe interrumpir al
    // lector de pantalla cada vez que se abre el panel.
    expect(caja.getAttribute('role')).toBe('note');
  });

  it('sin detectores, la nota explica igualmente la regla', async () => {
    apiMock.get.mockResolvedValue([aparato('c1', 'Puerta', 'contact')]);
    render(<AlarmSettingsSlideover onClose={() => {}} />);
    expect(await screen.findByText(/de noche, con la casa llena, es cuando más importa/i)).toBeInTheDocument();
  });
});
