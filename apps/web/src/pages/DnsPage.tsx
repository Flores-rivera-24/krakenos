import type { BlockedDomain, DnsHistoryResponse, DnsQuery, DnsStats } from '@krakenos/types';
import { Ban, Globe, ShieldCheck, ListFilter } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { StatCard } from '@/components/dashboard/StatCard';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { DnsFeeds } from '@/components/dns/DnsFeeds';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DeleteButton } from '@/components/ui/delete-button';
import { GlossaryHint } from '@/components/ui/glossary-hint';
import { GlossaryTerm } from '@/components/ui/glossary-term';
import { HelpHint } from '@/components/ui/help-hint';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ErrorBanner } from '@/components/ui/error-banner';
import { SkeletonRows } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { getGlossaryEntry } from '@/lib/guides/glossary';
import { useT } from '@/lib/i18n';
import { useAuthStore } from '@/store/auth.store';
import { toast } from '@/store/toast.store';

export function DnsPage() {
  const t = useT();
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  /**
   * US-250: el registro de consultas exige `home.activity` (solo admin) porque es
   * el historial de navegación del hogar. No hace falta un tercer estado para «rol
   * aún sin cargar»: `App` no monta ninguna ruta hasta que `bootstrapSession()`
   * resuelve y `RequireAuth` redirige al login sin usuario, así que aquí el rol ya
   * está siempre resuelto.
   */
  const activityDenied = !isAdmin;
  const [stats, setStats] = useState<DnsStats | null>(null);
  const [blocklist, setBlocklist] = useState<BlockedDomain[]>([]);
  const [queries, setQueries] = useState<DnsQuery[]>([]);
  const [history, setHistory] = useState<DnsHistoryResponse | null>(null);
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Cifras y blocklist: lectura de cualquier rol. Va **aparte** del registro de
   * consultas a propósito (US-250): si las tres siguieran en un solo `Promise.all`,
   * el 403 del registro tumbaría también estas dos y un `viewer` vería la página
   * entera en blanco por una restricción que solo afecta a una tarjeta.
   */
  const loadShared = () =>
    Promise.all([api.get<DnsStats>('/dns/stats'), api.get<BlockedDomain[]>('/dns/blocklist')])
      .then(([s, b]) => {
        setStats(s);
        setBlocklist(b);
      })
      .catch((err) => setError(describeError(err, t('dns.loadError'))));

  const loadQueries = () =>
    api
      .get<DnsQuery[]>('/dns/queries?limit=20')
      .then(setQueries)
      .catch((err) => setError(describeError(err, t('dns.loadError'))));

  /**
   * Histórico persistido (US-252). Va **aparte** de las otras dos cargas por lo
   * mismo que el registro en vivo: un fallo suyo no puede dejar en blanco las
   * cifras y la lista de bloqueo, que son de otra tarjeta.
   */
  const loadHistory = () =>
    api
      .get<DnsHistoryResponse>('/dns/history?limit=100')
      .then(setHistory)
      .catch((err) => setError(describeError(err, t('dns.loadError'))));

  const clearHistory = async () => {
    try {
      await api.del('/dns/history');
      toast.success(t('dns.history.cleared'));
      void loadHistory();
    } catch (err) {
      toast.error(describeError(err, t('dns.history.clearError')));
    }
  };

  /**
   * La cobertura, defendida de una respuesta que no tenga la forma esperada. El
   * genérico de `api.get<T>()` es un **cast**, no una comprobación, y aquí el
   * coste de fiarse no es un dato raro: es que la excepción tumbe la página
   * entera, incluidas las cifras y la lista de bloqueo, que son de otra tarjeta y
   * de otro permiso. Es la misma regresión que US-250 arregló partiendo el
   * `Promise.all`, por otra vía.
   */
  const cobertura = history?.coverage as DnsHistoryResponse['coverage'] | undefined;

  /** Refresco completo tras una mutación (siempre la hace un admin). */
  const load = () => Promise.all([loadShared(), isAdmin ? loadQueries() : Promise.resolve()]);

  useEffect(() => {
    void Promise.all([loadShared(), loadHistory()]).finally(() => setLoading(false));
  }, []);

  // El registro solo se pide cuando ya se sabe que quien mira es admin: sin permiso
  // no se pide para luego pintar el error, porque no es un fallo.
  useEffect(() => {
    if (isAdmin) void loadQueries();
  }, [isAdmin]);

  const addDomain = async (e: FormEvent) => {
    e.preventDefault();
    if (!domain.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.post<BlockedDomain>('/dns/blocklist', { domain: domain.trim() });
      setDomain('');
      toast.success(t('dns.domainBlocked'));
      void load();
    } catch (err) {
      toast.error(describeError(err, t('dns.blockError')));
    } finally {
      setBusy(false);
    }
  };

  const removeDomain = async (id: string) => {
    try {
      await api.del(`/dns/blocklist/${id}`);
      toast.success(t('dns.domainRemoved'));
      void load();
    } catch (err) {
      toast.error(describeError(err, t('dns.removeError')));
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <div className="flex items-center gap-1.5">
          <h2 className="text-xl font-semibold">{t('dns.title')}</h2>
          <GlossaryHint termKey="dns" />
        </div>
        <p className="text-sm text-muted-foreground">
          <GlossaryTerm
            term={t('dns.adblockTerm')}
            definition={getGlossaryEntry('adblock')?.short ?? ''}
          >
            {t('dns.subtitle.link')}
          </GlossaryTerm>{' '}
          {t('dns.subtitle.after')}
        </p>
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          title={t('dns.stat.queries')}
          value={stats ? stats.totalQueries.toLocaleString() : '—'}
          icon={Globe}
        />
        <StatCard
          title={t('dns.stat.blocked')}
          value={stats ? stats.blockedQueries.toLocaleString() : '—'}
          icon={Ban}
          accent="text-destructive"
        />
        <StatCard
          title={t('dns.stat.blockedPercent')}
          value={stats ? `${stats.blockedPercent}%` : '—'}
          icon={ShieldCheck}
          accent="text-success"
        />
        <StatCard
          title={t('dns.stat.domains')}
          value={stats ? `${stats.blocklistSize}` : '—'}
          icon={ListFilter}
        />
      </div>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-foreground">{t('dns.blockCard.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={addDomain} className="flex items-end gap-3">
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="dns-domain">{t('dns.domain')}</Label>
                  <HelpHint content={t('dns.domainHelp')} label={t('dns.domainHelpLabel')} />
                </div>
                <Input
                  id="dns-domain"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  placeholder={t('dns.domainPlaceholder')}
                  maxLength={253}
                />
              </div>
              <Button type="submit" disabled={busy}>
                {busy ? t('dns.blocking') : t('dns.block')}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Feeds de categoría / adlists (US-114) */}
      <DnsFeeds canEdit={isAdmin} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-foreground">{t('dns.blocklist.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-secondary text-secondary-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">{t('dns.col.domain')}</th>
                    {isAdmin && <th className="px-3 py-2 text-right">{t('dns.col.action')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <SkeletonRows cols={isAdmin ? 2 : 1} />
                  ) : blocklist.length === 0 ? (
                    <tr>
                      <td colSpan={isAdmin ? 2 : 1} className="px-3 py-8 text-center">
                        <p className="text-kr-muted">{t('dns.empty.title')}</p>
                        <p className="mx-auto mt-1 max-w-xs text-kr-xs text-kr-secondary">
                          {t('dns.empty.desc')}{' '}
                          {isAdmin && t('dns.empty.cta')}
                        </p>
                      </td>
                    </tr>
                  ) : (
                    blocklist.map((b) => (
                      <tr key={b.id} className="border-t border-border">
                        <td className="px-3 py-2 font-mono text-xs">{b.domain}</td>
                        {isAdmin && (
                          <td className="px-3 py-2 text-right">
                            <DeleteButton
                              onDelete={() => removeDomain(b.id)}
                              aria-label={t('dns.removeLabel', { domain: b.domain })}
                            >
                              {t('dns.remove')}
                            </DeleteButton>
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
            <CardTitle className="text-base text-foreground">{t('dns.queries.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            {activityDenied ? (
              /* La tarjeta se queda y explica por qué está vacía (US-263). No se
                 dice «no hay consultas» —sería mentira— ni se pide al usuario que
                 configure nada: lo que falta es un permiso, no un ajuste. */
              <Callout variant="info" standing title={t('dns.queries.adminOnly')}>
                {t('dns.queries.adminOnlyDesc')}
              </Callout>
            ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-secondary text-secondary-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">{t('dns.col.domain')}</th>
                    <th className="px-3 py-2 text-left">{t('dns.col.client')}</th>
                    <th className="px-3 py-2 text-left">{t('dns.col.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <SkeletonRows cols={3} />
                  ) : queries.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-3 py-8 text-center text-kr-muted">
                        {t('dns.queries.empty')}
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
                          <span className={q.blocked ? 'text-destructive' : 'text-success'}>
                            {q.blocked ? t('dns.blocked') : t('dns.allowed')}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Histórico persistido (US-252). A diferencia del registro en vivo de
          arriba, esta tarjeta la ve CUALQUIER rol: el servidor filtra a los
          aparatos de quien mira, así que no hace falta negarla entera. */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base text-foreground">{t('dns.history.title')}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {isAdmin ? t('dns.history.subtitle.admin') : t('dns.history.subtitle.own')}
            </p>
          </div>
          {isAdmin && (history?.entries?.length ?? 0) > 0 && (
            <DeleteButton onDelete={clearHistory} variant="outline">
              {t('dns.history.clear')}
            </DeleteButton>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Lo que el histórico NO ve va ANTES de la tabla: leer primero una lista
              corta y enterarse después de que faltan aparatos es enterarse tarde. */}
          {cobertura !== undefined && cobertura.silentDevices > 0 && (
            <Callout variant="warning" standing title={t('dns.history.silentTitle')}>
              {t('dns.history.silentDesc', {
                silent: String(cobertura.silentDevices),
                online: String(cobertura.onlineDevices),
              })}
            </Callout>
          )}

          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary text-secondary-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">{t('dns.col.time')}</th>
                  <th className="px-3 py-2 text-left">{t('dns.col.device')}</th>
                  <th className="px-3 py-2 text-left">{t('dns.col.domain')}</th>
                  <th className="px-3 py-2 text-left">{t('dns.col.status')}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <SkeletonRows cols={4} />
                ) : (history?.entries?.length ?? 0) === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-kr-muted">
                      {/* «Aún no se ha registrado nada» y «tus aparatos no han
                          consultado» son cosas distintas y llevan a sitios distintos. */}
                      {cobertura?.recording === false
                        ? t('dns.history.empty.notYet')
                        : t('dns.history.empty.none')}
                    </td>
                  </tr>
                ) : (
                  history!.entries.map((e) => (
                    <tr key={e.id} className="border-t border-border">
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {new Date(e.timestamp).toLocaleTimeString()}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {e.deviceLabel ?? (
                          <span className="text-kr-muted">{t('dns.history.unknownDevice')}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{e.domain}</td>
                      <td className="px-3 py-2">
                        <span className={e.blocked ? 'text-destructive' : 'text-success'}>
                          {e.blocked ? t('dns.blocked') : t('dns.allowed')}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {cobertura !== undefined && (
            <p className="text-xs text-kr-muted">
              {t('dns.history.retention', { days: String(cobertura.retentionDays) })}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
