import type { CreatePeerResult, PeerConfig, VpnPeer, VpnStatus } from '@krakenos/types';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DeleteButton } from '@/components/ui/delete-button';
import { GlossaryHint } from '@/components/ui/glossary-hint';
import { GlossaryTerm } from '@/components/ui/glossary-term';
import { HelpHint } from '@/components/ui/help-hint';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Skeleton, SkeletonRows } from '@/components/ui/skeleton';
import { MobileAccessCard } from '@/components/vpn/MobileAccessCard';
import { TailscaleCard } from '@/components/vpn/TailscaleCard';
import { VpnPeerSlideover } from '@/components/vpn/VpnPeerSlideover';
import { api } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { getGlossaryEntry } from '@/lib/guides/glossary';
import { useT } from '@/lib/i18n';
import { toast } from '@/store/toast.store';

export function VpnPage() {
  const t = useT();
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
      .catch((err) => setError(describeError(err, t('vpn.loadError'))));

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
      toast.success(t('vpn.peerAdded'));
      void load();
    } catch (err) {
      toast.error(describeError(err, t('vpn.peerAddError')));
    } finally {
      setBusy(false);
    }
  };

  const removePeer = async (id: string) => {
    try {
      await api.del(`/vpn/peers/${id}`);
      toast.success(t('vpn.peerRemoved'));
      void load();
    } catch (err) {
      toast.error(describeError(err, t('vpn.peerRemoveError')));
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <div className="flex items-center gap-1.5">
          <h2 className="text-xl font-semibold">{t('vpn.title')}</h2>
          <GlossaryHint termKey="vpn" />
        </div>
        <p className="text-sm text-muted-foreground">
          {t('vpn.subtitle.before')}
          <GlossaryTerm term="WireGuard" definition={getGlossaryEntry('wireguard')?.short ?? ''}>
            WireGuard
          </GlossaryTerm>
          {t('vpn.subtitle.after')}
        </p>
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base text-foreground">{t('vpn.server')}</CardTitle>
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
                  <span className="text-muted-foreground">{t('vpn.status')}</span>
                  <span className={status.enabled ? 'text-green-500' : 'text-muted-foreground'}>
                    {status.enabled ? t('vpn.status.active') : t('vpn.status.inactive')}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('vpn.endpoint')}</span>
                  <span className="font-mono text-xs">{status.endpoint ?? '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('vpn.devices')}</span>
                  <span>{status.peerCount}</span>
                </div>
              </>
            ) : (
              <p className="text-kr-muted">{t('vpn.unavailable')}</p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <span className="flex items-center gap-1.5">
              <CardTitle className="text-base text-foreground">{t('vpn.addDevice')}</CardTitle>
              <HelpHint content={t('vpn.qrHelp')} label={t('vpn.qrHelp.label')} />
            </span>
          </CardHeader>
          <CardContent>
            <form onSubmit={addPeer} className="flex items-end gap-3">
              <div className="flex-1 space-y-2">
                <Label htmlFor="peer-name">{t('vpn.name')}</Label>
                <Input
                  id="peer-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('vpn.namePlaceholder')}
                  maxLength={60}
                />
              </div>
              <Button type="submit" disabled={busy}>
                {busy ? t('vpn.adding') : t('vpn.addDevice')}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-foreground">{t('vpn.authorized')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary text-secondary-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">{t('vpn.col.name')}</th>
                  <th className="px-3 py-2 text-left">{t('vpn.col.vpnIp')}</th>
                  <th className="px-3 py-2 text-left">{t('vpn.col.publicKey')}</th>
                  <th className="px-3 py-2 text-right">{t('vpn.col.action')}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <SkeletonRows cols={4} />
                ) : peers.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center">
                      <p className="text-kr-muted">{t('vpn.empty.title')}</p>
                      <p className="mx-auto mt-1 max-w-md text-kr-xs text-kr-secondary">
                        {t('vpn.empty.desc')}
                      </p>
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
                          aria-label={t('vpn.deleteLabel', { name: p.name })}
                        >
                          {t('vpn.delete')}
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

      {/* Acceso remoto sin puertos (US-215): Tailscale para CGNAT + guía móvil. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <TailscaleCard />
        <MobileAccessCard />
      </div>

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
