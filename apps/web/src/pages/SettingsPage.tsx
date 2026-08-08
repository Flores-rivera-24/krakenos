import type {
  AuditLogEntry,
  ConnectivityTestResult,
  SystemSettingKey,
  SystemSettingsResponse,
} from '@krakenos/types';
import { Cpu, Lock, Plug, Server, User, Users } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AboutCard } from '@/components/settings/AboutCard';
import { ChangePasswordCard } from '@/components/settings/ChangePasswordCard';
import { AlertRulesCard } from '@/components/settings/AlertRulesCard';
import { ApiTokensCard } from '@/components/settings/ApiTokensCard';
import { MqttInteropCard } from '@/components/settings/MqttInteropCard';
import { IntegrationsSection } from '@/components/settings/IntegrationsSection';
import { MatterBridgeCard } from '@/components/settings/MatterBridgeCard';
import { ReportsCard } from '@/components/settings/ReportsCard';
import { SecuritySection } from '@/components/settings/SecuritySection';
import { SystemBackupCard } from '@/components/settings/SystemBackupCard';
import { LanguageCard } from '@/components/settings/LanguageCard';
import { MobileAccessCard } from '@/components/vpn/MobileAccessCard';
import { UiModeCard } from '@/components/settings/UiModeCard';
import { HealthCard } from '@/components/settings/HealthCard';
import { SupportCard } from '@/components/settings/SupportCard';
import { TlsCard } from '@/components/settings/TlsCard';
import { UpdateCard } from '@/components/settings/UpdateCard';
import { WeatherCard } from '@/components/settings/WeatherCard';
import { UsersSection } from '@/components/settings/UsersSection';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingLine } from '@/components/ui/loading-line';
import { StatusDot } from '@/components/ui/status-dot';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { useT, type TranslationKey } from '@/lib/i18n';
import { isPushSupported, subscribeToPush, unsubscribeFromPush } from '@/lib/push';
import { useAuthStore } from '@/store/auth.store';

type Section = 'sistema' | 'red' | 'seguridad' | 'integraciones' | 'usuarios' | 'cuenta';

