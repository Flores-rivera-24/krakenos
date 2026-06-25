import type {
  AuditLogEntry,
  ConnectivityTestResult,
  SystemSettingKey,
  SystemSettingsResponse,
} from '@krakenos/types';
import { Cpu, Lock, Plug, Server, User } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { IntegrationsSection } from '@/components/settings/IntegrationsSection';
import { SecuritySection } from '@/components/settings/SecuritySection';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusDot } from '@/components/ui/status-dot';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { isPushSupported, subscribeToPush, unsubscribeFromPush } from '@/lib/push';
import { useAuthStore } from '@/store/auth.store';

type Section = 'sistema' | 'red' | 'seguridad' | 'integraciones' | 'cuenta';

const SECTIONS: { id: Section; label: string; icon: typeof Cpu }[] = [
  { id: 'sistema', label: 'Sistema', icon: Cpu },
  { id: 'red', label: 'Red', icon: Server },
  { id: 'seguridad', label: 'Seguridad', icon: Lock },
  { id: 'integraciones', label: 'Integraciones', icon: Plug },
  { id: 'cuenta', label: 'Cuenta', icon: User },
];

const TIMEZONES = [
  'UTC',
  'Europe/Madrid',
  'Europe/London',
  'America/New_York',
  'America/Los_Angeles',
  'America/Mexico_City',
  'Asia/Tokyo',
];

const SELECT_CLASS =
  'h-10 w-full rounded-md border border-kr bg-kr-elevated px-3 text-kr-base text-kr-primary disabled:opacity-50';

function Setting({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[200px_1fr] sm:items-center">
      <Label className="text-kr-secondary">{label}</Label>
      {children}
    </div>
  );
}

