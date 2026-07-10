import type { LoginResponse, SetupInitRequest, SetupStatus } from '@krakenos/types';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthBackdrop } from '@/components/ui/auth-backdrop';
import { Button } from '@/components/ui/button';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LogoMark } from '@/components/ui/logo';
import { api } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { t as translate, useT } from '@/lib/i18n';
import { useAuthStore } from '@/store/auth.store';

export function SetupPage() {
  const t = useT();
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);

  const [homeName, setHomeName] = useState(() => translate('setup.defaultHomeName'));
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  // Prefill del token desde `?token=` (US-105): al escanear el QR de arranque, el
  // usuario llega con el token ya puesto y solo rellena nombre/email/contraseña.
  const [token, setToken] = useState(
    () => new URLSearchParams(window.location.search).get('token') ?? '',
  );
  const [requiresToken, setRequiresToken] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Si el sistema ya está configurado, no tiene sentido el wizard.
  useEffect(() => {
    let active = true;
    void api
      .get<SetupStatus>('/setup/status')
      .then((s) => {
        if (!active) return;
        if (!s.needsSetup) navigate('/login', { replace: true });
        else setRequiresToken(s.requiresToken);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [navigate]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError(t('setup.error.mismatch'));
      return;
    }
    if (password.length < 8) {
      setError(t('setup.error.short'));
      return;
    }
    setLoading(true);
    const body: SetupInitRequest = {
      homeName,
      displayName,
      email,
      password,
      ...(requiresToken ? { setupToken: token } : {}),
    };
    try {
      const data = await api.post<LoginResponse>('/setup/init', body, { anonymous: true });
      setSession(data);
      navigate('/', { replace: true });
    } catch (err) {
      setError(describeError(err, t('setup.error.generic')));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-kr-base p-4">
      <AuthBackdrop />
      <form
        onSubmit={onSubmit}
        className="relative z-10 w-full max-w-md space-y-4 rounded-xl border border-kr bg-kr-surface p-6 shadow-kr-glow-sm"
      >
        <div className="flex items-center gap-3">
          <LogoMark className="h-9 w-9 text-kr-accent" />
          <div>
            <h1 className="text-2xl font-semibold text-kr-primary">{t('setup.welcome')}</h1>
            <p className="text-sm text-kr-secondary">{t('setup.subtitle')}</p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="homeName">{t('setup.homeName')}</Label>
          <Input id="homeName" value={homeName} onChange={(e) => setHomeName(e.target.value)} required maxLength={64} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="displayName">{t('setup.displayName')}</Label>
          <Input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={80} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">{t('setup.email')}</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">{t('setup.password')}</Label>
          <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">{t('setup.confirm')}</Label>
          <Input id="confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} />
        </div>

        {requiresToken && (
          <div className="space-y-2">
            <Label htmlFor="setupToken">{t('setup.token')}</Label>
            <Input
              id="setupToken"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
              autoComplete="off"
            />
            <p className="text-xs text-kr-muted">{t('setup.tokenHint')}</p>
          </div>
        )}

        {error && <ErrorBanner>{error}</ErrorBanner>}

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? t('setup.submitting') : t('setup.submit')}
        </Button>
      </form>
    </div>
  );
}
