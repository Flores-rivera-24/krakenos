import type { LastSession, SetupStatus, SystemPublicInfo } from '@krakenos/types';
import { Clock, Eye, EyeOff, Fingerprint } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LogoMark } from '@/components/ui/logo';
import { Label } from '@/components/ui/label';
import { NetworkCanvas } from '@/components/ui/network-canvas';
import { StatusDot, type DotStatus } from '@/components/ui/status-dot';
import { api } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { prefersReducedMotion } from '@/lib/motion';
import { requestAccess } from '@/lib/onboarding';
import { completePasskeyLogin, verifyBackupCode } from '@/lib/webauthn';
import { HttpError, useAuthStore } from '@/store/auth.store';

type HealthState = 'loading' | 'online' | 'offline';

const HEALTH_DOT: Record<HealthState, DotStatus> = {
  loading: 'offline',
  online: 'online',
  offline: 'danger',
};

type PasskeyStatus = 'idle' | 'verifying' | 'cancelled' | 'error';

/**
 * Pantalla de acceso (US-266).
 *
 * Composición partida: el formulario vive en un panel sólido a la izquierda y la
 * derecha es un escenario oscuro con la marca y el fondo generativo. Sustituye a la
 * tarjeta de 380 px sobre una rejilla, que era la pantalla menos trabajada del
 * producto siendo la única que ve todo el mundo.
 *
 * Lo que el escenario derecho **no** hace: enseñar un panel de ejemplo con
 * dispositivos y cifras inventadas. Queda bonito y es exactamente lo que el resto
 * del sistema se prohíbe a sí mismo («un dato que no existe no se publica
 * inventado»); un visitante sin sesión no puede distinguir una casa de mentira de
 * la suya. Lo que se muestra ahí es marca, movimiento y el único estado que ya era
 * público: si el sistema responde.
 */
