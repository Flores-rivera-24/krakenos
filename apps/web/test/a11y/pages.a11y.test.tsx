import { render } from '@testing-library/react';
import { configureAxe, toHaveNoViolations } from 'jest-axe';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

expect.extend(toHaveNoViolations);

// Solo reglas WCAG 2.0/2.1 A y AA (las de "best-practice" como `region` darían
// falsos positivos al montar páginas sueltas fuera del layout con landmarks).
const axe = configureAxe({
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
});

// --- Mocks de datos (formas mínimas para que cada página monte poblada) ---
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

const fakeSocket = vi.hoisted(() => ({
  connected: true,
  active: true,
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
  io: { on: vi.fn(), off: vi.fn() },
}));
vi.mock('@/lib/socket', () => ({ getSocket: () => fakeSocket }));

import { LoginPage } from '@/pages/LoginPage';
import { SetupPage } from '@/pages/SetupPage';
import { InvitePage } from '@/pages/InvitePage';
import { WelcomePage } from '@/pages/WelcomePage';
import { ConnectPage } from '@/pages/ConnectPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { InventoryPage } from '@/pages/InventoryPage';
import { PeoplePage } from '@/pages/PeoplePage';
import { WifiPage } from '@/pages/WifiPage';
import { CoveragePage } from '@/pages/CoveragePage';
import { VpnPage } from '@/pages/VpnPage';
import { IotPage } from '@/pages/IotPage';
import { EnergyPage } from '@/pages/EnergyPage';
import { CamerasPage } from '@/pages/CamerasPage';
import { TrafficPage } from '@/pages/TrafficPage';
import { FirewallPage } from '@/pages/FirewallPage';
import { VlanPage } from '@/pages/VlanPage';
import { QosPage } from '@/pages/QosPage';
import { DnsPage } from '@/pages/DnsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { useAuthStore } from '@/store/auth.store';
import { useInventoryStore } from '@/store/inventory.store';

const SETTINGS = {
  settings: {
    homeName: 'Casa',
    timezone: 'UTC',
    scanIntervalSec: '60',
    trafficRetentionDays: '30',
    auditRetentionDays: '90',
    accessTokenTtl: '900',
    loginRateLimit: '5',
  },
  info: { driver: 'mock', host: 'localhost', httpsEnabled: false },
  appliedImmediately: false,
};

const WIFI = {
  ssid: 'KrakenOS',
  enabled: true,
  band: '5GHz',
  security: 'wpa2/wpa3',
  hidden: false,
  updatedAt: '',
};
const GUEST = {
  ssid: 'KrakenOS-Invitados',
  enabled: false,
  clientIsolation: true,
  bandwidthLimitMbps: 50,
  updatedAt: '',
};

// Una fila representativa por colección, para que tablas, switches y selects se
// rendericen de verdad y axe los audite (no enmascarados por estados vacíos).
const FIREWALL_RULE = {
  id: 'r1',
  name: 'Bloquear IoT',
  action: 'deny',
  protocol: 'any',
  source: '10.0.30.0/24',
  destination: null,
  port: null,
  enabled: true,
  priority: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
};
const QOS_RULE = {
  id: 'q1',
  name: 'Limitar consola',
  priority: 'low',
  target: '10.0.0.50',
  downloadKbps: 20000,
  uploadKbps: 5000,
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};
const VLAN = {
  id: 'vl1',
  tag: 30,
  name: 'IoT',
  subnet: '10.0.30.0/24',
  isolated: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  deviceCount: 1,
};
const DEVICE = {
  id: 'd1',
  mac: 'aa:bb:cc:dd:ee:01',
  ip: '192.168.1.10',
  hostname: 'macbook',
  label: 'MacBook',
  notes: null,
  vendor: 'Apple',
  type: 'computer',
  isBlocked: false,
  online: true,
  vlanTag: null,
  sources: ['arp'],
  firstSeen: '2026-01-01T00:00:00.000Z',
  lastSeen: '2026-01-01T00:00:00.000Z',
};
const VPN_PEER = {
  id: 'p1',
  name: 'Móvil',
  publicKey: 'abcdef0123456789xyz',
  allowedIps: '10.8.0.2/32',
  lastHandshake: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};
