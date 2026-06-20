/**
 * Vista de compatibilidad de hardware: muestra el mapa de la red del hogar y
 * qué puede controlar KrakenOS en cada dispositivo. El SVG se sirve como asset
 * estático desde `public/`.
 */
export function CompatibilityPage() {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="text-xl font-semibold">Compatibilidad de hardware</h2>
        <p className="text-sm text-muted-foreground">
          Mapa de la red del hogar y nivel de control de KrakenOS por dispositivo.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <img
          src="/hardware_compatibility_map.svg"
          alt="Mapa de compatibilidad de hardware con KrakenOS"
          className="mx-auto h-auto w-full max-w-3xl"
        />
      </div>
    </div>
  );
}
