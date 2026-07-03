import type { LoginResponse, SetupInitRequest, SetupStatus } from '@krakenos/types';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthBackdrop } from '@/components/ui/auth-backdrop';
import { Button } from '@/components/ui/button';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LogoMark } from '@/components/ui/logo';
import { ApiRequestError, api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

export function SetupPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);

  const [homeName, setHomeName] = useState('Mi hogar');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [token, setToken] = useState('');
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
      setError('Las contraseñas no coinciden');
      return;
    }
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres');
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
      const msg =
        err instanceof ApiRequestError ? err.body.message : 'No se pudo completar la configuración';
      setError(msg);
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
            <h1 className="text-2xl font-semibold text-kr-primary">Bienvenido a KrakenOS</h1>
            <p className="text-sm text-kr-secondary">Configura tu administrador para empezar.</p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="homeName">Nombre del hogar</Label>
          <Input id="homeName" value={homeName} onChange={(e) => setHomeName(e.target.value)} required maxLength={64} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="displayName">Tu nombre</Label>
          <Input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={80} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Contraseña</Label>
          <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">Confirmar contraseña</Label>
          <Input id="confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} />
        </div>

        {requiresToken && (
          <div className="space-y-2">
            <Label htmlFor="setupToken">Token de configuración</Label>
            <Input
              id="setupToken"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
              autoComplete="off"
            />
            <p className="text-xs text-kr-muted">
              Lo imprimió el agente en su log al arrancar (busca «Token de configuración»).
            </p>
          </div>
        )}

        {error && <ErrorBanner>{error}</ErrorBanner>}

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? 'Configurando…' : 'Crear administrador'}
        </Button>
      </form>
    </div>
  );
}
