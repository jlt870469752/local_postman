use crate::{committed_workspace, workspace_store};
use serde::Serialize;
use serde_json::Value;
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

pub const FILE_NAME: &str = "localpostman-workspace.json";

pub fn git(path: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(path)
        .output()
        .map_err(|e| format!("无法运行 Git：{e}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().into())
    } else {
        Err(format!(
            "{}{}",
            String::from_utf8_lossy(&output.stderr).trim(),
            if output.stdout.is_empty() {
                String::new()
            } else {
                format!("\n{}", String::from_utf8_lossy(&output.stdout).trim())
            }
        ))
    }
}

fn root(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path.trim());
    if !path.is_dir() {
        return Err("Git working directory does not exist".into());
    }
    let root = PathBuf::from(git(&path, &["rev-parse", "--show-toplevel"])?);
    if git(&root, &["rev-parse", "--is-bare-repository"])? != "false" {
        return Err("请选择非 bare 的 Git 工作目录".into());
    }
    Ok(root)
}

fn hash_bytes(path: &Path, bytes: &[u8]) -> Result<String, String> {
    let mut child = Command::new("git")
        .args(["hash-object", "--stdin"])
        .current_dir(path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    child
        .stdin
        .take()
        .ok_or("无法打开 Git stdin")?
        .write_all(bytes)
        .map_err(|e| e.to_string())?;
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().into());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().into())
}

fn capture(path: &Path) -> Result<(Option<Value>, String), String> {
    // The same bytes on a different branch or HEAD are a different commit target.
    // Include the worktree identity so an accepted token cannot be reused elsewhere.
    let git_dir = git(path, &["rev-parse", "--absolute-git-dir"])?;
    let reference = git(path, &["symbolic-ref", "-q", "HEAD"])
        .unwrap_or_else(|_| "detached".into());
    let head = git(path, &["rev-parse", "--verify", "HEAD"])
        .unwrap_or_else(|_| "unborn".into());
    let (workspace, file_revision) = match fs::read(path.join(FILE_NAME)) {
        Ok(bytes) => (
            Some(
                workspace_store::decode(&bytes)
                    .map_err(|e| format!("GIT_WORKSPACE_INVALID: {e}"))?,
            ),
            hash_bytes(path, &bytes)?,
        ),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (None, "missing".into()),
        Err(e) => return Err(format!("GIT_WORKSPACE_READ_FAILED: {e}")),
    };
    let identity = serde_json::to_vec(&(git_dir, reference, head, file_revision))
        .map_err(|e| e.to_string())?;
    Ok((workspace, hash_bytes(path, &identity)?))
}

pub fn revision(path: &Path) -> Result<String, String> {
    capture(path).map(|(_, revision)| revision)
}

fn check_revision(path: &Path, expected: Option<&str>) -> Result<String, String> {
    let actual = revision(path)?;
    match expected {
        Some(value) if value==actual=>Ok(actual),
        Some(_)=>Err("GIT_WORKSPACE_CHANGED: 仓库分支、HEAD 或工作区文件已被外部修改，请重新打开仓库并检查当前分支与工作区，确认后再提交；原文件未被覆盖。".into()),
        None=>Err("GIT_REVISION_REQUIRED: 请先打开 Git 工作目录并检查工作区差异。".into()),
    }
}

fn read_workspace(path: &Path) -> Result<Option<Value>, String> {
    capture(path).map(|(workspace, _)| workspace)
}

