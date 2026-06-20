import type { Device } from '@krakenos/types';
import { useMemo, useState } from 'react';
import { DeviceDetailSlideover } from '@/components/inventory/DeviceDetailSlideover';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useInventoryStore } from '@/store/inventory.store';

const MAX_NODES = 10;
const WIDTH = 520;
const HEIGHT = 260;

function deviceName(d: Device): string {
  return d.label ?? d.hostname ?? d.mac;
}

function dotColor(d: Device): string {
  if (d.isBlocked) return 'var(--kr-danger)';
  if (!d.online) return 'var(--kr-offline)';
  if (d.type === 'unknown') return 'var(--kr-warning)';
  return 'var(--kr-online)';
}

/**
 * Diagrama simplificado de la red: ISP → Router → dispositivos. SVG generado a
 * partir del inventario real; los nodos de dispositivo abren el Slideover.
 */
export function NetworkTopologyWidget() {
  const devices = useInventoryStore((s) => Object.values(s.devices));
  const [selected, setSelected] = useState<Device | null>(null);

  const { router, leaves } = useMemo(() => {
    const router = devices.find((d) => d.type === 'router') ?? null;
    const leaves = devices.filter((d) => d.id !== router?.id).slice(0, MAX_NODES);
    return { router, leaves };
  }, [devices]);

  const ispX = 60;
  const routerX = 200;
  const leafX = 420;
  const midY = HEIGHT / 2;
  const gap = leaves.length > 1 ? (HEIGHT - 40) / (leaves.length - 1) : 0;
  const leafY = (i: number) => (leaves.length === 1 ? midY : 20 + i * gap);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Topología de red</CardTitle>
      </CardHeader>
      <CardContent>
        {devices.length === 0 ? (
          <p className="py-12 text-center text-kr-sm text-kr-muted">Sin dispositivos en la red.</p>
        ) : (
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="h-auto w-full"
            role="img"
            aria-label="Diagrama de la red"
          >
            {/* Enlaces ISP→Router y Router→dispositivos */}
            <line x1={ispX} y1={midY} x2={routerX} y2={midY} stroke="var(--kr-border)" strokeWidth={2} />
            {leaves.map((d, i) => (
              <line
                key={`l-${d.id}`}
                x1={routerX}
                y1={midY}
                x2={leafX}
                y2={leafY(i)}
                stroke="var(--kr-border)"
                strokeWidth={1.5}
              />
            ))}

            {/* ISP */}
            <g>
              <circle cx={ispX} cy={midY} r={16} fill="var(--kr-bg-elevated)" stroke="var(--kr-border)" />
              <text x={ispX} y={midY + 32} textAnchor="middle" fill="var(--kr-text-secondary)" fontSize={11}>
                ISP
              </text>
            </g>

            {/* Router */}
            <g>
              <circle cx={routerX} cy={midY} r={20} fill="var(--kr-accent)" />
              <text x={routerX} y={midY + 38} textAnchor="middle" fill="var(--kr-text-secondary)" fontSize={11}>
                {router ? deviceName(router) : 'Router'}
              </text>
            </g>

            {/* Dispositivos (clicables) */}
            {leaves.map((d, i) => (
              <g
                key={d.id}
                className="cursor-pointer"
                role="button"
                aria-label={deviceName(d)}
                onClick={() => setSelected(d)}
              >
                <circle cx={leafX} cy={leafY(i)} r={9} fill={dotColor(d)} />
                <text
                  x={leafX + 16}
                  y={leafY(i) + 4}
                  fill="var(--kr-text-primary)"
                  fontSize={11}
                >
                  {deviceName(d).slice(0, 18)}
                </text>
              </g>
            ))}
          </svg>
        )}
        {devices.length > leaves.length + (router ? 1 : 0) && (
          <p className="mt-2 text-kr-xs text-kr-muted">
            Mostrando {leaves.length} de {devices.length} dispositivos.
          </p>
        )}
      </CardContent>

      {selected && (
        <DeviceDetailSlideover device={selected} onClose={() => setSelected(null)} />
      )}
    </Card>
  );
}
