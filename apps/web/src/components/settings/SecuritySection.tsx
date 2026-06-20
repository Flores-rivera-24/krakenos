import type { AuthSession, SystemSettingKey, WebAuthnCredentialInfo } from '@krakenos/types';
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
 * Gestión de passkeys WebAuthn (2FA, US-50): listar, registrar y eliminar las
 * passkeys del usuario actual. Las passkeys son un segundo factor; la contraseña
 * sigue siendo el primer factor, así que se pueden eliminar sin restricción.
 */
function PasskeysCard() {
  const supported = isWebAuthnSupported();
  const [passkeys, setPasskeys] = useState<WebAuthnCredentialInfo[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = () => {
    void api
      .get<WebAuthnCredentialInfo[]>('/webauthn/credentials')
      .then(setPasskeys)
      .catch(() => setPasskeys([]));
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
      await api.post('/webauthn/register/verify', {
        response: attestation,
        name: name.trim() || 'Passkey',
      });
      setName('');
      setAdding(false);
      load();
    } catch (err) {
      setError(
        err instanceof Error && err.message === 'webauthn_cancelled'
          ? 'Registro cancelado.'
          : 'No se pudo registrar la passkey.',
      );
    } finally {
      setBusy(false);
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
        <CardTitle>Passkeys</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!supported ? (
          <p className="text-kr-sm text-kr-muted">Tu navegador no soporta passkeys.</p>
        ) : (
          <>
            {passkeys === null ? (
              <p className="py-2 text-kr-sm text-kr-muted">Cargando…</p>
            ) : passkeys.length === 0 ? (
              <p className="text-kr-sm text-kr-muted">
                Sin passkeys registradas. Añade una para activar verificación en dos pasos al iniciar
                sesión.
              </p>
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
                        {pk.deviceType} · creada {new Date(pk.createdAt).toLocaleDateString()}
                        {pk.lastUsedAt
                          ? ` · usada ${new Date(pk.lastUsedAt).toLocaleDateString()}`
                          : ' · sin uso'}
                      </span>
                    </span>
                    {confirmId === pk.id ? (
                      <span className="flex items-center gap-1">
                        <Button variant="destructive" size="sm" onClick={() => void remove(pk.id)}>
                          Confirmar
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setConfirmId(null)}>
                          Cancelar
                        </Button>
                      </span>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => setConfirmId(pk.id)}>
                        Eliminar
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {adding ? (
              <div className="space-y-2 rounded-md border border-kr p-3">
                <Label htmlFor="passkey-name" className="text-kr-secondary">
                  Nombre para esta passkey
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
                    Cancelar
                  </Button>
                  <Button size="sm" disabled={busy} onClick={() => void register()}>
                    {busy ? 'Registrando…' : 'Registrar'}
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
                Añadir passkey
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function SecuritySection({ settings, patch, isAdmin }: Props) {
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const currentRefresh = useAuthStore((s) => s.tokens?.refreshToken);
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
    await api.del('/auth/sessions', { body: { keepRefreshToken: currentRefresh } });
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
          <CardTitle>Seguridad</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Row label="Duración del access token">
            <select
              className={SELECT_CLASS}
              value={settings.accessTokenTtl}
              disabled={!isAdmin}
              onChange={(e) => void patch('accessTokenTtl', e.target.value)}
            >
              <option value="900">15 minutos</option>
              <option value="3600">1 hora</option>
              <option value="28800">8 horas</option>
            </select>
          </Row>
          <Row label="Límite de intentos de login">
            <select
              className={SELECT_CLASS}
              value={settings.loginRateLimit}
              disabled={!isAdmin}
              onChange={(e) => void patch('loginRateLimit', e.target.value)}
            >
              <option value="5">5 por minuto</option>
              <option value="10">10 por minuto</option>
              <option value="20">20 por minuto</option>
            </select>
          </Row>
          <Row label="Tema oscuro">
            <Switch checked={theme === 'dark'} onCheckedChange={(v) => void toggleTheme(v)} />
          </Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Sesiones activas</CardTitle>
          <Button variant="outline" size="sm" onClick={() => void closeOthers()}>
            Cerrar todas las sesiones
          </Button>
        </CardHeader>
        <CardContent>
          {sessions === null ? (
            <p className="py-4 text-center text-kr-sm text-kr-muted">Cargando…</p>
          ) : sessions.length === 0 ? (
            <p className="py-4 text-center text-kr-sm text-kr-muted">Sin sesiones activas.</p>
          ) : (
            <ul className="space-y-2">
              {sessions.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between rounded-md border border-kr px-3 py-2 text-kr-sm"
                >
                  <span className="text-kr-secondary">
                    Creada {timeAgo(s.createdAt)} · expira{' '}
                    {new Date(s.expiresAt).toLocaleDateString()}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => void revoke(s.id)}>
                    Revocar
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
            <CardTitle className="text-danger">Zona de peligro</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-3">
            <p className="text-kr-sm text-kr-secondary">
              Regenerar las claves RS256 cerrará todas las sesiones activas.
            </p>
            <Button variant="destructive" size="sm" onClick={() => setConfirmRegen(true)}>
              Regenerar claves RS256
            </Button>
          </CardContent>
        </Card>
      )}

      {confirmRegen && (
        <Dialog open onClose={() => setConfirmRegen(false)}>
          <h3 className="text-kr-lg font-semibold text-kr-primary">¿Regenerar las claves RS256?</h3>
          <p className="mt-2 text-kr-sm text-kr-secondary">
            Esto cerrará todas las sesiones activas (incluida la tuya) y tendrás que volver a iniciar
            sesión. Esta acción no se puede deshacer.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmRegen(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" size="sm" onClick={() => void regenKeys()}>
              Sí, regenerar
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
