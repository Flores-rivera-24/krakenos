import type { PerDeviceTrafficCapability, WellbeingRange } from '@krakenos/types';
import { useState } from 'react';
import { PerDeviceTrafficNotice } from '@/components/traffic/PerDeviceTrafficNotice';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StaleBadge } from '@/components/ui/stale-badge';
import { WidgetError } from '@/components/ui/widget-error';
import { formatBytes } from '@/lib/format';
import { plural, useT } from '@/lib/i18n';
import { useLectura } from '@/lib/use-lectura';
import { WELLBEING_RANGES, fetchWellbeingUsage } from '@/lib/wellbeing';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { useAuthStore } from '@/store/auth.store';
import '@/lib/i18n/catalog/fragments/trafico';

/**
 * Bienestar digital: uso de internet por persona. El servidor filtra por rol
 * (un admin ve el hogar; el resto solo lo suyo), así que aquí solo se pinta lo recibido.
 */
export function WellbeingCard() {
  const t = useT();
  // Asignar dueños es cosa de admin: a los demás roles no se les manda a hacerlo.
  // Con el rol aún sin cargar se asume admin (mismo criterio que la nav).
  const notAdmin = useAuthStore((s) => s.user != null && s.user.role !== 'admin');
  const [range, setRange] = useState<WellbeingRange>('week');
  // Una respuesta sin `people` es un fallo, no «sin datos»; y un fallo nunca cae a «asigna un dueño».
  const lectura = useLectura(async () => {
    const u = await fetchWellbeingUsage(range);
    if (!Array.isArray(u?.people)) throw new Error('RESPUESTA_SIN_PERSONAS');
    return u;
  }, [range]);
  const people = lectura.data?.people ?? null;
  // Sin desglose por dispositivo esto está vacío SIEMPRE. Se asume
  // disponible hasta saber lo contrario, para no acusar al router mientras carga.
  const perDevice: PerDeviceTrafficCapability = lectura.data?.perDeviceTraffic ?? {
    status: 'supported',
  };
  const withOwner = lectura.data?.devicesWithOwner ?? 0;

  const max = people && people.length > 0 ? Math.max(...people.map((p) => p.totalBytes), 1) : 1;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>{t('wellbeing.title')}</CardTitle>
        <SegmentedControl
          options={WELLBEING_RANGES}
          value={range}
          onChange={setRange}
          aria-label={t('wellbeing.rangeLabel')}
        />
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">{t('wellbeing.subtitle')}</p>
        {people !== null && lectura.failed && <StaleBadge className="mb-2" />}
        {people === null && lectura.failed ? (
          <WidgetError message={t('wellbeing.loadError')} onRetry={lectura.reintentar} />
        ) : people === null ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t('wellbeing.loading')}</p>
        ) : people.length === 0 ? (
          /* Tres motivos distintos para no ver nada; solo el último (`withOwner === 0`) se arregla asignando dueños. */
          perDevice.status !== 'supported' ? (
            <PerDeviceTrafficNotice
              capability={perDevice}
              unsupportedTitle={t('wellbeing.unsupported')}
              unsupportedDesc={t('wellbeing.unsupportedDesc')}
            />
          ) : withOwner === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t(notAdmin ? 'wellbeing.noOwnedDevices' : 'wellbeing.noOwners')}
            </p>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">{t('wellbeing.empty')}</p>
          )
        ) : (
          <ul className="space-y-3">
            {people.map((p) => (
              <li key={p.userId ?? 'unassigned'} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-foreground">
                    {p.userId === null
                      ? t('wellbeing.unassigned')
                      : (p.name ?? t('wellbeing.unknown'))}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {plural(p.deviceCount, {
                        one: t('wellbeing.devices.one', { n: p.deviceCount }),
                        other: t('wellbeing.devices.other', { n: p.deviceCount }),
                      })}
                    </span>
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {formatBytes(p.totalBytes)}
                  </span>
                </div>
                <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.max(2, (p.totalBytes / max) * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
