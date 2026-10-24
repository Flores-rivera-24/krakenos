import type { ApiTokenInfo, ApiTokenScope } from '@krakenos/types';
import { KeyRound, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';
import { StaleBadge } from '@/components/ui/stale-badge';
import { WidgetError } from '@/components/ui/widget-error';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { describeError } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { useLectura } from '@/lib/use-lectura';
import { canControlHome } from '@/lib/roles';
import { createApiToken, listApiTokens, revokeApiToken } from '@/lib/tokens';
import { useAuthStore } from '@/store/auth.store';
import { toast } from '@/store/toast.store';
import '@/lib/i18n/catalog/fragments/ajustes';

/**
 * Tokens personales de API (US-174). Autoservicio: cada usuario crea, ve y revoca
 * los suyos. El valor en claro se muestra **una sola vez** al crearlo. El permiso
 * «controlar» solo se ofrece si el rol lo permite (el servidor lo acota igual).
 */
export function ApiTokensCard() {
  const t = useT();
  const role = useAuthStore((s) => s.user?.role);
  const mayControl = canControlHome(role);
  const lectura = useLectura<ApiTokenInfo[]>(() => listApiTokens(), []);
  const tokens = lectura.data;
  const setTokens = (fn: (prev: ApiTokenInfo[]) => ApiTokenInfo[]) =>
    lectura.setData((prev) => fn(prev ?? []));
  const [name, setName] = useState('');
  const [control, setControl] = useState(false);
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);

  const create = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const scopes: ApiTokenScope[] =
        mayControl && control ? ['home.view', 'home.control'] : ['home.view'];
      const created = await createApiToken({ name: name.trim(), scopes });
      setFresh(created.token);
      // Con la lista sin cargar, una lista de un solo token pasaría por la completa:
      // se vuelve a pedir en vez de inventarla.
      if (lectura.data === null) lectura.reintentar();
      else setTokens((prev) => [{ ...created }, ...prev]);
      setName('');
      setControl(false);
    } catch (err) {
      toast.error(describeError(err, t('settings.apiTokens.error')));
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    try {
      await revokeApiToken(id);
      setTokens((prev) => prev.filter((tk) => tk.id !== id));
      toast.success(t('settings.apiTokens.revoked'));
    } catch (err) {
      toast.error(describeError(err, t('settings.apiTokens.revokeError')));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-kr-accent" aria-hidden />
          {t('settings.apiTokens.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-kr-xs text-kr-muted">{t('settings.apiTokens.desc')}</p>

        {fresh && (
          <div className="space-y-2 rounded-lg border border-success/40 bg-success/10 p-3">
            <p className="text-kr-xs text-success">{t('settings.apiTokens.copyHint')}</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md bg-kr-elevated px-2 py-1 font-mono text-kr-xs text-kr-primary">
                {fresh}
              </code>
              <CopyButton value={fresh} />
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="token-name">{t('settings.apiTokens.name')}</Label>
          <Input
            id="token-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('settings.apiTokens.namePlaceholder')}
            maxLength={64}
          />
          {mayControl && (
            <label className="flex items-center gap-2 text-kr-sm text-kr-secondary">
              <input
                type="checkbox"
                checked={control}
                onChange={(e) => setControl(e.target.checked)}
              />
              {t('settings.apiTokens.scopeControl')}
            </label>
          )}
          <Button disabled={creating || !name.trim()} onClick={() => void create()}>
            {creating ? t('settings.apiTokens.creating') : t('settings.apiTokens.create')}
          </Button>
        </div>

        {lectura.failed && tokens !== null && <StaleBadge />}
        {tokens === null ? (
          lectura.failed ? (
            <WidgetError message={t('settings.apiTokens.loadError')} onRetry={lectura.reintentar} />
          ) : null
        ) : tokens.length === 0 ? (
          <p className="text-kr-sm text-kr-muted">{t('settings.apiTokens.none')}</p>
        ) : (
          <ul className="space-y-2">
            {tokens.map((tk) => (
              <li
                key={tk.id}
                className="flex items-center justify-between gap-2 rounded-md border border-kr bg-kr-elevated p-2"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-kr-primary">{tk.name}</p>
                  <p className="text-kr-xs text-kr-muted">
                    <span className="font-mono">{tk.prefix}…</span> ·{' '}
                    {tk.scopes.includes('home.control')
                      ? `${t('settings.apiTokens.scopeView')} + ${t('settings.apiTokens.scopeControl')}`
                      : t('settings.apiTokens.scopeView')}
                    {' · '}
                    {tk.lastUsedAt
                      ? t('settings.apiTokens.used', {
                          when: formatDate(tk.lastUsedAt),
                        })
                      : t('settings.apiTokens.neverUsed')}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('settings.apiTokens.revoke')}
                  onClick={() => void revoke(tk.id)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
