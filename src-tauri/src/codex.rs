use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::{sync::oneshot, time::timeout};
use uuid::Uuid;

type CommandResult<T> = Result<T, String>;
type PendingResponse = oneshot::Sender<CommandResult<Value>>;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(45);

pub struct CodexState {
    process: Arc<Mutex<Option<CodexProcess>>>,
    pending: Arc<Mutex<HashMap<u64, PendingResponse>>>,
    next_id: AtomicU64,
}

struct CodexProcess {
    child: Child,
    stdin: ChildStdin,
    workspace_id: String,
}

impl Drop for CodexProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexConnection {
    workspace_id: String,
    cwd: String,
    reused: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexMcpStatus {
    installed: bool,
    healthy: bool,
    matches_bundled: bool,
    command: Option<String>,
    bundled_path: String,
}

impl Default for CodexState {
    fn default() -> Self {
        Self {
            process: Arc::new(Mutex::new(None)),
            pending: Arc::new(Mutex::new(HashMap::new())),
            next_id: AtomicU64::new(1),
        }
    }
}

fn safe_workspace_id(value: &str) -> CommandResult<String> {
    let safe: String = value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
        .collect();
    if safe.is_empty() || safe.len() > 128 {
        return Err("Invalid design ID for Codex workspace".into());
    }
    Ok(safe)
}

fn workspace_dir(app: &AppHandle, workspace_id: &str) -> CommandResult<PathBuf> {
    let workspace_id = safe_workspace_id(workspace_id)?;
    let data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?;
    let directory = data_dir.join("codex-workspaces").join(workspace_id);
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create the Codex workspace: {error}"))?;
    Ok(directory)
}

fn toml_string(value: &Path) -> String {
    let escaped = value
        .to_string_lossy()
        .replace('\\', "\\\\")
        .replace('"', "\\\"");
    format!("\"{escaped}\"")
}

fn executable_in_path(name: &str) -> Option<PathBuf> {
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .map(|path| path.join(name))
            .find(|path| path.is_file())
    })
}

fn codex_executable() -> CommandResult<PathBuf> {
    if let Some(path) = std::env::var_os("FIGMABOY_CODEX_PATH").map(PathBuf::from) {
        if path.is_file() {
            return Ok(path);
        }
        return Err(format!(
            "FIGMABOY_CODEX_PATH does not point to a file: {}",
            path.display()
        ));
    }

    let binary = if cfg!(windows) { "codex.exe" } else { "codex" };
    if let Some(path) = executable_in_path(binary) {
        return Ok(path);
    }
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        for relative in [
            ".local/bin/codex",
            ".bun/bin/codex",
            ".npm-global/bin/codex",
        ] {
            let candidate = home.join(relative);
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }
    for candidate in ["/opt/homebrew/bin/codex", "/usr/local/bin/codex"] {
        let path = PathBuf::from(candidate);
        if path.is_file() {
            return Ok(path);
        }
    }
    Err(
        "Codex is not installed. Install the Codex CLI, sign in once, then reopen this sidebar."
            .into(),
    )
}

fn figmaboy_mcp_executable() -> CommandResult<PathBuf> {
    let binary = if cfg!(windows) {
        "figmaboy-mcp.exe"
    } else {
        "figmaboy-mcp"
    };
    if let Ok(current) = std::env::current_exe() {
        if let Some(directory) = current.parent() {
            let candidate = directory.join(binary);
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }

    let development = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");
    if let Ok(entries) = fs::read_dir(development) {
        if let Some(path) = entries
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .find(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with("figmaboy-mcp-") && path.is_file())
            })
        {
            return Ok(path);
        }
    }
    if let Some(path) = executable_in_path(binary) {
        return Ok(path);
    }
    Err("The bundled Figmaboy MCP server could not be found".into())
}

fn clean_cli_output(value: &[u8]) -> String {
    String::from_utf8_lossy(value)
        .lines()
        .map(strip_ansi)
        .filter(|line| !line.trim().is_empty() && !line.starts_with("WARNING: proceeding"))
        .collect::<Vec<_>>()
        .join("\n")
}

