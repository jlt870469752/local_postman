use serde::Serialize;
use serde_json::Value;
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};

pub static WORKSPACE_LOCK: Mutex<()> = Mutex::new(());
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub fn validate(workspace: &Value) -> Result<(), String> {
    let object = workspace.as_object().ok_or("工作区必须是 JSON 对象")?;
    let collections = object
        .get("collections")
        .and_then(Value::as_array)
        .ok_or("工作区缺少 collections 数组")?;
    for collection in collections {
        if !collection.is_object()
            || collection.get("id").and_then(Value::as_str).is_none()
            || collection.get("name").and_then(Value::as_str).is_none()
        {
            return Err("Collection 必须包含 id 和 name".into());
        }
        for field in ["items", "folders"] {
            if let Some(value) = collection.get(field) {
                if !value.is_array() {
                    return Err(format!("Collection 的 {field} 必须是数组"));
                }
            }
        }
        if let Some(items) = collection.get("items").and_then(Value::as_array) {
            for item in items {
                validate_record(item, "请求")?;
                for field in ["name", "method", "url"] {
                    optional_type(item, field, Value::is_string, "字符串")?;
                }
                for field in ["headers", "params", "bodyFields"] {
                    optional_type(
                        item,
                        field,
                        |value| value.is_array() || value.is_object(),
                        "数组或对象",
                    )?;
                }
                if let Some(rows) = item.get("headers").and_then(Value::as_array) {
                    for row in rows {
                        if !row.is_object() {
                            return Err("Header 行必须是对象".into());
                        }
                    }
                }
                optional_type(item, "auth", Value::is_object, "对象")?;
                optional_type(item, "settings", Value::is_object, "对象")?;
            }
        }
        if let Some(folders) = collection.get("folders").and_then(Value::as_array) {
            for folder in folders {
                validate_record(folder, "文件夹")?;
                optional_type(folder, "name", Value::is_string, "字符串")?;
            }
        }
    }
    for field in [
        "environments",
        "history",
        "mockServers",
        "monitors",
        "webhooks",
        "deployedFlows",
    ] {
        if let Some(value) = object.get(field) {
            if !value.is_array() {
                return Err(format!("工作区的 {field} 必须是数组"));
            }
        }
    }
    if let Some(environments) = object.get("environments").and_then(Value::as_array) {
        for environment in environments {
            validate_record(environment, "环境")?;
            optional_type(environment, "values", Value::is_object, "对象")?;
            optional_type(environment, "currentValues", Value::is_object, "对象")?;
        }
    }
    for field in ["mockServers", "monitors", "webhooks", "deployedFlows"] {
        if let Some(records) = object.get(field).and_then(Value::as_array) {
            for record in records {
                validate_record(record, field)?;
                optional_type(record, "routes", Value::is_array, "数组")?;
            }
        }
    }
    optional_type(workspace, "editorSession", Value::is_object, "对象")?;
    if let Some(session) = object.get("editorSession") {
        optional_type(session, "requestBaselines", Value::is_object, "对象")?;
        optional_type(session, "openRequestTabs", Value::is_array, "数组")?;
        if let Some(baselines) = session.get("requestBaselines").and_then(Value::as_object) {
            for baseline in baselines.values() {
                optional_type(baseline, "auth", Value::is_object, "对象")?;
            }
        }
    }
    if let Some(history) = object.get("history").and_then(Value::as_array) {
        for request in history {
            optional_type(request, "auth", Value::is_object, "对象")?;
        }
    }
    Ok(())
}

