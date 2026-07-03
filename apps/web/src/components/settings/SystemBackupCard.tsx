import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { downloadBackup, restoreBackup } from '@/lib/system-backup';
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
            <Label htmlFor="bk-pass">Contraseña del backup</Label>
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
              <Label htmlFor="bk-rpass">Contraseña del backup</Label>
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
      </CardContent>
    </Card>
  );
}
