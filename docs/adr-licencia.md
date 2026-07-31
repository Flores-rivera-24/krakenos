# ADR — Licencia del proyecto: AGPL-3.0-or-later

- **Estado:** Aceptado (2026-07-30)
- **Origen:** US-257. Hasta esta fecha el repositorio **no tenía fichero `LICENSE`** ni campo
  `license` en ningún `package.json`. Sin declaración expresa, el derecho de autor por defecto es
  **«todos los derechos reservados»**: nadie —ni siquiera quien clonaba el repo público— tenía
  permiso formal para usarlo, modificarlo ni redistribuirlo. «Open source mío» no significaba nada.
- **Qué desbloquea:** poder razonar sobre **integrar componentes GPL/AGPL** del mundo OpenWrt y
  self-hosted, que es una decisión de arquitectura que estaba bloqueada por no tener licencia propia.

---

## Decisión en una línea

Todo el monorepo (agente, web, tipos, scripts, instalador y documentación) se licencia bajo
**GNU Affero General Public License v3.0 o posterior** (`AGPL-3.0-or-later`), con el texto íntegro
de la FSF en `LICENSE`.

## Por qué AGPL y no una permisiva

1. **La opcionalidad es asimétrica, y hoy se puede elegir las dos puertas.** El copyright es de una
   sola persona: 471 commits, **un único autor** (verificado con `git log`). Mientras eso siga
   siendo cierto, el titular puede **relicenciar a una permisiva cuando quiera** o vender
   excepciones. Al revés no funciona: lo que se publica una vez bajo MIT sigue siendo MIT para
   siempre y no se recupera. Empezar por la restrictiva **conserva las dos opciones**; empezar por
   la permisiva quema una.
2. **La Fase C (SaaS multi-tenant) sigue en el roadmap.** Bajo MIT o Apache-2.0, un tercero puede
   ofrecer KrakenOS como servicio de pago sin devolver una línea. La §13 de la AGPL —la cláusula que
   distingue a esta licencia de la GPL— es exactamente lo que lo impide. **Al dueño no le limita**:
   quien tiene el copyright no necesita licenciarse a sí mismo.
3. **Es la única familia que permite integrar componentes GPL/AGPL de terceros**, que es lo que
   US-257 dice desbloquear. La compatibilidad va en un solo sentido: código Apache-2.0 o MIT **entra**
   en un proyecto AGPL, pero código GPL/AGPL **no entra** en uno Apache o MIT.
4. **Coherencia con lo que el producto dice ser.** `adr-control-total.md` declara que el enemigo es
   la app del fabricante y que el usuario debe tener el control de su casa. Una licencia que permite
   a un tercero cerrar el código y revenderlo contradice ese discurso en el único documento que un
   abogado leería.

## Compatibilidad verificada, no supuesta

Inventario completo del árbol de dependencias (`pnpm licenses list`, 2026-07-30):

| Ámbito | Licencias encontradas |
|---|---|
| **Producción** (287 paquetes) | MIT 232 · ISC 29 · Apache-2.0 14 · BSD-3-Clause 8 · BSD-2-Clause 1 · 0BSD 1 · «MIT AND ISC» 1 (`victory-vendor`) · MPL-2.0 1 (`web-push`) |
| **+ desarrollo** (total) | las anteriores + BlueOak-1.0.0 6 · MIT-0 2 · Python-2.0 1 (`argparse`) · CC-BY-4.0 1 (`caniuse-lite`) · CC0-1.0 1 (`mdn-data`) · MPL-2.0 (`axe-core`) |
| **Opcionales de integraciones** (no van en `package.json`, se instalan en el servidor) | `node-ssh`, `mqtt`, `net-snmp`, `ws`, `tuyapi` → MIT · `@matter/main` → Apache-2.0 |

**Ninguna es incompatible con AGPL-3.0.** Las tres que no son permisivas obvias:

- **MPL-2.0** (`web-push`, `axe-core`) — su §3.3 autoriza expresamente combinar con GPL/AGPL como
  *Secondary License*.
- **Python-2.0** (`argparse`) — declarada compatible con la GPL por la FSF.
- **CC-BY-4.0** (`caniuse-lite`) — compatible en un solo sentido hacia GPLv3+, y es un **dato de
  build** (tabla de navegadores), no código enlazado.

