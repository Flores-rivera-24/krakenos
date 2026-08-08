import type { CreateVlanRequest, Device, VlanWithCount } from '@krakenos/types';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DeleteButton } from '@/components/ui/delete-button';
import { GlossaryHint } from '@/components/ui/glossary-hint';
import { HelpHint } from '@/components/ui/help-hint';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Skeleton, SkeletonRows } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { useAuthStore } from '@/store/auth.store';
import { toast } from '@/store/toast.store';

const EMPTY: CreateVlanRequest = { tag: 0, name: '', subnet: '', isolated: false };

export function VlanPage() {
  const t = useT();
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  const [vlans, setVlans] = useState<VlanWithCount[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [form, setForm] = useState<CreateVlanRequest>(EMPTY);
  const [tagText, setTagText] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    Promise.all([api.getList<VlanWithCount>('/vlans'), api.getList<Device>('/inventory/devices')])
      .then(([v, d]) => {
        setVlans(v);
        setDevices(d);
      })
      .catch((err) => setError(describeError(err, t('vlan.loadError'))));

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
      toast.success(t('vlan.created'));
      void load();
    } catch (err) {
      toast.error(describeError(err, t('vlan.createError')));
    } finally {
      setBusy(false);
    }
  };

  const removeVlan = async (id: string) => {
    try {
      await api.del(`/vlans/${id}`);
      toast.success(t('vlan.removed'));
      void load();
    } catch (err) {
      toast.error(describeError(err, t('vlan.removeError')));
    }
  };

  const assignDevice = async (deviceId: string, tag: number | null) => {
    try {
      await api.put<Device>(`/inventory/devices/${deviceId}/vlan`, { tag });
      toast.success(t('vlan.updated'));
      void load();
    } catch (err) {
      toast.error(describeError(err, t('vlan.assignError')));
      void load(); // re-sincroniza el selector con la verdad del servidor
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <div className="flex items-center gap-1.5">
          <h1 className="text-xl font-semibold">{t('vlan.title')}</h1>
          <GlossaryHint termKey="vlan" />
        </div>
        <p className="text-sm text-muted-foreground">{t('vlan.subtitle')}</p>
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-foreground">{t('vlan.newVlan')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={addVlan} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="vlan-tag">{t('vlan.tag')}</Label>
                  <HelpHint content={t('vlan.tagHelp')} label={t('vlan.tagHelpLabel')} />
                </div>
                <Input
                  id="vlan-tag"
                  value={tagText}
                  onChange={(e) => setTagText(e.target.value.replace(/\D/g, ''))}
                  placeholder="30"
                  inputMode="numeric"
                />
              </div>
              <div className="space-y-2 lg:col-span-2">
                <Label htmlFor="vlan-name">{t('vlan.name')}</Label>
                <Input
                  id="vlan-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={t('vlan.namePlaceholder')}
                  maxLength={60}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="vlan-subnet">{t('vlan.subnet')}</Label>
                  <GlossaryHint termKey="subred" />
                </div>
                <Input
                  id="vlan-subnet"
                  value={form.subnet ?? ''}
                  onChange={(e) => setForm({ ...form, subnet: e.target.value })}
                  placeholder="10.0.30.0/24"
                />
              </div>
              <div className="flex items-end gap-1.5">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.isolated ?? false}
                    onChange={(e) => setForm({ ...form, isolated: e.target.checked })}
                  />
                  {t('vlan.isolated')}
                </label>
                <HelpHint content={t('vlan.isolatedHelp')} label={t('vlan.isolatedHelpLabel')} />
              </div>
              <div className="flex items-end lg:col-span-5">
                <Button type="submit" disabled={busy}>
                  {busy ? t('vlan.creating') : t('vlan.create')}
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
                    {v.subnet ?? t('vlan.noSubnet')}
                  </p>
                </div>
                {v.isolated && (
                  <span className="rounded bg-warning/15 px-2 py-0.5 text-[10px] text-warning">
                    {t('vlan.isolated')}
                  </span>
                )}
              </CardHeader>
              <CardContent className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {t('vlan.deviceCount', { count: v.deviceCount })}
                </span>
                {isAdmin && (
                  <DeleteButton
                    onDelete={() => removeVlan(v.id)}
                    aria-label={t('vlan.deleteLabel', { name: v.name })}
                  >
                    {t('vlan.delete')}
                  </DeleteButton>
                )}
              </CardContent>
            </Card>
          ))}
        {!loading && vlans.length === 0 && (
          <div className="rounded-xl border border-kr bg-kr-surface py-10 text-center sm:col-span-2 lg:col-span-3">
            <p className="text-kr-secondary">{t('vlan.empty.title')}</p>
            <p className="mx-auto mt-1 max-w-md text-kr-xs text-kr-muted">
              {t('vlan.empty.desc')}{' '}
              {isAdmin && t('vlan.empty.cta')}
            </p>
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-foreground">{t('vlan.assignment')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary text-secondary-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">{t('vlan.col.device')}</th>
                  <th className="px-3 py-2 text-left">{t('vlan.col.ip')}</th>
                  <th className="px-3 py-2 text-left">{t('vlan.col.vlan')}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <SkeletonRows cols={3} />
                ) : devices.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-8 text-center text-kr-muted">
                      {t('vlan.noDevices')}
                    </td>
                  </tr>
                ) : (
                  devices.map((d) => (
                    <tr key={d.id} className="border-t border-border">
                      <td className="px-3 py-2">{d.label ?? d.hostname ?? d.mac}</td>
                      <td className="px-3 py-2 font-mono text-xs">{d.ip}</td>
                      <td className="px-3 py-2">
                        <select
                          aria-label={t('vlan.deviceVlanLabel', { name: d.label ?? d.mac })}
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
                          <option value="">{t('vlan.noVlan')}</option>
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
