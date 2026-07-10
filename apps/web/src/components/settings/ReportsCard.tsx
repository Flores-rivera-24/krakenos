import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useT, type TranslationKey } from '@/lib/i18n';
import { downloadReport } from '@/lib/reports';
import { toast } from '@/store/toast.store';

const REPORTS: { path: string; file: string; labelKey: TranslationKey }[] = [
  { path: '/reports/devices.csv', file: 'krakenos-dispositivos.csv', labelKey: 'settings.reports.devices' },
  {
    path: '/reports/traffic.csv?range=week',
    file: 'krakenos-trafico.csv',
    labelKey: 'settings.reports.trafficWeek',
  },
  { path: '/reports/audit.csv', file: 'krakenos-auditoria.csv', labelKey: 'settings.reports.audit' },
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
      toast.error(t('settings.reports.error'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.reports.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-kr-sm text-kr-secondary">{t('settings.reports.desc')}</p>
        <div className="flex flex-wrap gap-2">
          {REPORTS.map((r) => (
            <Button
              key={r.path}
              size="sm"
              variant="outline"
              disabled={busy === r.path}
              onClick={() => void run(r)}
            >
              {busy === r.path ? t('settings.reports.generating') : t(r.labelKey)}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
