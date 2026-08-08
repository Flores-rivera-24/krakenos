import type { Device } from '@krakenos/types';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => {
  // `getList` delega en `get` para que los mocks por ruta que ya existen
  // sigan valiendo tal cual: es el mismo GET, con la forma comprobada.
  const get = vi.fn();
  return { get, getList: vi.fn((path: string) => get(path)), patch: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() };
});
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));
const fakeSocket = vi.hoisted(() => ({ connected: true, on: vi.fn(), off: vi.fn(), emit: vi.fn() }));
vi.mock('@/lib/socket', () => ({ getSocket: () => fakeSocket }));

import { AlertsWidget } from '@/components/dashboard/widgets/AlertsWidget';
import { DeviceCountWidget } from '@/components/dashboard/widgets/DeviceCountWidget';
import { IotStatusWidget } from '@/components/dashboard/widgets/IotStatusWidget';
import { NetworkTopologyWidget } from '@/components/dashboard/widgets/NetworkTopologyWidget';
import { SystemWidget } from '@/components/dashboard/widgets/SystemWidget';
import { TrafficWidget } from '@/components/dashboard/widgets/TrafficWidget';
import { WifiStatusWidget } from '@/components/dashboard/widgets/WifiStatusWidget';
import { useInventoryStore } from '@/store/inventory.store';

function device(over: Partial<Device> = {}): Device {
  return {
    id: 'd1', mac: 'aa:bb:cc:dd:ee:01', ip: '192.168.1.10', hostname: 'macbook',
    label: null, notes: null, vendor: 'Apple', type: 'computer', isBlocked: false,
    online: true, vlanTag: null, sources: ['arp'], firstSeen: '', lastSeen: '', ...over,
  };
}

