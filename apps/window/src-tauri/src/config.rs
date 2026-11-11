use std::path::PathBuf;
use url::Url;

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Config {
    pub origin: Option<Url>,
    pub setup_token: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConfigError {
    Ilegible(PathBuf),
    EsquemaNoHttp(String),
    UrlInvalida(String),
}

/// Ruta fija del fichero de configuración (lo escribe el instalador).
pub fn ruta_config() -> PathBuf {
    let base = std::env::var_os("ProgramData")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\ProgramData"));
    base.join("KrakenOS").join("window.json")
}

fn valor_de(args: &[String], nombre: &str) -> Option<String> {
    let pos = args.iter().position(|a| a == nombre)?;
    args.get(pos + 1).cloned()
}

/// Solo `http(s)`, y se queda con el origen: sin ruta, query ni fragmento.
fn parsear_origen(texto: &str) -> Result<Url, ConfigError> {
    let mut url =
        Url::parse(texto.trim()).map_err(|_| ConfigError::UrlInvalida(texto.to_string()))?;
    if !matches!(url.scheme(), "http" | "https") || url.host().is_none() {
        return Err(ConfigError::EsquemaNoHttp(texto.to_string()));
    }
    url.set_path("/");
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

/// Los argumentos (`--origin`, `--setup-token`) mandan sobre el fichero; si traen
/// `--origin`, el fichero ni se mira. El token de setup nunca viene del fichero.
pub fn resolver_config(args: &[String], fichero: Option<&str>) -> Result<Config, ConfigError> {
    let setup_token = valor_de(args, "--setup-token");
    let origen = match (valor_de(args, "--origin"), fichero) {
        (Some(o), _) => Some(o),
        (None, Some(texto)) => {
            let json: serde_json::Value =
                serde_json::from_str(texto).map_err(|_| ConfigError::Ilegible(ruta_config()))?;
            match json.get("origin") {
                None | Some(serde_json::Value::Null) => None,
                Some(serde_json::Value::String(s)) => Some(s.clone()),
                Some(_) => return Err(ConfigError::Ilegible(ruta_config())),
            }
        }
        (None, None) => None,
    };
    let origin = origen.as_deref().map(parsear_origen).transpose()?;
    Ok(Config { origin, setup_token })
}

pub fn url_de_setup(origin: &Url, token: &str) -> Url {
    let mut url = origin.clone();
    url.set_path("/setup");
    url.set_query(None);
    url.query_pairs_mut().append_pair("token", token);
    url
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn args_mandan_sobre_el_fichero() {
        let c = resolver_config(
            &args(&["--origin", "https://arg.local:3001"]),
            Some(r#"{"origin":"https://fichero.local"}"#),
        )
        .unwrap();
        assert_eq!(c.origin.unwrap().as_str(), "https://arg.local:3001/");
    }

    #[test]
    fn fichero_se_usa_sin_args_y_token_viene_de_args() {
        let c = resolver_config(
            &args(&["--setup-token", "abc"]),
            Some(r#"{"origin":"https://fichero.local/algo/?x=1"}"#),
        )
        .unwrap();
        assert_eq!(c.origin.unwrap().as_str(), "https://fichero.local/");
        assert_eq!(c.setup_token.as_deref(), Some("abc"));
    }

    #[test]
    fn config_rechaza_esquema_no_http() {
        for malo in ["file:///etc/passwd", "javascript:alert(1)"] {
            let e = resolver_config(&args(&["--origin", malo]), None).unwrap_err();
            assert_eq!(e, ConfigError::EsquemaNoHttp(malo.to_string()));
        }
        let e = resolver_config(&[], Some(r#"{"origin":"file:///x"}"#)).unwrap_err();
        assert!(matches!(e, ConfigError::EsquemaNoHttp(_)));
    }

    #[test]
    fn origen_que_no_es_url_es_url_invalida() {
        let e = resolver_config(&args(&["--origin", "no es url"]), None).unwrap_err();
        assert_eq!(e, ConfigError::UrlInvalida("no es url".to_string()));
    }

    #[test]
    fn fichero_ilegible_es_error_con_ruta() {
        for malo in ["{no json", r#"{"origin": 5}"#] {
            match resolver_config(&[], Some(malo)).unwrap_err() {
                ConfigError::Ilegible(ruta) => assert!(ruta.ends_with("window.json")),
                otro => panic!("esperaba Ilegible, salió {otro:?}"),
            }
        }
    }

    #[test]
    fn sin_origen_es_none() {
        assert_eq!(resolver_config(&[], None).unwrap().origin, None);
        assert_eq!(resolver_config(&[], Some("{}")).unwrap().origin, None);
    }

    #[test]
    fn url_de_setup_sin_doble_barra() {
        let o = Url::parse("https://casa.local:3001/").unwrap();
        assert_eq!(
            url_de_setup(&o, "abc").as_str(),
            "https://casa.local:3001/setup?token=abc"
        );
    }

    #[test]
    fn token_se_codifica_en_la_query() {
        let o = Url::parse("https://casa.local:3001/").unwrap();
        assert_eq!(
            url_de_setup(&o, "a b&c=d").as_str(),
            "https://casa.local:3001/setup?token=a+b%26c%3Dd"
        );
    }
}
