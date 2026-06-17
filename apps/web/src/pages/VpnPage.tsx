import type { CreatePeerResult, VpnPeer, VpnStatus } from '@krakenos/types';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiRequestError, api } from '@/lib/api';

export function VpnPage() {
  const [status, setStatus] = useState<VpnStatus | null>(null);
  const [peers, setPeers] = useState<VpnPeer[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatePeerResult | null>(null);

  const load = () => {
    void Promise.all([api.get<VpnStatus>('/vpn/status'), api.get<VpnPeer[]>('/vpn/peers')])
      .then(([s, p]) => {
        setStatus(s);
        setPeers(p);
      })
      .catch(() => setError('No se pudo cargar la VPN'));
  };

  useEffect(load, []);

  const addPeer = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<CreatePeerResult>('/vpn/peers', { name: name.trim() });
      setCreated(result); // muestra QR + config una sola vez
      setName('');
      load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : 'No se pudo crear el peer');
    } finally {
      setBusy(false);
    }
  };

  const removePeer = async (id: string) => {
    setError(null);
    try {
      await api.del(`/vpn/peers/${id}`);
      load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : 'No se pudo eliminar');
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

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base text-foreground">Servidor</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {status ? (
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
              <p className="text-muted-foreground">Cargando…</p>
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
                {peers.map((p) => (
                  <tr key={p.id} className="border-t border-border">
                    <td className="px-3 py-2">{p.name}</td>
                    <td className="px-3 py-2 font-mono text-xs">{p.allowedIps}</td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {p.publicKey.slice(0, 16)}…
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button variant="ghost" size="sm" onClick={() => void removePeer(p.id)}>
                        Eliminar
                      </Button>
                    </td>
                  </tr>
                ))}
                {peers.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">
                      Sin dispositivos. Crea el primero arriba.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {created && (
        <Dialog open onClose={() => setCreated(null)}>
          <div className="mb-3 flex items-start justify-between">
            <div>
              <h3 className="text-lg font-semibold">{created.peer.name}</h3>
              <p className="text-xs text-muted-foreground">{created.peer.allowedIps}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setCreated(null)}>
              Cerrar
            </Button>
          </div>
          <p className="mb-3 text-sm text-amber-500">
            Escanea el QR en la app de WireGuard. Esta config solo se muestra una vez.
          </p>
          <img
            src={created.config.qr}
            alt="QR de configuración WireGuard"
            className="mx-auto h-56 w-56 rounded bg-white p-2"
          />
          <pre className="mt-3 max-h-48 overflow-auto rounded-md bg-secondary/40 p-3 text-xs">
            {created.config.config}
          </pre>
        </Dialog>
      )}
    </div>
  );
}
