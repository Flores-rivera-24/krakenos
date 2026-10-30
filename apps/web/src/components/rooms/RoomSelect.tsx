import type { RoomWithState } from '@krakenos/types';
import { Select } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useT } from '@/lib/i18n';

interface Props {
  id?: string;
  rooms: RoomWithState[];
  /** Id de la habitación actual, o `null` si ninguna. */
  value: string | null;
  disabled?: boolean;
  /** Texto neutro cuando la lista no llegó y hay una asignación: no se afirma «sin habitación». */
  assignedLabel?: string;
  onChange: (roomId: string | null) => void;
}

/**
 * Selector de habitación reutilizable (US-165): en el detalle del dispositivo de
 * red y en el de IoT. Presentacional — el padre ejecuta la asignación y refleja
 * la verdad del servidor. `''` en el `<option>` = "Sin habitación".
 */
export function RoomSelect({
  id = 'room-select',
  rooms,
  value,
  disabled,
  assignedLabel,
  onChange,
}: Props) {
  const t = useT();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{t('rooms.select.label')}</Label>
      <Select
        id={id}
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      >
        {assignedLabel ? (
          <option value={value ?? ''}>{assignedLabel}</option>
        ) : (
          <option value="">{t('rooms.select.none')}</option>
        )}
        {rooms.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </Select>
    </div>
  );
}
