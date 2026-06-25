import type { CreatePeerResult, PeerConfig, VpnPeer, VpnStatus } from '@krakenos/types';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DeleteButton } from '@/components/ui/delete-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Skeleton, SkeletonRows } from '@/components/ui/skeleton';
import { VpnPeerSlideover } from '@/components/vpn/VpnPeerSlideover';
import { api } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { toast } from '@/store/toast.store';

export function VpnPage() {
  const [status, setStatus] = useState<VpnStatus | null>(null);
  const [peers, setPeers] = useState<VpnPeer[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Peer abierto en el slideover; `config` solo está presente al recién crearlo.
  const [selected, setSelected] = useState<{ peer: VpnPeer; config?: PeerConfig } | null>(null);

  const load = () =>
    Promise.all([api.get<VpnStatus>('/vpn/status'), api.get<VpnPeer[]>('/vpn/peers')])
      .then(([s, p]) => {
        setStatus(s);
        setPeers(p);
      })
      .catch((err) => setError(describeError(err, 'No se pudo cargar la VPN')));

  useEffect(() => {
    void load().finally(() => setLoading(false));
  }, []);

  const addPeer = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<CreatePeerResult>('/vpn/peers', { name: name.trim() });
      setSelected({ peer: result.peer, config: result.config }); // QR + config una sola vez
      setName('');
      toast.success('Peer creado');
      void load();
    } catch (err) {
      toast.error(describeError(err, 'No se pudo crear el peer'));
    } finally {
      setBusy(false);
    }
  };

  const removePeer = async (id: string) => {
    try {
      await api.del(`/vpn/peers/${id}`);
      toast.success('Peer eliminado');
      void load();
    } catch (err) {
      toast.error(describeError(err, 'No se pudo eliminar el peer'));
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="text-xl font-semibold">VPN / Acceso remoto</h2>
        <p className="text-sm text-muted-foreground">
          Conecta tus dispositivos por WireGuard. Ningún puerto queda expuesto a internet.
        </p>
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base text-foreground">Servidor</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ) : status ? (
              <>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Estado</span>
                  <span className={status.enabled ? 'text-green-500' : 'text-muted-foreground'}>
                    {status.enabled ? 'activo' : 'inactivo'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Endpoint</span>
                  <span className="font-mono text-xs">{status.endpoint ?? '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Peers</span>
                  <span>{status.peerCount}</span>
                </div>
              </>
            ) : (
              <p className="text-kr-muted">No disponible.</p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base text-foreground">Añadir dispositivo</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={addPeer} className="flex items-end gap-3">
              <div className="flex-1 space-y-2">
                <Label htmlFor="peer-name">Nombre</Label>
                <Input
                  id="peer-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="p. ej. Móvil de Emilio"
                  maxLength={60}
                />
              </div>
              <Button type="submit" disabled={busy}>
                {busy ? 'Creando…' : 'Crear peer'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-foreground">Dispositivos autorizados</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary text-secondary-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Nombre</th>
                  <th className="px-3 py-2 text-left">IP VPN</th>
                  <th className="px-3 py-2 text-left">Clave pública</th>
                  <th className="px-3 py-2 text-right">Acción</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <SkeletonRows cols={4} />
                ) : peers.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-kr-muted">
                      Sin dispositivos. Crea el primero arriba.
                    </td>
                  </tr>
                ) : (
                  peers.map((p) => (
                    <tr
                      key={p.id}
                      className="cursor-pointer border-t border-border hover:bg-secondary/40"
                      onClick={() => setSelected({ peer: p })}
                    >
                      <td className="px-3 py-2">{p.name}</td>
                      <td className="px-3 py-2 font-mono text-xs">{p.allowedIps}</td>
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                        {p.publicKey.slice(0, 16)}…
                      </td>
                      <td className="px-3 py-2 text-right">
                        <DeleteButton
                          onDelete={() => removePeer(p.id)}
                          aria-label={`Eliminar ${p.name}`}
                        >
                          Eliminar
                        </DeleteButton>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {selected && (
        <VpnPeerSlideover
          peer={selected.peer}
          config={selected.config}
          onClose={() => setSelected(null)}
          onDelete={(id) => void removePeer(id)}
        />
      )}
    </div>
  );
}
