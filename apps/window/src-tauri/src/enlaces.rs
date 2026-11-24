//! Enlaces que piden una ventana nueva (`target="_blank"`, `window.open`): «Código fuente» y
//! «Licencia» de «Acerca de» (la oferta de la AGPL), «abrir issue»…
//! La ventana nunca crea otra dentro de la app; solo se entrega al navegador del sistema lo
//! que es web de verdad.

use url::Url;

/// Solo `http(s)` con host: nada de `file:`, `javascript:`, `data:` ni esquemas propios,
/// que el sistema ejecutaría como lo que son.
pub fn es_web_externa(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https") && url.host_str().is_some_and(|h| !h.is_empty())
}

/// Si la propia ventana puede navegar a `url`: solo al origen del agente (esquema, host y puerto
/// exactos; credenciales iguales a las del origen) o a la página local de la app (`tauri://localhost`
/// en Linux/macOS, `http(s)://tauri.localhost` en Windows). Todo lo demás se suplantaría con el marco de KrakenOS.
pub fn navegacion_permitida(url: &Url, origen_agente: Option<&Url>) -> bool {
    if url.as_str() == "about:blank" {
        return true;
    }
    let local = match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        "http" | "https" => url.host_str() == Some("tauri.localhost"),
        _ => false,
    };
    if local {
        return url.username().is_empty() && url.password().is_none();
    }
    origen_agente.is_some_and(|o| {
        es_web_externa(url)
            && url.origin() == o.origin()
            && url.username() == o.username()
            && url.password() == o.password()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn nav(s: &str, origen: Option<&str>) -> bool {
        let o = origen.map(|o| Url::parse(o).unwrap());
        navegacion_permitida(&Url::parse(s).unwrap(), o.as_ref())
    }

    const AG: Option<&str> = Some("http://192.168.1.10:3001");

    #[test]
    fn navega_al_agente_y_a_la_pagina_local() {
        assert!(nav("http://192.168.1.10:3001/devices?x=1", AG));
        assert!(nav("tauri://localhost/index.html?estado=inicial", AG));
        assert!(nav("http://tauri.localhost/index.html", None));
        assert!(nav("https://tauri.localhost/index.html", None));
        assert!(nav("about:blank", None));
    }

    #[test]
    fn no_navega_a_otro_puerto_host_o_esquema() {
        assert!(!nav("http://192.168.1.10:3002/", AG));
        assert!(!nav("http://192.168.1.11:3001/", AG));
        assert!(!nav("https://192.168.1.10:3001/", AG));
        assert!(!nav("http://192.168.1.10:3001.evil.example/", AG));
        assert!(!nav("https://evil.example/", AG));
        assert!(!nav("https://evil.example/", None));
        assert!(!nav("http://tauri.localhost.evil.example/", None));
    }

    #[test]
    fn no_navega_a_esquemas_peligrosos_ni_con_credenciales() {
        for u in [
            "javascript:alert(1)",
            "data:text/html,hola",
            "file:///C:/Windows/System32/calc.exe",
            "tauri://evil/",
        ] {
            assert!(!nav(u, AG), "{u}");
        }
        assert!(!nav("http://u:p@192.168.1.10:3001/", AG));
        assert!(!nav("http://u:p@tauri.localhost/", None));
    }

    #[test]
    fn el_origen_con_credenciales_solo_admite_las_mismas() {
        let o = Some("http://u:p@192.168.1.10:3001");
        assert!(nav("http://u:p@192.168.1.10:3001/x", o));
        assert!(!nav("http://192.168.1.10:3001/x", o));
    }

    fn web(s: &str) -> bool {
        es_web_externa(&Url::parse(s).unwrap())
    }

    #[test]
    fn https_y_http_con_host_se_abren() {
        assert!(web("https://github.com/Flores-rivera-24/krakenos"));
        assert!(web("http://192.168.1.10:3001/licencia?x=1&y=2"));
    }

    #[test]
    fn lo_que_no_es_web_se_rechaza() {
        for u in [
            "file:///C:/Windows/System32/calc.exe",
            "javascript:alert(1)",
            "data:text/html,<script>alert(1)</script>",
            "krakenos://abrir",
            "ms-msdt:/id+PCWDiagnostic",
            "mailto:a@b.c",
            "ftp://example.com/x",
            "ws://example.com/x",
        ] {
            assert!(!web(u), "{u}");
        }
    }
}