// Opening an older workspace adds editor defaults without changing its meaning.
// Compare both sides using those same defaults, while preserving unknown fields
// and all nonempty parameter metadata so actual changes still block Pull.
fn comparable_workspace(workspace: Value) -> Value {
    let mut workspace = committed_workspace(workspace);
    if let Some(object) = workspace.as_object_mut() {
        for key in ["environments", "mockServers", "monitors", "webhooks", "deployedFlows"] {
            object.entry(key).or_insert_with(|| Value::Array(vec![]));
        }
        if let Some(collections) = object.get_mut("collections").and_then(Value::as_array_mut) {
            for collection in collections {
                if let Some(collection) = collection.as_object_mut() {
                    collection.entry("folders").or_insert_with(|| Value::Array(vec![]));
                    let items = collection.entry("items").or_insert_with(|| Value::Array(vec![]));
                    if let Some(items) = items.as_array_mut() {
                        for request in items {
                            if let Some(request) = request.as_object_mut() {
                                request.entry("folderId").or_insert(Value::Null);
                                let empty_params = request.get("params").is_none_or(|params| {
                                    params.as_array().is_some_and(Vec::is_empty)
                                        || params.as_object().is_some_and(serde_json::Map::is_empty)
                                });
                                if empty_params {
                                    let query = request.get("url").and_then(Value::as_str)
                                        .and_then(|url| url.split_once('?').map(|(_, query)| query.split('#').next().unwrap_or("")));
                                    let params = if let Some(query) = query {
                                        let mut url = reqwest::Url::parse("http://local.invalid/").unwrap();
                                        url.set_query(Some(query));
                                        url.query_pairs().map(|(key, value)| serde_json::json!({"key":key,"value":value,"enabled":true,"description":""})).collect()
                                    } else { vec![] };
                                    request.insert("params".into(), Value::Array(params));
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    workspace
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorkspace {
    pub path: String,
    pub status: String,
    pub revision: String,
    pub workspace: Option<Value>,
    pub output: String,
    pub error: Option<String>,
}

fn snapshot(path: &Path, output: String) -> Result<GitWorkspace, String> {
    let (workspace, revision) = capture(path)?;
    Ok(GitWorkspace {
        path: path.display().to_string(),
        status: git(path, &["status", "--short", "--branch"])?,
        revision,
        workspace,
        output,
        error: None,
    })
}

pub fn open(path: &str) -> Result<GitWorkspace, String> {
    snapshot(&root(path)?, String::new())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPreview {
    pub path: String,
    pub status: String,
    pub revision: String,
    pub diff: String,
    pub has_changes: bool,
    pub externally_changed: bool,
}

fn head_workspace(path: &Path) -> Result<Option<Value>, String> {
    if git(path, &["rev-parse", "--verify", "HEAD"]).is_err() {
        return Ok(None);
    }
    let names = git(path, &["ls-tree", "--name-only", "HEAD", "--", FILE_NAME])?;
    if names.is_empty() {
        return Ok(None);
    }
    let bytes = git(path, &["show", &format!("HEAD:{FILE_NAME}")])?;
    workspace_store::decode(bytes.as_bytes())
        .map(Some)
        .map_err(|e| format!("GIT_HEAD_WORKSPACE_INVALID: {e}"))
}

pub fn preview(path: &str, expected: Option<&str>, workspace: Value) -> Result<GitPreview, String> {
    let path = root(path)?;
    let (_, current_revision) = capture(&path)?;
    let previous = head_workspace(&path)?;
    let local = committed_workspace(workspace);
    workspace_store::validate(&local)?;
    let has_changes = previous.as_ref() != Some(&local);
    let diff = if has_changes {
        let temp = workspace_store::unique_path(
            &std::env::temp_dir().join("localpostman-diff"),
            "preview",
        );
        fs::create_dir_all(&temp).map_err(|e| e.to_string())?;
        let result: Result<String, String> = (|| {
            let repository = temp.join("repository.json");
            let proposed = temp.join("local.json");
            fs::write(
                &repository,
                previous
                    .as_ref()
                    .map(serde_json::to_vec_pretty)
                    .transpose()
                    .map_err(|e| e.to_string())?
                    .unwrap_or_default(),
            )
            .map_err(|e| e.to_string())?;
            fs::write(
                &proposed,
                serde_json::to_vec_pretty(&local).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
            let output = Command::new("git")
                .args([
                    "diff",
                    "--no-index",
                    "--no-color",
                    "--",
                    "repository.json",
                    "local.json",
                ])
                .current_dir(&temp)
                .output()
                .map_err(|e| e.to_string())?;
            if !output.status.success() && output.status.code() != Some(1) {
                return Err(String::from_utf8_lossy(&output.stderr).trim().into());
            }
            Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
        })();
        let _ = fs::remove_dir_all(temp);
        result?
    } else {
        String::new()
    };
    Ok(GitPreview {
        path: path.display().to_string(),
        status: git(&path, &["status", "--short", "--branch"])?,
        externally_changed: expected.is_some_and(|value| value != current_revision),
        revision: current_revision,
        diff,
        has_changes,
    })
}

pub fn pull(path: &str, expected: Option<&str>, workspace: Value) -> Result<GitWorkspace, String> {
    let path = root(path)?;
    check_revision(&path, expected)?;
    if !git(&path, &["status", "--porcelain"])?.is_empty() {
        return Err(
            "GIT_DIRTY: 仓库有未提交文件，请先提交或处理这些更改后再 Pull；未修改本地数据。".into(),
        );
    }
    let repository = read_workspace(&path)?;
    if repository
        .as_ref()
        .is_some_and(|saved| comparable_workspace(saved.clone()) != comparable_workspace(workspace))
    {
        return Err("GIT_LOCAL_CHANGES: 本地工作区与仓库不同，请先 Commit 或重新打开仓库后再 Pull；未修改本地数据。".into());
    }
    if repository.is_none() {
        return Err(
            "GIT_LOCAL_CHANGES: 仓库没有工作区文件，请先 Commit 当前工作区后再 Pull。".into(),
        );
    }
    let output = git(&path, &["pull", "--ff-only"])
        .map_err(|e| format!("GIT_PULL_FAILED: 只允许快进合并，未自动解决冲突。{e}"))?;
    snapshot(&path, output)
}

pub fn sync(
    path: &str,
    expected: Option<&str>,
    workspace: Value,
    message: &str,
    push: bool,
) -> Result<GitWorkspace, String> {
    let path = root(path)?;
    check_revision(&path, expected)?;
    read_workspace(&path)?;
    let workspace = committed_workspace(workspace);
    workspace_store::validate(&workspace)?;
    let bytes = serde_json::to_vec_pretty(&workspace).map_err(|e| e.to_string())?;
    // Recheck immediately before the atomic replacement; opening or previewing alone never authorizes a later external edit.
    check_revision(&path, expected)?;
    let changed = fs::read(path.join(FILE_NAME))
        .map(|old| old != bytes)
        .unwrap_or(true);
    if changed {
        workspace_store::atomic_write(&path.join(FILE_NAME), &bytes)?;
    }
    if let Err(error) = git(&path, &["add", "--", FILE_NAME]) {
        let mut result = snapshot(&path, String::new())?;
        result.error = Some(format!(
            "GIT_STAGE_FAILED: 工作区文件已保存，暂存失败。{error}"
        ));
        return Ok(result);
    }
    let mut output = String::new();
    if !git(&path, &["diff", "--cached", "--name-only", "--", FILE_NAME])?.is_empty() {
        let message = if message.trim().is_empty() {
            "Update LocalPostman workspace"
        } else {
            message
        };
        match git(&path, &["commit", "--only", "-m", message, "--", FILE_NAME]) {
            Ok(committed) => output = committed,
            Err(error) => {
                let mut result = snapshot(&path, String::new())?;
                result.error = Some(format!(
                    "GIT_COMMIT_FAILED: 工作区文件已保存，提交失败。{error}"
                ));
                return Ok(result);
            }
        }
    }
    if push {
        let pushed = match git(&path, &["push"]) {
            Ok(pushed) => pushed,
            Err(error) => {
                let mut result = snapshot(&path, output)?;
                result.error = Some(format!("GIT_PUSH_FAILED: 本地提交已保留。{error}"));
                return Ok(result);
            }
        };
        output.push_str(&format!("\n{pushed}\n工作区已推送 Git"));
    } else {
        output.push_str("\n工作区已提交 Git");
    }
    snapshot(&path, output.trim().into())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn temp() -> PathBuf {
        let path =
            workspace_store::unique_path(&std::env::temp_dir().join("localpostman-git"), "test");
        fs::create_dir_all(&path).unwrap();
        path
    }
    fn init(path: &Path) {
        git(path, &["init", "-b", "main"]).unwrap();
        git(path, &["config", "user.email", "test@local.invalid"]).unwrap();
        git(path, &["config", "user.name", "Local Test"]).unwrap();
    }
    fn workspace(name: &str) -> Value {
        serde_json::json!({"collections":[{"id":"c","name":name,"items":[]}],"history":[]})
    }
    fn commit_file(path: &Path, workspace: &Value) {
        fs::write(
            path.join(FILE_NAME),
            serde_json::to_vec_pretty(&committed_workspace(workspace.clone())).unwrap(),
        )
        .unwrap();
        git(path, &["add", "--", FILE_NAME]).unwrap();
        git(path, &["commit", "-m", "Workspace"]).unwrap();
    }
    #[test]
    fn opens_existing_workspace_and_guards_external_changes() {
        let _network_guard = crate::NETWORK_TEST_LOCK.lock().unwrap_or_else(|e|e.into_inner());
        let path = temp();
        init(&path);
        let first = workspace("Existing");
        commit_file(&path, &first);
        let opened = open(path.to_str().unwrap()).unwrap();
        assert_eq!(opened.workspace, Some(committed_workspace(first.clone())));
        let local = workspace("Local edit");
        let previewed = preview(
            path.to_str().unwrap(),
            Some(&opened.revision),
            local.clone(),
        )
        .unwrap();
        assert!(previewed.has_changes);
        assert!(previewed.diff.contains("Local edit"));
        let external = workspace("Other machine");
        fs::write(path.join(FILE_NAME), serde_json::to_vec(&external).unwrap()).unwrap();
        assert!(sync(
            path.to_str().unwrap(),
            Some(&opened.revision),
            local,
            "Update",
            false
        )
        .err()
        .unwrap()
        .starts_with("GIT_WORKSPACE_CHANGED:"));
        assert_eq!(read_workspace(&path).unwrap(), Some(external));
        fs::remove_dir_all(path).unwrap();
    }
    #[test]
    fn revision_guards_same_content_branch_switches_and_head_changes() {
        let _network_guard = crate::NETWORK_TEST_LOCK.lock().unwrap_or_else(|e|e.into_inner());
        let path = temp();
        init(&path);
        // A fresh repository has no HEAD yet but can still be reviewed.
        let unborn = open(path.to_str().unwrap()).unwrap();
        assert!(unborn.workspace.is_none());
        assert!(!unborn.revision.is_empty());
        let initial = workspace("Existing");
        commit_file(&path, &initial);
        let accepted = revision(&path).unwrap();
        git(&path, &["checkout", "-b", "other"]).unwrap();
        assert_ne!(revision(&path).unwrap(), accepted, "A new branch at the same HEAD needs a new review");
        let error = sync(path.to_str().unwrap(), Some(&accepted), workspace("Edited"), "Update", false).err().unwrap();
        assert!(error.starts_with("GIT_WORKSPACE_CHANGED:"));
        assert_eq!(read_workspace(&path).unwrap(), Some(committed_workspace(initial.clone())));
        git(&path, &["checkout", "main"]).unwrap();
        assert_eq!(revision(&path).unwrap(), accepted);
        fs::write(path.join("other.txt"), b"unrelated commit").unwrap();
        git(&path, &["add", "other.txt"]).unwrap();
        git(&path, &["commit", "-m", "Move HEAD"]).unwrap();
        assert_ne!(revision(&path).unwrap(), accepted, "HEAD moving with the same workspace also needs a new review");
        assert!(sync(path.to_str().unwrap(), Some(&accepted), workspace("Edited"), "Update", false).err().unwrap().starts_with("GIT_WORKSPACE_CHANGED:"));
        fs::remove_dir_all(path).unwrap();
    }
    #[test]
    fn older_workspace_defaults_allow_pull_but_real_request_changes_do_not() {
        let _network_guard = crate::NETWORK_TEST_LOCK.lock().unwrap_or_else(|e|e.into_inner());
        let dir = temp();
        let remote = dir.join("remote.git");
        fs::create_dir(&remote).unwrap();
        git(&remote, &["init", "--bare", "--initial-branch=main"]).unwrap();
        let path = dir.join("local");
        fs::create_dir(&path).unwrap();
        init(&path);
        let older = serde_json::json!({"collections":[{"id":"c","name":"Existing","items":[{"id":"r","name":"Query","method":"GET","url":"http://example.test/?q=hello+world&tag=%E4%B8%AD&tag=two"}]}]});
        commit_file(&path, &older);
        git(&path, &["remote", "add", "origin", remote.to_str().unwrap()]).unwrap();
        git(&path, &["push", "-u", "origin", "main"]).unwrap();
        let accepted = revision(&path).unwrap();
        let normalized = comparable_workspace(older.clone());
        assert_eq!(normalized["collections"][0]["items"][0]["params"][0]["value"], "hello world");
        assert_eq!(normalized["collections"][0]["items"][0]["params"][1]["value"], "中");
        let mut changed = normalized.clone();
        changed["collections"][0]["items"][0]["params"][0]["description"] = "Do not discard".into();
        assert!(pull(path.to_str().unwrap(), Some(&accepted), changed).err().unwrap().starts_with("GIT_LOCAL_CHANGES:"));
        let pulled = pull(path.to_str().unwrap(), Some(&accepted), normalized).unwrap();
        assert_eq!(pulled.workspace, Some(older));
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn commit_only_workspace_preserves_unrelated_staged_files() {
        let _network_guard = crate::NETWORK_TEST_LOCK.lock().unwrap_or_else(|e|e.into_inner());
        let path = temp();
        init(&path);
        let first = workspace("First");
        commit_file(&path, &first);
        let accepted = revision(&path).unwrap();
        fs::write(path.join("unrelated.txt"), b"keep staged").unwrap();
        git(&path, &["add", "unrelated.txt"]).unwrap();
        let result = sync(
            path.to_str().unwrap(),
            Some(&accepted),
            workspace("Updated"),
            "Update",
            false,
        )
        .unwrap();
        assert!(!result.revision.is_empty());
        assert_eq!(
            git(&path, &["show", "--format=", "--name-only", "HEAD"]).unwrap(),
            FILE_NAME
        );
        assert_eq!(
            git(&path, &["diff", "--cached", "--name-only"]).unwrap(),
            "unrelated.txt"
        );
        fs::remove_dir_all(path).unwrap();
    }
    #[test]
    fn push_failure_retains_new_revision_for_retry() {
        let _network_guard = crate::NETWORK_TEST_LOCK.lock().unwrap_or_else(|e|e.into_inner());
        let path = temp();
        init(&path);
        let initial = workspace("First");
        commit_file(&path, &initial);
        let accepted = revision(&path).unwrap();
        let edited = workspace("Committed locally");
        let result = sync(
            path.to_str().unwrap(),
            Some(&accepted),
            edited.clone(),
            "Update",
            true,
        )
        .unwrap();
        assert!(result.error.unwrap().starts_with("GIT_PUSH_FAILED:"));
        assert_ne!(result.revision, accepted);
        let retry = sync(
            path.to_str().unwrap(),
            Some(&result.revision),
            edited,
            "Retry",
            false,
        )
        .unwrap();
        assert!(retry.error.is_none());
        fs::remove_dir_all(path).unwrap();
    }
    #[test]
    fn pull_fast_forwards_and_refuses_dirty_or_diverged_workspaces() {
        let _network_guard = crate::NETWORK_TEST_LOCK.lock().unwrap_or_else(|e|e.into_inner());
        let dir = temp();
        let remote = dir.join("remote.git");
        fs::create_dir(&remote).unwrap();
        git(&remote, &["init", "--bare", "--initial-branch=main"]).unwrap();
        let first = dir.join("first");
        fs::create_dir(&first).unwrap();
        init(&first);
        let initial = workspace("First");
        commit_file(&first, &initial);
        git(
            &first,
            &["remote", "add", "origin", remote.to_str().unwrap()],
        )
        .unwrap();
        git(&first, &["push", "-u", "origin", "main"]).unwrap();
        git(&dir, &["clone", remote.to_str().unwrap(), "second"]).unwrap();
        let second = dir.join("second");
        git(&second, &["config", "user.email", "test@local.invalid"]).unwrap();
        git(&second, &["config", "user.name", "Local Test"]).unwrap();
        let accepted = revision(&first).unwrap();
        let remote_update = workspace("Remote");
        commit_file(&second, &remote_update);
        git(&second, &["push"]).unwrap();
        let pulled = pull(first.to_str().unwrap(), Some(&accepted), initial).unwrap();
        assert_eq!(
            pulled.workspace,
            Some(committed_workspace(remote_update.clone()))
        );
        fs::write(first.join("unrelated.txt"), b"unsaved").unwrap();
        assert!(pull(
            first.to_str().unwrap(),
            Some(&pulled.revision),
            remote_update.clone()
        )
        .err()
        .unwrap()
        .starts_with("GIT_DIRTY:"));
        fs::remove_file(first.join("unrelated.txt")).unwrap();
        assert!(pull(
            first.to_str().unwrap(),
            Some(&pulled.revision),
            workspace("Unsaved")
        )
        .err()
        .unwrap()
        .starts_with("GIT_LOCAL_CHANGES:"));
        let local = workspace("Local divergent");
        commit_file(&first, &local);
        let accepted = revision(&first).unwrap();
        commit_file(&second, &workspace("Remote divergent"));
        git(&second, &["push"]).unwrap();
        assert!(
            pull(first.to_str().unwrap(), Some(&accepted), local.clone())
                .err()
                .unwrap()
                .starts_with("GIT_PULL_FAILED:")
        );
        assert_eq!(
            read_workspace(&first).unwrap(),
            Some(committed_workspace(local))
        );
        assert!(git(&first, &["status", "--porcelain"]).unwrap().is_empty());
        fs::remove_dir_all(dir).unwrap();
    }
}
