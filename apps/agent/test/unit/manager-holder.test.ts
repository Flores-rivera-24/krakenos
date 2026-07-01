import { describe, expect, it } from 'vitest';
import { createManagerHolder, disposeManager } from '../../src/integrations/manager-holder.js';

describe('manager-holder — recarga en caliente vía handle (US-141)', () => {
  it('el handle delega métodos y propiedades en la instancia viva; swap cambia el destino', () => {
    const a = {
      id: 'a',
      greet(): string {
        return `soy ${this.id}`;
      },
    };
    const b = { id: 'b', greet(): string {
        return `soy ${this.id}`;
      } };
    const disposed: string[] = [];
    const holder = createManagerHolder(a, (old) => disposed.push(old.id));

    expect(holder.current).toBe(a);
    expect(holder.handle.greet()).toBe('soy a'); // método ligado a la instancia actual
    expect(holder.handle.id).toBe('a'); // propiedad no-función

    holder.swap(b);
    expect(holder.current).toBe(b);
    expect(holder.handle.greet()).toBe('soy b'); // ahora delega en b
    expect(holder.handle.id).toBe('b');
    expect(disposed).toEqual(['a']); // se limpió la instancia saliente
  });

  it('swap por la misma instancia no dispara dispose', () => {
    const a = { id: 'a' };
    const disposed: string[] = [];
    const holder = createManagerHolder(a, (old) => disposed.push(old.id));
    holder.swap(a);
    expect(disposed).toEqual([]);
  });

  it('disposeManager invoca stop/close/dispose y traga fallos', () => {
    let stopped = false;
    disposeManager({
      stop() {
        stopped = true;
      },
    });
    expect(stopped).toBe(true);

    // Sin hooks → no lanza.
    expect(() => disposeManager({})).not.toThrow();
    // Hook que lanza → tragado.
    expect(() =>
      disposeManager({
        close() {
          throw new Error('boom');
        },
      }),
    ).not.toThrow();
    // Hook async que rechaza → no propaga (rechazo capturado).
    expect(() =>
      disposeManager({
        stop() {
          return Promise.reject(new Error('async boom'));
        },
      }),
    ).not.toThrow();
  });
});