export function LoginPage() {
  const t = useT();
  const login = useAuthStore((s) => s.login);
  const recoverWithCode = useAuthStore((s) => s.recoverWithCode);
  const setSession = useAuthStore((s) => s.setSession);
  const navigate = useNavigate();

  // Sin prefijar (US-266): venía con `admin@krakenos.local` escrito, que es la
  // cuenta del `seed` de desarrollo. En una instalación real anunciaba el usuario
  // administrador por defecto a cualquiera que abriera la página, y a quien había
  // instalado de verdad le mostraba un correo que no era el suyo.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // 2FA WebAuthn (US-50/US-51): tras un login con passkey, el formulario da paso a la
  // verificación con el dispositivo. Se guarda el token efímero `mfa-pending` que
  // acredita la contraseña ya superada para reenviarlo al paso de passkey.
  const [stage, setStage] = useState<'form' | 'webauthn' | 'recover' | 'request'>('form');
  const [pendingEmail, setPendingEmail] = useState('');
  const [pendingMfaToken, setPendingMfaToken] = useState('');
  const [passkeyStatus, setPasskeyStatus] = useState<PasskeyStatus>('idle');

  // Recuperación con código (US-59): alternativa a la passkey si se perdió el dispositivo.
  const [backupMode, setBackupMode] = useState(false);
  const [backupCode, setBackupCode] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);

  // Entrar sin la contraseña con un código de recuperación (US-266). Es un camino
  // distinto del de arriba: aquel completa un 2FA cuya contraseña YA se verificó;
  // este sustituye a la contraseña.
  const [recoverCode, setRecoverCode] = useState('');
  const [recoverBusy, setRecoverBusy] = useState(false);
  const [recoverError, setRecoverError] = useState<string | null>(null);

  // Pedir acceso al hogar (US-268). No crea nada: lo aprueba un admin.
  const [reqName, setReqName] = useState('');
  const [reqNote, setReqNote] = useState('');
  const [reqBusy, setReqBusy] = useState(false);
  const [reqSent, setReqSent] = useState(false);
  const [reqError, setReqError] = useState<string | null>(null);

  // Datos públicos (cargan en paralelo, no bloquean el formulario).
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
      const result = await login(email, password, keepSignedIn);
      if (result && 'requiresWebAuthn' in result) {
        setPendingEmail(result.email);
        setPendingMfaToken(result.mfaToken);
        setPasskeyStatus('idle');
        setStage('webauthn');
      } else {
        navigate('/');
      }
    } catch (err) {
      // US-55: un 401 es credenciales; cualquier otro fallo (red, 5xx) es de conexión.
      // US-235: el 429 tenía que salir de ese «cualquier otro fallo». Lo descubrí
      // depurando la suite e2e: al crecer de 5 a 13 flujos empezó a saltar el
      // rate-limit de login y la pantalla decía «No se pudo conectar con el
      // servidor» — mandando a mirar el cable cuando el problema era el reloj.
      // Le pasa igual a quien se equivoca de contraseña varias veces seguidas.
      const status = err instanceof HttpError ? err.status : 0;
      setError(
        status === 401
          ? t('login.error.credentials')
          : status === 429
            ? t('login.error.tooManyAttempts')
            : t('login.error.connection'),
      );
    } finally {
      setLoading(false);
    }
  };

  const runPasskey = async () => {
    setPasskeyStatus('verifying');
    try {
      const session = await completePasskeyLogin(pendingEmail, pendingMfaToken);
      setSession(session);
      navigate('/');
    } catch (err) {
      setPasskeyStatus(
        err instanceof Error && err.message === 'webauthn_cancelled' ? 'cancelled' : 'error',
      );
    }
  };

  const runBackupCode = async () => {
    setBackupBusy(true);
    setBackupError(null);
    try {
      const session = await verifyBackupCode(pendingEmail, pendingMfaToken, backupCode);
      setSession(session);
      navigate('/');
    } catch {
      setBackupError(t('login.backup.invalid'));
    } finally {
      setBackupBusy(false);
    }
  };

  const runRecover = async (e: FormEvent) => {
    e.preventDefault();
    setRecoverBusy(true);
    setRecoverError(null);
    try {
      await recoverWithCode(email, recoverCode);
      navigate('/');
    } catch {
      // Un solo mensaje para «ese correo no existe» y «ese código no vale»: el
      // servidor tampoco los distingue, y distinguirlos aquí convertiría la
      // pantalla en un oráculo para saber qué cuentas hay en la casa.
      setRecoverError(t('login.recover.invalid'));
    } finally {
      setRecoverBusy(false);
    }
  };

  const runRequestAccess = async (e: FormEvent) => {
    e.preventDefault();
    setReqBusy(true);
    setReqError(null);
    try {
      await requestAccess({ email, displayName: reqName, ...(reqNote ? { note: reqNote } : {}) });
      // El servidor responde igual exista ya el correo o no, así que aquí tampoco se
      // distingue: el acuse es el mismo en los dos casos.
      setReqSent(true);
    } catch {
      setReqError(t('login.request.error'));
    } finally {
      setReqBusy(false);
    }
  };

  const healthLabel =
    health === 'online'
      ? t('login.health.online')
      : health === 'offline'
        ? t('login.health.offline')
        : t('login.verifying');

  // El nombre del hogar y el estado van en elementos SEPARADOS a propósito: son
  // dos datos distintos —la identidad de la instalación y si responde— y fundirlos
  // en una sola cadena los vuelve inlocalizables para cualquiera que busque uno de
  // los dos, lectores de pantalla y tests incluidos.
  const homeStatus = (
    <span className="flex items-center gap-1.5 text-kr-xs">
      <StatusDot status={HEALTH_DOT[health]} />
      {homeName !== null && (
        <>
          <span className="text-kr-secondary">{homeName}</span>
          <span aria-hidden="true" className="text-kr-muted">
            ·
          </span>
        </>
      )}
      <span className="text-kr-secondary">{healthLabel}</span>
    </span>
  );

  return (
    <div className="grid min-h-screen bg-kr-base lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      {/* ── Panel del formulario ────────────────────────────────────────── */}
      <div className="relative flex flex-col justify-center bg-kr-surface px-6 py-10 sm:px-10 lg:border-r lg:border-kr">
        <div className="mx-auto w-full max-w-[340px]">
          <div className="mb-8 flex items-center gap-2.5">
            <LogoMark className="h-7 w-7 text-kr-accent" draw />
            <span className="text-kr-lg font-semibold tracking-tight text-kr-primary">KrakenOS</span>
          </div>

          {stage === 'webauthn' && (
            <div className="space-y-4">
              <Fingerprint size={30} className="text-kr-accent" />
              <h1 className="text-kr-xl font-medium text-kr-primary">{t('login.mfa.title')}</h1>
              {/* Igual que el error de contraseña: el resultado de la ceremonia con
                  la passkey es lo que acaba de pasar, y sin anunciarlo el paso de
                  2FA es un callejón sin salida para un lector de pantalla. */}
              {passkeyStatus === 'cancelled' && (
                <p role="alert" className="text-[13px] text-danger">
                  {t('login.mfa.cancelled')}
                </p>
              )}
              {passkeyStatus === 'error' && (
                <p role="alert" className="text-[13px] text-danger">
                  {t('login.mfa.error')}
                </p>
              )}
              <Button
                type="button"
                className="w-full"
                onClick={() => void runPasskey()}
                disabled={passkeyStatus === 'verifying'}
              >
                {passkeyStatus === 'verifying'
                  ? t('login.verifying')
                  : passkeyStatus === 'idle'
                    ? t('login.mfa.usePasskey')
                    : t('login.mfa.retry')}
              </Button>

              {/* Recuperación con código (US-59) */}
              {backupMode ? (
                <div className="space-y-2">
                  <Label htmlFor="backup-code" className="text-kr-secondary">
                    {t('login.backup.label')}
                  </Label>
                  <Input
                    id="backup-code"
                    value={backupCode}
                    onChange={(e) => setBackupCode(e.target.value)}
                    placeholder="xxxx-xxxx-xxxx"
                    autoComplete="one-time-code"
                    autoCapitalize="none"
                  />
                  {backupError && (
                    // `role="alert"` (viene de main, «un error en pantalla se
                    // anuncia»): el resultado de canjear un código de recuperación
                    // es lo que acaba de pasar, igual que el error de contraseña.
                    // Sin él, el paso falla en silencio para quien no ve la pantalla.
                    <p role="alert" className="text-[13px] text-danger">
                      {backupError}
                    </p>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => void runBackupCode()}
                    disabled={backupBusy || backupCode.trim() === ''}
                  >
                    {backupBusy ? t('login.verifying') : t('login.backup.verify')}
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setBackupMode(true)}
                  className="text-kr-xs text-kr-link underline hover:text-kr-primary"
                >
                  {t('login.backup.prompt')}
                </button>
              )}
            </div>
          )}

          {stage === 'form' && (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="mb-6 space-y-1">
                <h1 className="text-kr-2xl font-semibold tracking-tight text-kr-primary">
                  {t('login.welcome')}
                </h1>
                {homeStatus}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-kr-secondary">
                  {t('login.email')}
                </Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                  autoFocus
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-kr-secondary">
                  {t('login.password')}
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
                    aria-label={showPassword ? t('login.hidePassword') : t('login.showPassword')}
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
                {t('login.keepSignedIn')}
              </label>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? t('login.submitting') : t('login.submit')}
              </Button>

              {/* `role="alert"` porque es exactamente lo que ACABA de pasar al
                  pulsar «Iniciar sesión» (misma regla que `ui/callout.tsx`). Sin
                  él, quien usa lector de pantalla teclea mal la contraseña y no se
                  entera de nada: el formulario se queda igual y el mensaje aparece
                  en un `<p>` que nadie anuncia. */}
              {error && (
                <p role="alert" className="text-[13px] text-danger">
                  {error}
                </p>
              )}

              {/* La salida que la pantalla no tenía: quien perdía la contraseña se
                  quedaba mirando el formulario, sin saber que existían vías. */}
              <div className="flex flex-wrap justify-between gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setRecoverError(null);
                    setStage('recover');
                  }}
                  className="text-kr-xs text-kr-link underline hover:text-kr-primary"
                >
                  {t('login.recover.prompt')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setReqError(null);
                    setReqSent(false);
                    setStage('request');
                  }}
                  className="text-kr-xs text-kr-link underline hover:text-kr-primary"
                >
                  {t('login.request.prompt')}
                </button>
              </div>
            </form>
          )}

          {stage === 'request' && (
            <form onSubmit={(e) => void runRequestAccess(e)} className="space-y-4">
              <div className="mb-6 space-y-1">
                <h1 className="text-kr-xl font-medium text-kr-primary">
                  {t('login.request.title')}
                </h1>
                <p className="text-kr-sm text-kr-secondary">{t('login.request.intro')}</p>
              </div>

              {reqSent ? (
                <>
                  {/* `role="status"` y no `alert`: es el acuse de algo que salió
                      bien, no una urgencia que interrumpa lo que se esté leyendo. */}
                  <p
                    role="status"
                    className="rounded-lg border border-kr bg-kr-elevated p-3 text-kr-sm text-kr-primary"
                  >
                    {t('login.request.sent')}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={() => setStage('form')}
                  >
                    {t('login.recover.back')}
                  </Button>
                </>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="request-email" className="text-kr-secondary">
                      {t('login.email')}
                    </Label>
                    <Input
                      id="request-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="request-name" className="text-kr-secondary">
                      {t('login.request.name')}
                    </Label>
                    <Input
                      id="request-name"
                      value={reqName}
                      onChange={(e) => setReqName(e.target.value)}
                      autoComplete="name"
                      required
                      maxLength={80}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="request-note" className="text-kr-secondary">
                      {t('login.request.note')}
                    </Label>
                    <Input
                      id="request-note"
                      value={reqNote}
                      onChange={(e) => setReqNote(e.target.value)}
                      maxLength={280}
                    />
                  </div>

                  <Button type="submit" className="w-full" disabled={reqBusy}>
                    {reqBusy ? t('login.request.sending') : t('login.request.submit')}
                  </Button>

                  {reqError && (
                    <p role="alert" className="text-[13px] text-danger">
                      {reqError}
                    </p>
                  )}

                  <button
                    type="button"
                    onClick={() => setStage('form')}
                    className="text-kr-xs text-kr-link underline hover:text-kr-primary"
                  >
                    {t('login.recover.back')}
                  </button>
                </>
              )}
            </form>
          )}

          {stage === 'recover' && (
            <form onSubmit={(e) => void runRecover(e)} className="space-y-4">
              <div className="mb-6 space-y-1">
                <h1 className="text-kr-xl font-medium text-kr-primary">
                  {t('login.recover.title')}
                </h1>
                <p className="text-kr-sm text-kr-secondary">{t('login.recover.intro')}</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="recover-email" className="text-kr-secondary">
                  {t('login.email')}
                </Label>
                <Input
                  id="recover-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="recover-code" className="text-kr-secondary">
                  {t('login.backup.label')}
                </Label>
                <Input
                  id="recover-code"
                  value={recoverCode}
                  onChange={(e) => setRecoverCode(e.target.value)}
                  placeholder="xxxx-xxxx-xxxx"
                  autoComplete="one-time-code"
                  autoCapitalize="none"
                  required
                />
              </div>

              <Button type="submit" className="w-full" disabled={recoverBusy}>
                {recoverBusy ? t('login.verifying') : t('login.recover.submit')}
              </Button>

              {recoverError && (
                <p role="alert" className="text-[13px] text-danger">
                  {recoverError}
                </p>
              )}

              {/* Sin códigos guardados, el camino NO está en esta pantalla. Decirlo
                  es la diferencia entre un callejón y una instrucción. */}
              <div className="rounded-lg border border-kr bg-kr-elevated p-3">
                <p className="text-kr-sm font-medium text-kr-primary">
                  {t('login.recover.noCodes')}
                </p>
                <p className="mt-1 text-kr-xs text-kr-secondary">{t('login.recover.noCodesHelp')}</p>
              </div>

              <button
                type="button"
                onClick={() => setStage('form')}
                className="text-kr-xs text-kr-link underline hover:text-kr-primary"
              >
                {t('login.recover.back')}
              </button>
            </form>
          )}

          {lastSession && (
            <div className="mt-8 flex items-center justify-between border-t border-kr pt-4 text-kr-xs text-kr-muted">
              <span className="flex items-center gap-1.5">
                <Clock size={13} />
                {t('login.lastAccess')}: {formatRelative(new Date(lastSession.timestamp))}
              </span>
              {lastSession.ip && <span>{lastSession.ip}</span>}
            </div>
          )}
        </div>
      </div>

      {/* ── Escenario de marca ──────────────────────────────────────────── */}
      <BrandStage tagline={t('login.tagline')} />
    </div>
  );
}

