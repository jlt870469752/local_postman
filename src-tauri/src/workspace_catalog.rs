use crate::workspace_store;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Deserialize, Serialize)]
struct Entry {
    id: String,
    name: String,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Catalog {
    active_id: String,
    workspaces: Vec<Entry>,
}
#[derive(Clone, Serialize)]
pub struct WorkspaceInfo {
    pub id: String,
    pub name: String,
    pub active: bool,
}

fn catalog_path(base: &Path) -> PathBuf {
    base.join("workspaces.json")
}
fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 100 && id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
}
fn read_catalog(base: &Path) -> Result<Catalog, String> {
    let bytes = match fs::read(catalog_path(base)) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Catalog {
                active_id: "default".into(),
                workspaces: vec![Entry {
                    id: "default".into(),
                    name: "My Workspace".into(),
                }],
            })
        }
        Err(e) => return Err(format!("WORKSPACE_CATALOG_READ_FAILED: {e}")),
    };
    let catalog: Catalog =
        serde_json::from_slice(&bytes).map_err(|e| format!("WORKSPACE_CATALOG_INVALID: {e}"))?;
    let mut ids = std::collections::HashSet::new();
    if catalog.workspaces.is_empty()
        || !catalog.workspaces.iter().all(|entry| {
            valid_id(&entry.id) && !entry.name.trim().is_empty() && ids.insert(entry.id.clone())
        })
        || !ids.contains(&catalog.active_id)
    {
        return Err("WORKSPACE_CATALOG_INVALID: 工作区索引损坏，已停止读写以保留原数据".into());
    }
    Ok(catalog)
}
fn save_catalog(base: &Path, catalog: &Catalog) -> Result<(), String> {
    fs::create_dir_all(base).map_err(|e| e.to_string())?;
    workspace_store::atomic_write(
        &catalog_path(base),
        &serde_json::to_vec_pretty(catalog).map_err(|e| e.to_string())?,
    )
}
fn entry<'a>(catalog: &'a Catalog, id: &str) -> Result<&'a Entry, String> {
    catalog
        .workspaces
        .iter()
        .find(|entry| entry.id == id)
        .ok_or_else(|| "WORKSPACE_NOT_FOUND: 工作区不存在".into())
}
fn path_for(base: &Path, id: &str) -> PathBuf {
    if id == "default" {
        base.join("workspace.json")
    } else {
        base.join("workspaces").join(id).join("workspace.json")
    }
}
fn name(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 80 {
        Err("工作区名称须为 1 到 80 个字符".into())
    } else {
        Ok(value.into())
    }
}
fn info(entry: &Entry, active_id: &str) -> WorkspaceInfo {
    WorkspaceInfo {
        id: entry.id.clone(),
        name: entry.name.clone(),
        active: entry.id == active_id,
    }
}