fn command_is_available(command: &str) -> bool {
    fn file_is_executable(path: &Path) -> bool {
        if !path.is_file() {
            return false;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::metadata(path)
                .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
                .unwrap_or(false)
        }
        #[cfg(not(unix))]
        true
    }

    let path = Path::new(command);
    if path.is_absolute() || path.components().count() > 1 {
        return file_is_executable(path);
    }
    executable_in_path(command).is_some_and(|path| file_is_executable(&path))
}

fn mcp_transport_is_healthy(value: &Value) -> bool {
    if let Some(command) = value.pointer("/transport/command").and_then(Value::as_str) {
        return command_is_available(command);
    }
    value
        .pointer("/transport/url")
        .and_then(Value::as_str)
        .is_some_and(|url| !url.trim().is_empty())
}

fn paths_match(left: &str, right: &Path) -> bool {
    let left = fs::canonicalize(left).unwrap_or_else(|_| PathBuf::from(left));
    let right = fs::canonicalize(right).unwrap_or_else(|_| right.to_path_buf());
    if cfg!(windows) {
        left.to_string_lossy()
            .eq_ignore_ascii_case(&right.to_string_lossy())
    } else {
        left == right
    }
}

fn mcp_status(codex: &Path, bundled: &Path) -> CommandResult<CodexMcpStatus> {
    let output = Command::new(codex)
        .args(["mcp", "get", "figmaboy", "--json"])
        .output()
        .map_err(|error| format!("Could not inspect the Codex MCP configuration: {error}"))?;
    let bundled_path = bundled.to_string_lossy().into_owned();
    if !output.status.success() {
        let message = clean_cli_output(&output.stderr);
        if message.contains("No MCP server named 'figmaboy'") {
            return Ok(CodexMcpStatus {
                installed: false,
                healthy: false,
                matches_bundled: false,
                command: None,
                bundled_path,
            });
        }
        return Err(if message.is_empty() {
            "Codex could not read its MCP configuration".into()
        } else {
            message
        });
    }

    let value: Value = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("Codex returned an invalid MCP configuration: {error}"))?;
    let command = value
        .pointer("/transport/command")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let healthy = mcp_transport_is_healthy(&value);
    let matches_bundled = command
        .as_deref()
        .is_some_and(|configured| paths_match(configured, bundled));
    Ok(CodexMcpStatus {
        installed: true,
        healthy,
        matches_bundled,
        command,
        bundled_path,
    })
}

fn run_codex_mcp_command(codex: &Path, args: &[&str]) -> CommandResult<()> {
    let output = Command::new(codex)
        .args(args)
        .output()
        .map_err(|error| format!("Could not update the Codex MCP configuration: {error}"))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = clean_cli_output(&output.stderr);
    let stdout = clean_cli_output(&output.stdout);
    Err(if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        "Codex could not update its MCP configuration".into()
    })
}

#[tauri::command]
pub fn codex_mcp_status() -> CommandResult<CodexMcpStatus> {
    let codex = codex_executable()?;
    let bundled = figmaboy_mcp_executable()?;
    mcp_status(&codex, &bundled)
}

#[tauri::command]
pub fn codex_mcp_install() -> CommandResult<CodexMcpStatus> {
    let codex = codex_executable()?;
    let bundled = figmaboy_mcp_executable()?;
    let existing = mcp_status(&codex, &bundled)?;

    // A healthy custom entry may carry arguments or environment variables that
    // Figmaboy cannot safely reproduce. Leave it alone.
    if existing.healthy {
        return Ok(existing);
    }
    if existing.installed {
        run_codex_mcp_command(&codex, &["mcp", "remove", "figmaboy"])?;
    }

    let bundled_argument = bundled.to_string_lossy().into_owned();
    run_codex_mcp_command(&codex, &["mcp", "add", "figmaboy", "--", &bundled_argument])?;
    let installed = mcp_status(&codex, &bundled)?;
    if installed.healthy && installed.matches_bundled {
        Ok(installed)
    } else {
        Err("Codex saved the Figmaboy MCP entry, but its executable is unavailable".into())
    }
}

fn fail_pending(pending: &Arc<Mutex<HashMap<u64, PendingResponse>>>, message: &str) {
    if let Ok(mut requests) = pending.lock() {
        for (_, sender) in requests.drain() {
            let _ = sender.send(Err(message.to_string()));
        }
    }
}

