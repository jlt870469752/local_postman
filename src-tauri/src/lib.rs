#[cfg(test)]
pub(crate) static NETWORK_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
mod git_workspace;
mod local_listener;
mod mock_server;
mod preferences;
mod service_runtime;
mod workspace_catalog;
mod workspace_store;
use preferences::RequestSettings;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{fs, path::PathBuf, process::Command, time::Instant};
use tauri::{Emitter, Manager};
#[derive(Clone, Deserialize)]
struct ApiRequest {
    method: String,
    url: String,
    headers: Vec<(String, String)>,
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
#[derive(Serialize)]
struct ApiResponse {
    ok: bool,
    status: u16,
    time_ms: u128,
    body: String,
    headers: std::collections::HashMap<String, String>,
    size: usize,
}
fn app_dir() -> Result<PathBuf, String> {
    let p = dirs::data_local_dir()
        .ok_or("找不到本地应用数据目录")?
        .join("LocalPostman");
    fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    Ok(p)
}
fn workspace_path() -> Result<PathBuf, String> {
    workspace_catalog::active_path(&app_dir()?)
}
fn storage_lock() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    workspace_store::WORKSPACE_LOCK
        .lock()
        .map_err(|_| "工作区存储锁不可用".into())
}
#[tauri::command]
async fn workspace_list() -> Result<Vec<workspace_catalog::WorkspaceInfo>, String> {
    background(|| {
        let _guard = storage_lock()?;
        workspace_catalog::list(&app_dir()?)
    })
    .await
}
#[tauri::command]
async fn workspace_create(name: String) -> Result<workspace_catalog::WorkspaceInfo, String> {
    background(move || {
        let _guard = storage_lock()?;
        workspace_catalog::create(&app_dir()?, &name)
    })
    .await
}
#[tauri::command]
async fn workspace_rename(
    id: String,
    name: String,
) -> Result<workspace_catalog::WorkspaceInfo, String> {
    background(move || {
        let _guard = storage_lock()?;
        workspace_catalog::rename(&app_dir()?, &id, &name)
    })
    .await
}
#[tauri::command]
async fn workspace_delete(id: String) -> Result<(), String> {
    background(move || {
        let _guard = storage_lock()?;
        workspace_catalog::delete(&app_dir()?, &id)
    })
    .await
}
#[tauri::command]
async fn workspace_switch(id: String) -> Result<Value, String> {
    background(move || {
        let _guard = storage_lock()?;
        workspace_catalog::switch(&app_dir()?, &id)
    })
    .await
}
#[tauri::command]
async fn load_workspace() -> Result<Value, String> {
    background(|| {
        let _guard = storage_lock()?;
        workspace_store::read(&workspace_path()?)
    })
    .await
}
#[tauri::command]
async fn save_workspace(
    workspace: Value,
    archive_current: Option<bool>,
    workspace_id: Option<String>,
) -> Result<(), String> {
    background(move || {
        let _guard = storage_lock()?;
        workspace_catalog::check_active(&app_dir()?, workspace_id.as_deref())?;
        if archive_current == Some(true) {
            workspace_store::archive_before_replace(&workspace_path()?)?;
        }
        workspace_store::save(&workspace_path()?, &workspace)
    })
    .await
}
#[tauri::command]
async fn workspace_recovery_info() -> Result<workspace_store::RecoveryInfo, String> {
    background(|| {
        let _guard = storage_lock()?;
        Ok(workspace_store::recovery_info(&workspace_path()?))
    })
    .await
}
#[tauri::command]
async fn restore_workspace_backup() -> Result<Value, String> {
    background(|| {
        let _guard = storage_lock()?;
        workspace_store::restore_backup(&workspace_path()?)
    })
    .await
}
#[tauri::command]
async fn export_workspace(workspace: Value) -> Result<Option<String>, String> {
    let mut dialog = rfd::AsyncFileDialog::new()
        .set_title("Export workspace")
        .set_file_name("localpostman-export.json")
        .add_filter("JSON", &["json"]);
    if let Some(directory) = dirs::download_dir() {
        dialog = dialog.set_directory(directory);
    }
    let Some(file) = dialog.save_file().await else {
        return Ok(None);
    };
    let path = file.path().to_path_buf();
    background(move || {
        workspace_store::atomic_write(
            &path,
            &serde_json::to_vec_pretty(&workspace).map_err(|e| e.to_string())?,
        )?;
        Ok(Some(path.display().to_string()))
    })
    .await
}
#[tauri::command]
async fn send_request(request: ApiRequest) -> Result<ApiResponse, String> {
    let settings = preferences::load(&app_dir()?)?;
    send_request_with_settings(request, &settings).await
}
async fn send_request_with_settings(
    mut request: ApiRequest,
    settings: &Value,
) -> Result<ApiResponse, String> {
    let start = Instant::now();
    if preferences::flag(settings, "requestValidation")
        && (request.url.trim() != request.url || request.url.contains("{{"))
    {
        return Err("Request validation failed: remove surrounding URL whitespace and resolve URL variables".into());
    }
    let mut url = reqwest::Url::parse(&request.url).map_err(|e| format!("Invalid URL: {e}"))?;
    if !["http", "https"].contains(&url.scheme()) {
        return Err("Only HTTP and HTTPS request URLs are supported".into());
    }
    let mut method: reqwest::Method = request
        .method
        .parse()
        .map_err(|e| format!("Invalid HTTP method: {e}"))?;
    if preferences::flag(settings, "trimKeysAndValues") {
        request.headers = request
            .headers
            .into_iter()
            .map(|(k, v)| (k.trim().into(), v.trim().into()))
            .collect();
        request.fields = request
            .fields
            .into_iter()
            .map(|(k, v)| (k.trim().into(), v.trim().into()))
            .collect();
        let pairs: Vec<_> = url
            .query_pairs()
            .map(|(k, v)| (k.trim().to_owned(), v.trim().to_owned()))
            .collect();
        if !pairs.is_empty() {
            url.query_pairs_mut().clear().extend_pairs(pairs);
        }
        if request.body_type == "urlencoded" {
            if let Some(body) = request.body.take() {
                request.body = Some(
                    url::form_urlencoded::Serializer::new(String::new())
                        .extend_pairs(
                            url::form_urlencoded::parse(body.as_bytes())
                                .map(|(k, v)| (k.trim().to_owned(), v.trim().to_owned())),
                        )
                        .finish(),
                );
            }
        }
    }
    let timeout = request
        .settings
        .timeout
        .unwrap_or(settings["general"]["timeout"].as_u64().unwrap_or(0));
    let max_redirects = settings["general"]["maxRedirects"].as_u64().unwrap_or(10);
    let mut redirects = 0;
    let mut body_allowed = true;
    loop {
        let client = preferences::client(settings, &request.settings, &url)?;
        let has_header = |name: &str| {
            request
                .headers
                .iter()
                .any(|(key, _)| key.eq_ignore_ascii_case(name))
        };
        let mut req = client.request(method.clone(), url.clone());
        if preferences::flag(settings, "sendNoCacheHeader") {
            if !has_header("Cache-Control") {
                req = req.header("Cache-Control", "no-cache")
            }
            if !has_header("Pragma") {
                req = req.header("Pragma", "no-cache")
            }
        }
        if preferences::flag(settings, "sendPostmanTokenHeader") && !has_header("Postman-Token") {
            req = req.header("Postman-Token", uuid_token())
        }
        for (key, value) in &request.headers {
            if body_allowed
                || !["content-type", "content-length", "transfer-encoding"]
                    .contains(&key.to_ascii_lowercase().as_str())
            {
                req = req.header(key, value)
            }
        }
        if body_allowed && method != reqwest::Method::GET && method != reqwest::Method::HEAD {
            match request.body_type.as_str() {
                "form-data" => {
                    let mut form = reqwest::multipart::Form::new();
                    for (key, value) in &request.fields {
                        form = form.text(key.clone(), value.clone())
                    }
                    req = req.multipart(form)
                }
                "binary" => req = req.body(request.binary_bytes.clone()),
                "none" => {}
                _ => {
                    if request.body_type == "urlencoded" && !has_header("Content-Type") {
                        req = req.header("Content-Type", "application/x-www-form-urlencoded")
                    }
                    if let Some(body) = &request.body {
                        req = req.body(body.clone())
                    }
                }
            }
        }
        if timeout > 0 {
            let remaining = std::time::Duration::from_millis(timeout)
                .checked_sub(start.elapsed())
                .ok_or("Request timed out")?;
            req = req.timeout(remaining);
        }
        let response = req.send().await.map_err(|e| {
            if e.is_timeout() {
                format!("Request timed out after {timeout} ms")
            } else {
                e.to_string()
            }
        })?;
        let status = response.status();
        if preferences::follows(settings, &request.settings)
            && [301, 302, 303, 307, 308].contains(&status.as_u16())
        {
            if let Some(location) = response.headers().get(reqwest::header::LOCATION) {
                if redirects >= max_redirects {
                    return Err(format!("Too many redirects (maximum {max_redirects})"));
                }
                let next = url
                    .join(location.to_str().map_err(|_| "Invalid redirect location")?)
                    .map_err(|e| format!("Invalid redirect URL: {e}"))?;
                if !["http", "https"].contains(&next.scheme()) {
                    return Err("Redirect target must use HTTP or HTTPS".into());
                }
                if url.origin() != next.origin() {
                    request.headers.retain(|(name, _)| {
                        !name.eq_ignore_ascii_case("Host")
                            && !name.eq_ignore_ascii_case("Cookie")
                            && (preferences::flag(settings, "followAuthorizationHeader")
                                || !name.eq_ignore_ascii_case("Authorization"))
                    });
                }
                let rewrite = status == reqwest::StatusCode::SEE_OTHER
                    && method != reqwest::Method::HEAD
                    || ([301, 302].contains(&status.as_u16()) && method == reqwest::Method::POST);
                if rewrite && !preferences::flag(settings, "redirectWithOriginalMethod") {
                    method = reqwest::Method::GET;
                    body_allowed = false;
                }
                url = next;
                redirects += 1;
                continue;
            }
        }
        let (bytes, status, headers) = preferences::response_body(
            response,
            preferences::max_response_bytes(settings, &request.settings),
        )
        .await?;
        return Ok(ApiResponse {
            ok: status.is_success(),
            status: status.as_u16(),
            time_ms: start.elapsed().as_millis(),
            size: bytes.len(),
            body: String::from_utf8_lossy(&bytes).into_owned(),
            headers,
        });
    }
}
fn uuid_token() -> String {
    format!(
        "localpostman-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    )
}
#[tauri::command]
fn export_response(body: String) -> Result<String, String> {
    let path = app_dir()?.join(format!(
        "response-{}.txt",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_millis()
    ));
    fs::write(&path, body).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}
fn repo() -> Result<PathBuf, String> {
    let _guard = storage_lock()?;
    let workspace = workspace_store::read(&workspace_path()?)?;
    let path = workspace
        .get("gitRepository")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or("请先配置 Git 仓库路径")?;
    let path = PathBuf::from(path);
    if !path.is_dir() {
        return Err("Git 仓库目录不存在".into());
    }
    Ok(path)
}
fn git_at(path: &std::path::Path, args: &[&str]) -> Result<String, String> {
    let o = Command::new("git")
        .args(args)
        .current_dir(path)
        .output()
        .map_err(|e| e.to_string())?;
    if o.status.success() {
        Ok(String::from_utf8_lossy(&o.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&o.stderr).trim().to_string())
    }
}
async fn background<T: Send + 'static>(
    operation: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|e| format!("后台操作失败：{e}"))?
}
#[tauri::command]
async fn git_status() -> Result<String, String> {
    background(|| git_at(&repo()?, &["status", "--short", "--branch"])).await
}
#[tauri::command]
fn git_choose_folder() -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        let script = "POSIX path of (choose folder with prompt \"Choose Git working directory\")";
        let output = Command::new("osascript")
            .args(["-e", script])
            .output()
            .map_err(|e| e.to_string())?;
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            return Ok((!path.is_empty()).then_some(path));
        }
        let error = String::from_utf8_lossy(&output.stderr);
        if error.contains("User canceled") || error.contains("(-128)") {
            return Ok(None);
        }
        return Err(error.trim().to_string());
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(None)
    }
}
#[tauri::command]
fn git_probe(path: String) -> Result<String, String> {
    let root = PathBuf::from(path.trim());
    if !root.is_dir() {
        return Err("Git working directory does not exist".into());
    }
    git_at(&root, &["rev-parse", "--show-toplevel"])?;
    git_at(&root, &["status", "--short", "--branch"])
}
fn committed_workspace(mut workspace: Value) -> Value {
    let baselines = workspace
        .get("editorSession")
        .and_then(|s| s.get("requestBaselines"))
        .cloned()
        .unwrap_or(Value::Null);
    if let Some(collections) = workspace
        .get_mut("collections")
        .and_then(Value::as_array_mut)
    {
        for collection in collections {
            if let Some(items) = collection.get_mut("items").and_then(Value::as_array_mut) {
                *items = items
                    .iter()
                    .filter_map(|item| {
                        let id = item.get("id")?.as_str()?;
                        match baselines.get(id) {
                            Some(Value::Null) => None,
                            Some(saved) if saved.get("id").and_then(Value::as_str) == Some(id) => {
                                Some(saved.clone())
                            }
                            _ => Some(item.clone()),
                        }
                    })
                    .collect();
            }
        }
    }
    if let Some(obj) = workspace.as_object_mut() {
        obj.remove("history");
        obj.remove("gitRepository");
        obj.remove("editorSession");
        obj.remove("gitWorkspaceRevision");
    }
    workspace
}
#[tauri::command]
async fn git_open(path: String) -> Result<git_workspace::GitWorkspace, String> {
    background(move || {
        let _guard = storage_lock()?;
        git_workspace::open(&path)
    })
    .await
}
#[tauri::command]
async fn git_preview(
    path: String,
    expected_revision: Option<String>,
) -> Result<git_workspace::GitPreview, String> {
    background(move || {
        let _guard = storage_lock()?;
        let workspace = workspace_store::read(&workspace_path()?)?;
        git_workspace::preview(&path, expected_revision.as_deref(), workspace)
    })
    .await
}
#[tauri::command]
async fn git_pull(
    path: String,
    expected_revision: Option<String>,
) -> Result<git_workspace::GitWorkspace, String> {
    background(move || {
        let _guard = storage_lock()?;
        let workspace = workspace_store::read(&workspace_path()?)?;
        git_workspace::pull(&path, expected_revision.as_deref(), workspace)
    })
    .await
}
#[tauri::command]
async fn git_sync(
    message: String,
    push: bool,
    expected_revision: Option<String>,
) -> Result<git_workspace::GitWorkspace, String> {
    background(move || {
        let _guard = storage_lock()?;
        let workspace = workspace_store::read(&workspace_path()?)?;
        let path = workspace
            .get("gitRepository")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .ok_or("请先配置 Git 仓库路径")?;
        git_workspace::sync(
            path,
            expected_revision.as_deref(),
            workspace.clone(),
            &message,
            push,
        )
    })
    .await
}
#[tauri::command]
async fn settings_load() -> Result<Value, String> {
    background(|| preferences::load(&app_dir()?)).await
}
#[tauri::command]
async fn settings_save(settings: Value) -> Result<Value, String> {
    background(move || preferences::save(&app_dir()?, &settings)).await
}
#[tauri::command]
async fn settings_info() -> Result<Value, String> {
    background(||{
    let dir=app_dir()?;
    Ok(serde_json::json!({"version":env!("CARGO_PKG_VERSION"),"platform":std::env::consts::OS,"arch":std::env::consts::ARCH,"dataDirectory":dir.display().to_string(),"preferencesPath":preferences::path(&dir).display().to_string()}))
}).await
}
#[tauri::command]
async fn settings_check_update() -> Result<Value, String> {
    Ok(
        serde_json::json!({"status":"unavailable","message":"No signed update feed is configured for this local build."}),
    )
}
#[tauri::command]
async fn settings_choose_path(kind: String) -> Result<Option<String>, String> {
    background(move||{
    let script=match kind.as_str(){
        "directory"=>"POSIX path of (choose folder with prompt \"Choose working directory\")",
        "certificate"=>"POSIX path of (choose file with prompt \"Choose client certificate (PEM, CRT, PFX or P12)\")",
        "requestFile"=>"POSIX path of (choose file with prompt \"Choose binary request file\")",
        "privateKey"=>"POSIX path of (choose file with prompt \"Choose unencrypted PKCS#8 private key\")",
        "ca"=>"POSIX path of (choose file with prompt \"Choose CA certificate bundle (PEM or DER)\")",
        "sslKeyLog"=>return Err("SSL/TLS key logging is not supported by the current native TLS engine".into()),
        _=>return Err("Unsupported path chooser kind".into())
    };
    #[cfg(target_os="macos")]{let output=Command::new("osascript").args(["-e",script]).output().map_err(|e|e.to_string())?;if output.status.success(){let path=String::from_utf8_lossy(&output.stdout).trim().to_string();return Ok((!path.is_empty()).then_some(path));}let error=String::from_utf8_lossy(&output.stderr);if error.contains("User canceled")||error.contains("(-128)"){return Ok(None)}Err(error.trim().to_string())}
    #[cfg(not(target_os="macos"))]{let _=script;Err("Native path selection is supported on macOS only".into())}
}).await
}
#[tauri::command]
async fn settings_open_path(path: String) -> Result<(), String> {
    background(move || {
        let base = app_dir()?;
        let settings = preferences::load(&base)?;
        let target = preferences::allowed_open_path(&base, &settings, &PathBuf::from(path))?;
        #[cfg(target_os = "macos")]
        {
            Command::new("open")
                .arg(&target)
                .status()
                .map_err(|e| e.to_string())?
                .success()
                .then_some(())
                .ok_or("Could not open path".into())
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = target;
            Err("Opening paths is supported on macOS only".into())
        }
    })
    .await
}
#[tauri::command]
async fn settings_read_request_file(path: String) -> Result<Value, String> {
    background(move || {
        let settings = preferences::load(&app_dir()?)?;
        preferences::read_request_file(&settings, &PathBuf::from(path))
    }).await
}
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                if let Some(window) = app.get_webview_window("main") {
                    window.set_title("LocalPostman (Development)")?;
                }
            }
            Ok(())
        })
        .manage(mock_server::MockRegistry::default())
        .manage(service_runtime::ServiceRegistry::default())
        .menu(|app| {
            let menu = tauri::menu::Menu::default(app)?;
            let item = tauri::menu::MenuItem::with_id(
                app,
                "import-request",
                "Import…",
                true,
                Some("CmdOrCtrl+O"),
            )?;
            for entry in menu.items()? {
                if let tauri::menu::MenuItemKind::Submenu(submenu) = entry {
                    if submenu.text()? == "File" {
                        submenu.insert(&item, 0)?;
                        break;
                    }
                }
            }
            Ok(menu)
        })
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "import-request" {
                let _ = app.emit("open-import", ());
            }
        })
        .invoke_handler(tauri::generate_handler![
            service_runtime::service_run,
            service_runtime::service_start,
            service_runtime::service_stop,
            service_runtime::service_status,
            mock_server::mock_start,
            mock_server::mock_stop,
            mock_server::mock_status,
            workspace_list,
            workspace_create,
            workspace_rename,
            workspace_delete,
            workspace_switch,
            settings_load,
            settings_save,
            settings_info,
            settings_check_update,
            settings_choose_path,
            settings_open_path,
            settings_read_request_file,
            load_workspace,
            save_workspace,
            workspace_recovery_info,
            restore_workspace_backup,
            export_workspace,
            export_response,
            send_request,
            git_status,
            git_choose_folder,
            git_probe,
            git_open,
            git_preview,
            git_pull,
            git_sync
        ])
        .run(tauri::generate_context!())
        .expect("运行 Tauri 失败");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    fn capture_request(mut request: ApiRequest) -> String {
        let _network_guard = NETWORK_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let thread = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut bytes = Vec::new();
            let mut buf = [0; 4096];
            loop {
                let n = stream.read(&mut buf).unwrap();
                bytes.extend_from_slice(&buf[..n]);
                if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                    let head = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
                    let len = head
                        .lines()
                        .find_map(|line| {
                            line.strip_prefix("content-length: ")
                                .and_then(|v| v.parse::<usize>().ok())
                        })
                        .unwrap_or(0);
                    if bytes.len() >= end + 4 + len {
                        break;
                    }
                }
            }
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}")
                .unwrap();
            String::from_utf8_lossy(&bytes).into_owned()
        });
        let is_head = request.method == "HEAD";
        request.url = format!("http://{addr}/echo");
        let response = tauri::async_runtime::block_on(send_request_with_settings(
            request,
            &preferences::defaults(),
        ))
        .unwrap();
        assert_eq!(response.headers.get("content-length").unwrap(), "2");
        assert_eq!(response.size, if is_head { 0 } else { 2 });
        assert_eq!(response.status, 200);
        thread.join().unwrap()
    }
    #[test]
    fn git_export_uses_saved_requests_and_omits_local_drafts() {
        let saved = serde_json::json!({"id":"saved","url":"https://example.test/original"});
        let workspace = serde_json::json!({"collections":[{"id":"c","items":[{"id":"saved","url":"https://example.test/edited"},{"id":"new","url":"https://example.test/draft"},{"id":"clean","url":"https://example.test/clean"}]}],"history":[1],"gitRepository":"/local/repo","editorSession":{"requestBaselines":{"saved":saved,"new":null}}});
        let exported = committed_workspace(workspace.clone());
        assert_eq!(
            exported["collections"][0]["items"],
            serde_json::json!([saved,{"id":"clean","url":"https://example.test/clean"}])
        );
        for key in ["history", "gitRepository", "editorSession"] {
            assert!(exported.get(key).is_none());
        }
        assert_eq!(
            workspace["collections"][0]["items"]
                .as_array()
                .unwrap()
                .len(),
            3
        );
        assert_eq!(
            committed_workspace(serde_json::json!({"collections":[]})),
            serde_json::json!({"collections":[]})
        );
    }
    fn base_request() -> ApiRequest {
        ApiRequest {
            method: "POST".into(),
            url: String::new(),
            headers: vec![],
            body: None,
            body_type: "none".into(),
            fields: vec![],
            binary_bytes: vec![],
            settings: Default::default(),
        }
    }
    fn capture(body_type: &str, fields: Vec<(String, String)>, body: Option<String>) -> String {
        let mut r = base_request();
        r.body_type = body_type.into();
        r.fields = fields;
        r.body = body;
        capture_request(r)
    }
    #[test]
    fn binary_preserves_bytes() {
        let mut r = base_request();
        r.body_type = "binary".into();
        r.binary_bytes = vec![0, 1, 2, 127];
        let raw = capture_request(r);
        assert!(raw.ends_with("\0\x01\x02\x7f"));
    }
    #[test]
    fn duplicate_headers_and_auth_are_sent() {
        let mut r = base_request();
        r.headers = vec![
            ("x-tag".into(), "one".into()),
            ("x-tag".into(), "two".into()),
            ("Authorization".into(), "Bearer local-test".into()),
        ];
        let raw = capture_request(r).to_lowercase();
        assert!(raw.contains("x-tag: one"));
        assert!(raw.contains("x-tag: two"));
        assert!(raw.contains("authorization: bearer local-test"));
    }
    #[test]
    fn multipart_has_boundary_and_field() {
        let raw = capture("form-data", vec![("title".into(), "hello".into())], None);
        assert!(raw.contains("multipart/form-data; boundary="));
        assert!(raw.contains("name=\"title\""));
        assert!(raw.contains("hello"));
    }
    #[test]
    fn urlencoded_has_content_type_and_encoded_body() {
        let raw = capture("urlencoded", vec![], Some("title=hello+world".into()));
        assert!(raw.contains("application/x-www-form-urlencoded"));
        assert!(raw.ends_with("title=hello+world"));
    }
    #[test]
    fn get_and_head_do_not_send_any_body_type() {
        for method in ["GET", "HEAD"] {
            for body_type in ["raw", "graphql", "urlencoded", "form-data", "binary"] {
                let mut request = base_request();
                request.method = method.into();
                request.body_type = body_type.into();
                request.body = Some("should-not-send".into());
                request.fields = vec![("title".into(), "should-not-send".into())];
                request.binary_bytes = b"should-not-send".to_vec();
                let raw = capture_request(request);
                assert!(raw.starts_with(&format!("{method} /echo HTTP/1.1")));
                assert!(
                    raw.ends_with("\r\n\r\n"),
                    "{method} {body_type} sent a body: {raw}"
                );
                assert!(!raw.contains("should-not-send"));
                assert!(!raw.to_lowercase().contains("multipart/form-data"));
            }
        }
    }
    #[test]
    fn urlencoded_preserves_explicit_content_type_without_duplicates() {
        let mut request = base_request();
        request.body_type = "urlencoded".into();
        request.headers = vec![("cOnTeNt-TyPe".into(), "text/plain; charset=utf-8".into())];
        request.body = Some("title=hello+world".into());
        let raw = capture_request(request).to_lowercase();
        let headers = raw.split("\r\n\r\n").next().unwrap();
        assert_eq!(
            headers
                .lines()
                .filter(|line| line.starts_with("content-type:"))
                .count(),
            1
        );
        assert!(headers.contains("content-type: text/plain; charset=utf-8"));
        assert!(!headers.contains("application/x-www-form-urlencoded"));
        assert!(raw.ends_with("title=hello+world"));
    }

    fn test_settings() -> Value {
        let mut settings = preferences::defaults();
        settings["proxy"]["useSystem"] = serde_json::json!(false);
        settings["general"]["timeout"] = serde_json::json!(2000);
        settings
    }
    fn fixture(response: Vec<u8>) -> (String, std::thread::JoinHandle<String>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        listener.set_nonblocking(true).unwrap();
        let thread = std::thread::spawn(move || {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(4);
            let mut stream = loop {
                match listener.accept() {
                    Ok((stream, _)) => break stream,
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        assert!(
                            std::time::Instant::now() < deadline,
                            "Fixture received no request"
                        );
                        std::thread::sleep(std::time::Duration::from_millis(5));
                    }
                    Err(e) => panic!("{e}"),
                }
            };
            stream.set_nonblocking(false).unwrap();
            stream
                .set_write_timeout(Some(std::time::Duration::from_secs(2)))
                .unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(2)))
                .unwrap();
            let mut bytes = Vec::new();
            let mut buf = [0; 4096];
            loop {
                let n = stream.read(&mut buf).unwrap();
                assert!(n > 0);
                bytes.extend_from_slice(&buf[..n]);
                if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                    let head = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
                    let len = head
                        .lines()
                        .find_map(|line| {
                            line.strip_prefix("content-length: ")
                                .and_then(|v| v.parse::<usize>().ok())
                        })
                        .unwrap_or(0);
                    if bytes.len() >= end + 4 + len {
                        break;
                    }
                }
            }
            let _ = stream.write_all(&response);
            String::from_utf8_lossy(&bytes).into_owned()
        });
        (url, thread)
    }
    fn call(request: ApiRequest, settings: &Value) -> Result<ApiResponse, String> {
        tauri::async_runtime::block_on(send_request_with_settings(request, settings))
    }
    #[test]
    fn settings_headers_trim_and_validation_affect_outbound_request() {
        let _guard = NETWORK_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut settings = test_settings();
        settings["general"]["sendNoCacheHeader"] = serde_json::json!(true);
        settings["general"]["sendPostmanTokenHeader"] = serde_json::json!(true);
        settings["general"]["trimKeysAndValues"] = serde_json::json!(true);
        let (url, thread) = fixture(
            b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}".to_vec(),
        );
        let mut r = base_request();
        r.url = format!("{url}/?%20key%20=%20value%20");
        r.headers = vec![
            (" X-Test ".into(), " value ".into()),
            ("Cache-Control".into(), "max-age=60".into()),
        ];
        r.body_type = "urlencoded".into();
        r.body = Some("+name+=+local+".into());
        call(r, &settings).unwrap();
        let raw = thread.join().unwrap().to_lowercase();
        assert!(raw.starts_with("post /?key=value "));
        assert!(raw.contains("x-test: value\r\n"));
        assert!(raw.contains("cache-control: max-age=60"));
        assert!(!raw.contains("cache-control: no-cache"));
        assert!(raw.contains("pragma: no-cache"));
        assert!(raw.contains("postman-token:"));
        assert!(raw.ends_with("name=local"));
        let mut r = base_request();
        r.url = " http://127.0.0.1/ ".into();
        assert!(call(r, &settings).err().unwrap().contains("validation"));
    }
    #[test]
    fn redirects_apply_method_and_authorization_policies_and_request_override() {
        let _guard = NETWORK_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        for (preserve_method, forward_auth) in [(false, false), (true, true)] {
            let mut settings = test_settings();
            settings["general"]["redirectWithOriginalMethod"] = serde_json::json!(preserve_method);
            settings["general"]["followAuthorizationHeader"] = serde_json::json!(forward_auth);
            let (target, read_target) = fixture(
                b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}".to_vec(),
            );
            let(source,read_source)=fixture(format!("HTTP/1.1 302 Found\r\nLocation: {target}/destination\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").into_bytes());
            let mut r = base_request();
            r.url = source;
            r.body_type = "raw".into();
            r.body = Some("payload".into());
            r.headers = vec![
                ("Authorization".into(), "Bearer local-fixture".into()),
                ("Content-Type".into(), "text/plain".into()),
            ];
            assert_eq!(call(r, &settings).unwrap().status, 200);
            assert!(read_source.join().unwrap().starts_with("POST / "));
            let raw = read_target.join().unwrap();
            assert!(raw.starts_with(if preserve_method {
                "POST /destination "
            } else {
                "GET /destination "
            }));
            assert_eq!(
                raw.to_lowercase()
                    .contains("authorization: bearer local-fixture"),
                forward_auth
            );
            assert_eq!(raw.ends_with("payload"), preserve_method);
            assert_eq!(
                raw.to_lowercase().contains("content-type:"),
                preserve_method
            );
        }
        for max in [0, 1] {
            let mut settings = test_settings();
            settings["general"]["maxRedirects"] = serde_json::json!(max);
            let(url,thread)=fixture(b"HTTP/1.1 302 Found\r\nLocation: /again\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec());
            let mut r = base_request();
            r.method = "GET".into();
            r.url = url;
            r.settings.follow_redirects = Some(max == 0);
            let result = call(r, &settings);
            if max == 0 {
                assert!(result.err().unwrap().contains("Too many redirects"));
            } else {
                assert_eq!(result.unwrap().status, 302)
            }
            thread.join().unwrap();
        }
    }
    #[test]
    fn cookie_setting_persists_or_disables_cookie_jar() {
        let _guard = NETWORK_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        for disabled in [false, true] {
            let mut settings = test_settings();
            settings["general"]["disableCookies"] = serde_json::json!(disabled);
            let name = format!(
                "fixture{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            );
            let(url,thread)=fixture(format!("HTTP/1.1 200 OK\r\nSet-Cookie: {name}=local; Path=/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").into_bytes());
            let mut r = base_request();
            r.method = "GET".into();
            r.url = url;
            call(r, &settings).unwrap();
            thread.join().unwrap();
            let (url, thread) = fixture(
                b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec(),
            );
            let mut r = base_request();
            r.method = "GET".into();
            r.url = url;
            call(r, &settings).unwrap();
            assert_eq!(
                thread.join().unwrap().contains(&format!("{name}=local")),
                !disabled
            );
        }
    }
    #[test]
    fn custom_proxy_routes_request_and_authenticates_without_contacting_target() {
        let _guard = NETWORK_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let (url, thread) = fixture(
            b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}".to_vec(),
        );
        let proxy = reqwest::Url::parse(&url).unwrap();
        let mut settings = test_settings();
        settings["proxy"]["enabled"] = serde_json::json!(true);
        settings["proxy"]["host"] = serde_json::json!("127.0.0.1");
        settings["proxy"]["port"] = serde_json::json!(proxy.port().unwrap());
        settings["proxy"]["username"] = serde_json::json!("user");
        settings["proxy"]["password"] = serde_json::json!("pass");
        let mut r = base_request();
        r.method = "GET".into();
        r.url = "http://fixture.invalid/example".into();
        assert_eq!(call(r, &settings).unwrap().status, 200);
        let raw = thread.join().unwrap().to_lowercase();
        assert!(raw.starts_with("get http://fixture.invalid/example "));
        assert!(raw.contains("proxy-authorization: basic dxnlcjpwyxnz"));
    }
    #[test]
    fn response_limit_and_request_override_are_enforced() {
        let _guard = NETWORK_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut settings = test_settings();
        settings["general"]["maxResponseSize"] = serde_json::json!(1);
        for override_limit in [None, Some(2)] {
            let size = 1024 * 1024 + 1;
            let mut reply =
                format!("HTTP/1.1 200 OK\r\nContent-Length: {size}\r\nConnection: close\r\n\r\n")
                    .into_bytes();
            reply.extend(vec![b'x'; size]);
            let (url, thread) = fixture(reply);
            let mut r = base_request();
            r.method = "GET".into();
            r.url = url;
            r.settings.max_response_size = override_limit;
            let result = call(r, &settings);
            if override_limit.is_none() {
                assert!(result.err().unwrap().contains("configured limit"));
            } else {
                assert_eq!(result.unwrap().size, size)
            }
            thread.join().unwrap();
        }
    }

    #[test]
    fn timeout_setting_and_request_override_have_real_deadlines() {
        let _guard = NETWORK_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        for override_timeout in [None, Some(1000)] {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let url = format!("http://{}", listener.local_addr().unwrap());
            let thread = std::thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(std::time::Duration::from_secs(1)))
                    .unwrap();
                let mut buf = [0; 4096];
                let _ = stream.read(&mut buf);
                std::thread::sleep(std::time::Duration::from_millis(100));
                let _ = stream.write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                );
            });
            let mut settings = test_settings();
            settings["general"]["timeout"] = serde_json::json!(20);
            let mut r = base_request();
            r.method = "GET".into();
            r.url = url;
            r.settings.timeout = override_timeout;
            let result = call(r, &settings);
            if override_timeout.is_none() {
                assert!(result.is_err());
            } else {
                assert_eq!(result.unwrap().status, 200)
            }
            thread.join().unwrap();
        }
    }
    #[test]
    fn streaming_response_limit_also_applies_without_content_length() {
        let _guard = NETWORK_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let size = 1024 * 1024 + 1;
        let mut reply=format!("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n{size:x}\r\n").into_bytes();
        reply.extend(vec![b'x'; size]);
        reply.extend_from_slice(b"\r\n0\r\n\r\n");
        let (url, thread) = fixture(reply);
        let mut settings = test_settings();
        settings["general"]["maxResponseSize"] = serde_json::json!(1);
        let mut r = base_request();
        r.method = "GET".into();
        r.url = url;
        assert!(call(r, &settings)
            .err()
            .unwrap()
            .contains("configured limit"));
        thread.join().unwrap();
    }
}
