use crate::preferences::RequestSettings;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::State;

#[derive(Clone, Deserialize)]
pub struct ServiceConfig {
    id: String,
    kind: String,
    #[serde(default)]
    requests: Vec<ServiceRequest>,
    #[serde(default = "default_interval")]
    interval_seconds: u64,
    #[serde(default)]
    port: u16,
    #[serde(default = "default_path")]
    path: String,
    #[serde(default)]
    retry: bool,
    #[serde(default)]
    delay_ms: u64,
    #[serde(default)]
    initial_delay_seconds: Option<u64>,
}
fn default_interval() -> u64 {
    3600
}
fn default_path() -> String {
    "/webhook".into()
}
#[derive(Clone, Deserialize)]
struct ServiceRequest {
    method: String,
    url: String,
    #[serde(default)]
    headers: Vec<(String, String)>,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    body_type: String,
    #[serde(default)]
    fields: Vec<(String, String)>,
    #[serde(default)]
    binary_bytes: Vec<u8>,
    #[serde(default)]
    settings: RequestSettings,
}
#[derive(Clone, Serialize)]
pub struct RequestResult {
    method: String,
    url: String,
    status: u16,
    time_ms: u128,
    error: Option<String>,
}
#[derive(Clone, Serialize)]
pub struct ServiceRun {
    at: u128,
    ok: bool,
    requests: Vec<RequestResult>,
}
#[derive(Clone, Serialize)]
pub struct ServiceStatus {
    id: String,
    running: bool,
    port: u16,
    runs: Vec<ServiceRun>,
}
struct ServiceHandle {
    stop: Arc<AtomicBool>,
    status: Arc<Mutex<ServiceStatus>>,
    thread: Option<JoinHandle<()>>,
}
impl ServiceHandle {
    fn stop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
        if let Ok(mut s) = self.status.lock() {
            s.running = false;
        }
    }
}
#[derive(Default)]
pub struct ServiceRegistry {
    services: Mutex<HashMap<String, ServiceHandle>>,
}
impl Drop for ServiceRegistry {
    fn drop(&mut self) {
        if let Ok(services) = self.services.get_mut() {
            for h in services.values_mut() {
                h.stop();
            }
        }
    }
}
fn now() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}
fn validate(c: &ServiceConfig) -> Result<(), String> {
    if c.id.is_empty() {
        return Err("Service id is required".into());
    }
    if !["monitor", "webhook", "flow"].contains(&c.kind.as_str()) {
        return Err("Invalid service kind".into());
    }
    if c.requests.is_empty() || c.requests.len() > 200 {
        return Err("Select a collection with 1–200 requests".into());
    }
    if c.interval_seconds < 60 || c.delay_ms > 60_000 {
        return Err("Use an interval of at least 60 seconds and a delay up to 60 seconds".into());
    }
    if !c.path.starts_with('/') || c.path.contains(['\r', '\n', '?', '#']) {
        return Err("Use a valid /path".into());
    }
    for r in &c.requests {
        let u = reqwest::Url::parse(&r.url).map_err(|_| "Invalid request URL")?;
        if !["http", "https"].contains(&u.scheme()) || r.url.contains("{{") {
            return Err("Resolve every request to an HTTP URL".into());
        }
        r.method
            .parse::<reqwest::Method>()
            .map_err(|_| "Invalid HTTP method")?;
        if r.body.as_ref().is_some_and(|b| b.len() > 1024 * 1024)
            || r.binary_bytes.len() > 1024 * 1024
        {
            return Err("Request body exceeds 1 MiB".into());
        }
    }
    Ok(())
}
async fn execute_request(r: &ServiceRequest) -> RequestResult {
    let started = Instant::now();
    let result: Result<u16, String> = async {
        let settings = crate::preferences::load(&crate::app_dir()?)?;
        let request = crate::ApiRequest {
            method: r.method.clone(),
            url: r.url.clone(),
            headers: r.headers.clone(),
            body: r.body.clone(),
            body_type: r.body_type.clone(),
            fields: r.fields.clone(),
            binary_bytes: r.binary_bytes.clone(),
            settings: r.settings.clone(),
        };
        Ok(crate::send_request_with_settings(request, &settings)
            .await?
            .status)
    }
    .await;
    match result {
        Ok(status) => RequestResult {
            method: r.method.clone(),
            url: r.url.clone(),
            status,
            time_ms: started.elapsed().as_millis(),
            error: None,
        },
        Err(error) => RequestResult {
            method: r.method.clone(),
            url: r.url.clone(),
            status: 0,
            time_ms: started.elapsed().as_millis(),
            error: Some(error),
        },
    }
}
fn wait(stop: &AtomicBool, duration: Duration) -> bool {
    let deadline = Instant::now() + duration;
    while Instant::now() < deadline {
        if stop.load(Ordering::Relaxed) {
            return false;
        }
        thread::sleep(
            deadline
                .saturating_duration_since(Instant::now())
                .min(Duration::from_millis(50)),
        );
    }
    !stop.load(Ordering::Relaxed)
}
fn run_collection(c: &ServiceConfig, stop: &AtomicBool) -> ServiceRun {
    let mut requests = Vec::new();
    for r in &c.requests {
        if stop.load(Ordering::Relaxed) {
            break;
        }
        if c.delay_ms > 0 && !wait(stop, Duration::from_millis(c.delay_ms)) {
            break;
        }
        let mut result = tauri::async_runtime::block_on(execute_request(r));
        if c.retry
            && (result.error.is_some() || result.status >= 400)
            && !stop.load(Ordering::Relaxed)
        {
            result = tauri::async_runtime::block_on(execute_request(r));
        }
        requests.push(result);
    }
    let ok = requests.len() == c.requests.len()
        && requests
            .iter()
            .all(|r| r.error.is_none() && (200..400).contains(&r.status));
    ServiceRun {
        at: now(),
        ok,
        requests,
    }
}
fn record(status: &Arc<Mutex<ServiceStatus>>, run: ServiceRun) {
    if let Ok(mut s) = status.lock() {
        s.runs.push(run);
        if s.runs.len() > 20 {
            s.runs.remove(0);
        }
    }
}
fn snapshot(handle: &ServiceHandle) -> Result<ServiceStatus, String> {
    handle
        .status
        .lock()
        .map(|s| s.clone())
        .map_err(|_| "Service state unavailable".into())
}
fn start_service(
    c: ServiceConfig,
    registry: &ServiceRegistry,
    once: bool,
) -> Result<ServiceStatus, String> {
    validate(&c)?;
    let mut services = registry
        .services
        .lock()
        .map_err(|_| "Service registry unavailable")?;
    if let Some(handle) = services.get(&c.id) {
        if snapshot(handle)?.running {
            return Err(
                "Service is already running; stop it before changing its configuration".into(),
            );
        }
    }
    let mut previous_runs = Vec::new();
    if let Some(mut previous) = services.remove(&c.id) {
        previous.stop();
        previous_runs = snapshot(&previous)?.runs;
    }
    let listener = if !once && c.kind != "monitor" {
        let l = crate::local_listener::bind(c.port)?;
        l.set_nonblocking(true).map_err(|e| e.to_string())?;
        Some(l)
    } else {
        None
    };
    let port = listener
        .as_ref()
        .and_then(|l| l.local_addr().ok())
        .map(|a| a.port())
        .unwrap_or(0);
    let stop = Arc::new(AtomicBool::new(false));
    let status = Arc::new(Mutex::new(ServiceStatus {
        id: c.id.clone(),
        running: true,
        port,
        runs: previous_runs,
    }));
    let mut handle = ServiceHandle {
        stop: stop.clone(),
        status: status.clone(),
        thread: None,
    };
    let initial = snapshot(&handle)?;
    let id = c.id.clone();
    handle.thread = Some(thread::spawn(move || {
        if once {
            record(&status, run_collection(&c, &stop));
        } else if let Some(listener) = listener {
            while !stop.load(Ordering::Relaxed) {
                match listener.accept() {
                    // macOS can inherit O_NONBLOCK from the listener. Read a complete request before parsing.
                    Ok((mut stream, _)) => {
                        let _ = stream.set_nonblocking(false);
                        let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                        let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
                        let mut bytes = Vec::new();
                        let mut buf = [0; 8192];
                        let mut parsed = None;
                        while bytes.len() < 1024 * 1024 {
                            match stream.read(&mut buf) {
                                Ok(0) | Err(_) => break,
                                Ok(n) => bytes.extend_from_slice(&buf[..n]),
                            }
                            if let Some(end) = bytes.windows(4).position(|b| b == b"\r\n\r\n") {
                                let headers = String::from_utf8_lossy(&bytes[..end]);
                                let mut first =
                                    headers.lines().next().unwrap_or("").split_whitespace();
                                let method = first.next().unwrap_or("").to_string();
                                let path = first.next().unwrap_or("").to_string();
                                let length = headers
                                    .lines()
                                    .filter_map(|l| l.split_once(':'))
                                    .find(|(k, _)| k.eq_ignore_ascii_case("content-length"))
                                    .and_then(|(_, v)| v.trim().parse::<usize>().ok())
                                    .unwrap_or(0);
                                if length > 1024 * 1024 - end - 4 {
                                    break;
                                }
                                if bytes.len() >= end + 4 + length {
                                    parsed = Some((method, path));
                                    break;
                                }
                            }
                        }
                        let (code, body) = match parsed {
                            Some((method, path))
                                if path.split('?').next() == Some(c.path.as_str())
                                    && method == "POST" =>
                            {
                                let run = run_collection(&c, &stop);
                                let body = serde_json::to_string(&run).unwrap_or_default();
                                record(&status, run);
                                (200, body)
                            }
                            Some((_, path)) if path.split('?').next() != Some(c.path.as_str()) => {
                                (404, "{\"error\":\"Not found\"}".into())
                            }
                            Some(_) => (405, "{\"error\":\"Use POST\"}".into()),
                            None => (
                                400,
                                "{\"error\":\"Invalid or oversized HTTP request\"}".into(),
                            ),
                        };
                        let reason = if code == 200 { "OK" } else { "Error" };
                        let _ = write!(stream, "HTTP/1.1 {code} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body);
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(25));
                    }
                    Err(_) => break,
                }
            }
        } else {
            let initial_delay = c.initial_delay_seconds.unwrap_or(c.interval_seconds);
            if wait(&stop, Duration::from_secs(initial_delay)) {
                loop {
                    record(&status, run_collection(&c, &stop));
                    if !wait(&stop, Duration::from_secs(c.interval_seconds)) {
                        break;
                    }
                }
            }
        }
        if let Ok(mut s) = status.lock() {
            s.running = false;
        }
    }));
    services.insert(id, handle);
    Ok(initial)
}
#[tauri::command]
pub async fn service_run(
    config: ServiceConfig,
    registry: State<'_, ServiceRegistry>,
) -> Result<ServiceStatus, String> {
    let id = config.id.clone();
    start_service(config, &registry, true)?;
    loop {
        let snapshot = {
            let services = registry
                .services
                .lock()
                .map_err(|_| "Service registry unavailable")?;
            snapshot(services.get(&id).ok_or("Service not found")?)?
        };
        if !snapshot.running {
            return Ok(snapshot);
        }
        tauri::async_runtime::spawn_blocking(|| thread::sleep(Duration::from_millis(25)))
            .await
            .map_err(|e| e.to_string())?;
    }
}
#[tauri::command]
pub fn service_start(
    config: ServiceConfig,
    registry: State<'_, ServiceRegistry>,
) -> Result<ServiceStatus, String> {
    start_service(config, &registry, false)
}
#[tauri::command]
pub async fn service_stop(
    id: String,
    registry: State<'_, ServiceRegistry>,
) -> Result<ServiceStatus, String> {
    let mut handle = registry
        .services
        .lock()
        .map_err(|_| "Service registry unavailable")?
        .remove(&id)
        .ok_or("Service not found")?;
    tauri::async_runtime::spawn_blocking(move || {
        handle.stop();
        snapshot(&handle)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn service_status(registry: State<'_, ServiceRegistry>) -> Result<Vec<ServiceStatus>, String> {
    registry
        .services
        .lock()
        .map_err(|_| "Service registry unavailable".to_string())?
        .values()
        .map(snapshot)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{TcpListener, TcpStream};
    fn config(url: &str) -> ServiceConfig {
        serde_json::from_value(serde_json::json!({"id":"test", "kind":"webhook", "requests":[{"method":"GET","url":url,"headers":[],"body_type":"binary","binary_bytes":[1,2,3]}],"port":0,"path":"/hook"})).unwrap()
    }
    #[test]
    fn webhook_runs_collection_and_releases_port() {
        let _network_guard = crate::NETWORK_TEST_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let target = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = target.local_addr().unwrap();
        let received = thread::spawn(move || {
            let (mut stream, _) = target.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut buf = [0; 4096];
            let n = stream.read(&mut buf).unwrap();
            let req = String::from_utf8_lossy(&buf[..n]);
            assert!(req.starts_with("GET /ok "));
            assert!(!req.to_ascii_lowercase().contains("content-length: 3"));
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}")
                .unwrap();
        });
        let registry = ServiceRegistry::default();
        let status =
            start_service(config(&format!("http://{address}/ok")), &registry, false).unwrap();
        let mut client = TcpStream::connect(("127.0.0.1", status.port)).unwrap();
        client
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        client
            .write_all(b"POST /hook HTTP/1.1\r\nHost: localhost\r\nContent-Length: 2\r\n\r\n{}")
            .unwrap();
        let mut response = String::new();
        client.read_to_string(&mut response).unwrap();
        assert!(
            response.starts_with("HTTP/1.1 200"),
            "Unexpected response: {response}"
        );
        assert!(response.contains("\"ok\":true"));
        received.join().unwrap();
        let mut handle = registry.services.lock().unwrap().remove("test").unwrap();
        handle.stop();
        assert_eq!(snapshot(&handle).unwrap().runs.len(), 1);
        assert!(
            std::net::TcpStream::connect_timeout(
                &format!("127.0.0.1:{}", status.port).parse().unwrap(),
                Duration::from_millis(250)
            )
            .is_err(),
            "Stopped Webhook must refuse new connections"
        );
    }
    #[test]
    fn scheduled_monitor_does_not_run_before_due_and_stops() {
        let _network_guard = crate::NETWORK_TEST_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let registry = ServiceRegistry::default();
        let mut c = config("http://127.0.0.1:1/no-request");
        c.kind = "monitor".into();
        c.interval_seconds = 60;
        let s = start_service(c, &registry, false).unwrap();
        assert!(s.running);
        let mut h = registry.services.lock().unwrap().remove("test").unwrap();
        h.stop();
        assert!(snapshot(&h).unwrap().runs.is_empty());
    }
}
