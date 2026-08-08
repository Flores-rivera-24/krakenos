import { useEffect, useRef } from 'react';
import { prefersReducedMotion } from '@/lib/motion';
import { cn } from '@/lib/utils';

/**
 * Fondo generativo de las pantallas de entrada (US-269).
 *
 * Dos variantes, ambas dibujadas en `<canvas>` en vez de SVG a mano: la geometría
 * es aleatoria y se recalcula al redimensionar, así que no hay nada que versionar
 * en el repositorio.
 *
 * - `grid`   — rejilla técnica que deriva muy despacio. Es el fondo del **acceso**:
 *              tiene que dar textura sin competir con el formulario.
 * - `fabric` — nodos enlazados con paquetes viajando por los enlaces y repulsión
 *              alrededor del puntero. Es el fondo de la **portada**, donde no hay
 *              ningún campo que rellenar y el movimiento se paga solo.
 *
 * Invariantes que respeta (y por los que existe este componente en vez de un
 * `<canvas>` suelto en cada página):
 * - `prefers-reduced-motion` → pinta **un solo fotograma** y no arranca el bucle.
 *   No se queda en blanco: el fondo sigue existiendo, simplemente no se mueve.
 * - Se detiene con la pestaña oculta y cuando sale de la pantalla. Un `<canvas>`
 *   animado en una pestaña de fondo es batería quemada a cambio de nada — mismo
 *   motivo por el que todo sondeo del proyecto pasa por `lib/use-polling.ts`.
 * - Los colores salen de los tokens `kr-*` leídos del DOM, no de literales: así el
 *   fondo cambia con el tema como el resto de la interfaz.
 */

export type NetworkCanvasVariant = 'grid' | 'fabric';

interface NetworkCanvasProps {
  variant: NetworkCanvasVariant;
  className?: string;
}

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hub: boolean;
}

interface Packet {
  a: number;
  b: number;
  p: number;
  s: number;
}

/** Distancia máxima a la que dos nodos se consideran enlazados, en px. */
const LINK_DISTANCE = 128;
/** Un nodo cada N px² de superficie, con tope para no castigar pantallas grandes. */
const AREA_PER_NODE = 22_000;
const MAX_NODES = 46;
const MAX_PACKETS = 16;

/** Lee un token CSS del documento y lo devuelve utilizable en `canvas`. */
function token(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v === '' ? fallback : v;
}

