import type { DeviceType, GuestNetwork, WifiNetwork } from '@krakenos/types';
import { Activity, Cpu, Users, Wifi, WifiOff } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertsCard } from '@/components/dashboard/AlertsCard';
import { RecentActivityCard } from '@/components/dashboard/RecentActivityCard';
import { StatCard } from '@/components/dashboard/StatCard';
import { SystemCard } from '@/components/dashboard/SystemCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { useInventoryStore } from '@/store/inventory.store';

const TYPE_LABELS: Record<DeviceType, string> = {
  router: 'Router',
  computer: 'Ordenador',
  phone: 'Móvil',
  tablet: 'Tablet',
  iot: 'IoT',
  tv: 'TV',
  printer: 'Impresora',
  unknown: 'Desconocido',
};

/** Paleta consistente con el tema (HSL de las variables CSS). */
const CHART_COLORS = ['#0ea5e9', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6', '#ef4444', '#64748b'];
const TOOLTIP_STYLE = {
  backgroundColor: 'hsl(222.2 84% 4.9%)',
  border: '1px solid hsl(217.2 32.6% 17.5%)',
  borderRadius: '0.5rem',
  fontSize: '0.8rem',
} as const;

export function DashboardPage() {
  const devices = useInventoryStore((s) => s.devices);
  const connected = useInventoryStore((s) => s.connected);
  const subscribe = useInventoryStore((s) => s.subscribe);
  const recentEvents = useInventoryStore((s) => s.recentEvents);

  const [wifi, setWifi] = useState<WifiNetwork | null>(null);
  const [guest, setGuest] = useState<GuestNetwork | null>(null);

  useEffect(() => subscribe(), [subscribe]);

  useEffect(() => {
    let active = true;
    void Promise.all([api.get<WifiNetwork>('/wifi'), api.get<GuestNetwork>('/wifi/guest')])
      .then(([w, g]) => {
        if (!active) return;
        setWifi(w);
        setGuest(g);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const stats = useMemo(() => {
    const list = Object.values(devices);
    const online = list.filter((d) => d.online).length;

    const byType = new Map<DeviceType, number>();
    for (const d of list) byType.set(d.type, (byType.get(d.type) ?? 0) + 1);

    const typeData = [...byType.entries()]
      .map(([type, count]) => ({ name: TYPE_LABELS[type], count }))
      .sort((a, b) => b.count - a.count);

    return {
      total: list.length,
      online,
      offline: list.length - online,
      typeData,
      statusData: [
        { name: 'Online', value: online },
        { name: 'Offline', value: list.length - online },
      ],
    };
  }, [devices]);

  const deviceList = useMemo(() => Object.values(devices), [devices]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Dashboard</h2>
          <p className="text-sm text-muted-foreground">
            {connected ? 'En tiempo real · conectado' : 'Desconectado'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Dispositivos" value={stats.total} icon={Cpu} hint="Total descubiertos" />
        <StatCard
          title="Online"
          value={stats.online}
          icon={Activity}
          accent="text-green-500"
          hint={`${stats.offline} offline`}
        />
        <StatCard
          title="Red WiFi"
          value={wifi ? (wifi.enabled ? 'Activa' : 'Inactiva') : '—'}
          icon={wifi?.enabled ? Wifi : WifiOff}
          accent={wifi?.enabled ? 'text-primary' : 'text-muted-foreground'}
          hint={wifi ? `${wifi.ssid} · ${wifi.band}` : 'Cargando…'}
        />
        <StatCard
          title="Invitados"
          value={guest ? (guest.enabled ? 'Activa' : 'Inactiva') : '—'}
          icon={Users}
          accent={guest?.enabled ? 'text-primary' : 'text-muted-foreground'}
          hint={guest ? guest.ssid : 'Cargando…'}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Dispositivos por tipo</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.typeData.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">Sin datos todavía.</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={stats.typeData}>
                  <XAxis dataKey="name" stroke="hsl(215 20.2% 65.1%)" fontSize={12} />
                  <YAxis allowDecimals={false} stroke="hsl(215 20.2% 65.1%)" fontSize={12} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'hsl(217.2 32.6% 17.5%)' }} />
                  <Bar dataKey="count" name="Dispositivos" radius={[4, 4, 0, 0]}>
                    {stats.typeData.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Estado de conexión</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.total === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">Sin datos todavía.</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={stats.statusData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={2}
                  >
                    <Cell fill="#22c55e" />
                    <Cell fill="#64748b" />
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <AlertsCard devices={deviceList} />
        <SystemCard />
        <RecentActivityCard events={recentEvents} />
      </div>
    </div>
  );
}
