use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};

static SETTINGS_LOCK: Mutex<()> = Mutex::new(());
static COOKIE_JAR: OnceLock<Arc<reqwest::cookie::Jar>> = OnceLock::new();

#[derive(Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RequestSettings {
    pub follow_redirects: Option<bool>,
    pub verify_ssl: Option<bool>,
    pub timeout: Option<u64>,
    pub http_version: Option<String>,
    pub max_response_size: Option<u64>,
    pub disable_cookies: Option<bool>,
}

pub fn defaults() -> Value {
    json!({
     "general":{"language":"en","httpVersion":"auto","timeout":0,"maxResponseSize":50,"verifySsl":true,"sslKeyLog":false,"sslKeyLogPath":"","disableCookies":false,"responseFormat":"auto","workingDirectory":"","readOutsideWorkingDirectory":false,"sendNoCacheHeader":false,"sendPostmanTokenHeader":false,"followRedirects":true,"redirectWithOriginalMethod":false,"followAuthorizationHeader":false,"maxRedirects":10,"requestValidation":true,"trimKeysAndValues":false,"variableAutocomplete":true,"alwaysAskClosingUnsavedTabs":true,"showIconsWithTabNames":true,"twoPane":false,"swapSidebars":false,"editorFontFamily":"ui-monospace, SFMono-Regular, Menlo, monospace","editorFontSize":12,"editorTabSize":2,"editorIndentation":"spaces","editorAutoCloseBrackets":true,"editorAutoCloseQuotes":true,"editorLineWrap":true,"editorFormatOnPaste":false},
     "theme":{"mode":"light","accent":"orange"},"shortcuts":{"enabled":true},
     "certificates":{"caEnabled":false,"caPath":"","clients":[]},
     "proxy":{"useSystem":true,"enabled":false,"type":"http","host":"","port":8080,"username":"","password":"","bypass":""},
     "update":{"automaticCheck":false}
    })
}
fn merge(target: &mut Value, source: &Value) {
    if let (Some(target), Some(source)) = (target.as_object_mut(), source.as_object()) {
        for (key, value) in source {
            if value.is_object() && target.get(key).is_some_and(Value::is_object) {
                merge(target.get_mut(key).unwrap(), value)
            } else {
                target.insert(key.clone(), value.clone());
            }
        }
    }
}
fn same_types(value: &Value, template: &Value, path: &str) -> Result<(), String> {
    if let Some(template) = template.as_object() {
        let object = value
            .as_object()
            .ok_or_else(|| format!("Invalid settings object: {path}"))?;
        for (key, expected) in template {
            if let Some(value) = object.get(key) {
                same_types(value, expected, &format!("{path}.{key}"))?
            }
        }
    } else if (template.is_boolean() && !value.is_boolean())
        || (template.is_string() && !value.is_string())
        || (template.is_u64() && !value.is_u64())
        || (template.is_array() && !value.is_array())
    {
        return Err(format!("Invalid setting type: {path}"));
    }
    Ok(())
}
fn choice(value: &Value, path: &str, choices: &[&str]) -> Result<(), String> {
    if !choices.contains(&value.as_str().unwrap_or("")) {
        return Err(format!("Invalid setting: {path}"));
    }
    Ok(())
}
pub fn normalize(input: &Value) -> Result<Value, String> {
    same_types(input, &defaults(), "settings")?;
    let mut settings = defaults();
    merge(&mut settings, input);
    let g = &settings["general"];
    choice(&g["language"], "general.language", &["en", "zh-CN"])?;
    choice(
        &g["httpVersion"],
        "general.httpVersion",
        &["auto", "http1", "http2"],
    )?;
    choice(
        &g["responseFormat"],
        "general.responseFormat",
        &["auto", "json"],
    )?;
    choice(
        &g["editorIndentation"],
        "general.editorIndentation",
        &["spaces", "tabs"],
    )?;
    choice(
        &settings["theme"]["mode"],
        "theme.mode",
        &["light", "dark", "system"],
    )?;
    choice(
        &settings["theme"]["accent"],
        "theme.accent",
        &["orange", "blue", "purple", "green"],
    )?;
    choice(
        &settings["proxy"]["type"],
        "proxy.type",
        &["http", "https", "socks5"],
    )?;
    for (key, max) in [
        ("timeout", 86_400_000),
        ("maxResponseSize", 10_240),
        ("maxRedirects", 100),
        ("editorFontSize", 32),
        ("editorTabSize", 8),
    ] {
        if g[key].as_u64().unwrap_or(u64::MAX) > max {
            return Err(format!("Setting out of range: general.{key}"));
        }
    }
    if g["editorFontSize"].as_u64().unwrap_or(0) < 8 || g["editorTabSize"].as_u64().unwrap_or(0) < 1
    {
        return Err("Editor font size must be 8–32 and tab size 1–8".into());
    }
    if g["sslKeyLog"] == true {
        return Err("SSL/TLS key logging is not supported by the current native TLS engine".into());
    }
    if settings["update"]["automaticCheck"] == true {
        return Err("Automatic updates require a configured signed release feed; this development build has none".into());
    }
    if settings["proxy"]["port"]
        .as_u64()
        .is_none_or(|port| port == 0 || port > 65535)
    {
        return Err("Proxy port must be 1–65535".into());
    }
    if settings["proxy"]["enabled"] == true {
        let host = settings["proxy"]["host"].as_str().unwrap_or("").trim();
        if host.is_empty() || host.contains(['/', '\\', '@', '\r', '\n']) {
            return Err("Enter a proxy host without URL scheme or credentials".into());
        }
    }
    let clients = settings["certificates"]["clients"].as_array().unwrap();
    if clients.len() > 100 {
        return Err("At most 100 client certificates are supported".into());
    }
    let mut ids = std::collections::HashSet::new();
    for cert in clients {
        let object = cert
            .as_object()
            .ok_or("Client certificate must be an object")?;
        for key in ["id", "host", "certPath", "keyPath", "passphrase"] {
            if !object.get(key).is_some_and(Value::is_string) {
                return Err(format!("Certificate {key} must be a string"));
            }
        }
        let id = cert["id"].as_str().unwrap();
        let host = cert["host"].as_str().unwrap();
        if id.is_empty()
            || !ids.insert(id)
            || host.trim().is_empty()
            || host.contains(['/', ':', '@', '\r', '\n'])
        {
            return Err("Client certificate needs a unique id and a hostname".into());
        }
        if cert
            .get("port")
            .is_some_and(|port| !port.is_null() && port.as_u64().is_none_or(|port| port > 65535))
        {
            return Err("Certificate port must be 0–65535".into());
        }
    }
    Ok(settings)
}
pub fn path(base: &Path) -> PathBuf {
    base.join("preferences.json")
}
pub fn load(base: &Path) -> Result<Value, String> {
    let _guard = SETTINGS_LOCK
        .lock()
        .map_err(|_| "Settings lock unavailable")?;
    load_unlocked(base)
}
fn load_unlocked(base: &Path) -> Result<Value, String> {
    match fs::read(path(base)) {
        Ok(bytes) => normalize(
            &serde_json::from_slice::<Value>(&bytes)
                .map_err(|e| format!("SETTINGS_INVALID: {e}"))?,
        ),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(defaults()),
        Err(e) => Err(format!("SETTINGS_READ_FAILED: {e}")),
    }
}
pub fn save(base: &Path, input: &Value) -> Result<Value, String> {
    let _guard = SETTINGS_LOCK
        .lock()
        .map_err(|_| "Settings lock unavailable")?;
    let settings = normalize(input)?;
    fs::create_dir_all(base).map_err(|e| e.to_string())?;
    // Refuse to overwrite unreadable preferences, preserving a recoverable original.
    if path(base).exists() {
        load_unlocked(base)?;
        let bytes = fs::read(path(base)).map_err(|e| e.to_string())?;
        private_write(&base.join("preferences.json.bak"), &bytes)?;
    }
    private_write(
        &path(base),
        &serde_json::to_vec_pretty(&settings).map_err(|e| e.to_string())?,
    )?;

    Ok(settings)
}
fn private_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    static SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let temp = path.with_extension(format!(
        "tmp-{}-{}",
        std::process::id(),
        SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    let result = (|| {
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temp).map_err(|e| e.to_string())?;
        file.write_all(bytes).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        fs::rename(&temp, path).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        if let Some(parent) = path.parent() {
            fs::File::open(parent)
                .and_then(|dir| dir.sync_all())
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}
pub(crate) fn allowed_open_path(
    base: &Path,
    settings: &Value,
    target: &Path,
) -> Result<PathBuf, String> {
    let target = target
        .canonicalize()
        .map_err(|e| format!("Cannot open path: {e}"))?;
    let data = base.canonicalize().map_err(|e| e.to_string())?;
    if target.starts_with(&data) {
        return Ok(target);
    }
    if let Some(working) = settings["general"]["workingDirectory"]
        .as_str()
        .filter(|s| !s.is_empty())
        .and_then(|s| Path::new(s).canonicalize().ok())
    {
        if target.starts_with(working) {
            return Ok(target);
        }
    }
    Err("Only the app data folder or configured working directory can be opened".into())
}
pub(crate) fn flag(settings: &Value, key: &str) -> bool {
    settings["general"][key].as_bool().unwrap_or(false)
}
pub(crate) fn read_request_file(settings: &Value, path: &Path) -> Result<Value, String> {
    use std::io::Read;
    const LIMIT: u64 = 50 * 1024 * 1024;
    let target = path
        .canonicalize()
        .map_err(|e| format!("Cannot read request file: {e}"))?;
    if !flag(settings, "readOutsideWorkingDirectory") {
        let working = settings["general"]["workingDirectory"]
            .as_str()
            .filter(|p| !p.is_empty())
            .ok_or("Choose a working directory in Settings before using a file path.")?;
        let root = Path::new(working)
            .canonicalize()
            .map_err(|e| e.to_string())?;
        if !target.starts_with(root) {
            return Err("This file is outside the working directory. Select a file within it or change the file access setting.".into());
        }
    }
    let file = fs::File::open(&target).map_err(|e| e.to_string())?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err("Choose a regular file for the binary request body.".into());
    }
    if metadata.len() > LIMIT {
        return Err("Binary request files are limited to 50 MB.".into());
    }
    // Bound the read as well, in case another process grows the file after metadata was read.
    let mut bytes = Vec::new();
    file.take(LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > LIMIT {
        return Err("Binary request files are limited to 50 MB.".into());
    }
    Ok(json!({"name":target.file_name().unwrap_or_default().to_string_lossy(),"bytes":bytes}))
}
pub(crate) fn max_response_bytes(settings: &Value, request: &RequestSettings) -> u64 {
    request
        .max_response_size
        .unwrap_or(
            settings["general"]["maxResponseSize"]
                .as_u64()
                .unwrap_or(50),
        )
        .saturating_mul(1024 * 1024)
}
pub(crate) fn follows(settings: &Value, request: &RequestSettings) -> bool {
    request
        .follow_redirects
        .unwrap_or(flag(settings, "followRedirects"))
}
fn read_file(path: &str, label: &str) -> Result<Vec<u8>, String> {
    let bytes = fs::read(path).map_err(|e| format!("Cannot read {label}: {e}"))?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err(format!("{label} exceeds 8 MiB"));
    }
    Ok(bytes)
}
pub(crate) fn client(
    settings: &Value,
    request: &RequestSettings,
    url: &reqwest::Url,
) -> Result<reqwest::Client, String> {
    let verify_ssl = request.verify_ssl.unwrap_or(flag(settings, "verifySsl"));
    let mut builder = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .danger_accept_invalid_certs(!verify_ssl)
        .danger_accept_invalid_hostnames(!verify_ssl);
    let timeout = request
        .timeout
        .unwrap_or(settings["general"]["timeout"].as_u64().unwrap_or(0));
    if timeout > 0 {
        builder = builder.timeout(Duration::from_millis(timeout))
    }
    match request.http_version.as_deref().unwrap_or(
        settings["general"]["httpVersion"]
            .as_str()
            .unwrap_or("auto"),
    ) {
        "http1" => builder = builder.http1_only(),
        "http2" => builder = builder.http2_prior_knowledge(),
        "auto" => {}
        _ => return Err("Unsupported HTTP version".into()),
    }
    if !request
        .disable_cookies
        .unwrap_or(flag(settings, "disableCookies"))
    {
        builder = builder.cookie_provider(
            COOKIE_JAR
                .get_or_init(|| Arc::new(reqwest::cookie::Jar::default()))
                .clone(),
        )
    }
    let proxy = &settings["proxy"];
    if proxy["enabled"] == true {
        let scheme = proxy["type"].as_str().unwrap_or("http");
        let host = proxy["host"].as_str().unwrap_or("");
        let host = if host.contains(':') && !host.starts_with('[') {
            format!("[{host}]")
        } else {
            host.into()
        };
        let port = proxy["port"].as_u64().unwrap_or(8080);
        let mut configured =
            reqwest::Proxy::all(format!("{scheme}://{host}:{port}")).map_err(|e| e.to_string())?;
        if !proxy["username"].as_str().unwrap_or("").is_empty() {
            configured = configured.basic_auth(
                proxy["username"].as_str().unwrap_or(""),
                proxy["password"].as_str().unwrap_or(""),
            )
        }
        configured = configured.no_proxy(reqwest::NoProxy::from_string(
            proxy["bypass"].as_str().unwrap_or(""),
        ));
        builder = builder.no_proxy().proxy(configured);
    } else if proxy["useSystem"] != true {
        builder = builder.no_proxy()
    }
    let certificates = &settings["certificates"];
    if certificates["caEnabled"] == true {
        let bytes = read_file(
            certificates["caPath"].as_str().unwrap_or(""),
            "CA certificate",
        )?;
        let certs = reqwest::Certificate::from_pem_bundle(&bytes)
            .or_else(|_| reqwest::Certificate::from_der(&bytes).map(|c| vec![c]))
            .map_err(|e| format!("Invalid CA certificate: {e}"))?;
        if certs.is_empty() {
            return Err("CA certificate file contains no certificates".into());
        }
        for cert in certs {
            builder = builder.add_root_certificate(cert)
        }
    }
    if url.scheme() == "https" {
        let host = url.host_str().unwrap_or("");
        let port = url.port_or_known_default().unwrap_or(443);
        if let Some(cert) = certificates["clients"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|cert| {
                let pattern = cert["host"].as_str().unwrap_or("");
                let matches = pattern.eq_ignore_ascii_case(host)
                    || pattern.strip_prefix("*.").is_some_and(|suffix| {
                        host.to_ascii_lowercase()
                            .ends_with(&format!(".{}", suffix.to_ascii_lowercase()))
                    });
                matches
                    && (cert["port"].as_u64().unwrap_or(0) == 0
                        || cert["port"].as_u64() == Some(port.into()))
            })
        {
            let cert_path = cert["certPath"].as_str().unwrap_or("");
            let bytes = read_file(cert_path, "client certificate")?;
            let password = cert["passphrase"].as_str().unwrap_or("");
            let identity = if cert_path.to_ascii_lowercase().ends_with(".pfx")
                || cert_path.to_ascii_lowercase().ends_with(".p12")
            {
                reqwest::Identity::from_pkcs12_der(&bytes, password)
                    .map_err(|e| format!("Invalid PFX/P12 certificate or passphrase: {e}"))?
            } else {
                if !password.is_empty() {
                    return Err("Encrypted PEM private keys are unsupported; use an unencrypted PKCS#8 key or a PFX/P12 certificate".into());
                }
                let key = read_file(cert["keyPath"].as_str().unwrap_or(""), "client private key")?;
                reqwest::Identity::from_pkcs8_pem(&bytes, &key)
                    .map_err(|e| format!("Invalid PEM certificate or PKCS#8 private key: {e}"))?
            };
            builder = builder.identity(identity);
        }
    }
    builder.build().map_err(|e| e.to_string())
}
pub(crate) async fn response_body(
    mut response: reqwest::Response,
    limit: u64,
) -> Result<
    (
        Vec<u8>,
        reqwest::StatusCode,
        std::collections::HashMap<String, String>,
    ),
    String,
> {
    let status = response.status();
    let headers = response
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    if limit > 0
        && response
            .content_length()
            .is_some_and(|length| length > limit)
    {
        return Err(format!(
            "Response exceeds the configured limit of {limit} bytes"
        ));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| {
        if e.is_timeout() {
            "Request timed out while reading the response".into()
        } else {
            e.to_string()
        }
    })? {
        if limit > 0 && (bytes.len() as u64).saturating_add(chunk.len() as u64) > limit {
            return Err(format!(
                "Response exceeds the configured limit of {limit} bytes"
            ));
        }
        bytes.extend_from_slice(&chunk)
    }
    Ok((bytes, status, headers))
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Temp(PathBuf);
    impl Temp {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "localpostman-preferences-test-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    fn settings_defaults_validation_and_atomic_recovery() {
        let temp = Temp::new();
        assert_eq!(load(&temp.0).unwrap(), defaults());
        let mut first = json!({"general":{"timeout":2500},"proxy":{"password":"local-test-secret"},"future":{"enabled":true}});
        let saved = save(&temp.0, &first).unwrap();
        assert_eq!(saved["general"]["timeout"], 2500);
        assert_eq!(saved["general"]["maxRedirects"], 10);
        assert_eq!(saved["future"]["enabled"], true);
        first["general"]["timeout"] = json!(100);
        save(&temp.0, &first).unwrap();
        let backup: Value =
            serde_json::from_slice(&fs::read(temp.0.join("preferences.json.bak")).unwrap())
                .unwrap();
        assert_eq!(backup, saved);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            for name in ["preferences.json", "preferences.json.bak"] {
                assert_eq!(
                    fs::metadata(temp.0.join(name))
                        .unwrap()
                        .permissions()
                        .mode()
                        & 0o777,
                    0o600
                );
            }
        }
        let before = fs::read(path(&temp.0)).unwrap();
        for input in [
            json!({"general":{"timeout":-1}}),
            json!({"general":{"editorFontSize":7}}),
            json!({"general":{"httpVersion":"ftp"}}),
            json!({"general":{"sslKeyLog":true}}),
            json!({"update":{"automaticCheck":true}}),
            json!({"proxy":{"enabled":true,"host":"http://localhost"}}),
            json!({"theme":{"accent":"unknown"}}),
        ] {
            assert!(save(&temp.0, &input).is_err());
            assert_eq!(fs::read(path(&temp.0)).unwrap(), before);
        }
        fs::write(path(&temp.0), b"broken JSON").unwrap();
        assert!(save(&temp.0, &defaults()).is_err());
        assert_eq!(fs::read(path(&temp.0)).unwrap(), b"broken JSON");
        assert_eq!(
            serde_json::from_slice::<Value>(
                &fs::read(temp.0.join("preferences.json.bak")).unwrap()
            )
            .unwrap(),
            saved
        );
    }
    #[test]
    fn configured_paths_do_not_allow_arbitrary_or_symlink_escapes() {
        let temp = Temp::new();
        let data = temp.0.join("data");
        let outside = temp.0.join("outside");
        fs::create_dir_all(&data).unwrap();
        fs::create_dir_all(&outside).unwrap();
        let mut settings = defaults();
        assert_eq!(
            allowed_open_path(&data, &settings, &data).unwrap(),
            data.canonicalize().unwrap()
        );
        assert!(allowed_open_path(&data, &settings, &outside).is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&outside, data.join("escape")).unwrap();
            assert!(allowed_open_path(&data, &settings, &data.join("escape")).is_err());
        }
        settings["general"]["workingDirectory"] = json!(outside);
        assert!(allowed_open_path(&data, &settings, &outside).is_ok());
    }
    #[test]
    fn language_persists_and_invalid_values_preserve_saved_preferences() {
        let temp = Temp::new();
        assert_eq!(load(&temp.0).unwrap()["general"]["language"], "en");
        for language in ["zh-CN", "en"] {
            save(&temp.0, &json!({"general":{"language":language}})).unwrap();
            assert_eq!(load(&temp.0).unwrap()["general"]["language"], language);
        }
        let before = fs::read(path(&temp.0)).unwrap();
        let backup = fs::read(temp.0.join("preferences.json.bak")).unwrap();
        for language in [json!("zh"), json!("ja"), json!(null), json!(true), json!(1)] {
            assert!(save(&temp.0, &json!({"general":{"language":language}})).is_err());
            assert_eq!(fs::read(path(&temp.0)).unwrap(), before);
            assert_eq!(
                fs::read(temp.0.join("preferences.json.bak")).unwrap(),
                backup
            );
        }
    }
    #[test]
    fn request_files_respect_working_directory_and_size_limit() {
        let temp = Temp::new();
        let working = temp.0.join("working");
        let sibling = temp.0.join("working-other");
        fs::create_dir_all(&working).unwrap();
        fs::create_dir_all(&sibling).unwrap();
        let inside = working.join("body.bin");
        let outside = sibling.join("outside.bin");
        fs::write(&inside, [0, 1, 255]).unwrap();
        fs::write(&outside, [2, 3]).unwrap();
        let mut settings = defaults();
        assert!(read_request_file(&settings, &inside)
            .unwrap_err()
            .contains("Choose a working directory"));
        settings["general"]["workingDirectory"] = json!(working);
        assert_eq!(
            read_request_file(&settings, &inside).unwrap(),
            json!({"name":"body.bin","bytes":[0,1,255]})
        );
        assert!(read_request_file(&settings, &outside)
            .unwrap_err()
            .contains("outside the working directory"));
        assert!(read_request_file(&settings, &working)
            .unwrap_err()
            .contains("regular file"));
        #[cfg(unix)]
        {
            let escape = working.join("escape.bin");
            std::os::unix::fs::symlink(&outside, &escape).unwrap();
            assert!(read_request_file(&settings, &escape)
                .unwrap_err()
                .contains("outside the working directory"));
        }
        settings["general"]["readOutsideWorkingDirectory"] = json!(true);
        assert_eq!(
            read_request_file(&settings, &outside).unwrap()["bytes"],
            json!([2, 3])
        );
        let large = fs::File::create(working.join("large.bin")).unwrap();
        large.set_len(50 * 1024 * 1024 + 1).unwrap();
        assert!(read_request_file(&settings, &working.join("large.bin"))
            .unwrap_err()
            .contains("limited to 50 MB"));
    }
    #[test]
    fn invalid_ca_is_reported_before_request() {
        let temp = Temp::new();
        let file = temp.0.join("invalid.crt");
        fs::write(&file, "invalid certificate").unwrap();
        let mut settings = defaults();
        settings["certificates"]["caEnabled"] = json!(true);
        settings["certificates"]["caPath"] = json!(file);
        let error = client(
            &settings,
            &RequestSettings::default(),
            &reqwest::Url::parse("https://localhost/").unwrap(),
        )
        .err()
        .unwrap();
        assert!(error.contains("CA certificate"));
    }
}
