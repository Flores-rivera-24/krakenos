use crate::estado::ErrorSondeo;
use reqwest::{redirect::Policy, Client};
use std::time::Duration;
use url::Url;

/// Tope del sondeo (plan: 3 s). Sin redirecciones, sin proxy del sistema, sin cookies,
/// sin credenciales y con la verificación TLS de Windows (un certificado inválido falla).
pub fn cliente(tope: Duration) -> Client {
    Client::builder()
        .timeout(tope)
        .redirect(Policy::none())
        .no_proxy()
        .build()
        .expect("cliente HTTP del sondeo")
}

// Cualquier fallo del handshake TLS: schannel no deja distinguir de forma fiable «certificado no
// válido» de otros fallos (el texto del error depende del idioma de Windows), así que la página
// local habla de «conexión segura» y solo menciona el certificado como causa posible.
fn es_tls(e: &reqwest::Error) -> bool {
    let mut fuente: Option<&(dyn std::error::Error + 'static)> = Some(e);
    while let Some(f) = fuente {
        if f.is::<native_tls::Error>() {
            return true;
        }
        fuente = f.source();
    }
    false
}

/// `GET <origin>/health/ready`: el código HTTP, o por qué no hubo respuesta.
/// Nunca devuelve ni registra la URL (el error de reqwest la lleva dentro).
pub async fn sondear(cliente: &Client, origin: &Url) -> Result<u16, ErrorSondeo> {
    let url = origin.join("health/ready").map_err(|_| ErrorSondeo::Red)?;
    match cliente.get(url).send().await {
        Ok(r) => Ok(r.status().as_u16()),
        Err(e) if e.is_timeout() => Err(ErrorSondeo::TiempoAgotado),
        Err(e) if es_tls(&e) => Err(ErrorSondeo::Tls),
        Err(_) => Err(ErrorSondeo::Red),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    /// Servidor de una sola respuesta; devuelve el origen y el hilo con lo que recibió.
    fn servidor(respuesta: &'static [u8]) -> (Url, std::thread::JoinHandle<String>) {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let origen = Url::parse(&format!("http://{}/", l.local_addr().unwrap())).unwrap();
        let h = std::thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let mut buf = [0u8; 2048];
            let n = s.read(&mut buf).unwrap_or(0);
            let _ = s.write_all(respuesta);
            String::from_utf8_lossy(&buf[..n]).into_owned()
        });
        (origen, h)
    }

    fn sondeo_con(o: &Url, tope: Duration) -> Result<u16, ErrorSondeo> {
        tauri::async_runtime::block_on(sondear(&cliente(tope), o))
    }

    fn sondeo(o: &Url) -> Result<u16, ErrorSondeo> {
        sondeo_con(o, Duration::from_millis(500))
    }

    #[test]
    fn devuelve_el_codigo_y_no_manda_credenciales() {
        let (o, h) = servidor(b"HTTP/1.1 200 OK\r\ncontent-length: 0\r\nconnection: close\r\n\r\n");
        assert_eq!(sondeo(&o), Ok(200));
        let pedido = h.join().unwrap().to_lowercase();
        assert!(pedido.starts_with("get /health/ready "));
        assert!(!pedido.contains("authorization") && !pedido.contains("cookie"));
    }

    #[test]
    fn un_503_es_un_codigo_no_un_error() {
        let (o, _h) = servidor(
            b"HTTP/1.1 503 Service Unavailable\r\ncontent-length: 0\r\nconnection: close\r\n\r\n",
        );
        assert_eq!(sondeo(&o), Ok(503));
    }

    #[test]
    fn no_sigue_redirecciones() {
        let (o, _h) = servidor(b"HTTP/1.1 302 Found\r\nlocation: http://127.0.0.1:1/\r\ncontent-length: 0\r\nconnection: close\r\n\r\n");
        assert_eq!(sondeo(&o), Ok(302));
    }

    #[test]
    fn puerto_cerrado_es_red() {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let o = Url::parse(&format!("http://{}/", l.local_addr().unwrap())).unwrap();
        drop(l);
        // Windows tarda ~2 s en dar «rechazada» (reintenta el SYN): el tope corto lo cortaría antes.
        assert_eq!(
            sondeo_con(&o, Duration::from_secs(5)),
            Err(ErrorSondeo::Red)
        );
    }

    #[test]
    fn sin_respuesta_es_tiempo_agotado() {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let o = Url::parse(&format!("http://{}/", l.local_addr().unwrap())).unwrap();
        assert_eq!(sondeo(&o), Err(ErrorSondeo::TiempoAgotado));
        drop(l);
    }

    #[test]
    fn https_contra_un_servidor_sin_tls_es_tls() {
        let (o, _h) = servidor(b"HTTP/1.1 200 OK\r\ncontent-length: 0\r\n\r\n");
        let https = Url::parse(&o.as_str().replace("http://", "https://")).unwrap();
        assert_eq!(sondeo(&https), Err(ErrorSondeo::Tls));
    }
}
