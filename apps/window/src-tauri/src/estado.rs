use url::Url;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Motivo {
    Red,
    Certificado,
    TiempoAgotado,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Estado {
    Activo,
    NoListo,
    NoResponde(Motivo),
}

/// Por qué falló el sondeo de `/health/ready` sin llegar a una respuesta HTTP.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorSondeo {
    Red,
    Tls,
    TiempoAgotado,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Destino {
    Agente(Url),
    /// Página local: "inicial" (neutra, antes de medir) | "no-responde" | "no-listo" |
    /// "sin-configurar" | "certificado" (fallo de TLS: no se sabe si es el certificado).
    Local(&'static str),
}

/// Activo es exactamente 200; cualquier otra respuesta (el agente da 503 si no está listo) = no listo.
pub fn estado_desde_sondeo(r: Result<u16, ErrorSondeo>) -> Estado {
    match r {
        Ok(200) => Estado::Activo,
        Ok(_) => Estado::NoListo,
        Err(ErrorSondeo::Tls) => Estado::NoResponde(Motivo::Certificado),
        Err(ErrorSondeo::TiempoAgotado) => Estado::NoResponde(Motivo::TiempoAgotado),
        Err(ErrorSondeo::Red) => Estado::NoResponde(Motivo::Red),
    }
}

/// Adónde navegar tras un cambio de estado; `None` = ya se está ahí, no navegar.
/// Al volver a `Activo` se regresa a la última ruta del agente, no al inicio.
pub fn siguiente_destino(
    actual: &Destino,
    ultima_ruta_agente: Option<&Url>,
    nuevo: &Estado,
    origin: Option<&Url>,
) -> Option<Destino> {
    let objetivo = match (origin, nuevo) {
        (None, _) => Destino::Local("sin-configurar"),
        (Some(o), Estado::Activo) => {
            if matches!(actual, Destino::Agente(_)) {
                return None;
            }
            Destino::Agente(ultima_ruta_agente.unwrap_or(o).clone())
        }
        (Some(_), Estado::NoListo) => Destino::Local("no-listo"),
        (Some(_), Estado::NoResponde(Motivo::Certificado)) => Destino::Local("certificado"),
        (Some(_), Estado::NoResponde(_)) => Destino::Local("no-responde"),
    };
    (&objetivo != actual).then_some(objetivo)
}

/// Sondeos fallidos seguidos que hacen falta para sacar al usuario del agente.
pub const FALLOS_PARA_SALIR: u32 = 2;
/// Segundos hasta el re-sondeo de confirmación tras un primer fallo dentro del agente.
pub const CONFIRMACION_SEGS: u64 = 1;

/// Qué hacer tras un sondeo: adónde navegar, la racha de fallos que queda y cuándo volver a sondear.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Decision {
    pub destino: Option<Destino>,
    pub fallos: u32,
    pub siguiente_en_segs: u64,
}

/// Entrar al agente basta con un sondeo bueno; salir de él exige `FALLOS_PARA_SALIR` seguidos
/// (el primero se confirma con un re-sondeo rápido), para que un fallo aislado no recargue la ruta
/// y se lleve un formulario a medias. Con la página local ya en pantalla no hay nada que confirmar.
pub fn decidir(
    actual: &Destino,
    ultima_ruta_agente: Option<&Url>,
    nuevo: &Estado,
    origin: Option<&Url>,
    fallos_previos: u32,
) -> Decision {
    let fallos = if *nuevo == Estado::Activo {
        0
    } else {
        fallos_previos.saturating_add(1)
    };
    if matches!(actual, Destino::Agente(_)) && fallos > 0 && fallos < FALLOS_PARA_SALIR {
        return Decision {
            destino: None,
            fallos,
            siguiente_en_segs: CONFIRMACION_SEGS,
        };
    }
    let destino = siguiente_destino(actual, ultima_ruta_agente, nuevo, origin);
    let queda = destino.as_ref().unwrap_or(actual);
    Decision {
        siguiente_en_segs: intervalo_segs(queda),
        destino,
        fallos,
    }
}

/// Texto de la bandeja: solo lo medido (`None` = sin origen configurado).
pub fn texto_bandeja(estado: Option<&Estado>, en: bool) -> &'static str {
    match (estado, en) {
        (Some(Estado::Activo), false) => "KrakenOS: Activo",
        (Some(Estado::Activo), true) => "KrakenOS: Active",
        (Some(Estado::NoListo), false) => "KrakenOS: No está listo",
        (Some(Estado::NoListo), true) => "KrakenOS: Not ready",
        (Some(Estado::NoResponde(_)), false) => "KrakenOS: No responde",
        (Some(Estado::NoResponde(_)), true) => "KrakenOS: Not responding",
        (None, false) => "KrakenOS: sin configurar",
        (None, true) => "KrakenOS: not set up",
    }
}