fn stream_stdout(
    app: AppHandle,
    stdout: impl std::io::Read + Send + 'static,
    pending: Arc<Mutex<HashMap<u64, PendingResponse>>>,
) {
    thread::Builder::new()
        .name("figmaboy-codex-events".into())
        .spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                let Ok(message) = serde_json::from_str::<Value>(&line) else {
                    let _ = app.emit(
                        "codex-log",
                        json!({ "level": "warning", "message": "Codex returned an invalid protocol message" }),
                    );
                    continue;
                };
                let response_id = message.get("id").and_then(Value::as_u64);
                let is_response = response_id.is_some()
                    && message.get("method").is_none()
                    && (message.get("result").is_some() || message.get("error").is_some());
                if is_response {
                    let id = response_id.unwrap_or_default();
                    let sender = pending.lock().ok().and_then(|mut map| map.remove(&id));
                    if let Some(sender) = sender {
                        let response = if let Some(error) = message.get("error") {
                            Err(error
                                .get("message")
                                .and_then(Value::as_str)
                                .unwrap_or("Codex request failed")
                                .to_string())
                        } else {
                            Ok(message.get("result").cloned().unwrap_or(Value::Null))
                        };
                        let _ = sender.send(response);
                    }
                } else {
                    let _ = app.emit("codex-event", message);
                }
            }
            fail_pending(&pending, "Codex app-server disconnected");
            let _ = app.emit("codex-disconnected", json!({}));
        })
        .ok();
}

fn stream_stderr(app: AppHandle, stderr: impl std::io::Read + Send + 'static) {
    thread::Builder::new()
        .name("figmaboy-codex-logs".into())
        .spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                let line = strip_ansi(&line);
                if line.trim().is_empty() || line.starts_with("WARNING: proceeding") {
                    continue;
                }
                // App-server writes tracing and subsystem diagnostics to stderr,
                // including recoverable failures. Keep them available for a future
                // diagnostics view, but never treat them as user-facing errors.
                let _ = app.emit(
                    "codex-log",
                    json!({ "level": "diagnostic", "message": line }),
                );
            }
        })
        .ok();
}

fn strip_ansi(value: &str) -> String {
    let mut clean = String::with_capacity(value.len());
    let mut characters = value.chars().peekable();
    while let Some(character) = characters.next() {
        if character != '\u{1b}' {
            clean.push(character);
            continue;
        }
        if characters.next_if_eq(&'[').is_none() {
            continue;
        }
        for control in characters.by_ref() {
            if ('@'..='~').contains(&control) {
                break;
            }
        }
    }
    clean
}

fn write_message(process: &mut CodexProcess, message: &Value) -> CommandResult<()> {
    serde_json::to_writer(&mut process.stdin, message).map_err(|error| error.to_string())?;
    process
        .stdin
        .write_all(b"\n")
        .and_then(|_| process.stdin.flush())
        .map_err(|error| format!("Could not send a request to Codex: {error}"))
}

async fn request(state: &CodexState, method: &str, params: Value) -> CommandResult<Value> {
    let id = state.next_id.fetch_add(1, Ordering::Relaxed);
    let (sender, receiver) = oneshot::channel();
    state
        .pending
        .lock()
        .map_err(|_| "Codex request state is unavailable".to_string())?
        .insert(id, sender);
    let message = json!({ "method": method, "id": id, "params": params });
    let sent = state
        .process
        .lock()
        .map_err(|_| "Codex process state is unavailable".to_string())?
        .as_mut()
        .ok_or_else(|| "Codex is not connected".to_string())
        .and_then(|process| write_message(process, &message));
    if let Err(error) = sent {
        if let Ok(mut pending) = state.pending.lock() {
            pending.remove(&id);
        }
        return Err(error);
    }
    match timeout(REQUEST_TIMEOUT, receiver).await {
        Ok(Ok(response)) => response,
        Ok(Err(_)) => Err("Codex response channel closed".into()),
        Err(_) => {
            if let Ok(mut pending) = state.pending.lock() {
                pending.remove(&id);
            }
            Err(format!("Codex did not answer {method} in time"))
        }
    }
}

