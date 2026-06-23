import type { CreateVlanRequest, Device, VlanWithCount } from '@krakenos/types';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Skeleton, SkeletonRows } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { useAuthStore } from '@/store/auth.store';

const EMPTY: CreateVlanRequest = { tag: 0, name: '', subnet: '', isolated: false };

export function VlanPage() {
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  const [vlans, setVlans] = useState<VlanWithCount[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [form, setForm] = useState<CreateVlanRequest>(EMPTY);
  const [tagText, setTagText] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    Promise.all([api.get<VlanWithCount[]>('/vlans'), api.get<Device[]>('/inventory/devices')])
      .then(([v, d]) => {
        setVlans(v);
        setDevices(d);
      })
      .catch((err) => setError(describeError(err, 'No se pudieron cargar las VLANs')));

  useEffect(() => {
    void load().finally(() => setLoading(false));
  }, []);

  const addVlan = async (e: FormEvent) => {
    e.preventDefault();
    const tag = Number(tagText);
    if (!form.name.trim() || !tag) return;
    setBusy(true);
    setError(null);
    try {
      await api.post<VlanWithCount>('/vlans', {
        tag,
        name: form.name.trim(),
        subnet: form.subnet?.trim() || null,
        isolated: form.isolated,
      });
      setForm(EMPTY);
      setTagText('');
      void load();
    } catch (err) {
      setError(describeError(err, 'No se pudo crear la VLAN'));
    } finally {
      setBusy(false);
    }
  };

  const removeVlan = async (id: string) => {
    setError(null);
    try {
      await api.del(`/vlans/${id}`);
      void load();
    } catch (err) {
      setError(describeError(err, 'No se pudo eliminar'));
    }
  };

  const assignDevice = async (deviceId: string, tag: number | null) => {
    setError(null);
    try {
      await api.put<Device>(`/inventory/devices/${deviceId}/vlan`, { tag });
      void load();
    } catch (err) {
      setError(describeError(err, 'No se pudo asignar'));
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="text-xl font-semibold">VLANs</h2>
        <p className="text-sm text-muted-foreground">
          Segmenta la red en VLANs y asigna dispositivos a cada segmento.
        </p>
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-foreground">Nueva VLAN</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={addVlan} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <div className="space-y-2">
                <Label htmlFor="vlan-tag">Tag (1-4094)</Label>
                <Input
                  id="vlan-tag"
                  value={tagText}
                  onChange={(e) => setTagText(e.target.value.replace(/\D/g, ''))}
                  placeholder="30"
                  inputMode="numeric"
                />
              </div>
              <div className="space-y-2 lg:col-span-2">
                <Label htmlFor="vlan-name">Nombre</Label>
                <Input
                  id="vlan-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="p. ej. IoT"
                  maxLength={60}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vlan-subnet">Subred</Label>
                <Input
                  id="vlan-subnet"
                  value={form.subnet ?? ''}
                  onChange={(e) => setForm({ ...form, subnet: e.target.value })}
                  placeholder="10.0.30.0/24"
                />
              </div>
              <div className="flex items-end gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.isolated ?? false}
                    onChange={(e) => setForm({ ...form, isolated: e.target.checked })}
                  />
                  Aislada
                </label>
              </div>
              <div className="flex items-end lg:col-span-5">
                <Button type="submit" disabled={busy}>
                  {busy ? 'Creando…' : 'Crear VLAN'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {loading &&
          Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        {!loading &&
          vlans.map((v) => (
            <Card key={v.id}>
              <CardHeader className="flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle className="text-base text-foreground">
                    {v.name}{' '}
                    <span className="font-mono text-xs text-muted-foreground">#{v.tag}</span>
                  </CardTitle>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {v.subnet ?? 'sin subred'}
                  </p>
                </div>
                {v.isolated && (
                  <span className="rounded bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-500">
                    aislada
                  </span>
                )}
              </CardHeader>
              <CardContent className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{v.deviceCount} dispositivos</span>
                {isAdmin && (
                  <Button variant="ghost" size="sm" onClick={() => void removeVlan(v.id)}>
                    Eliminar
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        {!loading && vlans.length === 0 && (
          <p className="text-kr-muted text-sm">Aún no hay VLANs configuradas.</p>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-foreground">Asignación de dispositivos</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary text-secondary-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Dispositivo</th>
                  <th className="px-3 py-2 text-left">IP</th>
                  <th className="px-3 py-2 text-left">VLAN</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <SkeletonRows cols={3} />
                ) : devices.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-8 text-center text-kr-muted">
                      Aún no hay dispositivos en el inventario.
                    </td>
                  </tr>
                ) : (
                  devices.map((d) => (
                    <tr key={d.id} className="border-t border-border">
                      <td className="px-3 py-2">{d.label ?? d.hostname ?? d.mac}</td>
                      <td className="px-3 py-2 font-mono text-xs">{d.ip}</td>
                      <td className="px-3 py-2">
                        <select
                          aria-label={`VLAN de ${d.label ?? d.mac}`}
                          value={d.vlanTag ?? ''}
                          disabled={!isAdmin}
                          onChange={(e) =>
                            void assignDevice(
                              d.id,
                              e.target.value === '' ? null : Number(e.target.value),
                            )
                          }
                          className="h-9 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
                        >
                          <option value="">Sin VLAN</option>
                          {vlans.map((v) => (
                            <option key={v.id} value={v.tag}>
                              {v.name} (#{v.tag})
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
