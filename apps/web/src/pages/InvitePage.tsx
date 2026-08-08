import type { InvitationPreview } from '@krakenos/types';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LogoMark } from '@/components/ui/logo';
import { NetworkCanvas } from '@/components/ui/network-canvas';
import { Splash } from '@/components/ui/splash';
import { useT } from '@/lib/i18n';
import { acceptInvitation, previewInvitation } from '@/lib/onboarding';
import { ROLE_LABELS } from '@/lib/roles';
import { useAuthStore } from '@/store/auth.store';

/**
 * Aceptar una invitación (US-267). Pública: quien la abre todavía no tiene cuenta.
 *
 * El valor está en lo que **no** hace: no le enseña una contraseña que otro haya
 * elegido por ella. La teclea aquí, no la ve nadie más y no viaja por ningún chat.
 * Antes, dar de alta a alguien de la casa era que el admin escribiera una contraseña
 * y se la mandara por WhatsApp.
 */
export function InvitePage() {
  const t = useT();
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);

  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  // `invalid` distingue «enlace muerto» de «todavía cargando»: sin ese estado, un
  // enlace caducado se queda en un spinner eterno, que no dice nada a nadie.
  const [invalid, setInvalid] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void previewInvitation(token)
      .then((p) => {
        if (!active) return;
        setPreview(p);
        setDisplayName(p.displayName);
      })
      .catch(() => {
        if (active) setInvalid(true);
      });
    return () => {
      active = false;
    };
  }, [token]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError(t('invite.error.mismatch'));
      return;
    }
    if (password.length < 8) {
      setError(t('invite.error.short'));
      return;
    }
    setBusy(true);
    try {
      const session = await acceptInvitation(token, { password, displayName });
      setSession(session as Parameters<typeof setSession>[0]);
      navigate('/', { replace: true });
    } catch {
      // El enlace pudo consumirse o caducar entre que se abrió y se envió.
      setError(t('invite.error.generic'));
    } finally {
      setBusy(false);
    }
  };

  if (invalid) {
    return (
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-kr-base p-4">
        <NetworkCanvas variant="grid" />
        <div className="relative z-10 w-full max-w-md space-y-4 rounded-xl border border-kr bg-kr-surface p-6 text-center">
          <LogoMark className="mx-auto h-10 w-10 text-kr-accent" draw />
          <h1 className="text-kr-xl font-medium text-kr-primary">{t('invite.invalid.title')}</h1>
          <p className="text-kr-sm text-kr-secondary">{t('invite.invalid.body')}</p>
          <Button type="button" variant="outline" className="w-full" onClick={() => navigate('/login')}>
            {t('invite.goToLogin')}
          </Button>
        </div>
      </div>
    );
  }

  if (!preview) return <Splash label={t('invite.checking')} />;

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-kr-base p-4">
      <NetworkCanvas variant="grid" />
      <form
        onSubmit={(e) => void onSubmit(e)}
        className="relative z-10 w-full max-w-md space-y-4 rounded-xl border border-kr bg-kr-surface p-6"
      >
        <div className="flex items-center gap-3">
          <LogoMark className="h-9 w-9 text-kr-accent" draw />
          <div>
            <h1 className="text-kr-xl font-semibold text-kr-primary">
              {t('invite.title', { home: preview.homeName })}
            </h1>
            <p className="text-kr-sm text-kr-secondary">
              {preview.email} · {ROLE_LABELS[preview.role]}
            </p>
          </div>
        </div>

        <p className="text-kr-sm text-kr-secondary">{t('invite.intro')}</p>

        <div className="space-y-2">
          <Label htmlFor="invite-name">{t('invite.displayName')}</Label>
          <Input
            id="invite-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            maxLength={80}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="invite-password">{t('invite.password')}</Label>
          <Input
            id="invite-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
            minLength={8}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="invite-confirm">{t('invite.confirm')}</Label>
          <Input
            id="invite-confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
            minLength={8}
          />
        </div>

        {error && <ErrorBanner>{error}</ErrorBanner>}

        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? t('invite.submitting') : t('invite.submit')}
        </Button>
      </form>
    </div>
  );
}