/// Segundos hasta el próximo sondeo: 2 con la página local (volver pronto), 5 en el agente.
pub fn intervalo_segs(actual: &Destino) -> u64 {
    match actual {
        Destino::Local(_) => 2,
        Destino::Agente(_) => 5,
    }
}

/// URL de la página local: la base que Tauri dio a la ventana con otro estado y reintento.
pub fn url_local(base: &Url, estado: &str, reintento_segs: u64) -> Url {
    let mut url = base.clone();
    url.set_query(None);
    url.query_pairs_mut()
        .append_pair("estado", estado)
        .append_pair("reintento", &reintento_segs.to_string());
    url
}

/// Dónde está la ventana: en el agente si la URL es de su origen; si no, en la local conocida.
pub fn destino_actual(url: &Url, origin: &Url, local_previo: &Destino) -> Destino {
    if url.origin() == origin.origin() {
        Destino::Agente(url.clone())
    } else {
        local_previo.clone()
    }
}

/// Ruta del agente que se recuerda para volver a ella: sin el token de `/setup`, que es de un solo uso.
pub fn ruta_a_recordar(url: &Url, origin: &Url) -> Option<Url> {
    if url.origin() != origin.origin() {
        return None;
    }
    let resto: Vec<(String, String)> = url
        .query_pairs()
        .filter(|(k, _)| k != "token")
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    let mut limpia = url.clone();
    limpia.set_query(None);
    if !resto.is_empty() {
        limpia.query_pairs_mut().extend_pairs(resto);
    }
    Some(limpia)
}

