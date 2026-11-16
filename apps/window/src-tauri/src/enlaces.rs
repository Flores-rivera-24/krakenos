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

#[cfg(test)]
mod tests {
    use super::*;

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
