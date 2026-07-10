# Guía de estilo de copy — KrakenOS web

Baseline **derivado de lo que la app ya hace mayoritariamente** (auditoría US-209, 2026-07-09), no
de una voz inventada. Toda historia nueva que añada texto visible debe seguir esta guía.

## Idioma

- **Todo el texto visible de la app es español (es-ES)**: páginas, componentes, toasts, errores,
  aria-labels, guías y glosario. No existe un «chrome en inglés»: un string en inglés dentro de la
  UI es un bug de copy, salvo los términos retenidos de abajo.
- `manifest.json` conserva el nombre de marca `KrakenOS — Home Control` (tagline de producto).
- Los **comentarios de código** y los identificadores no cuentan como copy.

### Términos retenidos (se dejan en inglés/técnico, adrede)

| Término | Dónde | Por qué |
|---|---|---|
| Dashboard | nav + título de página | nombre de producto del panel (estilo UniFi) |
| Firewall | título de página; el cuerpo usa «cortafuegos» al explicar | término establecido; el asistente lo glosa |
| Driver, Uptime, CPU, RAM | sidebar avanzada, widget Sistema | jerga deliberada de modo avanzado; el modo sencillo la oculta (US-176) |
| Endpoint, handshake | VPN (WireGuard) | vocabulario propio de WireGuard; glosado en guías |
| passkey | login/seguridad | término de producto WebAuthn en español coloquial |
| WiFi, IoT, VLAN, QoS, DNS, SSID, MAC, IP/CIDR, RTSP, ONVIF, SSH, SMTP | global | siglas/estándares; el asistente y el glosario los explican |
| Push / Email / Telegram | tabla de alertas | nombres de canal/producto |

En **bloques de comandos** de las guías, los placeholders van en ASCII (`TU_PASSWORD`), nunca con
`ñ`/tildes: se pegan en CLIs de routers.

## Terminología canónica (por concepto)

| Concepto | Canónico | Prohibido / matiz |
|---|---|---|
| aparato de red | **dispositivo** | «aparato» solo en prosa explicativa de guías/ayudas (registro coloquial); nunca «peer» ni «disp» |
| habitación | **habitación** | no «estancia» |
| recorrido de medición (coverage) | **recorrido** (pestaña «Medición») | no «survey» en texto visible |
| lista de dominios bloqueados | **lista de bloqueo** / **listas por categoría** | no «blocklist» ni «feeds» visibles |
| copia de seguridad | **copia de seguridad** (o «la copia» en labels cortos) | no «backup» visible |
| eliminar (destruir una entidad) | **Eliminar** | no «Borrar» |
| quitar (sacar de una lista/lienzo, reversible) | **Quitar** | correcto en DNS (quitar dominio), paleta de APs, «Quitar imagen» |
| descartar (sugerencias/avisos) | **Descartar** | |
| guardar | **Guardar cambios** (edición) / **Guardar** (alta o formularios cortos) | |
| habilitar/deshabilitar cuentas | **Habilitar / Deshabilitar** | par simétrico |
| activar/desactivar features y reglas | **Activar / Desactivar** («Activado/Desactivado») | un horario desactivado es «(desactivado)», no «(pausado)» |
| pausar | reservado a **pausar internet** de un dispositivo (`pausedUntil`) | |
| estado de red de un dispositivo | **En línea / Desconectado / Bloqueado** | |
| alcanzabilidad IoT | **disponible / sin señal** | distinto del estado de red, a propósito |
| presencia de personas | **en casa / fuera** | |
| stream en tiempo real (socket) | **En tiempo real / Reconectando… / Sin conexión** | estados US-93/94; no inventar variantes |
| datos no en vivo | **Datos obsoletos** (+ tooltip «Sin datos en vivo…») | |
| escanear inventario de red | **Escanear la red** (Inventario) | acción distinta de… |
| buscar IoT (descubrimiento US-175) | **Buscar dispositivos** (Conectar) | …que se llama así a propósito |
| firewall: acción de regla | **Bloquear / Permitir** (valor de API `deny`/`allow` nunca visible) | |
| protocolo `any` | **Cualquiera** | TCP/UDP en mayúsculas |
| seguridad WiFi `open` | **Abierta (sin contraseña)** | |

