import type { Device } from '@krakenos/types';
import { act, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => {
  // `getList` delega en `get` para que los mocks por ruta que ya existen
  // sigan valiendo tal cual: es el mismo GET, con la forma comprobada.
  const get = vi.fn();
  return {
    get,
    getList: vi.fn((path: string) => get(path)),
    patch: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
  };
});
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));
const fakeSocket = vi.hoisted(() => ({
  connected: true,
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
}));
vi.mock('@/lib/socket', () => ({ getSocket: () => fakeSocket }));

// jsdom mide 0×0: sin tamaño, Recharts no pinta ni la leyenda.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const { cloneElement } = await import('react');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      cloneElement(children, { width: 600, height: 200 } as never),
  };
});

import { AlertsWidget } from '@/components/dashboard/widgets/AlertsWidget';
import { DeviceCountWidget } from '@/components/dashboard/widgets/DeviceCountWidget';
import { IotStatusWidget } from '@/components/dashboard/widgets/IotStatusWidget';
import { NetworkTopologyWidget } from '@/components/dashboard/widgets/NetworkTopologyWidget';
import { SystemWidget } from '@/components/dashboard/widgets/SystemWidget';
import { TrafficWidget } from '@/components/dashboard/widgets/TrafficWidget';
import { WifiStatusWidget } from '@/components/dashboard/widgets/WifiStatusWidget';
import { formatRate } from '@/lib/format';
import { changeLocale, setLocale } from '@/lib/i18n';
import { useAuthStore } from '@/store/auth.store';
import { useInventoryStore } from '@/store/inventory.store';

