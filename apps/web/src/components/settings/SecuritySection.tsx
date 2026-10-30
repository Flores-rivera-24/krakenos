import type {
  AuthSession,
  BackupCodesResult,
  BackupCodesStatus,
  RegisterPasskeyResult,
  SystemSettingKey,
  WebAuthnCredentialInfo,
} from '@krakenos/types';
import { Download, KeyRound } from 'lucide-react';
import { useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DeleteButton } from '@/components/ui/delete-button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { FormError } from '@/components/ui/form-error';
import { StaleBadge } from '@/components/ui/stale-badge';
import { WidgetError } from '@/components/ui/widget-error';
import { api } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { formatDate, timeAgo } from '@/lib/format';
import { applyTheme, useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { isWebAuthnSupported, startRegistration } from '@/lib/webauthn';
import { useAuthStore } from '@/store/auth.store';
import { useT } from '@/lib/i18n';
import { useLectura } from '@/lib/use-lectura';
import { toast } from '@/store/toast.store';
import '@/lib/i18n/catalog/fragments/ajustes';

/**
 * `ok`: el cambio se guardó (el fallo ya lo avisa quien lo implementa).
 * `aplicadoAlInstante`: el servidor lo aplicó en caliente y la página ya lo anuncia con su banner.
 */
export interface PatchResult {
  ok: boolean;
  aplicadoAlInstante: boolean;
}

interface Props {
  /** `null` mientras la lectura de ajustes carga o ha fallado. */
  settings: Record<SystemSettingKey, string> | null;
  patch: (key: SystemSettingKey, value: string) => Promise<PatchResult>;
  isAdmin: boolean;
  /** Qué se pinta en lugar de los controles que dependen de los ajustes. */
  ajustesPendientes: React.ReactNode;
}

function Row({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-[200px_1fr] sm:items-center">
      <Label htmlFor={htmlFor} className="text-kr-secondary">
        {label}
      </Label>
      {children}
    </div>
  );
}

/**
 * Muestra los códigos de recuperación recién generados (US-59) una sola vez. El
 * usuario debe guardarlos: el servidor solo almacena su hash y no puede volver a
 * mostrarlos.
 */
function CodesReveal({ codes, onDismiss }: { codes: string[]; onDismiss: () => void }) {
  const t = useT();
  const texto = codes.join('\n');
  const descargar = () => {
    const url = URL.createObjectURL(new Blob([texto], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'krakenos-codigos-de-recuperacion.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-3 rounded-md border border-warning bg-kr-elevated p-3">
      <p className="text-kr-sm text-kr-primary">
        {t('security.codes.reveal')} <strong>{t('security.codes.onceOnly')}</strong>
      </p>
      <ul className="grid grid-cols-2 gap-1.5 font-mono text-kr-sm text-kr-primary">
        {codes.map((c) => (
          <li key={c} className="rounded-sm bg-kr-surface px-2 py-1 text-center">
            {c}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <CopyButton value={texto} showLabel variant="button" />
        <Button size="sm" variant="outline" onClick={descargar}>
          <Download className="h-4 w-4" aria-hidden />
          {t('security.codes.download')}
        </Button>
        <Button size="sm" onClick={onDismiss}>
          {t('security.codes.saved')}
        </Button>
      </div>
    </div>
  );
}

/**
 * Gestión de passkeys WebAuthn (2FA, US-50) y códigos de recuperación (US-59):
 * listar, registrar y eliminar passkeys, y regenerar los códigos de recuperación.
 * Las passkeys son un segundo factor; la contraseña sigue siendo el primero.
 */
function PasskeysCard() {
  const t = useT();
  const supported = isWebAuthnSupported();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Códigos de recuperación (US-59): cuántos quedan y los recién generados (una vez).
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [regenBusy, setRegenBusy] = useState(false);

  const creds = useLectura(() => api.getList<WebAuthnCredentialInfo>('/webauthn/credentials'), [], {
    enabled: supported,
  });
  const codigos = useLectura(
    async () => (await api.get<BackupCodesStatus>('/webauthn/backup-codes')).remaining,
    [],
    { enabled: supported },
  );
  const passkeys = creds.data;
  const remaining = codigos.data;
  const load = () => {
    creds.reintentar();
    codigos.reintentar();
  };

  const register = async () => {
    setError(null);
    setBusy(true);
    try {
      const options = await api.post<Parameters<typeof startRegistration>[0]>(
        '/webauthn/register/options',
      );
      const attestation = await startRegistration(options);
      const result = await api.post<RegisterPasskeyResult>('/webauthn/register/verify', {
        response: attestation,
        name: name.trim() || t('security.passkey.defaultName'),
      });
      setName('');
      setAdding(false);
      // Al registrar la primera passkey llegan los códigos de recuperación (una vez).
      if (result.backupCodes) setNewCodes(result.backupCodes);
      load();
    } catch (err) {
      setError(
        err instanceof Error && err.message === 'webauthn_cancelled'
          ? t('security.passkey.cancelled')
          : t('security.passkey.registerError'),
      );
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async () => {
    setRegenBusy(true);
    try {
      const { codes } = await api.post<BackupCodesResult>('/webauthn/backup-codes');
      setNewCodes(codes);
      load();
    } catch (err) {
      toast.error(describeError(err, t('security.codes.regenerateError')));
    } finally {
      setRegenBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await api.del(`/webauthn/credentials/${id}`);
      load();
    } catch (err) {
      toast.error(describeError(err, t('security.passkey.deleteError')));
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 space-y-0">
        <KeyRound className="h-5 w-5 text-kr-accent" aria-hidden />
        <CardTitle>{t('security.passkeys')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!supported ? (
          <p className="text-kr-sm text-kr-muted">{t('security.passkey.unsupported')}</p>
        ) : (
          <>
            {passkeys === null && creds.failed ? (
              <WidgetError message={t('security.passkeys.loadError')} onRetry={creds.reintentar} />
            ) : passkeys === null ? (
              <p className="py-2 text-kr-sm text-kr-muted">{t('common.loading')}</p>
            ) : passkeys.length === 0 ? (
              <p className="text-kr-sm text-kr-muted">{t('security.passkey.empty')}</p>
            ) : (
              <ul className="space-y-2">
                {passkeys.map((pk) => (
                  <li
                    key={pk.id}
                    className="flex items-center justify-between rounded-md border border-kr px-3 py-2 text-kr-sm"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-kr-primary">{pk.name}</span>
                      <span className="text-kr-xs text-kr-muted">
                        {pk.lastUsedAt
                          ? t('security.passkey.metaUsed', {
                              type: pk.deviceType,
                              created: formatDate(pk.createdAt),
                              used: formatDate(pk.lastUsedAt),
                            })
                          : t('security.passkey.metaUnused', {
                              type: pk.deviceType,
                              created: formatDate(pk.createdAt),
                            })}
                      </span>
                    </span>
                    <DeleteButton onDelete={() => remove(pk.id)}>{t('common.delete')}</DeleteButton>
                  </li>
                ))}
              </ul>
            )}

            {adding ? (
              <div className="space-y-2 rounded-md border border-kr p-3">
                <Label htmlFor="passkey-name" className="text-kr-secondary">
                  {t('security.passkey.name')}
                </Label>
                <Input
                  id="passkey-name"
                  placeholder={t('security.passkey.namePlaceholder')}
                  value={name}
                  maxLength={64}
                  onChange={(e) => setName(e.target.value)}
                />
                {error && <FormError>{error}</FormError>}
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setAdding(false);
                      setError(null);
                    }}
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button size="sm" disabled={busy} onClick={() => void register()}>
                    {busy ? t('security.passkey.registering') : t('security.passkey.register')}
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
                {t('security.passkey.add')}
              </Button>
            )}

            {passkeys !== null && creds.failed && <StaleBadge />}

            {newCodes && <CodesReveal codes={newCodes} onDismiss={() => setNewCodes(null)} />}

            {!newCodes && passkeys && passkeys.length > 0 && (
              <div className="space-y-2 rounded-md border border-kr p-3">
                <p className="text-kr-sm text-kr-secondary">
                  {t('security.codes.title')}
                  {remaining !== null && (
                    <span className="text-kr-muted">
                      {' '}
                      · {t('security.codes.remaining', { n: remaining })}
                    </span>
                  )}
                </p>
                {remaining !== null && codigos.failed && <StaleBadge />}
                {remaining === null && codigos.failed && (
                  <WidgetError
                    message={t('security.codes.remainingError')}
                    onRetry={codigos.reintentar}
                  />
                )}
                <p className="text-kr-xs text-kr-muted">{t('security.codes.help')}</p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={regenBusy}
                  onClick={() => void regenerate()}
                >
                  {regenBusy ? t('security.codes.regenerating') : t('security.codes.regenerate')}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SecurityControls({
  settings,
  patch,
  isAdmin,
}: {
  settings: Record<SystemSettingKey, string>;
  patch: Props['patch'];
  isAdmin: boolean;
}) {
  const t = useT();
  const uid = useId();
  const theme = useTheme();
  const guardar = async (key: SystemSettingKey, value: string) => {
    const { ok, aplicadoAlInstante } = await patch(key, value);
    // Un ajuste en caliente ya se anuncia con el banner de la página: un solo aviso.
    if (ok && !aplicadoAlInstante) toast.success(t('common.saved'));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('security.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Row label={t('security.tokenTtl')} htmlFor={`${uid}-ttl`}>
          <Select
            id={`${uid}-ttl`}
            value={settings.accessTokenTtl}
            disabled={!isAdmin}
            onChange={(e) => void guardar('accessTokenTtl', e.target.value)}
          >
            <option value="900">{t('security.ttl.15m')}</option>
            <option value="3600">{t('security.ttl.1h')}</option>
            <option value="28800">{t('security.ttl.8h')}</option>
          </Select>
        </Row>
        <Row label={t('security.loginLimit')} htmlFor={`${uid}-limit`}>
          <Select
            id={`${uid}-limit`}
            value={settings.loginRateLimit}
            disabled={!isAdmin}
            onChange={(e) => void guardar('loginRateLimit', e.target.value)}
          >
            <option value="5">{t('security.perMinute', { n: 5 })}</option>
            <option value="10">{t('security.perMinute', { n: 10 })}</option>
            <option value="20">{t('security.perMinute', { n: 20 })}</option>
          </Select>
        </Row>
        <Row label={t('security.darkTheme')} htmlFor={`${uid}-dark`}>
          <Switch
            id={`${uid}-dark`}
            checked={theme === 'dark'}
            onCheckedChange={(v) => applyTheme(v ? 'dark' : 'light')}
          />
        </Row>
      </CardContent>
    </Card>
  );
}

export function SecuritySection({ settings, patch, isAdmin, ajustesPendientes }: Props) {
  const t = useT();
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const lecturaSesiones = useLectura(() => api.getList<AuthSession>('/auth/sessions'), []);
  const sessions = lecturaSesiones.data;
  const [regenError, setRegenError] = useState<string | null>(null);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const loadSessions = lecturaSesiones.reintentar;

  const revoke = async (id: string) => {
    try {
      await api.del(`/auth/sessions/${id}`);
      loadSessions();
    } catch (err) {
      toast.error(describeError(err, t('security.sessionRevokeError')));
    }
  };

  const closeOthers = async () => {
    try {
      // La sesión a conservar es la actual, identificada por la cookie (US-91).
      await api.del('/auth/sessions');
      toast.success(t('security.otherSessionsClosed'));
      loadSessions();
    } catch (err) {
      toast.error(describeError(err, t('security.otherSessionsError')));
    }
  };

  const regenKeys = async () => {
    setRegenError(null);
    try {
      await api.post('/system/regen-keys');
    } catch (err) {
      setRegenError(describeError(err, t('security.regen.error')));
      return;
    }
    setConfirmRegen(false);
    await logout();
    navigate('/login');
  };

  return (
    <div className="space-y-6">
      {settings ? (
        <SecurityControls settings={settings} patch={patch} isAdmin={isAdmin} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{t('security.title')}</CardTitle>
          </CardHeader>
          <CardContent>{ajustesPendientes}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle>{t('security.sessions')}</CardTitle>
          <DeleteButton variant="outline" onDelete={closeOthers}>
            {t('security.closeAllSessions')}
          </DeleteButton>
        </CardHeader>
        <CardContent>
          {sessions !== null && lecturaSesiones.failed && <StaleBadge className="mb-2" />}
          {sessions === null && lecturaSesiones.failed ? (
            <WidgetError
              message={t('security.sessions.loadError')}
              onRetry={lecturaSesiones.reintentar}
            />
          ) : sessions === null ? (
            <p className="py-4 text-center text-kr-sm text-kr-muted">{t('common.loading')}</p>
          ) : sessions.length === 0 ? (
            <p className="py-4 text-center text-kr-sm text-kr-muted">{t('security.noSessions')}</p>
          ) : (
            <ul className="space-y-2">
              {sessions.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-kr px-3 py-2 text-kr-sm"
                >
                  <span className="min-w-0 text-kr-secondary">
                    {t('security.sessionMeta', {
                      created: timeAgo(s.createdAt),
                      expires: formatDate(s.expiresAt),
                    })}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void revoke(s.id)}
                    aria-label={t('security.sessionRevokeFor', { created: timeAgo(s.createdAt) })}
                  >
                    {t('security.sessionRevoke')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <PasskeysCard />

      {isAdmin && (
        <Card className={cn('border-danger')}>
          <CardHeader>
            <CardTitle className="text-danger">{t('security.danger')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 text-kr-sm text-kr-secondary">{t('security.regen.warning')}</p>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setRegenError(null);
                setConfirmRegen(true);
              }}
            >
              {t('security.regen.button')}
            </Button>
          </CardContent>
        </Card>
      )}

      {confirmRegen && (
        <Dialog open onClose={() => setConfirmRegen(false)} aria-labelledby="dialog-regen-title">
          <h3 id="dialog-regen-title" className="text-kr-lg font-semibold text-kr-primary">
            {t('security.regen.confirmTitle')}
          </h3>
          <p className="mt-2 text-kr-sm text-kr-secondary">{t('security.regen.confirmBody')}</p>
          {regenError && <FormError>{regenError}</FormError>}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmRegen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" size="sm" onClick={() => void regenKeys()}>
              {t('security.regen.confirm')}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