#[tauri::command]
pub async fn codex_connect(
    app: AppHandle,
    state: State<'_, CodexState>,
    workspace_id: String,
) -> CommandResult<CodexConnection> {
    let workspace_id = safe_workspace_id(&workspace_id)?;
    let data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?;
    let cwd = workspace_dir(&app, &workspace_id)?;

    let reused = {
        let mut process = state
            .process
            .lock()
            .map_err(|_| "Codex process state is unavailable".to_string())?;
        if let Some(active) = process.as_mut() {
            let alive = active
                .child
                .try_wait()
                .map_err(|error| error.to_string())?
                .is_none();
            if alive && active.workspace_id == workspace_id {
                true
            } else {
                *process = None;
                false
            }
        } else {
            false
        }
    };

    if !reused {
        fail_pending(&state.pending, "Codex restarted");
        let codex = codex_executable()?;
        let mcp = figmaboy_mcp_executable()?;
        let bridge = data_dir.join("editor-bridge.json");
        let command_config = format!("mcp_servers.figmaboy.command={}", toml_string(&mcp));
        let bridge_config = format!(
            "mcp_servers.figmaboy.env.FIGMABOY_BRIDGE_FILE={}",
            toml_string(&bridge)
        );
        let mut child = Command::new(codex)
            .args([
                "app-server",
                "--stdio",
                "-c",
                &command_config,
                "-c",
                &bridge_config,
            ])
            .current_dir(&cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("Could not start Codex app-server: {error}"))?;
        let stdin = child.stdin.take().ok_or("Could not open Codex input")?;
        let stdout = child.stdout.take().ok_or("Could not open Codex output")?;
        let stderr = child.stderr.take().ok_or("Could not open Codex logs")?;
        stream_stdout(app.clone(), stdout, state.pending.clone());
        stream_stderr(app.clone(), stderr);
        *state
            .process
            .lock()
            .map_err(|_| "Codex process state is unavailable".to_string())? = Some(CodexProcess {
            child,
            stdin,
            workspace_id: workspace_id.clone(),
        });

        if let Err(error) = request(
            &state,
            "initialize",
            json!({
                "clientInfo": {
                    "name": "figmaboy",
                    "title": "Figmaboy",
                    "version": env!("CARGO_PKG_VERSION")
                },
                "capabilities": {
                    "experimentalApi": true,
                    "requestAttestation": false
                }
            }),
        )
        .await
        {
            if let Ok(mut process) = state.process.lock() {
                *process = None;
            }
            return Err(error);
        }
        let mut process = state
            .process
            .lock()
            .map_err(|_| "Codex process state is unavailable".to_string())?;
        write_message(
            process
                .as_mut()
                .ok_or("Codex disconnected during initialization")?,
            &json!({ "method": "initialized", "params": {} }),
        )?;
    }

    Ok(CodexConnection {
        workspace_id,
        cwd: cwd.to_string_lossy().into_owned(),
        reused,
    })
}

#[tauri::command]
pub fn codex_ui_state_read(app: AppHandle, workspace_id: String) -> CommandResult<Value> {
    let path = workspace_dir(&app, &workspace_id)?.join("ui-state.json");
    if !path.is_file() {
        return Ok(Value::Null);
    }
    serde_json::from_slice(&fs::read(path).map_err(|error| error.to_string())?)
        .map_err(|error| format!("Could not read saved Codex UI state: {error}"))
}

