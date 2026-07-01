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
const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}));
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
import { ConnectPage } from '@/pages/ConnectPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { InventoryPage } from '@/pages/InventoryPage';
import { WifiPage } from '@/pages/WifiPage';
import { VpnPage } from '@/pages/VpnPage';
import { IotPage } from '@/pages/IotPage';
import { CamerasPage } from '@/pages/CamerasPage';
import { TrafficPage } from '@/pages/TrafficPage';
import { FirewallPage } from '@/pages/FirewallPage';
import { VlanPage } from '@/pages/VlanPage';
import { QosPage } from '@/pages/QosPage';
import { DnsPage } from '@/pages/DnsPage';
import { CompatibilityPage } from '@/pages/CompatibilityPage';
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
  reading: null,
};
const CAMERA = { id: 'cam', name: 'Entrada', room: 'Exterior', model: 'X', online: false };

function apiGet(path: string): Promise<unknown> {
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
  if (path === '/iot/devices') return Promise.resolve([IOT_LIGHT]);
  if (path === '/cameras') return Promise.resolve([CAMERA]);
  if (path === '/firewall/rules') return Promise.resolve([FIREWALL_RULE]);
  if (path === '/qos/rules') return Promise.resolve([QOS_RULE]);
  if (path === '/vlans') return Promise.resolve([VLAN]);
  if (path === '/inventory/devices') return Promise.resolve([DEVICE]);
  if (path.startsWith('/traffic/stats'))
    return Promise.resolve({ range: 'day', buckets: [], totalRxBytes: 0, totalTxBytes: 0 });
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
  { name: 'Connect', el: <ConnectPage /> },
  { name: 'Dashboard', el: <DashboardPage /> },
  { name: 'Inventory', el: <InventoryPage /> },
  { name: 'Wifi', el: <WifiPage /> },
  { name: 'Vpn', el: <VpnPage /> },
  { name: 'Iot', el: <IotPage /> },
  { name: 'Cameras', el: <CamerasPage /> },
  { name: 'Traffic', el: <TrafficPage /> },
  { name: 'Firewall', el: <FirewallPage /> },
  { name: 'Vlan', el: <VlanPage /> },
  { name: 'Qos', el: <QosPage /> },
  { name: 'Dns', el: <DnsPage /> },
  { name: 'Compatibility', el: <CompatibilityPage /> },
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