// Older importers represented an unresolved auth inheritance chain as null.
// Requests without an inherited auth use No Auth; normalize only that legacy
// representation, leaving malformed non-object values for validation to reject.
fn normalize_legacy_auth(workspace: &mut Value) {
    fn request_auth(request: &mut Value) {
        if let Some(auth) = request.get_mut("auth") {
            if auth.is_null() {
                *auth = serde_json::json!({"type": "No Auth"});
            }
        }
    }
    if let Some(collections) = workspace.get_mut("collections").and_then(Value::as_array_mut) {
        for collection in collections {
            if let Some(items) = collection.get_mut("items").and_then(Value::as_array_mut) {
                for request in items {
                    request_auth(request);
                }
            }
        }
    }
    if let Some(history) = workspace.get_mut("history").and_then(Value::as_array_mut) {
        for request in history {
            request_auth(request);
        }
    }
    if let Some(baselines) = workspace
        .get_mut("editorSession")
        .and_then(|session| session.get_mut("requestBaselines"))
        .and_then(Value::as_object_mut)
    {
        for request in baselines.values_mut() {
            request_auth(request);
        }
    }
}

fn validate_record(value: &Value, label: &str) -> Result<(), String> {
    if !value.is_object() || value.get("id").and_then(Value::as_str).is_none() {
        return Err(format!("{label} 必须是包含 id 的对象"));
    }
    Ok(())
}

fn optional_type(
    value: &Value,
    key: &str,
    check: impl FnOnce(&Value) -> bool,
    label: &str,
) -> Result<(), String> {
    if let Some(field) = value.get(key) {
        if !check(field) {
            return Err(format!("{key} 必须是{label}"));
        }
    }
    Ok(())
}

pub fn decode(bytes: &[u8]) -> Result<Value, String> {
    let mut workspace: Value = serde_json::from_slice(bytes)
        .map_err(|e| format!("WORKSPACE_INVALID: 工作区 JSON 无法解析：{e}"))?;
    normalize_legacy_auth(&mut workspace);
    validate(&workspace).map_err(|e| format!("WORKSPACE_INVALID: {e}"))?;
    Ok(workspace)
}

pub fn read(path: &Path) -> Result<Value, String> {
    let bytes = fs::read(path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "WORKSPACE_NOT_FOUND: 尚无本地工作区".into()
        } else {
            format!("WORKSPACE_READ_FAILED: {}：{e}", path.display())
        }
    })?;
    decode(&bytes)
}

pub fn backup_path(path: &Path) -> PathBuf {
    path.with_extension("json.bak")
}

pub fn unique_path(path: &Path, label: &str) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    path.with_file_name(format!(
        "{}.{}-{}-{}-{}",
        path.file_name().unwrap_or_default().to_string_lossy(),
        label,
        std::process::id(),
        stamp,
        TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ))
}

pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temp = unique_path(path, "tmp");
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|e| e.to_string())?;
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
        let _ = fs::remove_file(&temp);
    }
    result
}

