import type { TailscaleStatus } from '@krakenos/types';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusDot } from '@/components/ui/status-dot';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';

const DOT_BY_STATE = {
  running: 'online',
  'needs-login': 'warning',
  stopped: 'warning',
  'not-installed': 'offline',
} as const;

const INSTALL_COMMAND = 'curl -fsSL https://tailscale.com/install.sh | sh';
const LOGIN_COMMAND = 'sudo tailscale up';
const START_COMMAND = 'sudo systemctl start tailscaled';

function isTailscaleStatus(value: unknown): value is TailscaleStatus {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as TailscaleStatus).state === 'string'
  );
}

/** Bloque de comando copiable (los comandos son literales ASCII, no copy). */
function CommandLine({ command }: { command: string }) {
  const t = useT();
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs">
        {command}
      </code>
      <CopyButton
        value={command}
        label={t('vpn.tailscale.copy')}
        copiedLabel={t('vpn.tailscale.copied')}
      />
    </div>
  );
}

/**
 * Detección de Tailscale (US-215): muestra el estado del `tailscaled` del
 * servidor y guía según el caso. Solo lectura — la app nunca administra el
 * tailnet (iniciar sesión es interactivo y se hace por SSH en el servidor).
 */
export function TailscaleCard() {
  const t = useT();
  const [status, setStatus] = useState<TailscaleStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    api
      .get<TailscaleStatus>('/vpn/tailscale')
      .then((data) => {
        if (isTailscaleStatus(data)) setStatus(data);
        else setError(true);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base text-foreground">{t('vpn.tailscale.title')}</CardTitle>
          {status && (
            <span className="flex items-center gap-2 text-sm">
              <StatusDot status={DOT_BY_STATE[status.state]} />
              {t(`vpn.tailscale.state.${status.state}`)}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-kr-xs text-kr-secondary">{t('vpn.tailscale.desc')}</p>

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : error || !status ? (
          <p className="text-kr-muted">{t('vpn.tailscale.loadError')}</p>
        ) : status.state === 'running' ? (
          <>
            {status.magicDnsName && (
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{t('vpn.tailscale.magicDns')}</span>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-mono text-xs">{status.magicDnsName}</span>
                    <CopyButton
                      value={status.magicDnsName}
                      label={t('vpn.tailscale.copy')}
                      copiedLabel={t('vpn.tailscale.copied')}
                    />
                  </span>
                </div>
                <p className="text-kr-xs text-kr-secondary">{t('vpn.tailscale.magicDnsHint')}</p>
              </div>
            )}
            {status.tailscaleIp && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('vpn.tailscale.ip')}</span>
                <span className="font-mono text-xs">{status.tailscaleIp}</span>
              </div>
            )}
            {status.version && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('vpn.tailscale.version')}</span>
                <span className="font-mono text-xs">{status.version}</span>
              </div>
            )}
            <p className="text-kr-xs text-kr-secondary">{t('vpn.tailscale.webauthnNote')}</p>
          </>
        ) : status.state === 'needs-login' ? (
          <>
            <p>{t('vpn.tailscale.needsLoginHint')}</p>
            <CommandLine command={LOGIN_COMMAND} />
          </>
        ) : status.state === 'stopped' ? (
          <>
            <p>{t('vpn.tailscale.stoppedHint')}</p>
            <CommandLine command={START_COMMAND} />
          </>
        ) : (
          <>
            <p>{t('vpn.tailscale.notInstalledHint')}</p>
            <CommandLine command={INSTALL_COMMAND} />
            <p className="text-kr-xs text-kr-secondary">{t('vpn.tailscale.wireguardNote')}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
