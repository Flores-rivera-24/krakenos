import { useEffect, useMemo, useState } from 'react';
import { DeviceDetailModal } from '@/components/inventory/DeviceDetailModal';
import { Button } from '@/components/ui/button';
import { TYPE_LABELS } from '@/lib/devices';
import { useInventoryStore } from '@/store/inventory.store';

export function InventoryPage() {
  const devices = useInventoryStore((s) => s.devices);
  const connected = useInventoryStore((s) => s.connected);
  const subscribe = useInventoryStore((s) => s.subscribe);
  const rescan = useInventoryStore((s) => s.rescan);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => subscribe(), [subscribe]);

  const list = useMemo(
    () => Object.values(devices).sort((a, b) => b.lastSeen.localeCompare(a.lastSeen)),
    [devices],
  );

  // El dispositivo seleccionado se lee del store para reflejar cambios en vivo.
  const selected = selectedId ? (devices[selectedId] ?? null) : null;

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Inventario de dispositivos</h2>
          <p className="text-sm text-muted-foreground">
            {connected ? 'En tiempo real · conectado' : 'Desconectado'}
          </p>
        </div>
        <Button onClick={rescan} variant="outline" size="sm">
          Re-escanear
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-secondary-foreground">
            <tr>
              <th className="px-4 py-2 text-left">Dispositivo</th>
              <th className="px-4 py-2 text-left">IP</th>
              <th className="px-4 py-2 text-left">MAC</th>
              <th className="px-4 py-2 text-left">Tipo</th>
              <th className="px-4 py-2 text-left">Fabricante</th>
              <th className="px-4 py-2 text-left">Estado</th>
            </tr>
          </thead>
          <tbody>
            {list.map((d) => (
              <tr
                key={d.id}
                onClick={() => setSelectedId(d.id)}
                className="cursor-pointer border-t border-border hover:bg-secondary/40"
              >
                <td className="px-4 py-2">{d.label ?? d.hostname ?? '—'}</td>
                <td className="px-4 py-2 font-mono text-xs">{d.ip}</td>
                <td className="px-4 py-2 font-mono text-xs">{d.mac}</td>
                <td className="px-4 py-2">{TYPE_LABELS[d.type]}</td>
                <td className="px-4 py-2">{d.vendor ?? '—'}</td>
                <td className="px-4 py-2">
                  <span className={d.online ? 'text-primary' : 'text-muted-foreground'}>
                    {d.online ? 'online' : 'offline'}
                  </span>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  Sin dispositivos todavía. Pulsa «Re-escanear».
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && <DeviceDetailModal device={selected} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
