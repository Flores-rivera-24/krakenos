import type { LastSession, LoginResponse, SetupStatus, SystemPublicInfo } from '@krakenos/types';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { Clock, Eye, EyeOff, Fingerprint, Home, Lock } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusDot, type DotStatus } from '@/components/ui/status-dot';
import { api } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { startAuthentication } from '@/lib/webauthn';
import { useAuthStore } from '@/store/auth.store';

type HealthState = 'loading' | 'online' | 'offline';

const HEALTH_UI: Record<HealthState, { dot: DotStatus; label: string }> = {
  loading: { dot: 'offline', label: 'Verificando…' },
  online: { dot: 'online', label: 'Sistema en línea' },
  offline: { dot: 'danger', label: 'Sin conexión' },
};

type PasskeyStatus = 'idle' | 'verifying' | 'cancelled' | 'error';

export function LoginPage() {
  const login = useAuthStore((s) => s.login);
  const setSession = useAuthStore((s) => s.setSession);
  const navigate = useNavigate();

  const [email, setEmail] = useState('admin@krakenos.local');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // 2FA WebAuthn (US-50): tras un login con passkey, el formulario da paso a la
  // verificación con el dispositivo.
  const [stage, setStage] = useState<'form' | 'webauthn'>('form');
  const [pendingEmail, setPendingEmail] = useState('');
  const [passkeyStatus, setPasskeyStatus] = useState<PasskeyStatus>('idle');

  // Datos públicos del card (cargan en paralelo, no bloquean el formulario).
  const [homeName, setHomeName] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthState>('loading');
  const [lastSession, setLastSession] = useState<LastSession | null>(null);

  // Si ya hay sesión válida, no mostrar el login.
  useEffect(() => {
    if (useAuthStore.getState().user) navigate('/', { replace: true });
  }, [navigate]);

  // Instalación nueva (sin usuarios) → al wizard de configuración.
  useEffect(() => {
    let active = true;
    void api
      .get<SetupStatus>('/setup/status')
      .then((s) => {
        if (active && s.needsSetup) navigate('/setup', { replace: true });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [navigate]);

  // Carga en paralelo: nombre del hogar, estado del sistema y última sesión.
  // Si alguno falla se usa el valor por defecto; nunca bloquea el login.
  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      api.get<SystemPublicInfo>('/system/info'),
      fetch('/health').then((r) => {
        if (!r.ok) throw new Error('health');
        return true;
      }),
      api.get<LastSession | null>('/auth/last-session'),
    ]).then(([info, healthRes, last]) => {
      if (!active) return;
      setHomeName(info.status === 'fulfilled' ? info.value.homeName : 'KrakenOS');
      setHealth(healthRes.status === 'fulfilled' ? 'online' : 'offline');
      setLastSession(last.status === 'fulfilled' ? last.value : null);
    });
    return () => {
      active = false;
    };
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await login(email, password);
      if (result && 'requiresWebAuthn' in result) {
        setPendingEmail(result.email);
        setPasskeyStatus('idle');
        setStage('webauthn');
      } else {
        navigate('/');
      }
    } catch {
      setError('Correo o contraseña incorrectos.');
    } finally {
      setLoading(false);
    }
  };

  const runPasskey = async () => {
    setPasskeyStatus('verifying');
    try {
      const res = await api.post<{
        available: boolean;
        options?: PublicKeyCredentialRequestOptionsJSON;
      }>('/webauthn/authenticate/options', { email: pendingEmail });
      if (!res.available || !res.options) {
        setPasskeyStatus('error');
        return;
      }
      const assertion = await startAuthentication(res.options);
      const session = await api.post<LoginResponse>('/webauthn/authenticate/verify', {
        email: pendingEmail,
        response: assertion,
      });
      setSession(session);
      navigate('/');
    } catch (err) {
      setPasskeyStatus(
        err instanceof Error && err.message === 'webauthn_cancelled' ? 'cancelled' : 'error',
      );
    }
  };

  const healthUi = HEALTH_UI[health];

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center gap-4 bg-kr-base px-4"
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Ccircle cx='2' cy='2' r='1' fill='%232563eb'/%3E%3C/svg%3E\")",
        backgroundRepeat: 'repeat',
      }}
    >
      <div
        className="w-full max-w-[380px] overflow-hidden rounded-xl bg-kr-surface"
        style={{ border: '0.5px solid var(--kr-border)' }}
      >
        {/* Header: hogar + estado del sistema */}
        <div
          className="flex items-center gap-3 px-5 py-4"
          style={{ borderBottom: '0.5px solid var(--kr-border)' }}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-kr-elevated">
            <Home size={18} className="text-kr-accent" />
          </span>
          <div className="min-w-0 flex-1">
            {homeName === null ? (
              <span className="block h-4 w-20 animate-pulse rounded bg-kr-elevated" />
            ) : (
              <p className="truncate text-kr-base font-medium text-kr-primary">{homeName}</p>
            )}
            <span className="mt-0.5 flex items-center gap-1.5">
              <StatusDot status={healthUi.dot} />
              <span className="text-kr-xs text-kr-secondary">{healthUi.label}</span>
            </span>
          </div>
          <span className="self-start text-[11px] text-kr-muted">KrakenOS</span>
        </div>

        {/* Cuerpo: verificación con passkey (2FA, US-50) */}
        {stage === 'webauthn' ? (
          <div className="space-y-4 px-5 py-6 text-center">
            <Fingerprint size={32} className="mx-auto text-kr-accent" />
            <h1 className="text-kr-lg font-medium text-kr-primary">
              Verifica tu identidad con tu dispositivo
            </h1>
            {passkeyStatus === 'cancelled' && (
              <p className="text-[13px] text-danger">Verificación cancelada — intenta de nuevo</p>
            )}
            {passkeyStatus === 'error' && (
              <p className="text-[13px] text-danger">
                No se pudo verificar la passkey. Inténtalo de nuevo.
              </p>
            )}
            <Button
              type="button"
              className="w-full"
              onClick={() => void runPasskey()}
              disabled={passkeyStatus === 'verifying'}
            >
              {passkeyStatus === 'verifying'
                ? 'Verificando…'
                : passkeyStatus === 'idle'
                  ? 'Usar passkey'
                  : 'Reintentar'}
            </Button>
          </div>
        ) : (
          /* Cuerpo: formulario */
          <form onSubmit={onSubmit} className="space-y-4 px-5 py-5">
            <h1 className="text-kr-lg font-medium text-kr-primary">Bienvenido de vuelta</h1>

            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-kr-secondary">
                Correo electrónico
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-kr-secondary">
                Contraseña
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  className="pr-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-kr-muted hover:text-kr-secondary"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-kr-sm text-kr-secondary">
              <input
                type="checkbox"
                checked={keepSignedIn}
                onChange={(e) => setKeepSignedIn(e.target.checked)}
                className="h-4 w-4 rounded border-kr accent-kr-accent"
              />
              Mantener sesión iniciada
            </label>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Entrando…' : 'Iniciar sesión'}
            </Button>

            {error && <p className="text-[13px] text-danger">{error}</p>}
          </form>
        )}

        {/* Footer: última sesión */}
        {lastSession && (
          <div
            className="flex items-center justify-between px-5 py-3 text-kr-xs text-kr-muted"
            style={{ borderTop: '0.5px solid var(--kr-border)' }}
          >
            <span className="flex items-center gap-1.5">
              <Clock size={13} />
              Último acceso: {formatRelative(new Date(lastSession.timestamp))}
            </span>
            {lastSession.ip && <span>{lastSession.ip}</span>}
          </div>
        )}
      </div>

      <p className="flex items-center gap-1.5 text-[12px] text-kr-muted">
        <Lock size={13} />
        Acceso local · Sin nube · Sin terceros
      </p>
    </div>
  );
}