function device(over: Partial<Device> = {}): Device {
  return {
    id: 'd1',
    mac: 'aa:bb:cc:dd:ee:01',
    ip: '192.168.1.10',
    hostname: 'macbook',
    label: null,
    notes: null,
    vendor: 'Apple',
    type: 'computer',
    isBlocked: false,
    icon: null,
    roomId: null,
    ownerId: null,
    online: true,
    vlanTag: null,
    sources: ['arp'],
    firstSeen: '',
    lastSeen: '',
    ...over,
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
    useAuthStore.setState({ user: null } as never);
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
        d3: device({ id: 'd3', online: true, type: 'phone', isBlocked: true }),
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

    // La acción se enseña con su texto (catálogo), no con el identificador crudo.
    expect(await screen.findByText('Ajustes de WiFi modificados')).toBeInTheDocument();
    expect(screen.getByText('Dispositivo bloqueado')).toBeInTheDocument();
    expect(screen.getByText('Inicio de sesión')).toBeInTheDocument();
    expect(screen.queryByText('auth.login')).not.toBeInTheDocument();
    // Dos son posteriores al `lastSeen`; la tercera no.
    expect(screen.getByText('2 nuevas')).toBeInTheDocument();
  });

  it('WifiStatusWidget: un fallo se dice, no se pinta como «Sin redes WiFi»', async () => {
    apiMock.get.mockReset().mockRejectedValue(new Error('caído'));
    wrap(<WifiStatusWidget />);
    expect(await screen.findByText('No se pudieron cargar las redes WiFi.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reintentar/ })).toBeInTheDocument();
    expect(screen.queryByText('Sin redes WiFi.')).not.toBeInTheDocument();
  });

  it('TrafficWidget: sin historial por fallo lo dice, no «Esperando muestras»', async () => {
    apiMock.get.mockReset().mockRejectedValue(new Error('caído'));
    wrap(<TrafficWidget />);
    expect(await screen.findByText('No se pudo cargar el tráfico WAN.')).toBeInTheDocument();
    expect(screen.queryByText('Esperando muestras…')).not.toBeInTheDocument();
  });

  it('TrafficWidget: un dato que llega por socket después del fallo limpia el fallo', async () => {
    apiMock.get.mockReset().mockRejectedValue(new Error('caído'));
    fakeSocket.on.mockClear();
    wrap(<TrafficWidget />);
    await screen.findByText('No se pudo cargar el tráfico WAN.');
    const onHistory = fakeSocket.on.mock.calls.find((c) => c[0] === 'traffic:history')?.[1] as (
      h: unknown[],
    ) => void;
    act(() =>
      onHistory([
        { timestamp: 1, rxBytesPerSec: 10, txBytesPerSec: 5 },
        { timestamp: 2, rxBytesPerSec: 20, txBytesPerSec: 6 },
      ]),
    );
    expect(screen.queryByText('No se pudo cargar el tráfico WAN.')).not.toBeInTheDocument();
  });

  it('TrafficWidget: con muestras y un fallo del historial, solo «Datos obsoletos» (sin error)', async () => {
    let rechazar: (e: Error) => void = () => {};
    apiMock.get.mockReset().mockReturnValue(new Promise((_, rej) => (rechazar = rej)));
    fakeSocket.on.mockClear();
    wrap(<TrafficWidget />);
    const onSample = fakeSocket.on.mock.calls.find((c) => c[0] === 'traffic:sample')?.[1] as (
      s: unknown,
    ) => void;
    act(() => onSample({ timestamp: 1, rxBytesPerSec: 10, txBytesPerSec: 5 }));
    await act(async () => rechazar(new Error('caído')));
    expect(await screen.findByText('Datos obsoletos')).toBeInTheDocument();
    expect(screen.queryByText('No se pudo cargar el tráfico WAN.')).not.toBeInTheDocument();
  });

  describe('TrafficWidget con muestras', () => {
    const MUESTRAS = [
      { timestamp: 1, rxBytesPerSec: 10, txBytesPerSec: 5 },
      { timestamp: 2, rxBytesPerSec: 2_000_000, txBytesPerSec: 500_000 },
    ];
    async function conMuestras() {
      apiMock.get.mockReset().mockResolvedValue(MUESTRAS);
      wrap(<TrafficWidget />);
      return await screen.findByRole('img', { name: /descarga.*subida/i });
    }

    it('el gráfico de tráfico se anuncia con sus valores actuales', async () => {
      const grafico = await conMuestras();
      const nombre = grafico.getAttribute('aria-label') ?? '';
      expect(nombre).toMatch(/^Gráfico de tráfico WAN\. Ahora: descarga /);
      expect(nombre).toContain(formatRate(2_000_000));
      expect(nombre).toContain(formatRate(500_000));
    });

    it('el texto de la leyenda va en un token de texto, no en el color de la serie', async () => {
      const grafico = await conMuestras();
      const texto = within(grafico as HTMLElement).getByText('Descarga');
      expect(texto).toHaveClass('text-kr-secondary');
    });

    it('el gráfico tiene leyenda', async () => {
      const grafico = await conMuestras();
      const leyenda = grafico.querySelector('.recharts-legend-wrapper');
      expect(leyenda).not.toBeNull();
      expect(leyenda).toHaveTextContent('Descarga');
      expect(leyenda).toHaveTextContent('Subida');
    });

    it('dos gráficos a la vez no comparten ids de degradado y cada área apunta a los suyos', async () => {
      apiMock.get.mockReset().mockResolvedValue(MUESTRAS);
      wrap(
        <>
          <TrafficWidget />
          <TrafficWidget />
        </>,
      );
      const graficos = await screen.findAllByRole('img', { name: /descarga.*subida/i });
      expect(graficos).toHaveLength(2);

      const todosLosIds = graficos.flatMap((g) =>
        Array.from(g.querySelectorAll('linearGradient'), (el) => el.id),
      );
      expect(todosLosIds).toHaveLength(4);
      expect(new Set(todosLosIds).size).toBe(4);

      for (const g of graficos) {
        const idsPropios = Array.from(g.querySelectorAll('linearGradient'), (el) => el.id);
        const rellenos = Array.from(g.querySelectorAll('[fill^="url(#"]'), (el) =>
          el.getAttribute('fill'),
        );
        expect(rellenos).toHaveLength(2);
        for (const relleno of rellenos) {
          const id = relleno?.slice('url(#'.length, -1) ?? '';
          expect(idsPropios).toContain(id);
        }
      }
    });

    it('el estilo del tooltip usa un token, no un rgba suelto', () => {
      // El estilo viaja como prop de Recharts y solo se pinta al pasar el ratón: se lee del fuente.
      // `process.cwd()` es apps/web (como en `_fuentes.ts`); `import.meta.url` no es `file:` en jsdom.
      const fuente = readFileSync(
        join(process.cwd(), 'src/components/dashboard/widgets/TrafficWidget.tsx'),
        'utf8',
      );
      const bloque = /const TOOLTIP_STYLE = \{[\s\S]*?\} as const;/.exec(fuente)?.[0] ?? '';
      expect(bloque).toContain('var(--kr-border)');
      expect(bloque).not.toContain('rgba(');
    });
  });

  it('las barras de CPU/RAM no se anuncian; el valor sigue como texto', async () => {
    wrap(<SystemWidget />);
    expect(await screen.findByText('50%')).toBeInTheDocument();
    const barras = document.querySelectorAll('.h-2.rounded-full');
    expect(barras).toHaveLength(2);
    barras.forEach((b) => expect(b).toHaveAttribute('aria-hidden', 'true'));
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

      expect(
        await screen.findByText('No se pudo cargar el estado del sistema.'),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Reintentar/ })).toBeInTheDocument();
      expect(screen.queryByText('Cargando…')).not.toBeInTheDocument();
    });

    it('IotStatusWidget NO dice «sin dispositivos» cuando en realidad falló', async () => {
      apiMock.get.mockReset().mockRejectedValue(new Error('agente caído'));
      wrap(<IotStatusWidget />);

      expect(
        await screen.findByText('No se pudo cargar la lista de dispositivos IoT.'),
      ).toBeInTheDocument();
      // La distinción que importa: fallo ≠ casa sin dispositivos.
      expect(screen.queryByText('Sin dispositivos IoT.')).not.toBeInTheDocument();
    });

    it('con la app en inglés, el fallo sale entero en inglés (sin español mezclado)', async () => {
      await changeLocale('en', { persist: false });
      try {
        apiMock.get.mockReset().mockRejectedValue(new Error('agente caído'));
        wrap(<IotStatusWidget />);

        expect(await screen.findByText('Could not load the IoT device list.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
        expect(screen.queryByText(/No se pudo|Reintentar/)).not.toBeInTheDocument();
      } finally {
        setLocale('es', { persist: false });
      }
    });

    it('«Reintentar» vuelve a pedir los datos y se recupera', async () => {
      apiMock.get.mockReset().mockRejectedValueOnce(new Error('caído')).mockResolvedValue(STATS);
      wrap(<SystemWidget />);

      const boton = await screen.findByRole('button', { name: /Reintentar/ });
      boton.click();

      expect(await screen.findByText('Uptime')).toBeInTheDocument();
    });

    it('AlertsWidget con un viewer cargado no llama a la API ni pinta nada', () => {
      useAuthStore.setState({ user: { sub: 'u', email: 'v@b.c', role: 'viewer' } } as never);
      apiMock.get.mockReset();
      const { container } = wrap(<AlertsWidget />);

      expect(apiMock.get).not.toHaveBeenCalled();
      expect(container).toBeEmptyDOMElement();
    });

    it('AlertsWidget: un 403 a un admin es un fallo, nunca «sin actividad»', async () => {
      apiMock.get.mockReset().mockRejectedValue(Object.assign(new Error('403'), { status: 403 }));
      wrap(<AlertsWidget />);

      expect(await screen.findByText(/No se pudo cargar/)).toBeInTheDocument();
      expect(screen.queryByText('Sin actividad registrada.')).not.toBeInTheDocument();
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