pub fn active_path(base: &Path) -> Result<PathBuf, String> {
    let catalog = read_catalog(base)?;
    Ok(path_for(base, &catalog.active_id))
}
pub fn check_active(base: &Path, expected: Option<&str>) -> Result<(), String> {
    if let Some(id) = expected {
        if read_catalog(base)?.active_id != id {
            return Err("WORKSPACE_CHANGED: 当前工作区已切换，已阻止旧工作区写入".into());
        }
    }
    Ok(())
}
pub fn list(base: &Path) -> Result<Vec<WorkspaceInfo>, String> {
    let catalog = read_catalog(base)?;
    Ok(catalog
        .workspaces
        .iter()
        .map(|entry| info(entry, &catalog.active_id))
        .collect())
}
pub fn create(base: &Path, value: &str) -> Result<WorkspaceInfo, String> {
    let mut catalog = read_catalog(base)?;
    let name = name(value)?;
    let id = format!(
        "w-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos()
    );
    let workspace_path = path_for(base, &id);
    fs::create_dir_all(workspace_path.parent().unwrap()).map_err(|e| e.to_string())?;
    let empty = json!({"collections":[],"environments":[],"history":[],"mockServers":[],"monitors":[],"webhooks":[],"deployedFlows":[]});
    workspace_store::save(&workspace_path, &empty)?;
    let created = Entry { id, name };
    let result = info(&created, &catalog.active_id);
    catalog.workspaces.push(created);
    if let Err(error) = save_catalog(base, &catalog) {
        let _ = fs::remove_dir_all(workspace_path.parent().unwrap());
        return Err(error);
    }
    Ok(result)
}
pub fn rename(base: &Path, id: &str, value: &str) -> Result<WorkspaceInfo, String> {
    let mut catalog = read_catalog(base)?;
    let name = name(value)?;
    let active = catalog.active_id.clone();
    let target = catalog
        .workspaces
        .iter_mut()
        .find(|entry| entry.id == id)
        .ok_or("工作区不存在")?;
    target.name = name;
    let result = info(target, &active);
    save_catalog(base, &catalog)?;
    Ok(result)
}
pub fn switch(base: &Path, id: &str) -> Result<Value, String> {
    let mut catalog = read_catalog(base)?;
    entry(&catalog, id)?;
    // Read and validate the destination before changing the active pointer.
    let workspace = workspace_store::read(&path_for(base, id))?;
    catalog.active_id = id.into();
    save_catalog(base, &catalog)?;
    Ok(workspace)
}
pub fn delete(base: &Path, id: &str) -> Result<(), String> {
    let mut catalog = read_catalog(base)?;
    let target = entry(&catalog, id)?.clone();
    if catalog.active_id == id {
        return Err("不能删除当前工作区，请先切换到其他工作区".into());
    }
    let source = path_for(base, id);
    let archive_base = base.join("archived-workspaces");
    fs::create_dir_all(&archive_base).map_err(|e| e.to_string())?;
    let archive = workspace_store::unique_path(&archive_base.join(id), "deleted");
    fs::create_dir(&archive).map_err(|e| e.to_string())?;
    workspace_store::atomic_write(
        &archive.join("metadata.json"),
        &serde_json::to_vec_pretty(&target).map_err(|e| e.to_string())?,
    )?;
    // Copy all workspace recovery files first. Catalog removal happens only after
    // the recoverable archive is complete; later autosaves cannot overwrite it.
    let parent = source.parent().ok_or("无效工作区目录")?;
    let mut sources = Vec::new();
    if parent.exists() {
        for item in fs::read_dir(parent).map_err(|e| e.to_string())? {
            let path = item.map_err(|e| e.to_string())?.path();
            let filename = path.file_name().unwrap_or_default().to_string_lossy();
            if path.is_file()
                && (filename == "workspace.json" || filename.starts_with("workspace.json."))
            {
                workspace_store::atomic_write(
                    &archive.join(path.file_name().unwrap()),
                    &fs::read(&path).map_err(|e| e.to_string())?,
                )?;
                sources.push(path);
            }
        }
    }
    catalog.workspaces.retain(|entry| entry.id != id);
    save_catalog(base, &catalog)?;
    // A cleanup failure can leave an inaccessible duplicate, never data loss.
    for path in sources {
        let _ = fs::remove_file(path);
    }
    if id != "default" {
        let _ = fs::remove_dir(parent);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn temp() -> PathBuf {
        let base = workspace_store::unique_path(
            &std::env::temp_dir().join("localpostman-catalog"),
            "test",
        );
        fs::create_dir_all(&base).unwrap();
        base
    }
    #[test]
    fn default_workspace_is_migrated_without_rewriting_its_data() {
        let base = temp();
        let original = b"{\"collections\":[],\"history\":[{\"id\":\"old\"}]}";
        fs::write(base.join("workspace.json"), original).unwrap();
        let initial = list(&base).unwrap();
        assert_eq!(initial.len(), 1);
        assert!(initial[0].active);
        assert_eq!(initial[0].name, "My Workspace");
        assert_eq!(active_path(&base).unwrap(), base.join("workspace.json"));
        assert_eq!(fs::read(base.join("workspace.json")).unwrap(), original);
        rename(&base, "default", "Renamed workspace").unwrap();
        assert_eq!(list(&base).unwrap()[0].name, "Renamed workspace");
        assert_eq!(fs::read(base.join("workspace.json")).unwrap(), original);
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn switching_preserves_independent_workspaces_and_rejects_unreadable_destination() {
        let base = temp();
        workspace_store::save(
            &base.join("workspace.json"),
            &json!({"collections":[],"gitRepository":"/first","history":[1]}),
        )
        .unwrap();
        let created = create(&base, " New workspace ").unwrap();
        assert!(!created.active);
        assert_eq!(created.name, "New workspace");
        let empty = switch(&base, &created.id).unwrap();
        assert!(empty["collections"].as_array().unwrap().is_empty());
        assert!(empty.get("gitRepository").is_none());
        workspace_store::save(
            &active_path(&base).unwrap(),
            &json!({"collections":[],"gitRepository":"/second","history":[2]}),
        )
        .unwrap();
        assert_eq!(switch(&base, "default").unwrap()["gitRepository"], "/first");
        assert!(check_active(&base, Some(&created.id)).is_err());
        assert!(check_active(&base, Some("default")).is_ok());
        fs::write(path_for(&base, &created.id), b"{corrupt").unwrap();
        assert!(switch(&base, &created.id).is_err());
        assert_eq!(active_path(&base).unwrap(), base.join("workspace.json"));
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn deletion_archives_data_and_never_deletes_active_workspace() {
        let base = temp();
        workspace_store::save(
            &base.join("workspace.json"),
            &json!({"collections":[],"history":[1]}),
        )
        .unwrap();
        let created = create(&base, "Test").unwrap();
        let path = path_for(&base, &created.id);
        workspace_store::save(&path, &json!({"collections":[],"history":[42]})).unwrap();
        assert!(delete(&base, "default").is_err());
        delete(&base, &created.id).unwrap();
        assert_eq!(list(&base).unwrap().len(), 1);
        assert!(!path.exists());
        let archive = fs::read_dir(base.join("archived-workspaces"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        assert_eq!(
            workspace_store::read(&archive.join("workspace.json")).unwrap()["history"][0],
            42
        );
        assert!(archive.join("workspace.json.bak").exists());
        fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn malformed_catalog_and_names_cannot_escape_or_replace_data() {
        let base = temp();
        assert!(create(&base, "  ").is_err());
        assert!(create(&base, &"x".repeat(101)).is_err());
        fs::write(catalog_path(&base),b"{\"activeId\":\"../../escape\",\"workspaces\":[{\"id\":\"../../escape\",\"name\":\"Bad\"}]}").unwrap();
        assert!(active_path(&base).is_err());
        assert!(create(&base, "No overwrite").is_err());
        assert!(rename(&base, "default", "No overwrite").is_err());
        assert!(list(&base).is_err());
        fs::remove_dir_all(base).unwrap();
    }
}
