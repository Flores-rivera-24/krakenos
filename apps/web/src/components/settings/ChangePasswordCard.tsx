import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { describeError } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { changeOwnPassword } from '@/lib/users';
import { toast } from '@/store/toast.store';

/** Cambio de la propia contraseña (US-101) — disponible para cualquier usuario. */
export function ChangePasswordCard() {
  const t = useT();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next !== confirm) {
      setError(t('settings.password.mismatch'));
      return;
    }
    setBusy(true);
    try {
      await changeOwnPassword({ currentPassword: current, newPassword: next });
      toast.success(t('settings.password.updated'));
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      setError(describeError(err, t('settings.password.error')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.password.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="max-w-md space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cp-current">{t('settings.password.current')}</Label>
            <Input
              id="cp-current"
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
              minLength={8}
              maxLength={128}
              autoComplete="current-password"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cp-new">{t('settings.password.new')}</Label>
            <Input
              id="cp-new"
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
              minLength={8}
              maxLength={128}
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cp-confirm">{t('settings.password.confirm')}</Label>
            <Input
              id="cp-confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={8}
              maxLength={128}
              autoComplete="new-password"
            />
          </div>
          {error && <p className="text-kr-sm text-danger">{error}</p>}
          <Button type="submit" disabled={busy}>
            {busy ? t('common.saving') : t('settings.password.title')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
