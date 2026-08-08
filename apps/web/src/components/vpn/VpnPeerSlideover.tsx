import type { PeerConfig, VpnPeer } from '@krakenos/types';
import { Button } from '@/components/ui/button';
import { Slideover } from '@/components/ui/slideover';
import { useT } from '@/lib/i18n';

interface Props {
  peer: VpnPeer;
  /** Config + QR, disponible **solo** justo tras crear el peer. */
  config?: PeerConfig;
  onClose: () => void;
  onDelete?: (id: string) => void;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-kr-sm text-kr-secondary">{label}</span>
      <span className="break-all text-right font-mono text-kr-xs text-kr-primary">{value}</span>
    </div>
  );
}

export function VpnPeerSlideover({ peer, config, onClose, onDelete }: Props) {
  const t = useT();
  return (
    <Slideover
      open
      onClose={onClose}
      title={peer.name}
      subtitle={peer.allowedIps}
      footer={
        onDelete && (
          <Button
            variant="destructive"
            className="w-full"
            onClick={() => {
              onDelete(peer.id);
              onClose();
            }}
          >
            {t('vpn.peer.delete')}
          </Button>
        )
      }
    >
      <dl className="space-y-2 rounded-lg border border-kr bg-kr-elevated p-3">
        <Row label="IP VPN" value={peer.allowedIps} />
        <Row label={t('vpn.peer.publicKey')} value={peer.publicKey} />
        <Row label={t('vpn.peer.created')} value={new Date(peer.createdAt).toLocaleString()} />
        <Row
          label={t('vpn.peer.lastHandshake')}
          value={
            peer.lastHandshake ? new Date(peer.lastHandshake).toLocaleString() : t('vpn.peer.never')
          }
        />
      </dl>

      {config ? (
        <div className="mt-4 space-y-3">
          <p className="text-kr-sm text-warning">{t('vpn.peer.qrHint')}</p>
          <img
            src={config.qr}
            alt={t('vpn.peer.qrAlt')}
            className="mx-auto h-56 w-56 rounded bg-white p-2"
          />
          <pre className="max-h-48 overflow-auto rounded-md border border-kr bg-kr-base p-3 text-kr-xs text-kr-secondary">
            {config.config}
          </pre>
        </div>
      ) : (
        <p className="mt-4 text-kr-xs text-kr-muted">{t('vpn.peer.noConfig')}</p>
      )}
    </Slideover>
  );
}
