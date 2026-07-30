import type { BlockedDomain, DnsQuery, DnsStats } from '@krakenos/types';
import { Ban, Globe, ShieldCheck, ListFilter } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { StatCard } from '@/components/dashboard/StatCard';
import { Button } from '@/components/ui/button';
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
      .catch((err) => setError(describeError(err, t('dns.loadError'))));

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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
