import type { RoomWithState } from '@krakenos/types';
import { Label } from '@/components/ui/label';
import { useT } from '@/lib/i18n';
import { roomGlyph } from '@/lib/rooms';

const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-kr bg-kr-elevated px-3 py-2 text-kr-base text-kr-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

interface Props {
  id?: string;
  rooms: RoomWithState[];
  /** Id de la habitación actual, o `null` si ninguna. */
  value: string | null;
  disabled?: boolean;
  onChange: (roomId: string | null) => void;
}

/**
 * Selector de habitación reutilizable (US-165): en el detalle del dispositivo de
 * red y en el de IoT. Presentacional — el padre ejecuta la asignación y refleja
 * la verdad del servidor. `''` en el `<option>` = "Sin habitación".
 */
export function RoomSelect({ id = 'room-select', rooms, value, disabled, onChange }: Props) {
  const t = useT();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{t('rooms.select.label')}</Label>
      <select
        id={id}
        className={SELECT_CLASS}
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      >
        <option value="">{t('rooms.select.none')}</option>
        {rooms.map((r) => (
          <option key={r.id} value={r.id}>
            {roomGlyph(r.icon)} {r.name}
          </option>
        ))}
      </select>
    </div>
  );
}