No aparece ninguna licencia no-libre ni de fuente disponible (SSPL, BUSL, Elastic, CC-BY-NC) ni la
licencia «JSON» del *shall be used for Good, not Evil*, que sí habría sido un problema.

## Lo que esta licencia NO hace

- **No obliga a nada a quien la usa en su casa.** El copyleft se dispara al **distribuir** el
  programa o al ofrecer una versión **modificada** a terceros por red. Autohospedarlo para la propia
  familia no genera ninguna obligación, ni siquiera bajo la §13.
- **No impide vender.** Ni el software, ni soporte, ni una versión hospedada.
- **No aplica retroactivamente** a nada, porque no había versiones publicadas bajo otra licencia.
  ⚠️ El tag **`v0.1.0` se publicó sin fichero de licencia**; queda cubierto a partir de esta
  declaración, no antes.

## Consecuencias

- **Obligación que hay que honrar, no solo declarar (AGPL §13).** Una versión modificada ofrecida
  por red debe dar a sus usuarios acceso al código correspondiente. Se cumple con la tarjeta
  **«Acerca de»** en Ajustes → Sistema, visible para **cualquier rol** (no solo admin), con el
  nombre de la licencia y el enlace al repositorio. El propio texto de la AGPL sugiere justo eso:
  *«if your program is a web application, its interface could display a "Source" link»*.
- **El dual-licensing depende de seguir siendo el único titular.** La **primera contribución externa
  aceptada sin DCO ni cesión de derechos congela la licencia para siempre**: ya no se puede
  relicenciar sin el permiso de esa persona. Si llega un PR de fuera, hay que decidir antes de
  mergearlo —pedir DCO/CLA o aceptar que la puerta se cierra—; no después.
- **Integrar un componente GPL/AGPL de terceros cierra esa misma puerta**, por la misma razón. Es
  una decisión con fecha de caducidad: se puede tomar, pero sabiendo que es de ida.
- **Se acepta el coste de adoption.** La AGPL ahuyenta a empresas que no quieren auditar su
  cumplimiento. Es irrelevante para un mantenedor único cuyo público objetivo son self-hosters, y es
  el mismo cálculo que hicieron Nextcloud, Grafana e Immich.
- **Un `LICENSE` en la raíz no basta si el binario viaja aparte.** La imagen Docker lo incluye
  (`COPY . .` y `.dockerignore` no lo excluye) y el instalador clona el repo, así que las dos vías
  de distribución lo llevan. Una vía de distribución nueva tiene que llevarlo también.

## Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| **MIT / Apache-2.0** | Regala la Fase C (cualquiera puede ofrecerlo como SaaS sin devolver nada) y **cierra** la integración de componentes GPL/AGPL, que es justo lo que US-257 quería abrir. Es también la opción irreversible |
| **GPL-3.0** | No cubre el uso **por red**, que es exactamente la forma en que se usa este producto: un panel web. Bajo GPL, un tercero puede hospedarlo modificado y no publicar nada |
| **BUSL / Elastic License / SSPL** | No son licencias de código abierto. Contradicen «open source mío» y las rechazan tanto la OSI como buena parte del público self-hoster al que va dirigido |
| **Seguir sin licencia** | El statu quo: «todos los derechos reservados». Nadie puede colaborar, empaquetar ni recomendar el proyecto con confianza jurídica |

## Reevaluar si…

- **Llega una contribución externa que se quiera mergear** → decidir DCO/CLA **antes** del merge.
- **La bifurcación del `BACKLOG.md` acaba en la opción C** (archivar como pieza de portfolio) →
  entonces una permisiva maximiza la utilidad de lo escrito y ya no hay Fase C que proteger.
- **Aparece una dependencia imprescindible con licencia incompatible** → el gate de
  `apps/agent/test/unit/license.test.ts` lo cazará al añadirla, no meses después.

> Relacionados: [`adr-control-total.md`](adr-control-total.md) (por qué el control del usuario es la
> tesis del producto) · [`adr-distribution.md`](adr-distribution.md) (cómo se distribuye) ·
> `LICENSE` (el texto íntegro) · `BACKLOG.md → US-257`.