/** `adminOnly` oculta la sección a los viewers (el servidor la impone igualmente). */
const SECTIONS: { id: Section; labelKey: TranslationKey; icon: typeof Cpu; adminOnly?: boolean }[] = [
  { id: 'sistema', labelKey: 'settings.section.system', icon: Cpu },
  { id: 'red', labelKey: 'settings.section.network', icon: Server },
  { id: 'seguridad', labelKey: 'settings.section.security', icon: Lock },
  { id: 'integraciones', labelKey: 'settings.section.integrations', icon: Plug },
  { id: 'usuarios', labelKey: 'settings.section.users', icon: Users, adminOnly: true },
  { id: 'cuenta', labelKey: 'settings.section.account', icon: User },
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
  const t = useT();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';
  const [section, setSection] = useState<Section>('sistema');
  const [data, setData] = useState<SystemSettingsResponse | null>(null);
  const [homeName, setHomeName] = useState('');
  const [maintWindow, setMaintWindow] = useState('');
  const [nightSuppress, setNightSuppress] = useState('');
  const [test, setTest] = useState<ConnectivityTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [audit, setAudit] = useState<AuditLogEntry[] | null>(null);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const appliedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        setMaintWindow(d.settings.updateMaintenanceWindow ?? '');
        setNightSuppress(d.settings.presenceNightSuppress ?? '');
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
      setError(t('settings.saveError'));
      if (key === 'homeName' && data) setHomeName(data.settings.homeName);
      if (key === 'updateMaintenanceWindow' && data)
        setMaintWindow(data.settings.updateMaintenanceWindow ?? '');
      if (key === 'presenceNightSuppress' && data)
        setNightSuppress(data.settings.presenceNightSuppress ?? '');
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


  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-kr-xl font-semibold text-kr-primary">{t('settings.title')}</h1>
        <p className="text-kr-sm text-kr-secondary">{t('settings.subtitle')}</p>
      </div>

      <div className="grid gap-6 md:grid-cols-[200px_1fr]">
        {/* Sidebar de secciones */}
        <nav className="flex gap-1 overflow-x-auto md:flex-col">
          {SECTIONS.filter((s) => !s.adminOnly || isAdmin).map(({ id, labelKey, icon: Icon }) => (
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
              {t(labelKey)}
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
              {t('settings.applied')}
            </div>
          )}
          {error && <ErrorBanner>{error}</ErrorBanner>}
          {section === 'sistema' && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>{t('settings.system.title')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Setting label={t('settings.system.homeName')}>
                    <div className="flex gap-2">
                      <Input
                        aria-label={t('settings.system.homeName')}
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
                          {t('settings.system.save')}
                        </Button>
                      )}
                    </div>
                  </Setting>
                  <Setting label={t('settings.system.timezone')}>
                    <select
                      className={SELECT_CLASS}
                      aria-label={t('settings.system.timezone')}
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
                  <Setting label={t('settings.system.scanInterval')}>
                    <select
                      className={SELECT_CLASS}
                      aria-label={t('settings.system.scanInterval')}
                      value={setting('scanIntervalSec')}
                      disabled={!isAdmin}
                      onChange={(e) => void patch('scanIntervalSec', e.target.value)}
                    >
                      <option value="30">{t('settings.system.sec30')}</option>
                      <option value="60">{t('settings.system.min1')}</option>
                      <option value="300">{t('settings.system.min5')}</option>
                    </select>
                  </Setting>
                  <Setting label={t('settings.system.presenceGrace')}>
                    <select
                      className={SELECT_CLASS}
                      aria-label={t('settings.system.presenceGraceAria')}
                      value={setting('presenceGraceMin')}
                      disabled={!isAdmin}
                      onChange={(e) => void patch('presenceGraceMin', e.target.value)}
                    >
                      <option value="5">{t('settings.system.min5')}</option>
                      <option value="10">{t('settings.system.min10')}</option>
                      <option value="20">{t('settings.system.min20')}</option>
                      <option value="30">{t('settings.system.min30')}</option>
                    </select>
                  </Setting>
                  <Setting label={t('settings.system.presenceSweeps')}>
                    <select
                      className={SELECT_CLASS}
                      aria-label={t('settings.system.presenceSweepsAria')}
                      value={setting('presenceLeaveSweeps')}
                      disabled={!isAdmin}
                      onChange={(e) => void patch('presenceLeaveSweeps', e.target.value)}
                    >
                      <option value="1">1</option>
                      <option value="2">2</option>
                      <option value="3">3</option>
                      <option value="5">5</option>
                    </select>
                  </Setting>
                  <Setting label={t('settings.system.presenceNight')}>
                    <div className="flex gap-2">
                      <Input
                        aria-label={t('settings.system.presenceNight')}
                        placeholder={t('settings.system.presenceNightPlaceholder')}
                        value={nightSuppress}
                        onChange={(e) => setNightSuppress(e.target.value)}
                        disabled={!isAdmin}
                        maxLength={11}
                      />
                      {isAdmin && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void patch('presenceNightSuppress', nightSuppress.trim())}
                        >
                          {t('settings.system.save')}
                        </Button>
                      )}
                    </div>
                  </Setting>
                  <Setting label={t('settings.system.maintenanceWindow')}>
                    <div className="flex gap-2">
                      <Input
                        aria-label={t('settings.system.maintenanceWindow')}
                        placeholder={t('settings.system.maintenanceWindowPlaceholder')}
                        value={maintWindow}
                        onChange={(e) => setMaintWindow(e.target.value)}
                        disabled={!isAdmin}
                        maxLength={11}
                      />
                      {isAdmin && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void patch('updateMaintenanceWindow', maintWindow.trim())}
                        >
                          {t('settings.system.save')}
                        </Button>
                      )}
                    </div>
                  </Setting>
                  <Setting label={t('settings.system.https')}>
                    <span className="flex items-center gap-2 text-kr-base">
                      <StatusDot status={data?.info.httpsEnabled ? 'online' : 'offline'} />
                      {data?.info.httpsEnabled
                        ? t('settings.system.httpsOn')
                        : t('settings.system.httpsOff')}
                    </span>
                  </Setting>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t('settings.notifications.title')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {!pushSupported ? (
                    <p className="text-kr-sm text-kr-muted">
                      {t('settings.notifications.unsupported')}
                    </p>
                  ) : (
                    <Setting label={t('settings.notifications.push')}>
                      <div className="flex items-center gap-3">
                        <Switch
                          checked={pushEnabled}
                          disabled={pushBusy}
                          onCheckedChange={(v) => void togglePush(v)}
                          aria-label={t('settings.notifications.push')}
                        />
                        <span
                          className={
                            pushEnabled ? 'text-kr-sm text-success' : 'text-kr-sm text-kr-muted'
                          }
                        >
                          {pushEnabled
                            ? t('settings.notifications.on')
                            : t('settings.notifications.off')}
                        </span>
                      </div>
                    </Setting>
                  )}
                  <Setting label={t('settings.notifications.digest')}>
                    <select
                      className={SELECT_CLASS}
                      aria-label={t('settings.notifications.digest')}
                      value={setting('digestFrequency')}
                      disabled={!isAdmin}
                      onChange={(e) => void patch('digestFrequency', e.target.value)}
                    >
                      <option value="off">{t('settings.notifications.digestOff')}</option>
                      <option value="daily">{t('settings.notifications.digestDaily')}</option>
                      <option value="weekly">{t('settings.notifications.digestWeekly')}</option>
                    </select>
                  </Setting>
                </CardContent>
              </Card>

              {/* TLS (US-241): tres features entregadas quedaban inertes sin
                  contexto seguro y nada lo decía. */}
              <TlsCard />

              <UpdateCard />

              <HealthCard />

              {isAdmin && <SupportCard />}

              {isAdmin && <SystemBackupCard />}

              {isAdmin && <AlertRulesCard />}

              <ReportsCard />

              {/* Acerca de (US-257): la oferta de código fuente que exige la §13
                  de la AGPL. Va SIN `isAdmin` a propósito — la licencia se le
                  ofrece a quien usa el programa, no a quien lo administra. */}
              <AboutCard />
            </>
          )}

          {section === 'red' && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>{t('settings.driver.title')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between text-kr-base">
                    <span className="text-kr-secondary">{t('settings.driver.driver')}</span>
                    <span className="font-mono text-kr-primary">{data?.info.driver ?? '—'}</span>
                  </div>
                  <div className="flex items-center justify-between text-kr-base">
                    <span className="text-kr-secondary">{t('settings.driver.host')}</span>
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
                        {testing ? t('settings.driver.testing') : t('settings.driver.test')}
                      </Button>
                      {test && (
                        <span className="flex items-center gap-2 text-kr-sm">
                          <StatusDot status={test.ok ? 'online' : 'danger'} />
                          {test.ok
                            ? t('settings.driver.ok', { latency: String(test.latencyMs) })
                            : test.error}
                        </span>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t('settings.retention.title')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Setting label={t('settings.retention.traffic')}>
                    <select
                      className={SELECT_CLASS}
                      aria-label={t('settings.retention.trafficAria')}
                      value={setting('trafficRetentionDays')}
                      disabled={!isAdmin}
                      onChange={(e) => void patch('trafficRetentionDays', e.target.value)}
                    >
                      <option value="7">{t('settings.retention.d7')}</option>
                      <option value="30">{t('settings.retention.d30')}</option>
                      <option value="90">{t('settings.retention.d90')}</option>
                    </select>
                  </Setting>
                  <Setting label={t('settings.retention.audit')}>
                    <select
                      className={SELECT_CLASS}
                      aria-label={t('settings.retention.auditAria')}
                      value={setting('auditRetentionDays')}
                      disabled={!isAdmin}
                      onChange={(e) => void patch('auditRetentionDays', e.target.value)}
                    >
                      <option value="30">{t('settings.retention.d30')}</option>
                      <option value="90">{t('settings.retention.d90')}</option>
                      <option value="180">{t('settings.retention.d180')}</option>
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
            <div className="space-y-6">
              <IntegrationsSection isAdmin={isAdmin} />
              <MatterBridgeCard isAdmin={isAdmin} />
              {isAdmin && <MqttInteropCard />}
              {/* El tiempo exterior es lo único que manda un dato del hogar a un
                  tercero: solo un admin puede consentirlo (US-254). */}
              {isAdmin && <WeatherCard />}
            </div>
          )}

          {section === 'usuarios' && isAdmin && <UsersSection />}

          {section === 'cuenta' && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>{t('settings.account.title')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-2 gap-3 text-kr-base sm:grid-cols-3">
                    <div>
                      <dt className="text-kr-xs text-kr-muted">{t('settings.account.name')}</dt>
                      <dd className="text-kr-primary">{user?.displayName}</dd>
                    </div>
                    <div>
                      <dt className="text-kr-xs text-kr-muted">{t('settings.account.email')}</dt>
                      <dd className="text-kr-primary">{user?.email}</dd>
                    </div>
                    <div>
                      <dt className="text-kr-xs text-kr-muted">{t('settings.account.role')}</dt>
                      <dd className="text-kr-primary">{user?.role}</dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>

              {/* «Tu móvil en 3 pasos» (US-215) vive aquí desde US-240: en /vpn
                  quedaba dentro de «Red avanzada», invisible para member/kid/guest
                  y para el modo sencillo — justo quien necesita la guía. Ajustes →
                  Cuenta lo ve cualquier rol. */}
              <MobileAccessCard />

              <LanguageCard />

              <UiModeCard />

              <ChangePasswordCard />

              <ApiTokensCard />

              {isAdmin && (
                <Card>
                  <CardHeader>
                    <CardTitle>{t('settings.audit.title')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {audit === null ? (
                      <LoadingLine />
                    ) : audit.length === 0 ? (
                      <p className="py-6 text-center text-kr-sm text-kr-muted">
                        {t('settings.audit.empty')}
                      </p>
                    ) : (
                      <div className="overflow-x-auto rounded-md border border-kr">
                        <table className="w-full text-kr-sm">
                          <thead className="bg-kr-elevated text-kr-secondary">
                            <tr>
                              <th className="px-3 py-2 text-left">{t('settings.audit.colAction')}</th>
                              <th className="px-3 py-2 text-left">{t('settings.audit.colIp')}</th>
                              <th className="px-3 py-2 text-left">{t('settings.audit.colWhen')}</th>
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
