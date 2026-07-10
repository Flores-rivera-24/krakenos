import type {
  AuthSession,
  BackupCodesResult,
  BackupCodesStatus,
  RegisterPasskeyResult,
  SystemSettingKey,
  WebAuthnCredentialInfo,
} from '@krakenos/types';
import { KeyRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { applyTheme, type Theme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { isWebAuthnSupported, startRegistration } from '@/lib/webauthn';
import { useAuthStore } from '@/store/auth.store';

const SELECT_CLASS =
  'h-10 w-full rounded-md border border-kr bg-kr-elevated px-3 text-kr-base text-kr-primary disabled:opacity-50';

interface Props {
  settings: Record<SystemSettingKey, string>;
  patch: (key: SystemSettingKey, value: string) => Promise<void>;
  isAdmin: boolean;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[200px_1fr] sm:items-center">
      <Label className="text-kr-secondary">{label}</Label>
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
  return (
    <div className="space-y-3 rounded-md border border-warning bg-kr-elevated p-3">
      <p className="text-kr-sm text-kr-primary">
        {t('settings.security.codesRevealPrefix')}{' '}
        <strong>{t('settings.security.codesRevealBold')}</strong>
      </p>
      <ul className="grid grid-cols-2 gap-1.5 font-mono text-kr-sm text-kr-primary">
        {codes.map((c) => (
          <li key={c} className="rounded bg-kr-surface px-2 py-1 text-center">
            {c}
          </li>
        ))}
      </ul>
      <div className="flex justify-end">
        <Button size="sm" onClick={onDismiss}>
          {t('settings.security.codesSaved')}
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
  const [passkeys, setPasskeys] = useState<WebAuthnCredentialInfo[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  // Códigos de recuperación (US-59): cuántos quedan y los recién generados (una vez).
  const [remaining, setRemaining] = useState<number | null>(null);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [regenBusy, setRegenBusy] = useState(false);

  const load = () => {
    void api
      .get<WebAuthnCredentialInfo[]>('/webauthn/credentials')
      .then(setPasskeys)
      .catch(() => setPasskeys([]));
    void api
      .get<BackupCodesStatus>('/webauthn/backup-codes')
      .then((s) => setRemaining(s.remaining))
      .catch(() => setRemaining(null));
  };
  useEffect(() => {
    if (supported) load();
  }, [supported]);

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
        name: name.trim() || 'Passkey',
      });
      setName('');
      setAdding(false);
      // Al registrar la primera passkey llegan los códigos de recuperación (una vez).
      if (result.backupCodes) setNewCodes(result.backupCodes);
      load();
    } catch (err) {
      setError(
        err instanceof Error && err.message === 'webauthn_cancelled'
          ? t('settings.security.passkeyCancelled')
          : t('settings.security.passkeyRegisterError'),
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
    } finally {
      setRegenBusy(false);
    }
  };

  const remove = async (id: string) => {
    setConfirmId(null);
    await api.del(`/webauthn/credentials/${id}`);
    load();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 space-y-0">
        <KeyRound className="h-5 w-5 text-kr-accent" />
        <CardTitle>{t('settings.security.passkeysTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!supported ? (
          <p className="text-kr-sm text-kr-muted">{t('settings.security.passkeysUnsupported')}</p>
        ) : (
          <>
            {passkeys === null ? (
              <p className="py-2 text-kr-sm text-kr-muted">{t('settings.security.loading')}</p>
            ) : passkeys.length === 0 ? (
              <p className="text-kr-sm text-kr-muted">{t('settings.security.passkeysEmpty')}</p>
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
                        {pk.deviceType} ·{' '}
                        {t('settings.security.passkeyCreated', {
                          date: new Date(pk.createdAt).toLocaleDateString(),
                        })}
                        {pk.lastUsedAt
                          ? t('settings.security.passkeyUsed', {
                              date: new Date(pk.lastUsedAt).toLocaleDateString(),
                            })
                          : t('settings.security.passkeyUnused')}
                      </span>
                    </span>
                    {confirmId === pk.id ? (
                      <span className="flex items-center gap-1">
                        <Button variant="destructive" size="sm" onClick={() => void remove(pk.id)}>
                          {t('settings.security.confirm')}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setConfirmId(null)}>
                          {t('common.cancel')}
                        </Button>
                      </span>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => setConfirmId(pk.id)}>
                        {t('common.delete')}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {adding ? (
              <div className="space-y-2 rounded-md border border-kr p-3">
                <Label htmlFor="passkey-name" className="text-kr-secondary">
                  {t('settings.security.passkeyNameLabel')}
                </Label>
                <Input
                  id="passkey-name"
                  placeholder="MacBook, iPhone, YubiKey…"
                  value={name}
                  maxLength={64}
                  onChange={(e) => setName(e.target.value)}
                />
                {error && <p className="text-kr-sm text-danger">{error}</p>}
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
                    {busy ? t('settings.security.registering') : t('settings.security.register')}
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
                {t('settings.security.addPasskey')}
              </Button>
            )}

            {newCodes && <CodesReveal codes={newCodes} onDismiss={() => setNewCodes(null)} />}

            {!newCodes && passkeys && passkeys.length > 0 && (
              <div className="space-y-2 rounded-md border border-kr p-3">
                <p className="text-kr-sm text-kr-secondary">
                  {t('settings.security.recoveryCodes')}
                  {remaining !== null && (
                    <span className="text-kr-muted">
                      {' '}
                      {t('settings.security.recoveryRemaining', { remaining })}
                    </span>
                  )}
                </p>
                <p className="text-kr-xs text-kr-muted">{t('settings.security.recoveryHelp')}</p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={regenBusy}
                  onClick={() => void regenerate()}
                >
                  {regenBusy
                    ? t('settings.security.generating')
                    : t('settings.security.regenerateCodes')}
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function SecuritySection({ settings, patch, isAdmin }: Props) {
  const t = useT();
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const [sessions, setSessions] = useState<AuthSession[] | null>(null);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [theme, setTheme] = useState<Theme>(settings.theme === 'light' ? 'light' : 'dark');

  const loadSessions = () => {
    void api
      .get<AuthSession[]>('/auth/sessions')
      .then(setSessions)
      .catch(() => setSessions([]));
  };

  useEffect(loadSessions, []);

  const toggleTheme = async (next: boolean) => {
    const value: Theme = next ? 'dark' : 'light';
    setTheme(value);
    applyTheme(value); // efecto inmediato
    if (isAdmin) await patch('theme', value);
  };

  const revoke = async (id: string) => {
    await api.del(`/auth/sessions/${id}`);
    loadSessions();
  };

  const closeOthers = async () => {
    // La sesión a conservar es la actual, identificada por la cookie (US-91).
    await api.del('/auth/sessions');
    loadSessions();
  };

  const regenKeys = async () => {
    await api.post('/system/regen-keys');
    setConfirmRegen(false);
    await logout();
    navigate('/login');
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.security.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Row label={t('settings.security.accessTokenTtl')}>
            <select
              className={SELECT_CLASS}
              aria-label={t('settings.security.accessTokenTtl')}
              value={settings.accessTokenTtl}
              disabled={!isAdmin}
              onChange={(e) => void patch('accessTokenTtl', e.target.value)}
            >
              <option value="900">{t('settings.security.ttl15min')}</option>
              <option value="3600">{t('settings.security.ttl1hour')}</option>
              <option value="28800">{t('settings.security.ttl8hours')}</option>
            </select>
          </Row>
          <Row label={t('settings.security.loginRateLimit')}>
            <select
              className={SELECT_CLASS}
              aria-label={t('settings.security.loginRateLimit')}
              value={settings.loginRateLimit}
              disabled={!isAdmin}
              onChange={(e) => void patch('loginRateLimit', e.target.value)}
            >
              <option value="5">{t('settings.security.rate5')}</option>
              <option value="10">{t('settings.security.rate10')}</option>
              <option value="20">{t('settings.security.rate20')}</option>
            </select>
          </Row>
          <Row label={t('settings.security.darkTheme')}>
            <Switch
              checked={theme === 'dark'}
              onCheckedChange={(v) => void toggleTheme(v)}
              aria-label={t('settings.security.darkTheme')}
            />
          </Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>{t('settings.security.activeSessions')}</CardTitle>
          <Button variant="outline" size="sm" onClick={() => void closeOthers()}>
            {t('settings.security.closeAllSessions')}
          </Button>
        </CardHeader>
        <CardContent>
          {sessions === null ? (
            <p className="py-4 text-center text-kr-sm text-kr-muted">
              {t('settings.security.loading')}
            </p>
          ) : sessions.length === 0 ? (
            <p className="py-4 text-center text-kr-sm text-kr-muted">
              {t('settings.security.noSessions')}
            </p>
          ) : (
            <ul className="space-y-2">
              {sessions.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between rounded-md border border-kr px-3 py-2 text-kr-sm"
                >
                  <span className="text-kr-secondary">
                    {t('settings.security.sessionMeta', {
                      created: timeAgo(s.createdAt),
                      expires: new Date(s.expiresAt).toLocaleDateString(),
                    })}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => void revoke(s.id)}>
                    {t('settings.security.revoke')}
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
            <CardTitle className="text-danger">{t('settings.security.dangerZone')}</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-3">
            <p className="text-kr-sm text-kr-secondary">{t('settings.security.regenWarning')}</p>
            <Button variant="destructive" size="sm" onClick={() => setConfirmRegen(true)}>
              {t('settings.security.regenKeys')}
            </Button>
          </CardContent>
        </Card>
      )}

      {confirmRegen && (
        <Dialog open onClose={() => setConfirmRegen(false)} aria-labelledby="dialog-regen-title">
          <h3 id="dialog-regen-title" className="text-kr-lg font-semibold text-kr-primary">
            {t('settings.security.regenConfirmTitle')}
          </h3>
          <p className="mt-2 text-kr-sm text-kr-secondary">
            {t('settings.security.regenConfirmBody')}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmRegen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" size="sm" onClick={() => void regenKeys()}>
              {t('settings.security.regenConfirmYes')}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
