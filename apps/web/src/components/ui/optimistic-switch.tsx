import { Switch } from '@/components/ui/switch';
import { describeError } from '@/lib/errors';
import { useOptimisticToggle } from '@/lib/use-optimistic-toggle';
import { toast } from '@/store/toast.store';

interface Props {
  checked: boolean;
  /** Aplica el cambio. Si rechaza, el switch revierte y se avisa con un toast. */
  onToggle: (next: boolean) => Promise<unknown>;
  disabled?: boolean;
  /** Texto base del toast de error (se completa con `describeError`). */
  errorMessage?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}

/**
 * `Switch` optimista estándar (US-96): se mueve al instante, se deshabilita
 * mientras va la petición y **revierte + toast** si falla. Centraliza el patrón
 * pendiente→éxito→error-revert para todos los toggles de escritura (IoT, redes,
 * reglas de firewall/QoS), de modo que ninguno mienta sobre el estado real.
 */
export function OptimisticSwitch({
  checked,
  onToggle,
  disabled,
  errorMessage = 'No se pudo aplicar el cambio',
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
}: Props) {
  const { on, pending, toggle } = useOptimisticToggle({
    value: checked,
    mutate: onToggle,
    onError: (err) => toast.error(describeError(err, errorMessage)),
  });

  return (
    <Switch
      checked={on}
      disabled={disabled || pending}
      onCheckedChange={() => void toggle()}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledby}
    />
  );
}
