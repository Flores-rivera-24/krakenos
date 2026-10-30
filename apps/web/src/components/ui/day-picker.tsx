import { ToggleChip, ToggleChipGroup } from '@/components/ui/toggle-chip';
import { useT } from '@/lib/i18n';
import { diasCompletos, diasIniciales } from '@/lib/schedule-format';

export interface DayPickerProps {
  /** Índices de día marcados (0 = domingo). */
  selected: readonly number[];
  onToggle: (day: number) => void;
  'aria-label': string;
  disabled?: boolean;
}

/** Las siete casillas de la semana: la inicial a la vista y el nombre completo como nombre accesible. */
export function DayPicker({ selected, onToggle, disabled, ...rest }: DayPickerProps) {
  const t = useT();
  const completos = diasCompletos(t);
  return (
    <ToggleChipGroup
      aria-label={rest['aria-label']}
      className="grid grid-cols-7 gap-1 md:flex md:flex-wrap"
    >
      {diasIniciales(t).map((inicial, d) => (
        <ToggleChip
          key={d}
          shape="day"
          className="w-full min-w-0 md:w-9"
          pressed={selected.includes(d)}
          onPressedChange={() => onToggle(d)}
          aria-label={completos[d]}
          disabled={disabled}
        >
          {inicial}
        </ToggleChip>
      ))}
    </ToggleChipGroup>
  );
}