/// El enlace de `/setup` pendiente (con su token) se entrega una sola vez, cuando el agente está activo.
pub fn aplicar_setup(estado: &Estado, pendiente: &mut Option<Url>) -> Option<Url> {
    if *estado == Estado::Activo {
        pendiente.take()
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn estado_200_es_activo() {
        assert_eq!(estado_desde_sondeo(Ok(200)), Estado::Activo);
    }

    #[test]
    fn estado_503_es_no_listo() {
        assert_eq!(estado_desde_sondeo(Ok(503)), Estado::NoListo);
    }

    #[test]
    fn solo_el_200_es_activo() {
        for codigo in [201, 204, 301, 302, 401, 404, 500, 503] {
            assert_eq!(estado_desde_sondeo(Ok(codigo)), Estado::NoListo, "{codigo}");
        }
    }

    #[test]
    fn error_tls_se_distingue() {
        assert_eq!(
            estado_desde_sondeo(Err(ErrorSondeo::Tls)),
            Estado::NoResponde(Motivo::Certificado)
        );
        assert_eq!(
            estado_desde_sondeo(Err(ErrorSondeo::Red)),
            Estado::NoResponde(Motivo::Red)
        );
        assert_eq!(
            estado_desde_sondeo(Err(ErrorSondeo::TiempoAgotado)),
            Estado::NoResponde(Motivo::TiempoAgotado)
        );
    }

    #[test]
    fn transicion_activo_a_no_responde_va_a_local() {
        let o = u("https://casa.local:3001/");
        let actual = Destino::Agente(o.clone());
        let d = siguiente_destino(&actual, None, &Estado::NoResponde(Motivo::Red), Some(&o));
        assert_eq!(d, Some(Destino::Local("no-responde")));
        let d = siguiente_destino(
            &actual,
            None,
            &Estado::NoResponde(Motivo::Certificado),
            Some(&o),
        );
        assert_eq!(d, Some(Destino::Local("certificado")));
        let d = siguiente_destino(&actual, None, &Estado::NoListo, Some(&o));
        assert_eq!(d, Some(Destino::Local("no-listo")));
    }

    #[test]
    fn transicion_conserva_la_ruta_al_volver() {
        let o = u("https://casa.local:3001/");
        let ruta = u("https://casa.local:3001/devices");
        let previo = Destino::Local("no-responde");
        let d = siguiente_destino(&previo, Some(&ruta), &Estado::Activo, Some(&o));
        assert_eq!(d, Some(Destino::Agente(ruta)));
        let d = siguiente_destino(
            &Destino::Local("no-responde"),
            None,
            &Estado::Activo,
            Some(&o),
        );
        assert_eq!(d, Some(Destino::Agente(o)));
    }

    #[test]
    fn mismo_estado_no_navega() {
        let o = u("https://casa.local:3001/");
        let en_agente = Destino::Agente(u("https://casa.local:3001/devices"));
        assert_eq!(
            siguiente_destino(&en_agente, None, &Estado::Activo, Some(&o)),
            None
        );
        let local = Destino::Local("no-responde");
        let nuevo = Estado::NoResponde(Motivo::TiempoAgotado);
        let d = siguiente_destino(&local, None, &nuevo, Some(&o));
        assert_eq!(d, None);
    }

    #[test]
    fn sin_origen_va_a_sin_configurar() {
        let d = siguiente_destino(&Destino::Local("no-responde"), None, &Estado::Activo, None);
        assert_eq!(d, Some(Destino::Local("sin-configurar")));
        let d = siguiente_destino(
            &Destino::Local("sin-configurar"),
            None,
            &Estado::Activo,
            None,
        );
        assert_eq!(d, None);
    }

    #[test]
    fn texto_bandeja_dice_solo_lo_medido() {
        assert_eq!(
            texto_bandeja(Some(&Estado::Activo), false),
            "KrakenOS: Activo"
        );
        assert_eq!(
            texto_bandeja(Some(&Estado::NoListo), false),
            "KrakenOS: No está listo"
        );
        let nr = Estado::NoResponde(Motivo::Red);
        assert_eq!(texto_bandeja(Some(&nr), false), "KrakenOS: No responde");
        assert_eq!(texto_bandeja(Some(&nr), true), "KrakenOS: Not responding");
        assert_eq!(
            texto_bandeja(Some(&Estado::Activo), true),
            "KrakenOS: Active"
        );
        assert_eq!(
            texto_bandeja(Some(&Estado::NoListo), true),
            "KrakenOS: Not ready"
        );
        assert_eq!(texto_bandeja(None, false), "KrakenOS: sin configurar");
        assert_eq!(texto_bandeja(None, true), "KrakenOS: not set up");
    }

    #[test]
    fn intervalo_es_menor_con_la_pagina_local() {
        assert_eq!(intervalo_segs(&Destino::Local("no-responde")), 2);
        assert_eq!(intervalo_segs(&Destino::Agente(u("https://a.local/"))), 5);
    }

    #[test]
    fn url_local_cambia_estado_y_reintento_sobre_la_base() {
        let base = u("http://tauri.localhost/index.html?estado=no-responde");
        let d = url_local(&base, "no-listo", 2);
        assert_eq!(
            d.as_str(),
            "http://tauri.localhost/index.html?estado=no-listo&reintento=2"
        );
    }

    #[test]
    fn destino_actual_distingue_agente_de_local_por_origen() {
        let o = u("http://localhost:3001/");
        let previo = Destino::Local("no-responde");
        let en_agente = u("http://localhost:3001/devices?x=1");
        assert_eq!(
            destino_actual(&en_agente, &o, &previo),
            Destino::Agente(en_agente.clone())
        );
        assert_eq!(
            destino_actual(&u("http://tauri.localhost/index.html"), &o, &previo),
            previo
        );
        // mismo host, otro puerto: no es el agente
        assert_eq!(
            destino_actual(&u("http://localhost:3002/"), &o, &previo),
            previo
        );
    }

    #[test]
    fn ruta_a_recordar_quita_el_token_y_rechaza_otro_origen() {
        let o = u("http://localhost:3001/");
        let r = ruta_a_recordar(&u("http://localhost:3001/setup?token=abc&paso=2"), &o).unwrap();
        assert_eq!(r.as_str(), "http://localhost:3001/setup?paso=2");
        let r = ruta_a_recordar(&u("http://localhost:3001/setup?token=abc"), &o).unwrap();
        assert_eq!(r.as_str(), "http://localhost:3001/setup");
        let r = ruta_a_recordar(&u("http://localhost:3001/devices"), &o).unwrap();
        assert_eq!(r.as_str(), "http://localhost:3001/devices");
        assert_eq!(
            ruta_a_recordar(&u("http://otro.local:3001/devices"), &o),
            None
        );
    }

    #[test]
    fn setup_pendiente_se_consume_una_sola_vez_y_solo_con_el_agente_activo() {
        let setup = u("http://localhost:3001/setup?token=abc");
        let mut pend = Some(setup.clone());
        assert_eq!(aplicar_setup(&Estado::NoListo, &mut pend), None);
        assert_eq!(
            aplicar_setup(&Estado::NoResponde(Motivo::Red), &mut pend),
            None
        );
        assert_eq!(
            pend,
            Some(setup.clone()),
            "no se gasta sin el agente activo"
        );
        assert_eq!(aplicar_setup(&Estado::Activo, &mut pend), Some(setup));
        assert_eq!(pend, None);
        assert_eq!(aplicar_setup(&Estado::Activo, &mut pend), None);
    }

    fn en_agente() -> Destino {
        Destino::Agente(u("http://localhost:3001/inventory"))
    }

    const FALLO: Estado = Estado::NoResponde(Motivo::TiempoAgotado);

    #[test]
    fn un_fallo_aislado_no_saca_del_agente_y_reconfirma_en_1_s() {
        let o = u("http://localhost:3001/");
        let d = decidir(&en_agente(), None, &FALLO, Some(&o), 0);
        assert_eq!(
            d,
            Decision {
                destino: None,
                fallos: 1,
                siguiente_en_segs: 1
            }
        );
        // un 503 aislado cuenta igual
        let d = decidir(&en_agente(), None, &Estado::NoListo, Some(&o), 0);
        assert_eq!(d.destino, None);
    }

    #[test]
    fn dos_fallos_seguidos_si_sacan_y_la_local_sondea_cada_2_s() {
        let o = u("http://localhost:3001/");
        let d = decidir(&en_agente(), None, &FALLO, Some(&o), 1);
        assert_eq!(d.destino, Some(Destino::Local("no-responde")));
        assert_eq!(d.fallos, 2);
        assert_eq!(d.siguiente_en_segs, 2);
    }

    #[test]
    fn un_exito_entre_dos_fallos_reinicia_la_racha() {
        let o = u("http://localhost:3001/");
        let ok = decidir(&en_agente(), None, &Estado::Activo, Some(&o), 1);
        assert_eq!(ok.fallos, 0);
        assert_eq!(ok.destino, None);
        assert_eq!(ok.siguiente_en_segs, 5);
        let otra_vez = decidir(&en_agente(), None, &FALLO, Some(&o), ok.fallos);
        assert_eq!(otra_vez.destino, None, "vuelve a ser un fallo aislado");
    }

    #[test]
    fn con_la_pagina_local_en_pantalla_no_se_confirma_nada() {
        let o = u("http://localhost:3001/");
        let local = Destino::Local("inicial");
        let d = decidir(&local, None, &FALLO, Some(&o), 0);
        assert_eq!(d.destino, Some(Destino::Local("no-responde")));
        let d = decidir(&Destino::Local("no-responde"), None, &FALLO, Some(&o), 5);
        assert_eq!(d.destino, None);
        assert_eq!(d.siguiente_en_segs, 2);
        // entrar al agente basta con un sondeo bueno
        let d = decidir(
            &Destino::Local("no-responde"),
            None,
            &Estado::Activo,
            Some(&o),
            3,
        );
        assert_eq!(d.destino, Some(Destino::Agente(o)));
        assert_eq!(d.fallos, 0);
    }
}
