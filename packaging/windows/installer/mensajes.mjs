/** Mensajes del instalador de Windows (es/en). El idioma lo pasa NSIS con `--lang`. */
const CATALOGO = {
  es: {
    puertoOcupado: (pref, usado) =>
      `El puerto ${pref} está ocupado en este equipo: KrakenOS usará el ${usado}.`,
    listo: (puerto) => `El servicio de KrakenOS está en marcha en el puerto ${puerto}.`,
    fallo: (detalle) => `La instalación de KrakenOS no terminó: ${detalle}`,
  },
  en: {
    puertoOcupado: (pref, usado) =>
      `Port ${pref} is already in use on this PC: KrakenOS will use ${usado}.`,
    listo: (puerto) => `The KrakenOS service is running on port ${puerto}.`,
    fallo: (detalle) => `The KrakenOS installation did not finish: ${detalle}`,
  },
};

export function msg(lang, clave, ...args) {
  return (CATALOGO[lang] ?? CATALOGO.es)[clave](...args);
}