const IOT_LIGHT = {
  id: 'light-hue',
  name: 'Foco Hue',
  kind: 'light',
  room: 'Salón',
  reachable: true,
  on: true,
  brightness: 80,
  color: { hex: '#ff8800', temperatureK: null },
  readings: [],
};
const CAMERA = { id: 'cam', name: 'Entrada', room: 'Exterior', model: 'X', online: false };
const FLOOR_PLAN = {
  id: 'fp1',
  name: 'Planta baja',
  widthM: 10,
  heightM: 8,
  backgroundImage: null,
  walls: [],
  accessPoints: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const COVERAGE_HEATMAP = {
  band: '5GHz',
  source: 'predicted',
  widthM: 10,
  heightM: 8,
  cols: 20,
  rows: 16,
  cellSizeM: 0.5,
  values: Array.from({ length: 320 }, () => -60),
  minDbm: -80,
  maxDbm: -45,
};

function apiGet(path: string): Promise<unknown> {
  // US-267: la vista previa de una invitación. Se sirve para que la página se pinte
  // en su estado ÚTIL (el formulario), no en el de «enlace caducado», que es el que
  // saldría si la llamada fallase y dejaría media pantalla sin auditar.
  if (path.startsWith('/invitations/redeem/'))
    return Promise.resolve({
      email: 'nuevo@krakenos.test',
      displayName: 'Persona Nueva',
      role: 'member',
      homeName: 'Casa',
    });
  if (path === '/setup/status') return Promise.resolve({ needsSetup: false, requiresToken: false });
  if (path === '/system/info') return Promise.resolve({ homeName: 'Casa' });
  if (path === '/auth/last-session') return Promise.resolve(null);
  if (path === '/integrations') return Promise.resolve({ domains: [] });
  if (path === '/system/settings') return Promise.resolve(SETTINGS);
  if (path.startsWith('/system/stats'))
    return Promise.resolve({
      uptimeSeconds: 3600,
      cpu: { cores: 4, loadPercent: 20 },
      memory: { totalBytes: 8 * 1024 ** 3, usedBytes: 4 * 1024 ** 3, usedPercent: 50 },
      timestamp: '',
    });
  // Histórico DNS (US-252): la respuesta lleva `entries` **y** `coverage`; un mock
  // que devuelva solo una lista no se parece al contrato y prueba otra cosa.
  if (path.startsWith('/dns/history'))
    return Promise.resolve({
      entries: [],
      coverage: { recording: false, silentDevices: 0, onlineDevices: 0, retentionDays: 7 },
    });
  if (path === '/wifi') return Promise.resolve(WIFI);
  if (path === '/wifi/guest') return Promise.resolve(GUEST);
  if (path === '/wifi/networks')
    return Promise.resolve([
      {
        id: 'n1',
        ssid: 'KrakenOS',
        band: '5GHz',
        apId: null,
        isGuest: false,
        enabled: true,
        clientCount: 0,
      },
    ]);
  if (path === '/vpn/status')
    return Promise.resolve({
      enabled: true,
      publicKey: 'k',
      endpoint: 'h:1',
      listenPort: 1,
      peerCount: 1,
    });
  if (path === '/vpn/peers') return Promise.resolve([VPN_PEER]);
  if (path === '/vpn/tailscale')
    return Promise.resolve({
      state: 'running',
      tailscaleIp: '100.1.2.3',
      magicDnsName: 'krakenos.tail1234.ts.net',
      version: '1.66.4',
    });
  if (path === '/iot/devices') return Promise.resolve([IOT_LIGHT]);
  if (path === '/cameras') return Promise.resolve([CAMERA]);
  if (path === '/firewall/rules') return Promise.resolve([FIREWALL_RULE]);
  if (path === '/qos/rules') return Promise.resolve([QOS_RULE]);
  if (path === '/vlans') return Promise.resolve([VLAN]);
  if (path === '/inventory/devices') return Promise.resolve([DEVICE]);
  if (path === '/coverage/floorplans') return Promise.resolve([FLOOR_PLAN]);
  if (path === '/coverage/access-points') return Promise.resolve([]);
  if (path.startsWith('/coverage/floorplans/') && path.includes('/heatmap'))
    return Promise.resolve(COVERAGE_HEATMAP);
  if (path.startsWith('/coverage/floorplans/') && path.endsWith('/scans')) return Promise.resolve([]);
  if (path.startsWith('/traffic/stats'))
    return Promise.resolve({ range: 'day', buckets: [], totalRxBytes: 0, totalTxBytes: 0 });
  if (path.startsWith('/wellbeing/usage'))
    return Promise.resolve({
      range: 'week',
      people: [
        { userId: 'u1', name: 'Ana', rxBytes: 1000, txBytes: 500, totalBytes: 1500, deviceCount: 2, buckets: [] },
      ],
    });
  if (path === '/people')
    return Promise.resolve({
      people: [
        {
          userId: 'u1',
          name: 'Ana',
          role: 'kid',
          devices: [
            { id: 'd1', name: 'Tablet', online: true, blocked: true, reasons: ['schedule'], pausedUntil: null },
          ],
          onlineCount: 1,
          blockedCount: 1,
          pausedUntil: null,
          bedtime: { enabled: true, days: [1, 2], startMinute: 1320, endMinute: 420, appliedTo: 1 },
        },
      ],
      fullHome: true,
      unassignedDevices: 2,
    });
  if (path === '/energy/config') return Promise.resolve({ pricePerKwh: 0.15, currency: '€' });
  if (path.startsWith('/energy/stats'))
    return Promise.resolve({
      range: 'day',
      buckets: [{ timestamp: '2026-01-01T10:00:00.000Z', powerW: 100, energyWh: 100 }],
      totalEnergyWh: 1500,
      previousTotalEnergyWh: 1000,
      pricePerKwh: 0.15,
      currency: '€',
      totalCost: 0.23,
      previousTotalCost: 0.15,
      devices: [
        { deviceId: 'plug-tv', name: 'TV', room: 'Salón', energyWh: 1500, cost: 0.23, buckets: [] },
      ],
    });
  if (path === '/dns/stats')
    return Promise.resolve({
      totalQueries: 10,
      blockedQueries: 3,
      blockedPercent: 30,
      blocklistSize: 1,
    });
  if (path === '/dns/blocklist')
    return Promise.resolve([
      { id: 'b1', domain: 'ads.example.com', createdAt: '2026-01-01T00:00:00.000Z' },
    ]);
  if (path.startsWith('/dns/queries'))
    return Promise.resolve([
      {
        timestamp: '2026-01-01T00:00:00.000Z',
        domain: 'github.com',
        client: '10.0.0.10',
        blocked: false,
      },
    ]);
  // El resto de endpoints devuelven colecciones vacías.
  return Promise.resolve([]);
}

const PAGES: { name: string; el: ReactElement }[] = [
  { name: 'Login', el: <LoginPage /> },
  { name: 'Setup', el: <SetupPage /> },
  // US-266: la portada es pública y es la primera pantalla de la instalación, así
  // que entra en el barrido con el mismo rasero que el resto.
  { name: 'Welcome', el: <WelcomePage /> },
  { name: 'Invite', el: <InvitePage /> },
  { name: 'Connect', el: <ConnectPage /> },
  { name: 'Dashboard', el: <DashboardPage /> },
  { name: 'Inventory', el: <InventoryPage /> },
  { name: 'People', el: <PeoplePage /> },
  { name: 'Wifi', el: <WifiPage /> },
  { name: 'Coverage', el: <CoveragePage /> },
  { name: 'Vpn', el: <VpnPage /> },
  { name: 'Iot', el: <IotPage /> },
  { name: 'Energy', el: <EnergyPage /> },
  { name: 'Cameras', el: <CamerasPage /> },
  { name: 'Traffic', el: <TrafficPage /> },
  { name: 'Firewall', el: <FirewallPage /> },
  { name: 'Vlan', el: <VlanPage /> },
  { name: 'Qos', el: <QosPage /> },
  { name: 'Dns', el: <DnsPage /> },
  { name: 'Settings', el: <SettingsPage /> },
];

describe('Accesibilidad — smoke axe por página (US-95)', () => {
  beforeEach(() => {
    apiMock.get.mockReset().mockImplementation(apiGet);
    apiMock.post.mockReset().mockResolvedValue({});
    apiMock.patch.mockReset().mockResolvedValue(SETTINGS);
    apiMock.put.mockReset().mockResolvedValue({});
    apiMock.del.mockReset().mockResolvedValue(undefined);
    fakeSocket.on.mockReset();
    fakeSocket.off.mockReset();
    // `/health` para el card de Login.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ status: 'ok' }) })),
    );
    useAuthStore.setState({
      user: {
        id: 'u',
        email: 'a@b.c',
        displayName: 'Emilio Flores',
        role: 'admin',
        createdAt: '',
        updatedAt: '',
      },
      tokens: { accessToken: 't', refreshToken: 'r', expiresIn: 900 },
    });
    useInventoryStore.setState({
      connected: true,
      devices: {
        d1: {
          id: 'd1',
          mac: 'aa:bb:cc:dd:ee:01',
          ip: '192.168.1.10',
          hostname: 'macbook',
          label: 'MacBook',
          notes: null,
          vendor: 'Apple',
          type: 'computer',
          isBlocked: false,
          online: true,
          vlanTag: null,
          sources: ['arp'],
          firstSeen: '2026-01-01T00:00:00.000Z',
          lastSeen: '2026-01-01T00:00:00.000Z',
        },
      },
    });
  });

  for (const { name, el } of PAGES) {
    it(`${name} no tiene violaciones WCAG A/AA`, async () => {
      let container!: HTMLElement;
      await act(async () => {
        ({ container } = render(<MemoryRouter>{el}</MemoryRouter>));
        await Promise.resolve();
      });
      // Deja asentar los efectos asíncronos (fetch resuelto).
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  }
});
