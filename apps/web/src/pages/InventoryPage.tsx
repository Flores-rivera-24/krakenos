import type { Device, DeviceType } from '@krakenos/types';
import { ChevronDown, ChevronUp, LayoutGrid, List, RefreshCw, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { DeviceCard } from '@/components/inventory/DeviceCard';
import { DeviceDetailSlideover } from '@/components/inventory/DeviceDetailSlideover';
import { Button } from '@/components/ui/button';
import { StatusDot } from '@/components/ui/status-dot';
import {
  type ActiveFilter,
  DEVICE_TYPES,
  TYPE_LABELS_EN,
  filterDevices,
  groupDevicesByType,
} from '@/lib/devices';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useInventoryStore } from '@/store/inventory.store';

const GROUPS_OPEN_KEY = 'kr-groups-open';

const FILTERS: { value: ActiveFilter; label: string }[] = [
  { value: 'online', label: 'Online' },
  { value: 'offline', label: 'Offline' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'unknown', label: 'Unknown' },
];

/** En <768px se fuerza la vista lista; por defecto (jsdom/SSR) asume escritorio. */
function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 767px)');
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return mobile;
}

function loadGroupsOpen(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(GROUPS_OPEN_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function statusOf(d: Device): { dot: 'online' | 'offline' | 'danger'; text: string; danger: boolean } {
  if (d.isBlocked) return { dot: 'danger', text: 'Blocked', danger: true };
  return d.online
    ? { dot: 'online', text: 'Online', danger: false }
    : { dot: 'offline', text: 'Offline', danger: false };
}

const GRID_CLASS = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3';

function DeviceTable({ devices, onSelect }: { devices: Device[]; onSelect: (id: string) => void }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-kr">
      <table className="w-full text-kr-sm">
        <caption className="sr-only">Dispositivos detectados en la red</caption>
        <thead className="bg-kr-elevated text-kr-secondary">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              Device
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              IP
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              MAC
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              Vendor
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              Type
            </th>
            <th scope="col" className="px-3 py-2 text-left font-medium">
              Status
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Last seen
            </th>
          </tr>
        </thead>
        <tbody>
          {devices.map((d) => {
            const s = statusOf(d);
            return (
              <tr
                key={d.id}
                onClick={() => onSelect(d.id)}
                className="cursor-pointer border-t border-kr hover:bg-kr-elevated"
              >
                <td className="px-3 py-2 text-kr-primary">{d.label ?? d.hostname ?? d.mac}</td>
                <td className="px-3 py-2 font-mono text-kr-xs text-kr-secondary">{d.ip}</td>
                <td className="px-3 py-2 font-mono text-kr-xs text-kr-secondary">{d.mac}</td>
                <td className="px-3 py-2 text-kr-secondary">{d.vendor ?? '—'}</td>
                <td className="px-3 py-2 text-kr-secondary">{TYPE_LABELS_EN[d.type]}</td>
                <td className="px-3 py-2">
                  <span className="flex items-center gap-2">
                    <StatusDot status={s.dot} />
                    <span className={s.danger ? 'text-danger' : 'text-kr-secondary'}>{s.text}</span>
                  </span>
                </td>
                <td className="px-3 py-2 text-right text-kr-xs text-kr-muted">
                  {timeAgo(d.lastSeen)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function InventoryPage() {
  const devices = useInventoryStore((s) => s.devices);
  const connected = useInventoryStore((s) => s.connected);
  const subscribe = useInventoryStore((s) => s.subscribe);
  const rescan = useInventoryStore((s) => s.rescan);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<'all' | 'groups'>('all');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<ActiveFilter[]>([]);
  const [groupsOpen, setGroupsOpen] = useState<Record<string, boolean>>(loadGroupsOpen);

  const isMobile = useIsMobile();
  const effectiveView = isMobile ? 'list' : view;

  useEffect(() => subscribe(), [subscribe]);

  useEffect(() => {
    try {
      localStorage.setItem(GROUPS_OPEN_KEY, JSON.stringify(groupsOpen));
    } catch {
      /* localStorage no disponible: ignorar */
    }
  }, [groupsOpen]);

  const list = useMemo(
    () => Object.values(devices).sort((a, b) => b.lastSeen.localeCompare(a.lastSeen)),
    [devices],
  );
  const filtered = useMemo(() => filterDevices(list, query, filters), [list, query, filters]);
  // La pestaña "Groups" ignora los chips de estado: solo aplica el buscador.
  const grouped = useMemo(
    () => groupDevicesByType(filterDevices(list, query, [])),
    [list, query],
  );

  const selected = selectedId ? (devices[selectedId] ?? null) : null;
  const loading = !connected && list.length === 0;

  function toggleFilter(f: ActiveFilter) {
    setFilters((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]));
  }
  function toggleGroup(type: DeviceType) {
    setGroupsOpen((prev) => ({ ...prev, [type]: prev[type] === false }));
  }

  return (
    <div className="space-y-4 p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-kr-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search..."
            aria-label="Search devices"
            className="h-10 w-full rounded-md border border-kr bg-kr-elevated pl-9 pr-3 text-kr-base text-kr-primary placeholder:text-kr-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <div className="inline-flex rounded-md border border-kr bg-kr-elevated p-0.5">
          {(['all', 'groups'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                'rounded px-3 py-1.5 text-kr-sm font-medium transition-colors',
                tab === t ? 'bg-kr-accent text-white' : 'text-kr-secondary hover:text-kr-primary',
              )}
            >
              {t === 'all' ? 'All Devices' : 'Groups'}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="hidden rounded-md border border-kr bg-kr-elevated p-0.5 md:inline-flex">
            <button
              type="button"
              aria-label="Grid view"
              onClick={() => setView('grid')}
              className={cn('rounded p-1.5', view === 'grid' ? 'bg-kr-elevated text-kr-primary' : 'text-kr-muted')}
            >
              <LayoutGrid className="h-5 w-5" />
            </button>
            <button
              type="button"
              aria-label="List view"
              onClick={() => setView('list')}
              className={cn('rounded p-1.5', view === 'list' ? 'bg-kr-elevated text-kr-primary' : 'text-kr-muted')}
            >
              <List className="h-5 w-5" />
            </button>
          </div>
          <Button onClick={rescan} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4" />
            Scan
          </Button>
        </div>
      </div>

      {/* Filtros rápidos (solo "All Devices") */}
      {tab === 'all' && (
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const active = filters.includes(f.value);
            return (
              <button
                key={f.value}
                type="button"
                aria-pressed={active}
                onClick={() => toggleFilter(f.value)}
                className={cn(
                  'rounded-full border px-3 py-1 text-kr-sm font-medium transition-colors',
                  active
                    ? 'border-kr-accent bg-kr-accent text-white'
                    : 'border-kr bg-kr-elevated text-kr-secondary hover:text-kr-primary',
                )}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Contenido */}
      {loading ? (
        <div className={GRID_CLASS}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl bg-kr-elevated" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-kr bg-kr-surface py-16 text-center">
          <p className="text-kr-secondary">No devices yet.</p>
          <Button onClick={rescan}>
            <RefreshCw className="h-4 w-4" />
            Scan network
          </Button>
        </div>
      ) : tab === 'all' ? (
        filtered.length === 0 ? (
          <div className="rounded-xl border border-kr bg-kr-surface py-16 text-center text-kr-secondary">
            No devices match your search.
          </div>
        ) : effectiveView === 'grid' ? (
          <div className={GRID_CLASS}>
            {filtered.map((d) => (
              <DeviceCard key={d.id} device={d} onSelect={setSelectedId} />
            ))}
          </div>
        ) : (
          <DeviceTable devices={filtered} onSelect={setSelectedId} />
        )
      ) : (
        // Pestaña "Groups": acordeones por tipo
        <div className="space-y-3">
          {DEVICE_TYPES.filter((type) => grouped[type].length > 0).map((type) => {
            const items = grouped[type];
            const open = groupsOpen[type] !== false;
            return (
              <div key={type} className="overflow-hidden rounded-xl border border-kr bg-kr-surface">
                <button
                  type="button"
                  onClick={() => toggleGroup(type)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left text-kr-primary hover:bg-kr-elevated"
                >
                  <span className="font-medium">
                    {TYPE_LABELS_EN[type]} ({items.length})
                  </span>
                  {open ? (
                    <ChevronUp className="h-5 w-5 text-kr-muted" />
                  ) : (
                    <ChevronDown className="h-5 w-5 text-kr-muted" />
                  )}
                </button>
                {open && (
                  <div className={cn(GRID_CLASS, 'p-4 pt-0')}>
                    {items.map((d) => (
                      <DeviceCard key={d.id} device={d} onSelect={setSelectedId} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {selected && <DeviceDetailSlideover device={selected} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
