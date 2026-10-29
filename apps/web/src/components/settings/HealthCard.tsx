import type { MetricsSnapshot } from '@krakenos/types';
import { Activity, AlertTriangle } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StaleBadge } from '@/components/ui/stale-badge';
import { api } from '@/lib/api';
import { formatFixed, formatNumber } from '@/lib/format';
import { plural, useT } from '@/lib/i18n';
import { usePolling } from '@/lib/use-polling';
import '@/lib/i18n/catalog/fragments/ajustes';

/**
 * Panel de salud y observabilidad (US-191). Muestra métricas internas del agente
 * (memoria, latencia y tasa de error HTTP, retraso del event loop, clientes en
 * tiempo real y latencia por manager). Lectura autenticada; se refresca cada 5 s
 * mientras está montado. `/health` público sigue mínimo — esto vive tras la sesión.
 */
export function HealthCard() {
  const t = useT();
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const [failed, setFailed] = useState(false);

  // Refresca en vivo mientras el panel está montado (US-191). US-262: iba con un
  // `setInterval` a pelo, así que sondeaba también con la pestaña oculta.
  const load = useCallback(
    () =>
      api
        .get<MetricsSnapshot>('/system/metrics')
        .then((m) => {
          // Guarda contra una respuesta malformada: solo pintamos si trae la forma.
          if (m && typeof m === 'object' && 'memory' in m && 'http' in m) {
            setMetrics(m);
            setFailed(false);
          }
        })
        .catch(() => setFailed(true)),
    [],
  );
  usePolling(load, 5000);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-kr-accent" aria-hidden />
          {t('settings.health.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!metrics ? (
          failed ? (
            <p role="alert" className="text-kr-sm text-danger">
              {t('settings.health.error')}
            </p>
          ) : (
            <p className="text-kr-sm text-kr-muted">{t('settings.health.loading')}</p>
          )
        ) : (
          <>
            {failed && <StaleBadge />}
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Metric
                label={t('settings.health.uptime')}
                value={formatUptime(metrics.uptimeSeconds)}
              />
              {/* Dato principal: la memoria residente (RSS), lo que el aparato gasta de
                  verdad. El heap de V8 es otra cosa (parte de esa memoria) y va aparte,
                  rotulado: «232 / 112 MB» se leía como usado/total con el usado mayor. */}
              <Metric
                label={t('settings.health.memory')}
                value={formatMb(metrics.memory.rssBytes)}
              />
              <Metric
                label={t('settings.health.heap')}
                value={`${formatMb(metrics.memory.heapUsedBytes, false)} / ${formatMb(metrics.memory.heapTotalBytes)}`}
              />
              <Metric label={t('settings.health.requests')} value={String(metrics.http.total)} />
              <Metric
                label={t('settings.health.errorRate')}
                value={`${formatFixed(metrics.http.errorRate * 100, 1)}%`}
                danger={metrics.http.errorRate > 0.05}
              />
              <Metric
                label={t('settings.health.latency')}
                value={`${Math.round(metrics.http.avgLatencyMs)} / ${Math.round(metrics.http.p95LatencyMs)} ms`}
              />
              <Metric label={t('settings.health.inFlight')} value={String(metrics.http.inFlight)} />
              <Metric
                label={t('settings.health.loopLag')}
                value={`${Math.round(metrics.eventLoop.lagMs)} ms`}
                danger={metrics.eventLoop.maxLagMs > 200}
              />
              <Metric
                label={t('settings.health.wsClients')}
                value={String(metrics.websocketClients)}
              />
              {/* Disco y base (US-233): quedarse sin espacio es el fallo más
                  probable de un aparato sobre tarjeta SD, y no se veía en ningún sitio. */}
              <Metric
                label={t('settings.health.disk')}
                value={formatDisk(metrics.storage, (free, pct) =>
                  t('settings.health.diskValue', { free, pct }),
                )}
                danger={(metrics.storage?.diskUsedPercent ?? 0) >= 90}
              />
              <Metric
                label={t('settings.health.dbSize')}
                value={formatBytes(metrics.storage?.dbBytes ?? null)}
              />
            </dl>

            <div>
              <h4 className="mb-1 text-kr-xs font-medium uppercase tracking-wide text-kr-muted">
                {t('settings.health.managers')}
              </h4>
              {metrics.managers.length === 0 ? (
                <p className="text-kr-sm text-kr-muted">{t('settings.health.noManagers')}</p>
              ) : (
                <ul className="space-y-1">
                  {metrics.managers.map((m) => (
                    <li key={m.name} className="flex items-center justify-between text-kr-sm">
                      <span className="font-mono text-kr-secondary">{m.name}</span>
                      <span className="text-kr-primary">
                        {Math.round(m.avgLatencyMs)} ms
                        <span className="ml-2 text-kr-xs text-kr-muted">
                          {plural(m.count, {
                            one: t('settings.health.opsCount.one', { count: m.count }),
                            other: t('settings.health.opsCount.other', { count: m.count }),
                          })}
                          {m.errors > 0 && (
                            <>
                              {' · '}
                              {plural(m.errors, {
                                one: t('settings.health.errors.one', { count: m.errors }),
                                other: t('settings.health.errors.other', { count: m.errors }),
                              })}
                            </>
                          )}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  const t = useT();
  return (
    <div>
      <dt className="text-kr-xs text-kr-muted">{label}</dt>
      <dd className={danger ? 'font-medium text-warning' : 'font-medium text-kr-primary'}>
        {danger && (
          <>
            <AlertTriangle className="mr-1 inline h-3.5 w-3.5 align-text-bottom" aria-hidden />
            <span className="sr-only">{t('settings.health.attention')} </span>
          </>
        )}
        {value}
      </dd>
    </div>
  );
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}

/** Megabytes enteros; `unit` = false para encadenar dos cifras bajo una sola unidad. */
function formatMb(bytes: number, unit = true): string {
  const mb = formatNumber(Math.round(bytes / (1024 * 1024)));
  return unit ? `${mb} MB` : mb;
}

/** Bytes legibles; `null` = el sistema no permitió medirlo (US-233). */
function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes >= 1024 ** 3) return `${formatFixed(bytes / 1024 ** 3, 1)} GB`;
  return `${formatNumber(Math.round(bytes / 1024 ** 2))} MB`;
}

/**
 * «12 GB · 68% usado» o «—» si no se pudo medir. Los GB son los LIBRES (el rótulo
 * de la métrica es «Disco libre») y el porcentaje es el USADO (`diskUsedPercent`):
 * sin decirlo, «937,9 GB · 7%» no aclara de cuál de los dos habla el 7. Tolera
 * que falte el bloque entero: un agente anterior a US-233 no lo manda y la
 * tarjeta no debe romperse.
 */
function formatDisk(
  storage: MetricsSnapshot['storage'] | undefined,
  withPercent: (free: string, pct: number) => string,
): string {
  if (!storage || storage.diskFreeBytes === null) return '—';
  const free = formatBytes(storage.diskFreeBytes);
  return storage.diskUsedPercent === null ? free : withPercent(free, storage.diskUsedPercent);
}