/**
 * Mitad derecha: marca grande sobre el fondo generativo, con un paralaje suave
 * ligado al puntero. Se oculta por debajo de `lg` — en un móvil el formulario ya
 * ocupa la pantalla entera y apilar debajo un escenario decorativo solo obligaría
 * a hacer scroll para no ver nada nuevo.
 */
function BrandStage({ tagline }: { tagline: string }) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const markRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const stage = stageRef.current;
    const mark = markRef.current;
    if (!stage || !mark) return;
    if (prefersReducedMotion()) return;

    const onMove = (e: PointerEvent) => {
      const r = stage.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      mark.style.transform = `perspective(900px) rotateY(${x * 10}deg) rotateX(${-y * 10}deg)`;
    };
    const onLeave = () => {
      mark.style.transform = '';
    };
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerleave', onLeave);
    return () => {
      stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return (
    <div
      ref={stageRef}
      aria-hidden="true"
      className="relative hidden overflow-hidden bg-kr-base lg:grid lg:place-items-center"
    >
      <NetworkCanvas variant="grid" />
      <div className="relative z-10 flex flex-col items-center gap-6 px-8 text-center">
        <div
          ref={markRef}
          className="relative transition-transform duration-300 ease-out"
          style={{ transformStyle: 'preserve-3d' }}
        >
          <span className="absolute -inset-12 rounded-full bg-kr-accent-faint blur-3xl" />
          <LogoMark className="relative h-32 w-32 text-kr-accent" draw />
        </div>
        <p className="text-kr-sm tracking-[0.2em] text-kr-muted">{tagline}</p>
      </div>
    </div>
  );
}
