import type { AutoBackupStatus } from '@krakenos/types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RichText } from '@/components/ui/rich-text';
import { api } from '@/lib/api';
import {
  downloadBackup,
  getAutoBackupStatus,
  restoreBackup,
  revealAutoBackupPassphrase,
  runAutoBackup,
  setAutoBackupPassphrase,
} from '@/lib/system-backup';
import { toast } from '@/store/toast.store';
import { plural, useT } from '@/lib/i18n';

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
  // US-235: confirmación escrita para la acción más destructiva de la app.
  const [restoreConfirm, setRestoreConfirm] = useState('');
  const [restoreBusy, setRestoreBusy] = useState(false);

  const runRestore = async () => {
    if (!restoreFile) return;
    setRestoreBusy(true);
    try {
      const { staged } = await restoreBackup(restoreFile, restorePass);
      toast.success(t('backup.restorePrepared', { staged }));
      setRestoreFile(null);
      setRestorePass('');
      if (fileInput.current) fileInput.current.value = '';
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('backup.restoreError'));
    } finally {
      setRestoreBusy(false);
    }
  };

  const run = async () => {
    if (pass !== confirm) {
      toast.error(t('backup.passMismatch'));
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
      toast.success(t('backup.downloaded'));
      setPass('');
      setConfirm('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('backup.generateError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('backup.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-kr-sm text-kr-secondary">
          {t('backup.intro')}
        </p>
        <div className="grid max-w-lg gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="bk-pass">{t('backup.pass')}</Label>
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
            <Label htmlFor="bk-confirm">{t('backup.confirm')}</Label>
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
          {busy ? t('backup.generating') : t('backup.download')}
        </Button>

        {/* Restaurar (US-104) */}
        <div className="space-y-3 border-t border-kr pt-4">
          <div>
            <h4 className="text-kr-base font-medium text-kr-primary">{t('backup.restore')}</h4>
            <p className="text-kr-sm text-kr-secondary">
              <RichText>{t('backup.restoreHint')}</RichText>
            </p>
          </div>
          <div className="grid max-w-lg gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="bk-file">{t('backup.file')}</Label>
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
              <Label htmlFor="bk-rpass">{t('backup.pass')}</Label>
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
          {/* US-235 (AUD3-29): el aviso va ENCIMA del botón, no debajo. Es la acción
              más destructiva de la app —sustituye base, claves y datos— y estaba a
              un clic, con botón `outline` (el mismo que «Descargar copia») y el
              aviso donde nadie lo lee: después de haber pulsado. */}
          <Callout variant="danger" standing title={t('backup.replaceTitle')}>
            {t('backup.replaceBody')}
          </Callout>
          <div className="space-y-1.5">
            <Label htmlFor="bk-confirm">
              {t('backup.typeToConfirm')} <strong>{t('backup.confirmWord')}</strong>
            </Label>
            <Input
              id="bk-confirm"
              value={restoreConfirm}
              onChange={(e) => setRestoreConfirm(e.target.value)}
              autoComplete="off"
              className="max-w-xs"
            />
          </div>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => void runRestore()}
            disabled={
              restoreBusy ||
              !restoreFile ||
              restorePass.length < 12 ||
              restoreConfirm.trim().toUpperCase() !== t('backup.confirmWord').toUpperCase()
            }
          >
            {restoreBusy ? t('backup.preparing') : t('backup.restoreAction')}
          </Button>
        </div>

        <AutoBackupSection />
      </CardContent>
    </Card>
  );
}

/** Formatea bytes para la UI (sin decimales de más). */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Copias automáticas (US-233). El aparato vive sobre una tarjeta SD: la copia
 * manual solo salva a quien se acuerda de pulsarla. Aquí se programa, se ve cuándo
 * fue la última y se avisa si no hay ninguna reciente.
 */
function AutoBackupSection() {
  const t = useT();
  const [status, setStatus] = useState<AutoBackupStatus | null>(null);
  const [pass, setPass] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await getAutoBackupStatus());
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patchSetting = async (key: string, value: string) => {
    try {
      await api.patch('/system/settings', { key, value });
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('backup.settingError'));
    }
  };

  const withBusy = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('backup.opError'));
    } finally {
      setBusy(false);
    }
  };

  if (!status) return null;

  return (
    <div className="space-y-3 border-t border-kr pt-4">
      <div>
        <h4 className="text-kr-base font-medium text-kr-primary">{t('backup.auto.title')}</h4>
        <p className="text-kr-sm text-kr-secondary">
          <RichText>{t('backup.auto.hint')}</RichText>
        </p>
      </div>

      <div className="grid max-w-lg gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="bk-auto-freq">{t('backup.auto.freq')}</Label>
          <select
            id="bk-auto-freq"
            className="h-9 w-full rounded-md border border-kr bg-kr-elevated px-2 text-kr-sm text-kr-primary"
            value={status.frequency}
            onChange={(e) => void patchSetting('autoBackupFrequency', e.target.value)}
          >
            <option value="off">{t('backup.auto.off')}</option>
            <option value="daily">{t('backup.auto.daily')}</option>
            <option value="weekly">{t('backup.auto.weekly')}</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bk-auto-keep">{t('backup.auto.keep')}</Label>
          <Input
            id="bk-auto-keep"
            type="number"
            min={1}
            max={60}
            defaultValue={status.retention}
            onBlur={(e) => void patchSetting('autoBackupRetention', e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void withBusy(async () => {
              const res = await setAutoBackupPassphrase();
              setPass(res.generated);
              await load();
              toast.success(t('backup.auto.passGenerated'));
            })
          }
        >
          {status.passphraseSet ? t('backup.auto.passRegen') : t('backup.auto.passGen')}
        </Button>
        {status.passphraseSet && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void withBusy(async () => {
                const res = await revealAutoBackupPassphrase();
                setPass(res.passphrase);
              })
            }
          >
            {t('backup.auto.reveal')}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !status.passphraseSet}
          onClick={() =>
            void withBusy(async () => {
              const next = await runAutoBackup();
              setStatus(next);
              if (next.lastError) toast.error(next.lastError);
              else toast.success(t('backup.auto.created'));
            })
          }
        >
          {busy ? t('backup.auto.running') : t('backup.auto.runNow')}
        </Button>
      </div>

      {pass && (
        <Callout variant="warning" title={t('backup.auto.keepPassTitle')}>
          <code className="break-all font-mono text-kr-sm">{pass}</code>
          <p className="mt-1">
            {t('backup.auto.keepPassBody')}
          </p>
        </Callout>
      )}

      <p className="text-kr-sm text-kr-secondary">
        {status.count === 0
          ? t('backup.auto.none')
          : t('backup.auto.summary', {
              n: status.count,
              unidad: plural(status.count, {
                one: t('backup.auto.copy'),
                other: t('backup.auto.copies'),
              }),
              size: formatBytes(status.totalBytes),
              last: status.lastBackupAt ? new Date(status.lastBackupAt).toLocaleString() : '—',
            })}
      </p>

      {status.stale && (
        <Callout variant="warning" title={t('backup.auto.staleTitle')}>
          {t('backup.auto.staleBody')}
        </Callout>
      )}
      {status.lastError && (
        <Callout variant="danger" title={t('backup.auto.failedTitle')}>
          {status.lastError}
        </Callout>
      )}
    </div>
  );
}
