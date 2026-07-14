/**
 * Proyección segura DB→enum (AUD-20). SQLite guarda los enums como texto libre
 * (`Device.type`, `Scene.icon`, roles…), así que un valor legado o corrupto puede
 * no pertenecer a la unión actual: un cast ciego (`row.icon as SceneIcon`) haría
 * que el tipo **mienta**. Este helper valida contra los valores vigentes y cae a un
 * `fallback` conocido, de modo que el tipo devuelto sea siempre real.
 */
export function asEnum<T extends string>(value: string, values: readonly T[], fallback: T): T {
  return (values as readonly string[]).includes(value) ? (value as T) : fallback;
}
