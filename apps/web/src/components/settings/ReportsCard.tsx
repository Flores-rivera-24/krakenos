import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { downloadReport } from '@/lib/reports';
import { toast } from '@/store/toast.store';

const REPORTS = [
  { path: '/reports/devices.csv', file: 'krakenos-dispositivos.csv', label: 'Dispositivos' },
  { path: '/reports/traffic.csv?range=week', file: 'krakenos-trafico.csv', label: 'Tráfico (semana)' },
  { path: '/reports/audit.csv', file: 'krakenos-auditoria.csv', label: 'Auditoría' },
];

/** Exportación de informes en CSV (US-109) — para una revisión mensual o un auditor. */
export function ReportsCard() {
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (r: (typeof REPORTS)[number]) => {
    setBusy(r.path);
    try {
      await downloadReport(r.path, r.file);
    } catch {
      toast.error('No se pudo generar el informe');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Informes (CSV)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-kr-sm text-kr-secondary">
          Exporta tus datos para una revisión mensual o para un auditor.
        </p>
        <div className="flex flex-wrap gap-2">
          {REPORTS.map((r) => (
            <Button
              key={r.path}
              size="sm"
              variant="outline"
              disabled={busy === r.path}
              onClick={() => void run(r)}
            >
              {busy === r.path ? 'Generando…' : r.label}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
