import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useT } from '@/lib/i18n';
import { downloadBackup, restoreBackup } from '@/lib/system-backup';
import { toast } from '@/store/toast.store';

/**
 * Copia de seguridad real (US-103) — reemplaza el falso "backup" que solo exportaba
 * ajustes. Descarga un archivo cifrado con la base de datos, las claves y los datos
 * de integraciones. Admin-only (contiene secretos).
 */
export function SystemBackupCard() {
  const t = useT();
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restorePass, setRestorePass] = useState('');
  const [restoreBusy, setRestoreBusy] = useState(false);

  const runRestore = async () => {
    if (!restoreFile) return;
    setRestoreBusy(true);
    try {
      const { staged } = await restoreBackup(restoreFile, restorePass);
      toast.success(t('settings.backup.restorePrepared', { staged }));
      setRestoreFile(null);
      setRestorePass('');
      if (fileInput.current) fileInput.current.value = '';
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.backup.restoreError'));
    } finally {
      setRestoreBusy(false);
    }
  };

  const run = async () => {
    if (pass !== confirm) {
      toast.error(t('settings.backup.passwordMismatch'));
      return;
    }
    setBusy(true);
    try {
      const blob = await downloadBackup(pass);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `krakenos-backup-${new Date().toISOString().slice(0, 10)}.kbk`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t('settings.backup.downloaded'));
      setPass('');
      setConfirm('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings.backup.downloadError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.backup.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-kr-sm text-kr-secondary">
          {t('settings.backup.descPrefix')} <strong>{t('settings.backup.descEncrypted')}</strong>{' '}
          {t('settings.backup.descSuffix')}
        </p>
        <div className="grid max-w-lg gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="bk-pass">{t('settings.backup.passwordLabel')}</Label>
            <Input
              id="bk-pass"
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              minLength={12}
              maxLength={256}
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bk-confirm">{t('settings.backup.confirmLabel')}</Label>
            <Input
              id="bk-confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              minLength={12}
              maxLength={256}
              autoComplete="new-password"
            />
          </div>
        </div>
        <Button size="sm" onClick={() => void run()} disabled={busy || pass.length < 12}>
          {busy ? t('settings.backup.generating') : t('settings.backup.download')}
        </Button>

        {/* Restaurar (US-104) */}
        <div className="space-y-3 border-t border-kr pt-4">
          <div>
            <h4 className="text-kr-base font-medium text-kr-primary">
              {t('settings.backup.restoreTitle')}
            </h4>
            <p className="text-kr-sm text-kr-secondary">
              {t('settings.backup.restoreDescPrefix')}{' '}
              <strong>{t('settings.backup.restoreDescRestart')}</strong>{' '}
              {t('settings.backup.restoreDescSuffix')}
            </p>
          </div>
          <div className="grid max-w-lg gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="bk-file">{t('settings.backup.fileLabel')}</Label>
              <input
                ref={fileInput}
                id="bk-file"
                type="file"
                accept=".kbk,application/octet-stream"
                onChange={(e) => setRestoreFile(e.target.files?.[0] ?? null)}
                className="block w-full text-kr-sm text-kr-secondary file:mr-3 file:rounded-md file:border file:border-kr file:bg-kr-elevated file:px-3 file:py-1.5 file:text-kr-primary"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bk-rpass">{t('settings.backup.passwordLabel')}</Label>
              <Input
                id="bk-rpass"
                type="password"
                value={restorePass}
                onChange={(e) => setRestorePass(e.target.value)}
                minLength={12}
                maxLength={256}
                autoComplete="off"
              />
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void runRestore()}
            disabled={restoreBusy || !restoreFile || restorePass.length < 12}
          >
            {restoreBusy ? t('settings.backup.preparing') : t('settings.backup.restore')}
          </Button>
          <Callout variant="warning" title={t('settings.backup.warningTitle')}>
            {t('settings.backup.warningBody')}
          </Callout>
        </div>
      </CardContent>
    </Card>
  );
}