## Mayúsculas

- **Sentence case en todo**: botones («Añadir regla», «Guardar cambios»), títulos de página y de
  card («Ajustes», «Copia de seguridad»), pestañas. Nunca Title Case ni MAYÚSCULAS (salvo siglas).
- **Badges y valores de estado, capitalizados**: «Bloqueado», «En línea», «Activo», «Aislada»,
  «Bloqueada/Permitida».

## Puntuación

- **Toasts de una frase: sin punto final** («Regla creada», «Dispositivo eliminado»). Toasts de
  varias frases sí llevan puntos («Restauración preparada. … Reinicia el agente.»).
- **Errores inline y validaciones: frase completa con punto final** («Ponle un nombre a la
  escena.», «Elige al menos un día.»).
- **Estados vacíos: frase con punto** («Sin dispositivos IoT.») o enlace-acción sin punto
  («Crea tu primera escena →»).
- **Elipsis: siempre el carácter `…`** (U+2026), nunca `...`, tanto en gerundios de progreso
  («Guardando…») como en placeholders. Excepción: el cuerpo largo de las guías usa `...`
  históricamente; es consistente internamente y no se migra.
- **Comillas: guillemets `« »`** para citar términos de UI, nombres y ejemplos. Comillas rectas
  `" "` solo dentro de bloques de comandos/valores literales de las guías.
- **Separador inline: punto medio `·`** («En tiempo real · conectado»).
- **Rutas de menús en guías: flecha `→`** («Firewall → MAC filter»).

## Errores y honestidad

- Patrón de fallo: **«No se pudo + infinitivo»** («No se pudo eliminar el horario»). El fallback de
  `describeError` añade `(error N).` cuando el agente no manda mensaje; no filtrar jamás el
  `statusText` en inglés del navegador (fix US-209 en `lib/api.ts`).
- Fallo de red ≠ error del servidor: «No se pudo conectar con el servidor. Revisa tu conexión.»
  solo cuando la petición no llegó.
- Reintento: **«Inténtalo de nuevo.»** (formal, con punto); botón **«Reintentar»**.
- **No prometer más que la app**: acciones best-effort (escenas, acción de grupo) reportan el
  parcial real («N aplicado(s), M sin responder»); restaurar dice «preparada», no «restaurada»;
  guardar con fallback avisa de que no se aplicó.
- Progreso con contexto: gerundio específico («Bloqueando…», «Probando…», «Conectando…») mejor que
  «Cargando…»; el `LoadingLine` genérico queda para listas.

## Accesibilidad

- aria-label / sr-only / title son copy de primera: mismas reglas e idioma (español).
- El aria-label de un control **debe describir la acción real en su estado actual**: un
  interruptor de encendido anuncia «Apagar X» cuando está encendido (fix US-209).
- Concordancia de número computada, no «1 clientes»: `{n} {n === 1 ? 'cliente' : 'clientes'}`. El
  patrón «aplicado(s)» se tolera solo en toasts de resultado parcial ya establecidos.

## Propuestas debatibles (NO aplicadas en US-209 — decidir en historia propia)

- Renombrar «Dashboard» → «Panel» (ripple en nav, tests y hábito UniFi).
- Distinguir «Sin conexión» (stream) de «Sin conexión con el router» (driver) con wording propio
  en `ConnectionStatus`.
- Unificar los 4 placeholders de «dejar en blanco para conservar» en una sola fórmula.
- Sustituir el patrón «aplicado(s)» por plural computado en toasts parciales.
- El email prellenado `admin@krakenos.local` en el login (comportamiento, no copy).
- «Esperando muestras…» → «Esperando datos de tráfico…».
- Canal del toast parcial de escenas/habitaciones (hoy `toast.error`; ¿warning/info?).
