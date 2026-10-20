import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { downloadReport } from '@/lib/reports';
import { useT, type TranslationKey } from '@/lib/i18n';
import { toast } from '@/store/toast.store';
import '@/lib/i18n/catalog/fragments/ajustes';

const REPORTS: { path: string; file: string; label: TranslationKey }[] = [
  { path: '/reports/devices.csv', file: 'krakenos-dispositivos.csv', label: 'reports.devices' },
  {
    path: '/reports/traffic.csv?range=week',
    file: 'krakenos-trafico.csv',
    label: 'reports.traffic',
  },
  { path: '/reports/audit.csv', file: 'krakenos-auditoria.csv', label: 'reports.audit' },
];

/** Exportación de informes en CSV (US-109) — para una revisión mensual o un auditor. */
export function ReportsCard() {
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (r: (typeof REPORTS)[number]) => {
    setBusy(r.path);
    try {
      await downloadReport(r.path, r.file);
    } catch {
      toast.error(t('reports.generateError'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('reports.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-kr-sm text-kr-secondary">{t('reports.intro')}</p>
        <div className="flex flex-wrap gap-2">
          {REPORTS.map((r) => (
            <Button
              key={r.path}
              size="sm"
              variant="outline"
              disabled={busy === r.path}
              onClick={() => void run(r)}
            >
              {busy === r.path ? t('reports.generating') : t(r.label)}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
