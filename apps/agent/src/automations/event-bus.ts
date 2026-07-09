import type { HomeEvent } from '@krakenos/types';

export type HomeEventHandler = (event: HomeEvent) => void | Promise<void>;

/**
 * Bus interno ligero de eventos del hogar (US-167). Los productores (inventario,
 * watcher IoT) publican y el motor de automatizaciones se suscribe. Sin colas ni
 * persistencia: es fan-out en proceso; un handler que falle no afecta ni al
 * productor ni al resto de handlers (fire-and-forget con captura).
 */
export class HomeEventBus {
  private readonly handlers: HomeEventHandler[] = [];

  constructor(private readonly onError?: (err: unknown, event: HomeEvent) => void) {}

  subscribe(handler: HomeEventHandler): void {
    this.handlers.push(handler);
  }

  publish(event: HomeEvent): void {
    for (const handler of this.handlers) {
      try {
        const result = handler(event);
        if (result && typeof result.catch === 'function') {
          result.catch((err: unknown) => this.onError?.(err, event));
        }
      } catch (err) {
        this.onError?.(err, event);
      }
    }
  }
}
