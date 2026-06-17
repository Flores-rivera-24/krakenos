import type { AuditLogEntry } from '@krakenos/types';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { useAuthStore } from '@/store/auth.store';

const ACTION_LABELS: Record<string, string> = {
  'auth.login': 'Inicio de sesión',
  'setup.init': 'Configuración inicial',
  'wifi.update': 'Cambio de WiFi',
  'wifi.guest.update': 'Cambio de red de invitados',
  'device.block': 'Dispositivo bloqueado',
  'device.unblock': 'Dispositivo desbloqueado',
};

export function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';
  const [audit, setAudit] = useState<AuditLogEntry[] | null>(null);

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    void api
      .get<AuditLogEntry[]>('/audit?limit=50')
      .then((rows) => active && setAudit(rows))
      .catch(() => active && setAudit([]));
    return () => {
      active = false;
    };
  }, [isAdmin]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="text-xl font-semibold">Ajustes</h2>
        <p className="text-sm text-muted-foreground">Configuración del sistema y de tu cuenta.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-foreground">Cuenta</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">Nombre</dt>
              <dd>{user?.displayName}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Email</dt>
              <dd>{user?.email}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Rol</dt>
              <dd>{user?.role}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-foreground">Registro de auditoría</CardTitle>
          </CardHeader>
          <CardContent>
            {audit === null ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Cargando…</p>
            ) : audit.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Sin actividad registrada.</p>
            ) : (
              <div className="overflow-hidden rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-secondary text-secondary-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Acción</th>
                      <th className="px-3 py-2 text-left">Detalle</th>
                      <th className="px-3 py-2 text-left">IP</th>
                      <th className="px-3 py-2 text-left">Cuándo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.map((e) => (
                      <tr key={e.id} className="border-t border-border">
                        <td className="px-3 py-2">{ACTION_LABELS[e.action] ?? e.action}</td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                          {e.detail ?? '—'}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                          {e.ip ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {timeAgo(e.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