export function NetworkCanvas({ variant, className }: NetworkCanvasProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = prefersReducedMotion();
    // Tope de 2: por encima el coste sube en cuadrado y no se aprecia.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const accent = token('--kr-accent', '#2563eb');
    const link = token('--kr-link', '#58a6ff');
    const ink = token('--kr-text-primary', '#e6edf3');

    let width = 0;
    let height = 0;
    let nodes: Node[] = [];
    let packets: Packet[] = [];
    let raf: number | null = null;
    let tick = 0;
    const pointer = { x: -9999, y: -9999 };

    function seed() {
      nodes = [];
      packets = [];
      if (variant === 'grid') return;
      const count = Math.max(0, Math.min(Math.round((width * height) / AREA_PER_NODE), MAX_NODES));
      for (let i = 0; i < count; i++) {
        nodes.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.16,
          vy: (Math.random() - 0.5) * 0.16,
          r: 1 + Math.random() * 1.6,
          hub: Math.random() < 0.18,
        });
      }
    }

    function resize() {
      const rect = canvas!.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas!.width = Math.max(1, Math.round(width * dpr));
      canvas!.height = Math.max(1, Math.round(height * dpr));
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    }

    /** Halo de acento, común a las dos variantes. */
    function paintHalo() {
      const g = ctx!.createRadialGradient(
        width * 0.5,
        height * 0.42,
        0,
        width * 0.5,
        height * 0.42,
        Math.max(width, height) * 0.55,
      );
      g.addColorStop(0, withAlpha(accent, 0.13));
      g.addColorStop(1, withAlpha(accent, 0));
      ctx!.fillStyle = g;
      ctx!.fillRect(0, 0, width, height);
    }

    function paintGrid(offset: number) {
      const step = 34;
      ctx!.lineWidth = 1;
      ctx!.strokeStyle = withAlpha(ink, 0.05);
      ctx!.beginPath();
      for (let x = -step + offset; x < width + step; x += step) {
        ctx!.moveTo(x, 0);
        ctx!.lineTo(x, height);
      }
      for (let y = -step + offset; y < height + step; y += step) {
        ctx!.moveTo(0, y);
        ctx!.lineTo(width, y);
      }
      ctx!.stroke();
    }

    /** Pares de nodos suficientemente cerca, con su intensidad (1 = pegados). */
    function edges(): Array<[number, number, number]> {
      const out: Array<[number, number, number]> = [];
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i]!;
          const b = nodes[j]!;
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d = Math.hypot(dx, dy);
          if (d < LINK_DISTANCE) out.push([i, j, 1 - d / LINK_DISTANCE]);
        }
      }
      return out;
    }

    function paintFabric(animate: boolean) {
      if (animate) {
        for (const n of nodes) {
          n.x += n.vx;
          n.y += n.vy;
          if (n.x < 0 || n.x > width) n.vx *= -1;
          if (n.y < 0 || n.y > height) n.vy *= -1;
          const dx = n.x - pointer.x;
          const dy = n.y - pointer.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 12_000 && d2 > 1) {
            const f = ((12_000 - d2) / 12_000) * 0.9;
            const d = Math.sqrt(d2);
            n.x += (dx / d) * f;
            n.y += (dy / d) * f;
          }
        }
      }

      const es = edges();
      ctx!.lineWidth = 1;
      for (const [i, j, strength] of es) {
        ctx!.strokeStyle = withAlpha(ink, strength * 0.11);
        ctx!.beginPath();
        ctx!.moveTo(nodes[i]!.x, nodes[i]!.y);
        ctx!.lineTo(nodes[j]!.x, nodes[j]!.y);
        ctx!.stroke();
      }

      if (animate) {
        if (packets.length < MAX_PACKETS && es.length > 0 && tick % 7 === 0) {
          const pick = es[Math.floor(Math.random() * es.length)]!;
          packets.push({ a: pick[0], b: pick[1], p: 0, s: 0.006 + Math.random() * 0.01 });
        }
        packets = packets.filter((pk) => {
          pk.p += pk.s;
          const a = nodes[pk.a];
          const b = nodes[pk.b];
          if (pk.p >= 1 || !a || !b) return false;
          const px = a.x + (b.x - a.x) * pk.p;
          const py = a.y + (b.y - a.y) * pk.p;
          ctx!.fillStyle = withAlpha(link, 0.9);
          ctx!.beginPath();
          ctx!.arc(px, py, 1.7, 0, Math.PI * 2);
          ctx!.fill();
          ctx!.fillStyle = withAlpha(link, 0.16);
          ctx!.beginPath();
          ctx!.arc(px, py, 5, 0, Math.PI * 2);
          ctx!.fill();
          return true;
        });
      }

      nodes.forEach((n, i) => {
        const pulse = animate && n.hub ? 0.5 + 0.5 * Math.sin((tick + i * 30) / 34) : 1;
        ctx!.fillStyle = n.hub ? withAlpha(link, 0.35 + pulse * 0.5) : withAlpha(ink, 0.34);
        ctx!.beginPath();
        ctx!.arc(n.x, n.y, n.r * (n.hub ? 1.5 : 1), 0, Math.PI * 2);
        ctx!.fill();
        if (n.hub && animate) {
          ctx!.strokeStyle = withAlpha(link, 0.22 * pulse);
          ctx!.beginPath();
          ctx!.arc(n.x, n.y, 4 + pulse * 8, 0, Math.PI * 2);
          ctx!.stroke();
        }
      });
    }

    function frame() {
      tick += 1;
      ctx!.clearRect(0, 0, width, height);
      paintHalo();
      if (variant === 'grid') paintGrid((tick * 0.14) % 34);
      else paintFabric(true);
      raf = requestAnimationFrame(frame);
    }

    /** Un único fotograma: lo que ve quien pidió no tener movimiento. */
    function still() {
      ctx!.clearRect(0, 0, width, height);
      paintHalo();
      if (variant === 'grid') paintGrid(0);
      else paintFabric(false);
    }

    function start() {
      if (raf !== null || reduced) return;
      raf = requestAnimationFrame(frame);
    }
    function stop() {
      if (raf !== null) {
        cancelAnimationFrame(raf);
        raf = null;
      }
    }

    resize();
    if (reduced) still();

    // Solo se anima lo que está en pantalla: fuera de ella no se ve y sigue costando.
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && !document.hidden) start();
          else stop();
        }
      },
      { threshold: 0.05 },
    );
    io.observe(canvas);

    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    document.addEventListener('visibilitychange', onVisibility);

    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resize();
        if (reduced) still();
      }, 180);
    };
    window.addEventListener('resize', onResize);

    const onPointer = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = e.clientX - rect.left;
      pointer.y = e.clientY - rect.top;
    };
    const onPointerLeave = () => {
      pointer.x = -9999;
      pointer.y = -9999;
    };
    if (variant === 'fabric' && !reduced) {
      window.addEventListener('pointermove', onPointer);
      window.addEventListener('pointerleave', onPointerLeave);
    }

    return () => {
      stop();
      io.disconnect();
      clearTimeout(resizeTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('pointerleave', onPointerLeave);
    };
  }, [variant]);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className={cn('pointer-events-none absolute inset-0 h-full w-full', className)}
    />
  );
}

/**
 * Aplica alfa a un color de token. Los tokens `kr-*` son `#rrggbb`, pero el tema
 * claro podría traer otra notación, así que lo que no sea hexadecimal se devuelve
 * tal cual con `color-mix` — nunca se rompe el dibujado por un formato inesperado.
 */
function withAlpha(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return `color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, transparent)`;
}
