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
import { useAuthStore } from '@/store/auth.store';
import '@/lib/i18n/catalog/fragments/trafico';

/**
 * Bienestar digital (US-184): uso de internet por persona. El servidor filtra por
 * rol (un admin ve el hogar; el resto solo lo suyo), así que aquí solo se pinta
 * lo recibido. Se muestra junto al tráfico de red (misma naturaleza que US-46).
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
  // US-263/US-251: sin desglose por dispositivo esto está vacío SIEMPRE. Se asume
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
        <div className="flex gap-1" role="group" aria-label={t('wellbeing.rangeLabel')}>
          {WELLBEING_RANGES.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => setRange(r.value)}
              aria-pressed={range === r.value}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors min-h-11 min-w-11 md:min-h-0 md:min-w-0 ${
                range === r.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">{t('wellbeing.subtitle')}</p>
        {people !== null && lectura.failed && <StaleBadge className="mb-2" />}
        {people === null && lectura.failed ? (
          <WidgetError message={t('wellbeing.loadError')} onRetry={lectura.reintentar} />
        ) : people === null ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t('wellbeing.loading')}</p>
        ) : people.length === 0 ? (
          /* Tres motivos MUY distintos para no ver nada, y hasta US-263 los tres
             decían «asigna un dueño a los dispositivos» — mandando al usuario a
             configurar algo que no arreglaba nada. */
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
                <div className="h-2 overflow-hidden rounded-full bg-muted">
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