export function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';
  const [section, setSection] = useState<Section>('sistema');
  const [data, setData] = useState<SystemSettingsResponse | null>(null);
  const [homeName, setHomeName] = useState('');
  const [test, setTest] = useState<ConnectivityTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [audit, setAudit] = useState<AuditLogEntry[] | null>(null);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const appliedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Notificaciones push (US-45): estado reflejado desde localStorage.
  const pushSupported = isPushSupported();
  const [pushEnabled, setPushEnabled] = useState(() => {
    try {
      return localStorage.getItem('kr-push-enabled') === 'true';
    } catch {
      return false;
    }
  });
  const [pushBusy, setPushBusy] = useState(false);

  const togglePush = async (next: boolean) => {
    setPushBusy(true);
    try {
      if (next) await subscribeToPush();
      else await unsubscribeFromPush();
      setPushEnabled(next);
      localStorage.setItem('kr-push-enabled', String(next));
    } catch {
      // Permiso denegado u otro error: el toggle queda desactivado.
      setPushEnabled(false);
      localStorage.setItem('kr-push-enabled', 'false');
    } finally {
      setPushBusy(false);
    }
  };

  useEffect(() => {
    let active = true;
    void api
      .get<SystemSettingsResponse>('/system/settings')
      .then((d) => {
        if (!active) return;
        setData(d);
        setHomeName(d.settings.homeName);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isAdmin || section !== 'cuenta') return;
    let active = true;
    void api
      .get<AuditLogEntry[]>('/audit?limit=50')
      .then((rows) => active && setAudit(rows))
      .catch(() => active && setAudit([]));
    return () => {
      active = false;
    };
  }, [isAdmin, section]);

  // Limpia el temporizador del aviso "aplicado al instante" al desmontar.
  useEffect(
    () => () => {
      if (appliedTimer.current) clearTimeout(appliedTimer.current);
    },
    [],
  );

  const patch = async (key: SystemSettingKey, value: string) => {
    setError(null);
    try {
      const next = await api.patch<SystemSettingsResponse>('/system/settings', { key, value });
      setData(next);
      // Ajustes en caliente (US-47): confirmar que el cambio ya tiene efecto.
      if (next.appliedImmediately) {
        setApplied(true);
        if (appliedTimer.current) clearTimeout(appliedTimer.current);
        appliedTimer.current = setTimeout(() => setApplied(false), 2500);
      }
    } catch {
      // US-55: no fallar en silencio. Avisa y revierte visualmente el control. Los
      // selects ya muestran el valor guardado (controlados por `data`); el input de
      // nombre del hogar tiene estado propio, así que se restaura a mano.
      setError('No se pudo guardar el cambio. Revisa la conexión e inténtalo de nuevo.');
      if (key === 'homeName' && data) setHomeName(data.settings.homeName);
    }
  };

  const setting = (key: SystemSettingKey): string => data?.settings[key] ?? '';

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      setTest(await api.post<ConnectivityTestResult>('/system/connectivity-test'));
    } finally {
      setTesting(false);
    }
  };

  const exportBackup = () => {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data.settings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'krakenos-settings.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importBackup = async (file: File) => {
    const parsed = JSON.parse(await file.text()) as Record<string, string>;
    for (const [key, value] of Object.entries(parsed)) {
      if (data && key in data.settings) await patch(key as SystemSettingKey, String(value));
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="text-kr-xl font-semibold text-kr-primary">Ajustes</h2>
        <p className="text-kr-sm text-kr-secondary">Configuración del sistema y de tu cuenta.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-[200px_1fr]">
        {/* Sidebar de secciones */}
        <nav className="flex gap-1 overflow-x-auto md:flex-col">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setSection(id)}
              className={
                section === id
                  ? 'flex items-center gap-2 rounded-md bg-kr-elevated px-3 py-2 text-kr-base text-kr-primary'
                  : 'flex items-center gap-2 rounded-md px-3 py-2 text-kr-base text-kr-secondary hover:bg-kr-elevated hover:text-kr-primary'
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </nav>

        {/* Contenido */}
        <div className="space-y-6">
          {applied && (
            <div
              role="status"
              className="flex items-center gap-2 rounded-md border border-success bg-kr-elevated px-3 py-2 text-kr-sm text-success"
            >
              <StatusDot status="online" />
              Cambio aplicado al instante (sin reiniciar).
            </div>
          )}
          {error && (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-md border border-danger bg-kr-elevated px-3 py-2 text-kr-sm text-danger"
            >
              <StatusDot status="danger" />
              {error}
            </div>
          )}
          {section === 'sistema' && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Sistema</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Setting label="Nombre del hogar">
                    <div className="flex gap-2">
                      <Input
                        aria-label="Nombre del hogar"
                        value={homeName}
                        onChange={(e) => setHomeName(e.target.value)}
                        disabled={!isAdmin}
                        maxLength={60}
                      />
                      {isAdmin && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void patch('homeName', homeName)}
                        >
                          Guardar
                        </Button>
                      )}
                    </div>
                  </Setting>
                  <Setting label="Zona horaria">
                    <select
                      className={SELECT_CLASS}
                      aria-label="Zona horaria"
                      value={setting('timezone')}
                      disabled={!isAdmin}
                      onChange={(e) => void patch('timezone', e.target.value)}
                    >
                      {TIMEZONES.map((tz) => (
                        <option key={tz} value={tz}>
                          {tz}
                        </option>
                      ))}
                    </select>
                  </Setting>
                  <Setting label="Intervalo de escaneo">
                    <select
                      className={SELECT_CLASS}
                      aria-label="Intervalo de escaneo"
                      value={setting('scanIntervalSec')}
                      disabled={!isAdmin}
                      onChange={(e) => void patch('scanIntervalSec', e.target.value)}
                    >
                      <option value="30">30 segundos</option>
                      <option value="60">1 minuto</option>
                      <option value="300">5 minutos</option>
                    </select>
                  </Setting>
                  <Setting label="HTTPS">
                    <span className="flex items-center gap-2 text-kr-base">
                      <StatusDot status={data?.info.httpsEnabled ? 'online' : 'offline'} />
                      {data?.info.httpsEnabled
                        ? 'Activado (certificado en LAN)'
                        : 'Desactivado (HTTP)'}
                    </span>
                  </Setting>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Notificaciones</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {!pushSupported ? (
                    <p className="text-kr-sm text-kr-muted">
                      Tu navegador no soporta notificaciones push.
                    </p>
                  ) : (
                    <Setting label="Notificaciones push">
                      <div className="flex items-center gap-3">
                        <Switch
                          checked={pushEnabled}
                          disabled={pushBusy}
                          onCheckedChange={(v) => void togglePush(v)}
                          aria-label="Notificaciones push"
                        />
                        <span
                          className={
                            pushEnabled ? 'text-kr-sm text-success' : 'text-kr-sm text-kr-muted'
                          }
                        >
                          {pushEnabled ? 'Activadas' : 'Desactivadas'}
                        </span>
                      </div>
                    </Setting>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Copia de seguridad</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={exportBackup} disabled={!data}>
                    Exportar backup
                  </Button>
                  {isAdmin && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => fileInput.current?.click()}
                      >
                        Restaurar backup
                      </Button>
                      <input
                        ref={fileInput}
                        type="file"
                        accept="application/json"
                        className="hidden"
                        aria-label="Restaurar backup"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void importBackup(f);
                        }}
                      />
                    </>
                  )}
                </CardContent>
              </Card>
            </>
          )}

          {section === 'red' && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Driver activo</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between text-kr-base">
                    <span className="text-kr-secondary">Driver</span>
                    <span className="font-mono text-kr-primary">{data?.info.driver ?? '—'}</span>
                  </div>
                  <div className="flex items-center justify-between text-kr-base">
                    <span className="text-kr-secondary">Host</span>
                    <span className="font-mono text-kr-primary">{data?.info.host ?? '—'}</span>
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-3">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void runTest()}
                        disabled={testing}
                      >
                        {testing ? 'Probando…' : 'Probar conexión'}
                      </Button>
                      {test && (
                        <span className="flex items-center gap-2 text-kr-sm">
                          <StatusDot status={test.ok ? 'online' : 'danger'} />
                          {test.ok ? `OK · ${test.latencyMs} ms` : test.error}
                        </span>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Retención de datos</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Setting label="Historial de tráfico">
                    <select
                      className={SELECT_CLASS}
                      aria-label="Retención del historial de tráfico"
                      value={setting('trafficRetentionDays')}
                      disabled={!isAdmin}
                      onChange={(e) => void patch('trafficRetentionDays', e.target.value)}
                    >
                      <option value="7">7 días</option>
                      <option value="30">30 días</option>
                      <option value="90">90 días</option>
                    </select>
                  </Setting>
                  <Setting label="Registro de auditoría">
                    <select
                      className={SELECT_CLASS}
                      aria-label="Retención del registro de auditoría"
                      value={setting('auditRetentionDays')}
                      disabled={!isAdmin}
                      onChange={(e) => void patch('auditRetentionDays', e.target.value)}
                    >
                      <option value="30">30 días</option>
                      <option value="90">90 días</option>
                      <option value="180">180 días</option>
                    </select>
                  </Setting>
                </CardContent>
              </Card>
            </>
          )}

          {section === 'seguridad' && data && (
            <SecuritySection settings={data.settings} patch={patch} isAdmin={isAdmin} />
          )}

          {section === 'integraciones' && data && (
            <IntegrationsSection driver={data.info.driver} isAdmin={isAdmin} />
          )}

          {section === 'cuenta' && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Cuenta</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-2 gap-3 text-kr-base sm:grid-cols-3">
                    <div>
                      <dt className="text-kr-xs text-kr-muted">Nombre</dt>
                      <dd className="text-kr-primary">{user?.displayName}</dd>
                    </div>
                    <div>
                      <dt className="text-kr-xs text-kr-muted">Email</dt>
                      <dd className="text-kr-primary">{user?.email}</dd>
                    </div>
                    <div>
                      <dt className="text-kr-xs text-kr-muted">Rol</dt>
                      <dd className="text-kr-primary">{user?.role}</dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>

              {isAdmin && (
                <Card>
                  <CardHeader>
                    <CardTitle>Registro de auditoría</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {audit === null ? (
                      <p className="py-6 text-center text-kr-sm text-kr-muted">Cargando…</p>
                    ) : audit.length === 0 ? (
                      <p className="py-6 text-center text-kr-sm text-kr-muted">
                        Sin actividad registrada.
                      </p>
                    ) : (
                      <div className="overflow-x-auto rounded-md border border-kr">
                        <table className="w-full text-kr-sm">
                          <thead className="bg-kr-elevated text-kr-secondary">
                            <tr>
                              <th className="px-3 py-2 text-left">Acción</th>
                              <th className="px-3 py-2 text-left">IP</th>
                              <th className="px-3 py-2 text-left">Cuándo</th>
                            </tr>
                          </thead>
                          <tbody>
                            {audit.map((e) => (
                              <tr key={e.id} className="border-t border-kr">
                                <td className="px-3 py-2 text-kr-primary">{e.action}</td>
                                <td className="px-3 py-2 font-mono text-kr-xs text-kr-muted">
                                  {e.ip ?? '—'}
                                </td>
                                <td className="px-3 py-2 text-kr-xs text-kr-muted">
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
