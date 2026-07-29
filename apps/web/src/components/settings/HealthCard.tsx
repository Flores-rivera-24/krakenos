import type { MetricsSnapshot } from '@krakenos/types';
import { Activity } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';

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

  useEffect(() => {
    let active = true;
    const load = () =>
      api
        .get<MetricsSnapshot>('/system/metrics')
        .then((m) => {
          // Guarda contra una respuesta malformada: solo pintamos si trae la forma.
          if (active && m && typeof m === 'object' && 'memory' in m && 'http' in m) {
            setMetrics(m);
            setFailed(false);
          }
        })
        .catch(() => {
          if (active) setFailed(true);
        });
    void load();
    // Refresca en vivo mientras el panel está montado (US-191).
    const id = setInterval(() => void load(), 5000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

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
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Metric label={t('settings.health.uptime')} value={formatUptime(metrics.uptimeSeconds)} />
              <Metric label={t('settings.health.memory')} value={formatMem(metrics.memory)} />
              <Metric label={t('settings.health.requests')} value={String(metrics.http.total)} />
              <Metric
                label={t('settings.health.errorRate')}
                value={`${(metrics.http.errorRate * 100).toFixed(1)}%`}
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
              <Metric label={t('settings.health.wsClients')} value={String(metrics.websocketClients)} />
              {/* Disco y base (US-233): quedarse sin espacio es el fallo más
                  probable de un aparato sobre tarjeta SD, y no se veía en ningún sitio. */}
              <Metric
                label={t('settings.health.disk')}
                value={formatDisk(metrics.storage)}
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
                          {t('settings.health.opsCount', { count: m.count })}
                          {m.errors > 0 ? ` · ${m.errors} ✕` : ''}
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
  return (
    <div>
      <dt className="text-kr-xs text-kr-muted">{label}</dt>
      <dd className={danger ? 'font-medium text-warning' : 'font-medium text-kr-primary'}>{value}</dd>
    </div>
  );
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}

function formatMem(mem: MetricsSnapshot['memory']): string {
  const mb = (bytes: number) => Math.round(bytes / (1024 * 1024));
  return `${mb(mem.rssBytes)} / ${mb(mem.heapTotalBytes)} MB`;
}

/** Bytes legibles; `null` = el sistema no permitió medirlo (US-233). */
function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

/**
 * «12 GB libres · 68 %» o «—» si no se pudo medir. Tolera que falte el bloque
 * entero: un agente anterior a US-233 no lo manda y la tarjeta no debe romperse.
 */
function formatDisk(storage: MetricsSnapshot['storage'] | undefined): string {
  if (!storage || storage.diskFreeBytes === null) return '—';
  const free = formatBytes(storage.diskFreeBytes);
  return storage.diskUsedPercent === null ? free : `${free} · ${storage.diskUsedPercent}%`;
}
