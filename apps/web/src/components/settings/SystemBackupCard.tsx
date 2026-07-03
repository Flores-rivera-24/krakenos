import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { downloadBackup } from '@/lib/system-backup';
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
              minLength={8}
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
              minLength={8}
              maxLength={256}
              autoComplete="new-password"
            />
          </div>
        </div>
        <Button size="sm" onClick={() => void run()} disabled={busy || pass.length < 8}>
          {busy ? 'Generando…' : 'Descargar copia de seguridad'}
        </Button>
        <Callout variant="info" title="Restaurar">
          Para restaurar, coloca este archivo en la instalación nueva y aplica la restauración al
          desplegar. La restauración desde la propia app llegará en una próxima versión.
        </Callout>
      </CardContent>
    </Card>
  );
}
