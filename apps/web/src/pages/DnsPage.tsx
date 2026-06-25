import type { BlockedDomain, DnsQuery, DnsStats } from '@krakenos/types';
import { Ban, Globe, ShieldCheck, ListFilter } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { StatCard } from '@/components/dashboard/StatCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ErrorBanner } from '@/components/ui/error-banner';
import { SkeletonRows } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { useAuthStore } from '@/store/auth.store';
import { toast } from '@/store/toast.store';

export function DnsPage() {
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  const [stats, setStats] = useState<DnsStats | null>(null);
  const [blocklist, setBlocklist] = useState<BlockedDomain[]>([]);
  const [queries, setQueries] = useState<DnsQuery[]>([]);
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    Promise.all([
      api.get<DnsStats>('/dns/stats'),
      api.get<BlockedDomain[]>('/dns/blocklist'),
      api.get<DnsQuery[]>('/dns/queries?limit=20'),
    ])
      .then(([s, b, q]) => {
        setStats(s);
        setBlocklist(b);
        setQueries(q);
      })
      .catch((err) => setError(describeError(err, 'No se pudo cargar el DNS')));

  useEffect(() => {
    void load().finally(() => setLoading(false));
  }, []);

  const addDomain = async (e: FormEvent) => {
    e.preventDefault();
    if (!domain.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.post<BlockedDomain>('/dns/blocklist', { domain: domain.trim() });
      setDomain('');
      toast.success('Dominio bloqueado');
      void load();
    } catch (err) {
      toast.error(describeError(err, 'No se pudo bloquear el dominio'));
    } finally {
      setBusy(false);
    }
  };

  const removeDomain = async (id: string) => {
    try {
      await api.del(`/dns/blocklist/${id}`);
      toast.success('Dominio eliminado');
      void load();
    } catch (err) {
      toast.error(describeError(err, 'No se pudo eliminar el dominio'));
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="text-xl font-semibold">DNS</h2>
        <p className="text-sm text-muted-foreground">
          Bloqueo de dominios (anuncios/rastreadores) y estadísticas de consultas.
        </p>
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          title="Consultas"
          value={stats ? stats.totalQueries.toLocaleString() : '—'}
          icon={Globe}
        />
        <StatCard
          title="Bloqueadas"
          value={stats ? stats.blockedQueries.toLocaleString() : '—'}
          icon={Ban}
          accent="text-destructive"
        />
        <StatCard
          title="% Bloqueado"
          value={stats ? `${stats.blockedPercent}%` : '—'}
          icon={ShieldCheck}
          accent="text-green-500"
        />
        <StatCard
          title="Dominios"
          value={stats ? `${stats.blocklistSize}` : '—'}
          icon={ListFilter}
        />
      </div>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-foreground">Bloquear dominio</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={addDomain} className="flex items-end gap-3">
              <div className="flex-1 space-y-2">
                <Label htmlFor="dns-domain">Dominio</Label>
                <Input
                  id="dns-domain"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  placeholder="p. ej. ads.ejemplo.com"
                  maxLength={253}
                />
              </div>
              <Button type="submit" disabled={busy}>
                {busy ? 'Bloqueando…' : 'Bloquear'}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-foreground">Blocklist</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-secondary text-secondary-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Dominio</th>
                    {isAdmin && <th className="px-3 py-2 text-right">Acción</th>}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <SkeletonRows cols={isAdmin ? 2 : 1} />
                  ) : blocklist.length === 0 ? (
                    <tr>
                      <td colSpan={isAdmin ? 2 : 1} className="px-3 py-8 text-center text-kr-muted">
                        Aún no hay dominios bloqueados.
                      </td>
                    </tr>
                  ) : (
                    blocklist.map((b) => (
                      <tr key={b.id} className="border-t border-border">
                        <td className="px-3 py-2 font-mono text-xs">{b.domain}</td>
                        {isAdmin && (
                          <td className="px-3 py-2 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void removeDomain(b.id)}
                            >
                              Quitar
                            </Button>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base text-foreground">Consultas recientes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-secondary text-secondary-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Dominio</th>
                    <th className="px-3 py-2 text-left">Cliente</th>
                    <th className="px-3 py-2 text-left">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <SkeletonRows cols={3} />
                  ) : queries.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-3 py-8 text-center text-kr-muted">
                        Aún no hay consultas recientes.
                      </td>
                    </tr>
                  ) : (
                    queries.map((q, i) => (
                      <tr key={`${q.timestamp}-${i}`} className="border-t border-border">
                        <td className="px-3 py-2 font-mono text-xs">{q.domain}</td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                          {q.client}
                        </td>
                        <td className="px-3 py-2">
                          <span className={q.blocked ? 'text-destructive' : 'text-green-500'}>
                            {q.blocked ? 'bloqueada' : 'permitida'}
                          </span>
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
    </div>
  );
}
