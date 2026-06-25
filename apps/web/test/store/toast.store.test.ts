import { beforeEach, describe, expect, it } from 'vitest';
import { toast, useToastStore } from '@/store/toast.store';

describe('toast.store', () => {
  beforeEach(() => useToastStore.setState({ toasts: [] }));

  it('encola toasts de éxito y error con su tipo', () => {
    toast.success('guardado');
    toast.error('falló');
    const { toasts } = useToastStore.getState();
    expect(toasts.map((t) => t.kind)).toEqual(['success', 'error']);
    expect(toasts.map((t) => t.message)).toEqual(['guardado', 'falló']);
  });

  it('descarta por id sin tocar el resto', () => {
    toast.info('a');
    toast.info('b');
    const [first] = useToastStore.getState().toasts;
    useToastStore.getState().dismiss(first!.id);
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual(['b']);
  });
});