#[tauri::command]
pub fn codex_ui_state_write(
    app: AppHandle,
    workspace_id: String,
    value: Value,
) -> CommandResult<()> {
    let directory = workspace_dir(&app, &workspace_id)?;
    let path = directory.join("ui-state.json");
    let encoded = serde_json::to_vec(&value).map_err(|error| error.to_string())?;
    fs::write(&path, encoded).map_err(|error| format!("Could not save Codex UI state: {error}"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedCodexAttachment {
    path: String,
    mime: String,
    name: String,
}

#[tauri::command]
pub fn codex_attachment_save(
    app: AppHandle,
    workspace_id: String,
    name: String,
    data_url: String,
) -> CommandResult<SavedCodexAttachment> {
    const MAX_ATTACHMENT_BYTES: usize = 20 * 1024 * 1024;
    let (header, encoded) = data_url
        .split_once(',')
        .ok_or_else(|| "Image attachment must be a data URL".to_string())?;
    let (mime, extension) = match header {
        "data:image/png;base64" => ("image/png", "png"),
        "data:image/jpeg;base64" => ("image/jpeg", "jpg"),
        "data:image/webp;base64" => ("image/webp", "webp"),
        _ => return Err("Only PNG, JPEG, and WebP image attachments are supported".into()),
    };
    if encoded.len() > MAX_ATTACHMENT_BYTES * 4 / 3 + 8 {
        return Err("Image attachment is larger than 20 MB".into());
    }
    let bytes = BASE64
        .decode(encoded)
        .map_err(|_| "Image attachment contains invalid base64 data".to_string())?;
    if bytes.len() > MAX_ATTACHMENT_BYTES {
        return Err("Image attachment is larger than 20 MB".into());
    }
    let attachments = workspace_dir(&app, &workspace_id)?.join("attachments");
    fs::create_dir_all(&attachments)
        .map_err(|error| format!("Could not create the attachment folder: {error}"))?;
    let path = attachments.join(format!(
        "attachment_{}.{}",
        Uuid::new_v4().simple(),
        extension
    ));
    fs::write(&path, bytes).map_err(|error| format!("Could not save attachment: {error}"))?;
    Ok(SavedCodexAttachment {
        path: path.to_string_lossy().into_owned(),
        mime: mime.into(),
        name: name.chars().take(160).collect(),
    })
}

#[tauri::command]
pub async fn codex_request(
    state: State<'_, CodexState>,
    method: String,
    params: Value,
) -> CommandResult<Value> {
    request(&state, &method, params).await
}

#[tauri::command]
pub fn codex_respond(
    state: State<'_, CodexState>,
    id: Value,
    result: Option<Value>,
    error: Option<String>,
) -> CommandResult<()> {
    let message = if let Some(message) = error {
        json!({ "id": id, "error": { "code": -32000, "message": message } })
    } else {
        json!({ "id": id, "result": result.unwrap_or(Value::Null) })
    };
    let mut process = state
        .process
        .lock()
        .map_err(|_| "Codex process state is unavailable".to_string())?;
    write_message(process.as_mut().ok_or("Codex is not connected")?, &message)
}

#[tauri::command]
pub fn codex_disconnect(state: State<'_, CodexState>) -> CommandResult<()> {
    fail_pending(&state.pending, "Codex disconnected");
    *state
        .process
        .lock()
        .map_err(|_| "Codex process state is unavailable".to_string())? = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workspace_ids_cannot_escape_the_data_directory() {
        assert_eq!(safe_workspace_id("file_123-abc").unwrap(), "file_123-abc");
        assert!(safe_workspace_id("../../").is_err());
    }

    #[test]
    fn paths_are_encoded_as_toml_strings() {
        assert_eq!(toml_string(Path::new("/tmp/a b")), "\"/tmp/a b\"");
        assert_eq!(toml_string(Path::new("C:\\A\"B")), "\"C:\\\\A\\\"B\"");
    }

    #[test]
    fn app_server_diagnostics_drop_terminal_control_codes() {
        assert_eq!(
            strip_ansi("\u{1b}[2m2026-08-30T07:45:26Z\u{1b}[0m ERROR model refresh timed out"),
            "2026-08-30T07:45:26Z ERROR model refresh timed out"
        );
    }

    #[test]
    fn command_availability_handles_paths() {
        assert!(command_is_available(
            std::env::current_exe().unwrap().to_str().unwrap()
        ));
        assert!(!command_is_available("/definitely/missing/figmaboy-mcp"));
    }

    #[test]
    fn matching_paths_are_canonicalized() {
        let current = std::env::current_exe().unwrap();
        assert!(paths_match(current.to_str().unwrap(), &current));
    }

    #[test]
    fn remote_mcp_transport_is_kept_as_a_healthy_custom_entry() {
        assert!(mcp_transport_is_healthy(&json!({
            "transport": { "type": "streamable_http", "url": "https://mcp.example.com" }
        })));
    }

    #[test]
    fn image_attachment_type_is_validated() {
        let invalid = "data:text/plain;base64,aGVsbG8=";
        let (header, _) = invalid.split_once(',').unwrap();
        assert_ne!(header, "data:image/png;base64");
    }
}