pub fn save(path: &Path, workspace: &Value) -> Result<(), String> {
    let mut workspace = workspace.clone();
    normalize_legacy_auth(&mut workspace);
    validate(&workspace).map_err(|e| format!("WORKSPACE_INVALID: {e}"))?;
    match fs::read(path) {
        Ok(previous) => {
            decode(&previous).map_err(|e| {
                format!("WORKSPACE_SAVE_BLOCKED: 原工作区未被覆盖，请先恢复备份。{e}")
            })?;
            atomic_write(&backup_path(path), &previous)?;
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => {
            return Err(format!(
                "WORKSPACE_READ_FAILED: 保存前无法读取原工作区：{e}"
            ))
        }
    }
    atomic_write(
        path,
        &serde_json::to_vec_pretty(&workspace).map_err(|e| e.to_string())?,
    )
}

pub fn archive_before_replace(path: &Path) -> Result<(), String> {
    match fs::read(path) {
        Ok(bytes) => {
            decode(&bytes)?;
            atomic_write(&unique_path(path, "before-git-load"), &bytes)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("替换工作区前无法保留原文件：{e}")),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryInfo {
    pub exists: bool,
    pub backup_available: bool,
    pub error: Option<String>,
    pub path: String,
    pub backup_path: String,
}

pub fn recovery_info(path: &Path) -> RecoveryInfo {
    let backup = backup_path(path);
    RecoveryInfo {
        exists: path.exists(),
        backup_available: read(&backup).is_ok(),
        error: read(path).err(),
        path: path.display().to_string(),
        backup_path: backup.display().to_string(),
    }
}

pub fn restore_backup(path: &Path) -> Result<Value, String> {
    let bytes =
        fs::read(backup_path(path)).map_err(|e| format!("WORKSPACE_BACKUP_UNAVAILABLE: {e}"))?;
    let workspace = decode(&bytes)?;
    match fs::read(path) {
        Ok(original) => atomic_write(&unique_path(path, "before-recovery"), &original)?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("恢复前无法保留原文件：{e}")),
    }
    atomic_write(path, &bytes)?;
    Ok(workspace)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn temp_dir() -> PathBuf {
        let path = unique_path(&std::env::temp_dir().join("localpostman-store"), "test");
        fs::create_dir_all(&path).unwrap();
        path
    }
    #[test]
    fn atomic_save_keeps_valid_backup_and_rejects_corruption() {
        let dir = temp_dir();
        let path = dir.join("workspace.json");
        assert!(read(&path).unwrap_err().starts_with("WORKSPACE_NOT_FOUND:"));
        let first = serde_json::json!({"collections":[],"history":[1]});
        let second = serde_json::json!({"collections":[],"history":[2]});
        save(&path, &first).unwrap();
        save(&path, &second).unwrap();
        assert_eq!(read(&path).unwrap(), second);
        assert_eq!(read(&backup_path(&path)).unwrap(), first);
        fs::write(&path, b"{damaged").unwrap();
        assert!(save(&path, &second)
            .unwrap_err()
            .starts_with("WORKSPACE_SAVE_BLOCKED:"));
        assert_eq!(fs::read(&path).unwrap(), b"{damaged");
        assert!(recovery_info(&path).backup_available);
        assert_eq!(restore_backup(&path).unwrap(), first);
        assert!(fs::read_dir(&dir).unwrap().any(|item| item
            .unwrap()
            .file_name()
            .to_string_lossy()
            .contains("before-recovery")));
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn git_load_archive_survives_later_autosaves() {
        let dir = temp_dir();
        let path = dir.join("workspace.json");
        let original = serde_json::json!({"collections":[],"history":[1]});
        save(&path, &original).unwrap();
        archive_before_replace(&path).unwrap();
        let replacement = serde_json::json!({"collections":[],"history":[2]});
        save(&path, &replacement).unwrap();
        save(&path, &replacement).unwrap();
        assert_eq!(read(&backup_path(&path)).unwrap(), replacement);
        let archive = fs::read_dir(&dir).unwrap().map(|entry|entry.unwrap().path())
            .find(|file|file.file_name().unwrap().to_string_lossy().contains("before-git-load")).unwrap();
        assert_eq!(read(&archive).unwrap(), original);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn structurally_invalid_json_is_not_a_workspace() {
        for value in [
            serde_json::json!({}),
            serde_json::json!({"collections":{}}),
            serde_json::json!({"collections":[{}]}),
            serde_json::json!({"collections":[],"history":{}}),
            serde_json::json!({"collections":[],"environments":[null]}),
            serde_json::json!({"collections":[{"id":"c","name":"Collection","items":[{"id":"r","headers":1}]}]}),
            serde_json::json!({"collections":[],"editorSession":{"openRequestTabs":{}}}),
        ] {
            assert!(decode(&serde_json::to_vec(&value).unwrap()).is_err());
        }
    }

    #[test]
    fn legacy_null_auth_loads_saves_and_recovers_without_losing_original_bytes() {
        let dir = temp_dir();
        let path = dir.join("workspace.json");
        let legacy = serde_json::json!({
            "collections": [{"id":"c","name":"Imported","items":[
                {"id":"r","name":"Inherited","auth":null},
                {"id":"bearer","auth":{"type":"Bearer Token","token":"keep"}},
                {"id":"missing"}
            ]}],
            "history": [{"id":"h","auth":null}],
            "editorSession": {"requestBaselines": {
                "r":{"id":"r","auth":null}, "draft":null
            }},
            "environments": [{"id":"e","name":"Local","values":{"host":"http://localhost"}}]
        });
        let original = serde_json::to_vec(&legacy).unwrap();
        fs::write(&path, &original).unwrap();
        let loaded = read(&path).unwrap();
        assert_eq!(loaded["collections"][0]["items"][0]["auth"]["type"], "No Auth");
        assert_eq!(loaded["history"][0]["auth"]["type"], "No Auth");
        assert_eq!(loaded["editorSession"]["requestBaselines"]["r"]["auth"]["type"], "No Auth");
        assert!(loaded["editorSession"]["requestBaselines"]["draft"].is_null());
        assert!(loaded["collections"][0]["items"][2].get("auth").is_none());
        assert_eq!(loaded["collections"][0]["items"][1]["auth"]["token"], "keep");
        assert_eq!(fs::read(&path).unwrap(), original, "Loading must not rewrite the user's file");

        // Saving an environment must accept the old in-memory snapshot too.
        let mut edited = legacy.clone();
        edited["environments"][0]["values"]["host"] = serde_json::json!("http://127.0.0.1:8000");
        save(&path, &edited).unwrap();
        assert_eq!(edited["collections"][0]["items"][0]["auth"], Value::Null, "Saving does not mutate the caller's snapshot");
        let saved = read(&path).unwrap();
        assert_eq!(saved["environments"][0]["values"]["host"], "http://127.0.0.1:8000");
        assert_eq!(saved["collections"][0]["items"][0]["auth"]["type"], "No Auth");
        assert_eq!(fs::read(backup_path(&path)).unwrap(), original, "The backup preserves exact legacy bytes");
        assert_eq!(restore_backup(&path).unwrap(), loaded);
        assert_eq!(fs::read(&path).unwrap(), original);
        assert_eq!(read(&path).unwrap(), loaded);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn legacy_auth_compatibility_does_not_accept_invalid_auth_types() {
        let dir = temp_dir();
        let path = dir.join("workspace.json");
        for auth in [serde_json::json!("none"), serde_json::json!([]), serde_json::json!(false), serde_json::json!(1)] {
            for workspace in [
                serde_json::json!({"collections":[{"id":"c","name":"APIs","items":[{"id":"r","auth":auth}]}]}),
                serde_json::json!({"collections":[],"history":[{"id":"h","auth":auth}]}),
                serde_json::json!({"collections":[],"editorSession":{"requestBaselines":{"r":{"id":"r","auth":auth}}}}),
            ] {
                assert!(decode(&serde_json::to_vec(&workspace).unwrap()).unwrap_err().contains("auth 必须是对象"));
                assert!(save(&path, &workspace).unwrap_err().contains("auth 必须是对象"));
                assert!(!path.exists());
            }
        }
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn frontend_collection_imports_satisfy_native_workspace_contract() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        let output = std::process::Command::new("node")
            .current_dir(root)
            .args(["--input-type=module", "-e", r#"
                import { parseCollection } from './src/import-collection.js';
                const hoppscotch = { name:'Imported', folders:[], requests:[{
                    name:'Inherited', endpoint:'https://example.test', method:'GET',
                    auth:{authType:'inherit',authActive:true}, body:{contentType:null,body:null}
                }] };
                const postman = { info:{name:'Postman'}, item:[{
                    name:'Inherited', request:{method:'GET',url:'https://example.test'}
                }] };
                let sequence = 0;
                const collections = [hoppscotch, postman].map(input => parseCollection(input, prefix => prefix + ++sequence).collection);
                process.stdout.write(JSON.stringify({collections,environments:[],history:[]}));
            "#])
            .output()
            .expect("Node is required to verify the frontend/native import contract");
        assert!(output.status.success(), "Collection importer failed: {}", String::from_utf8_lossy(&output.stderr));
        let workspace: Value = serde_json::from_slice(&output.stdout).unwrap();
        validate(&workspace).expect("New imports must already satisfy native validation before migration");
        let dir = temp_dir();
        let path = dir.join("workspace.json");
        save(&path, &workspace).unwrap();
        assert_eq!(read(&path).unwrap(), workspace);
        fs::remove_dir_all(dir).unwrap();
    }
}
