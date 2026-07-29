import type { AutoBackupStatus } from '@krakenos/types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

/**
 * Copia de seguridad real (US-103) — reemplaza el falso "backup" que solo exportaba
 * ajustes. Descarga un archivo cifrado con la base de datos, las claves y los datos
 * de integraciones. Admin-only (contiene secretos).
 */
export function SystemBackupCard() {
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
      toast.success(`Restauración preparada (${staged} ficheros). Reinicia el agente para aplicarla.`);
      setRestoreFile(null);
      setRestorePass('');
      if (fileInput.current) fileInput.current.value = '';
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo restaurar');
    } finally {
      setRestoreBusy(false);
    }
  };

  const run = async () => {
    if (pass !== confirm) {
      toast.error('Las contraseñas no coinciden');
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
      toast.success('Copia de seguridad descargada');
      setPass('');
      setConfirm('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo generar la copia');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Copia de seguridad</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-kr-sm text-kr-secondary">
          Descarga un archivo <strong>cifrado</strong> con todo lo importante: la base de datos,
          las claves y los datos de tus integraciones. Guárdalo en un lugar seguro — necesitarás
          esta contraseña para restaurarlo, y sin ella el archivo es irrecuperable.
        </p>
        <div className="grid max-w-lg gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="bk-pass">Contraseña de la copia</Label>
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
            <Label htmlFor="bk-confirm">Confirmar</Label>
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
          {busy ? 'Generando…' : 'Descargar copia de seguridad'}
        </Button>

        {/* Restaurar (US-104) */}
        <div className="space-y-3 border-t border-kr pt-4">
          <div>
            <h4 className="text-kr-base font-medium text-kr-primary">Restaurar</h4>
            <p className="text-kr-sm text-kr-secondary">
              Sube un archivo de copia y su contraseña. Se valida y se prepara; se aplica al{' '}
              <strong>reiniciar</strong> el agente (se respalda lo actual por si acaso).
            </p>
          </div>
          <div className="grid max-w-lg gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="bk-file">Archivo de copia</Label>
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
              <Label htmlFor="bk-rpass">Contraseña de la copia</Label>
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
            {restoreBusy ? 'Preparando…' : 'Restaurar copia'}
          </Button>
          <Callout variant="warning" title="Ojo">
            Restaurar sustituye la base de datos, las claves y los datos actuales por los de la
            copia. Reinicia el agente para completar el proceso.
          </Callout>
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
      toast.error(err instanceof Error ? err.message : 'No se pudo guardar el ajuste');
    }
  };

  const withBusy = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo completar la operación');
    } finally {
      setBusy(false);
    }
  };

  if (!status) return null;

  return (
    <div className="space-y-3 border-t border-kr pt-4">
      <div>
        <h4 className="text-kr-base font-medium text-kr-primary">Copias automáticas</h4>
        <p className="text-kr-sm text-kr-secondary">
          KrakenOS puede guardar una copia cifrada en <code>data/backups/</code> cada día o cada
          semana, a las 03:00. Necesita una contraseña propia (nadie va a teclearla de madrugada).
        </p>
      </div>

      <div className="grid max-w-lg gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="bk-auto-freq">Frecuencia</Label>
          <select
            id="bk-auto-freq"
            className="h-9 w-full rounded-md border border-kr bg-kr-elevated px-2 text-kr-sm text-kr-primary"
            value={status.frequency}
            onChange={(e) => void patchSetting('autoBackupFrequency', e.target.value)}
          >
            <option value="off">Desactivadas</option>
            <option value="daily">Cada día</option>
            <option value="weekly">Cada semana</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bk-auto-keep">Copias que se conservan</Label>
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
              toast.success('Contraseña generada');
            })
          }
        >
          {status.passphraseSet ? 'Generar otra contraseña' : 'Generar contraseña'}
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
            Ver contraseña
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
              else toast.success('Copia creada');
            })
          }
        >
          {busy ? 'Copiando…' : 'Copiar ahora'}
        </Button>
      </div>

      {pass && (
        <Callout variant="warning" title="Guarda esta contraseña fuera del servidor">
          <code className="break-all font-mono text-kr-sm">{pass}</code>
          <p className="mt-1">
            Sin ella, las copias automáticas no se pueden restaurar. Y de nada sirve guardarla en el
            mismo aparato que quieres poder recuperar: llévate también las copias a otro sitio.
          </p>
        </Callout>
      )}

      <p className="text-kr-sm text-kr-secondary">
        {status.count === 0
          ? 'Todavía no hay ninguna copia automática.'
          : `${status.count} ${status.count === 1 ? 'copia' : 'copias'} en disco · ${formatBytes(status.totalBytes)} · última: ${
              status.lastBackupAt ? new Date(status.lastBackupAt).toLocaleString() : '—'
            }`}
      </p>

      {status.stale && (
        <Callout variant="warning" title="No hay una copia reciente">
          Las copias automáticas están activadas, pero la última es demasiado antigua (o no hay
          ninguna). Revisa que haya contraseña configurada y espacio en disco.
        </Callout>
      )}
      {status.lastError && (
        <Callout variant="danger" title="La última copia automática falló">
          {status.lastError}
        </Callout>
      )}
    </div>
  );
}
