import type { PeerConfig, VpnPeer } from '@krakenos/types';
import { Button } from '@/components/ui/button';
import { Slideover } from '@/components/ui/slideover';

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
            Eliminar peer
          </Button>
        )
      }
    >
      <dl className="space-y-2 rounded-lg border border-kr bg-kr-elevated p-3">
        <Row label="IP VPN" value={peer.allowedIps} />
        <Row label="Clave pública" value={peer.publicKey} />
        <Row label="Creado" value={new Date(peer.createdAt).toLocaleString()} />
        <Row
          label="Último handshake"
          value={peer.lastHandshake ? new Date(peer.lastHandshake).toLocaleString() : 'nunca'}
        />
      </dl>

      {config ? (
        <div className="mt-4 space-y-3">
          <p className="text-kr-sm text-warning">
            Escanea el QR en la app de WireGuard. Esta config solo se muestra una vez.
          </p>
          <img
            src={config.qr}
            alt="QR de configuración WireGuard"
            className="mx-auto h-56 w-56 rounded bg-white p-2"
          />
          <pre className="max-h-48 overflow-auto rounded-md border border-kr bg-kr-base p-3 text-kr-xs text-kr-secondary">
            {config.config}
          </pre>
        </div>
      ) : (
        <p className="mt-4 text-kr-xs text-kr-muted">
          La configuración y el QR solo están disponibles al crear el peer.
        </p>
      )}
    </Slideover>
  );
}
