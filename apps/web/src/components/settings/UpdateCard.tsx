import type { UpdateStatus } from '@krakenos/types';
import { ArrowUpCircle, CheckCircle2, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusDot } from '@/components/ui/status-dot';
import { api } from '@/lib/api';

/**
 * Comprobación de actualizaciones (US-116). Muestra la versión actual y, si hay
 * un repo configurado, si existe una release más nueva en GitHub. Opt-in: sin
 * `UPDATE_CHECK_REPO` en el servidor, aparece como desactivada.
 */
export function UpdateCard() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void api
      .get<UpdateStatus>('/system/update-check')
      .then((s) => alive && setStatus(s))
      .catch(() => alive && setStatus(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Actualizaciones</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between text-kr-base">
          <span className="text-kr-secondary">Versión instalada</span>
          <span className="font-mono text-kr-primary">{status?.current ?? '—'}</span>
        </div>

        {loading ? (
          <p className="flex items-center gap-2 text-kr-sm text-kr-muted">
            <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />
            Comprobando…
          </p>
        ) : !status || !status.enabled ? (
          <p className="text-kr-sm text-kr-muted">
            Comprobación de actualizaciones desactivada. Actívala con{' '}
            <code className="font-mono text-kr-secondary">UPDATE_CHECK_REPO</code> en el servidor.
          </p>
        ) : status.updateAvailable ? (
          <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-kr-sm text-warning">
            <ArrowUpCircle className="h-4 w-4 shrink-0" aria-hidden />
            <span>
              Actualización disponible: <span className="font-mono">{status.latest}</span>
            </span>
          </div>
        ) : (
          <p className="flex items-center gap-2 text-kr-sm text-success">
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            Estás al día{status.latest ? ` (${status.latest})` : ''}.
          </p>
        )}

        {status?.enabled && !loading && (
          <div className="flex items-center gap-2 text-kr-xs text-kr-muted">
            <StatusDot status="online" />
            Comprobado contra las releases de GitHub.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
