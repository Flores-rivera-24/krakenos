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
    /// Página local: "no-responde" | "no-listo" | "sin-configurar" | "certificado".
    Local(&'static str),
}

/// 2xx = activo; cualquier otro código (el agente responde 503 si no está listo) = no listo.
pub fn estado_desde_sondeo(r: Result<u16, ErrorSondeo>) -> Estado {
    match r {
        Ok(200..=299) => Estado::Activo,
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
}