function wrap(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

/**
 * Lee el número que acompaña a una etiqueta en los contadores del dashboard
 * (`<StatusDot/><span>{valor}</span><span>{etiqueta}</span>`). Asertar el valor
 * **junto a su etiqueta** —y no un `getByText('3')` suelto— es lo que impide que
 * un contador equivocado pase por estar el número en pantalla por otro motivo.
 */
function statValue(label: string): string {
  return screen.getByText(label).previousElementSibling?.textContent ?? '';
}

describe('Dashboard widgets', () => {
  const STATS = {
    uptimeSeconds: 3600,
    cpu: { cores: 4, loadPercent: 20 },
    memory: { totalBytes: 8 * 1024 ** 3, usedBytes: 4 * 1024 ** 3, usedPercent: 50 },
    timestamp: '',
  };

  beforeEach(() => {
    apiMock.get
      .mockReset()
      .mockImplementation((path: string) =>
        path === '/system/stats' ? Promise.resolve(STATS) : Promise.resolve([]),
      );
    useInventoryStore.setState({ devices: {}, connected: true, recentEvents: [] });
  });

  it('DeviceCountWidget rinde con el store vacío', () => {
    wrap(<DeviceCountWidget />);
    expect(screen.getByText('Dispositivos')).toBeInTheDocument();
    expect(statValue('total')).toBe('0');
  });

  /**
   * US-230 (AUD3-31) — el test de arriba es un **smoke**: solo comprueba que el
   * título aparece. El fichero estaba al **100 % de cobertura** y aun así la
   * mutación «contar `!d.online` en vez de `d.online`» sobrevivió a los 2.641
   * tests. Cobertura no es aserción: aquí se comprueban los cuatro números.
   *
   * Los conteos son **asimétricos a propósito** (3 en línea / 1 fuera): con 2 y 2,
   * invertir la condición daría el mismo número y la mutación volvería a colarse.
   */
  it('DeviceCountWidget cuenta en línea, total, desconocidos y bloqueados', () => {
    useInventoryStore.setState({
      devices: {
        d1: device({ id: 'd1', online: true, type: 'computer' }),
        d2: device({ id: 'd2', online: true, type: 'unknown' }),
        d3: device({ id: 'd3', online: true, type: 'mobile', isBlocked: true }),
        d4: device({ id: 'd4', online: false, type: 'unknown' }),
      },
    });
    wrap(<DeviceCountWidget />);

    expect(statValue('en línea')).toBe('3'); // invertir la condición daría 1
    expect(statValue('total')).toBe('4');
    expect(statValue('desconocidos')).toBe('2');
    expect(statValue('bloqueados')).toBe('1');
  });

  it('SystemWidget muestra el estado de carga sin datos', () => {
    wrap(<SystemWidget />);
    expect(screen.getByText('Cargando…')).toBeInTheDocument();
  });

  it('IotStatusWidget rinde su título', () => {
    wrap(<IotStatusWidget />);
    expect(screen.getByText('IoT')).toBeInTheDocument();
  });

  /**
   * US-230: agrupa por prefijo de backend (el composite usa `<backend>:<id>`) y
   * cuenta los **alcanzables**. Se asertan los conteos, no solo que pinte algo.
   */
  it('IotStatusWidget agrupa por backend y cuenta los alcanzables', async () => {
    apiMock.get.mockImplementation((path: string) =>
      path === '/iot/devices'
        ? Promise.resolve([
            { id: 'hue:1', name: 'Salón', kind: 'light', on: true, reachable: true },
            { id: 'hue:2', name: 'Cocina', kind: 'light', on: false, reachable: true },
            { id: 'hue:3', name: 'Baño', kind: 'light', on: false, reachable: false },
            { id: 'shelly:a', name: 'Enchufe', kind: 'plug', on: true, reachable: false },
          ])
        : Promise.resolve([]),
    );
    wrap(<IotStatusWidget />);

    expect(await screen.findByText('Hue')).toBeInTheDocument();
    expect(screen.getByText('2/3 en línea')).toBeInTheDocument(); // 1 inalcanzable
    expect(screen.getByText('shelly')).toBeInTheDocument(); // sin etiqueta bonita: cae al prefijo
    expect(screen.getByText('0/1 en línea')).toBeInTheDocument();
  });

  it('IotStatusWidget dice «sin dispositivos» cuando la lista viene vacía', async () => {
    wrap(<IotStatusWidget />);
    expect(await screen.findByText('Sin dispositivos IoT.')).toBeInTheDocument();
  });

  it('WifiStatusWidget rinde su título', () => {
    wrap(<WifiStatusWidget />);
    expect(screen.getByText('WiFi')).toBeInTheDocument();
  });

  it('AlertsWidget rinde su título', () => {
    wrap(<AlertsWidget />);
    expect(screen.getByText('Alertas recientes')).toBeInTheDocument();
  });

  /**
   * US-230: el widget lista las últimas acciones y marca cuántas son posteriores a
   * la última vez que se miraron (`localStorage`). Antes solo se comprobaba el
   * título, así que ni la lista ni el contador de no leídas tenían observador.
   */
  it('AlertsWidget lista las acciones y cuenta las no leídas desde la última visita', async () => {
    localStorage.setItem('krakenos-alerts-seen', '2026-07-20T00:00:00.000Z');
    apiMock.get.mockImplementation((path: string) =>
      path.startsWith('/audit')
        ? Promise.resolve([
            { id: 'a1', action: 'wifi.update', createdAt: '2026-07-22T10:00:00.000Z' },
            { id: 'a2', action: 'device.block', createdAt: '2026-07-21T10:00:00.000Z' },
            { id: 'a3', action: 'auth.login', createdAt: '2026-07-19T10:00:00.000Z' },
          ])
        : Promise.resolve([]),
    );
    wrap(<AlertsWidget />);

    expect(await screen.findByText('wifi.update')).toBeInTheDocument();
    expect(screen.getByText('device.block')).toBeInTheDocument();
    expect(screen.getByText('auth.login')).toBeInTheDocument();
    // Dos son posteriores al `lastSeen`; la tercera no.
    expect(screen.getByText('2 nuevas')).toBeInTheDocument();
  });

  it('TrafficWidget espera muestras cuando no hay datos', () => {
    wrap(<TrafficWidget />);
    expect(screen.getByText('Esperando muestras…')).toBeInTheDocument();
  });

  /**
   * US-234 (AUD3-24) — los widgets tragaban el error y se quedaban con los datos
   * en `null`: unos giraban para siempre (`SystemWidget`, `AlarmWidget`) y otros
   * pintaban el fallo como estado vacío («Sin dispositivos IoT»), que en un panel
   * del hogar se lee como «todo tranquilo» justo cuando no se sabe nada.
   */
  describe('estado de fallo explícito (US-234)', () => {
    it('SystemWidget dice que no pudo cargar en vez de girar para siempre', async () => {
      apiMock.get.mockReset().mockRejectedValue(new Error('agente caído'));
      wrap(<SystemWidget />);

      expect(await screen.findByText('No se pudo cargar el estado del sistema.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Reintentar/ })).toBeInTheDocument();
      expect(screen.queryByText('Cargando…')).not.toBeInTheDocument();
    });

    it('IotStatusWidget NO dice «sin dispositivos» cuando en realidad falló', async () => {
      apiMock.get.mockReset().mockRejectedValue(new Error('agente caído'));
      wrap(<IotStatusWidget />);

      expect(await screen.findByText('No se pudo cargar la lista de dispositivos IoT.')).toBeInTheDocument();
      // La distinción que importa: fallo ≠ casa sin dispositivos.
      expect(screen.queryByText('Sin dispositivos IoT.')).not.toBeInTheDocument();
    });

    it('«Reintentar» vuelve a pedir los datos y se recupera', async () => {
      apiMock.get.mockReset().mockRejectedValueOnce(new Error('caído')).mockResolvedValue(STATS);
      wrap(<SystemWidget />);

      const boton = await screen.findByRole('button', { name: /Reintentar/ });
      boton.click();

      expect(await screen.findByText('Uptime')).toBeInTheDocument();
    });

    it('AlertsWidget distingue «sin permiso» (403) de «no se pudo cargar»', async () => {
      // Un viewer sin acceso al audit es un caso legítimo: estado vacío, no error.
      apiMock.get.mockReset().mockRejectedValue(Object.assign(new Error('403'), { status: 403 }));
      wrap(<AlertsWidget />);

      expect(await screen.findByText('Sin actividad registrada.')).toBeInTheDocument();
      expect(screen.queryByText(/No se pudo cargar/)).not.toBeInTheDocument();
    });
  });

  it('NetworkTopologyWidget muestra el estado vacío sin dispositivos', () => {
    wrap(<NetworkTopologyWidget />);
    expect(screen.getByText('Sin dispositivos en la red.')).toBeInTheDocument();
  });

  it('NetworkTopologyWidget renderiza nodos clicables cuando hay dispositivos', () => {
    useInventoryStore.setState({
      devices: {
        r: device({ id: 'r', type: 'router', hostname: 'gateway' }),
        d1: device({ id: 'd1', hostname: 'macbook' }),
        d2: device({ id: 'd2', hostname: 'phone' }),
      },
    });
    wrap(<NetworkTopologyWidget />);
    expect(screen.getByLabelText('Diagrama de la red')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'macbook' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'phone' })).toBeInTheDocument();
  });
});
