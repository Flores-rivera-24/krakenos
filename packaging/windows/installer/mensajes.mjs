/** Mensajes del instalador de Windows (es/en). El idioma lo pasa NSIS con `--lang`. */
const CATALOGO = {
  es: {
    puertoOcupado: (pref, usado) =>
      `El puerto ${pref} está ocupado en este equipo: KrakenOS usará el ${usado}.`,
    listo: (puerto) => `El servicio de KrakenOS está en marcha en el puerto ${puerto}.`,
    tlsListo: (origen) =>
      `HTTPS listo en ${origen}. Este PC ya confía en la CA local; cada celular debe instalarla una vez (se descarga en ${origen}/api/system/ca-cert).`,
    caRotada: () =>
      'La carpeta de la CA estaba abierta a otros usuarios: se generó una CA nueva y se quitó la anterior de este PC. Los celulares que confiaban en la anterior deben instalar la nueva.',
    fallo: (detalle) => `La instalación de KrakenOS no terminó: ${detalle}`,
  },
  en: {
    puertoOcupado: (pref, usado) =>
      `Port ${pref} is already in use on this PC: KrakenOS will use ${usado}.`,
    listo: (puerto) => `The KrakenOS service is running on port ${puerto}.`,
    tlsListo: (origen) =>
      `HTTPS is ready at ${origen}. This PC already trusts the local CA; each phone must install it once (download it at ${origen}/api/system/ca-cert).`,
    caRotada: () =>
      'The CA folder was open to other users: a new CA was generated and the old one was removed from this PC. Phones that trusted the old one must install the new one.',
    fallo: (detalle) => `The KrakenOS installation did not finish: ${detalle}`,
  },
};

export function msg(lang, clave, ...args) {
  return (CATALOGO[lang] ?? CATALOGO.es)[clave](...args);
}
