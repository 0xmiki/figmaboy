use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
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
const FIGMABOY_MCP_APPROVAL_CONFIG: &str =
    "mcp_servers.figmaboy.default_tools_approval_mode=\"approve\"";
const EVOLVE_DIRECTOR_TOOLS_CONFIG: &str = "mcp_servers.figmaboy.enabled_tools=[\"types_get\",\"design_capabilities\",\"icons_search\",\"assets_list\",\"fonts_list\",\"design_audit\",\"frame_screenshot\"]";
const EVOLVE_DESIGNER_TOOLS_CONFIG: &str = "mcp_servers.figmaboy.enabled_tools=[\"types_get\",\"design_capabilities\",\"icons_search\",\"assets_list\",\"fonts_list\",\"design_audit\",\"frame_screenshot\",\"evolve_candidate_validate\",\"evolve_candidate_render\"]";
const EVOLVE_DIRECTOR_INSTRUCTIONS: &str = "You are an isolated Figmaboy evolution director. Visually inspect every attached frame image before judging or planning. The request states the image order. Treat the first image as the frozen reference and the second as the current reconstruction; a third image, when present, is the candidate. Use the reference for product meaning and content, not as a layout template. The available Figmaboy MCP tools are read-only. Use design_capabilities, icons_search, assets_list, fonts_list, or design_audit when they provide material evidence. Never mutate the canvas. Return only the required structured output.";
const EVOLVE_DESIGNER_INSTRUCTIONS: &str = "You are an isolated Figmaboy evolution designer. Visually inspect every attached frame image before proposing changes. The first image is the frozen reference and the second is the current reconstruction. The reference supplies product meaning and content, not reusable layout. Call types_get and design_capabilities before composing the proposal. Use icons_search before creating an icon, assets_list before reusing artwork, fonts_list when choosing typography, and design_audit when fit, contrast, overflow, or target size may matter. Candidate validation and rendering tools are available for early visual checks when useful, but Figmaboy will always render the returned proposal and send the exact result through a separate visual-review turn. These tools change only an isolated candidate, never the visible canvas. Never claim an image or tool is unavailable without attempting to inspect or call it. Return only the required structured output.";
const EVOLVE_REVIEWER_INSTRUCTIONS: &str = "You are the visual review pass for a Figmaboy evolution designer. Three images are attached in this exact order: frozen reference, current reconstruction, and the exact rendered candidate. Inspect the third image closely before answering. Compare it with the stated pass objective, the current reconstruction, and the supplied deterministic audit. If the candidate is already deliberate and correct, return its complete proposal unchanged. If it is weak, clipped, illegible, under-resolved, or inconsistent with the objective, return one complete revised proposal that fixes those visible problems without expanding the pass scope. Preserve the candidate ID. Return only the required structured output.";

pub struct CodexState {
    process: Arc<Mutex<Option<CodexProcess>>>,
    pending: Arc<Mutex<HashMap<u64, PendingResponse>>>,
    next_id: AtomicU64,
}

pub struct EvolveExecState {
    active: Arc<Mutex<HashMap<String, EvolveExecHandle>>>,
}

struct EvolveExecHandle {
    run_id: String,
    pid: u32,
    cancelled: Arc<AtomicBool>,
}

struct EvolveExecGuard {
    exec_id: String,
    pid: u32,
    directory: PathBuf,
    active: Arc<Mutex<HashMap<String, EvolveExecHandle>>>,
}

impl Drop for EvolveExecGuard {
    fn drop(&mut self) {
        terminate_evolve_process(self.pid, false);
        std::thread::sleep(Duration::from_millis(100));
        terminate_evolve_process(self.pid, true);
        if let Ok(mut active) = self.active.lock() {
            active.remove(&self.exec_id);
        }
        let _ = fs::remove_dir_all(&self.directory);
    }
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

impl Default for CodexState {
    fn default() -> Self {
        Self {
            process: Arc::new(Mutex::new(None)),
            pending: Arc::new(Mutex::new(HashMap::new())),
            next_id: AtomicU64::new(1),
        }
    }
}

impl Default for EvolveExecState {
    fn default() -> Self {
        Self {
            active: Arc::new(Mutex::new(HashMap::new())),
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

fn toml_text(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".into())
}

fn evolve_developer_instructions(role: &str) -> &'static str {
    match role {
        "director" => EVOLVE_DIRECTOR_INSTRUCTIONS,
        "reviewer" => EVOLVE_REVIEWER_INSTRUCTIONS,
        _ => EVOLVE_DESIGNER_INSTRUCTIONS,
    }
}

fn evolve_tools_config(role: &str) -> &'static str {
    if matches!(role, "director" | "reviewer") {
        EVOLVE_DIRECTOR_TOOLS_CONFIG
    } else {
        EVOLVE_DESIGNER_TOOLS_CONFIG
    }
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
    Err("Codex is not installed. Install the Codex CLI, then reopen this sidebar.".into())
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
                "mcp_servers={}",
                "-c",
                &command_config,
                "-c",
                &bridge_config,
                "-c",
                FIGMABOY_MCP_APPROVAL_CONFIG,
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

#[tauri::command(rename_all = "camelCase")]
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvolveExecImage {
    name: String,
    data_url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvolveExecRequest {
    exec_id: String,
    run_id: String,
    workspace_id: String,
    role: String,
    prompt: String,
    images: Vec<EvolveExecImage>,
    output_schema: Value,
    model: String,
    effort: Option<String>,
    service_tier: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvolveExecResponse {
    exec_id: String,
    text: String,
    exit_code: i32,
}

fn decode_evolve_image(value: &str) -> CommandResult<(Vec<u8>, &'static str)> {
    let (header, encoded) = value
        .split_once(',')
        .ok_or_else(|| "Evolution image must be a data URL".to_string())?;
    let extension = match header {
        "data:image/png;base64" => "png",
        "data:image/jpeg;base64" => "jpg",
        "data:image/webp;base64" => "webp",
        _ => return Err("Evolution images must be PNG, JPEG, or WebP".into()),
    };
    let bytes = BASE64
        .decode(encoded)
        .map_err(|_| "Evolution image contains invalid base64 data".to_string())?;
    if bytes.len() > 20 * 1024 * 1024 {
        return Err("Evolution image is larger than 20 MB".into());
    }
    Ok((bytes, extension))
}

#[cfg(unix)]
fn configure_evolve_process(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

#[cfg(windows)]
fn configure_evolve_process(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    command.creation_flags(CREATE_NEW_PROCESS_GROUP);
}

#[cfg(not(any(unix, windows)))]
fn configure_evolve_process(_command: &mut Command) {}

#[cfg(unix)]
fn terminate_evolve_process(pid: u32, force: bool) {
    let signal = if force { libc::SIGKILL } else { libc::SIGTERM };
    unsafe {
        libc::kill(-(pid as i32), signal);
    }
}

#[cfg(windows)]
fn terminate_evolve_process(pid: u32, force: bool) {
    let mut command = Command::new("taskkill");
    command.args(["/PID", &pid.to_string(), "/T"]);
    if force {
        command.arg("/F");
    }
    let _ = command.stdout(Stdio::null()).stderr(Stdio::null()).status();
}

#[cfg(not(any(unix, windows)))]
fn terminate_evolve_process(_pid: u32, _force: bool) {}

fn evolve_event_text(value: &Value) -> Option<&str> {
    if value.get("type").and_then(Value::as_str) != Some("item.completed") {
        return None;
    }
    let item = value.get("item")?;
    (item.get("type").and_then(Value::as_str) == Some("agent_message"))
        .then(|| item.get("text").and_then(Value::as_str))
        .flatten()
}

fn evolve_command(codex: &Path, schema_path: &Path, directory: &Path) -> Command {
    let mut command = Command::new(codex);
    command.args([
        "exec",
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
        "--disable",
        "apps",
        "--sandbox",
        "read-only",
        "--skip-git-repo-check",
        "--json",
        "--output-schema",
    ]);
    command.arg(schema_path);
    command.args(["-c", "agents.enabled=false", "-C"]);
    command.arg(directory);
    command
}

#[tauri::command(rename_all = "camelCase")]
pub async fn codex_evolve_exec(
    app: AppHandle,
    state: State<'_, EvolveExecState>,
    request: EvolveExecRequest,
) -> CommandResult<EvolveExecResponse> {
    let active = state.active.clone();
    tauri::async_runtime::spawn_blocking(move || run_codex_evolve_exec(app, active, request))
        .await
        .map_err(|error| format!("Evolution worker task failed: {error}"))?
}

fn run_codex_evolve_exec(
    app: AppHandle,
    active: Arc<Mutex<HashMap<String, EvolveExecHandle>>>,
    request: EvolveExecRequest,
) -> CommandResult<EvolveExecResponse> {
    let exec_id = safe_workspace_id(&request.exec_id)?;
    let run_id = safe_workspace_id(&request.run_id)?;
    if !matches!(
        request.role.as_str(),
        "designer" | "director" | "correction" | "reviewer"
    ) {
        return Err("Invalid evolution exec role".into());
    }
    if request.prompt.len() > 2_000_000 {
        return Err("Evolution prompt is too large".into());
    }
    let workspace = workspace_dir(&app, &request.workspace_id)?;
    let directory = workspace.join("evolve-exec").join(&exec_id);
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create evolution workspace: {error}"))?;
    let schema_path = directory.join("output-schema.json");
    fs::write(
        &schema_path,
        serde_json::to_vec(&request.output_schema).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("Could not write evolution output schema: {error}"))?;
    let mut image_paths = Vec::new();
    for (index, image) in request.images.iter().enumerate() {
        let (bytes, extension) = decode_evolve_image(&image.data_url)?;
        let safe_name: String = image
            .name
            .chars()
            .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
            .take(48)
            .collect();
        let path = directory.join(format!(
            "{}-{}.{}",
            index,
            if safe_name.is_empty() {
                "frame"
            } else {
                &safe_name
            },
            extension
        ));
        fs::write(&path, bytes)
            .map_err(|error| format!("Could not write evolution image: {error}"))?;
        image_paths.push(path);
    }

    let codex = codex_executable()?;
    let mut command = evolve_command(&codex, &schema_path, &directory);
    command.args([
        "-c",
        &format!(
            "developer_instructions={}",
            toml_text(evolve_developer_instructions(&request.role))
        ),
    ]);
    if !request.model.trim().is_empty() {
        command.args(["--model", request.model.trim()]);
    }
    if let Some(effort) = request
        .effort
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        command.args([
            "-c",
            &format!("model_reasoning_effort=\"{}\"", effort.replace('"', "")),
        ]);
    }
    if let Some(tier) = request
        .service_tier
        .as_deref()
        .filter(|value| !value.trim().is_empty() && *value != "default")
    {
        command.args(["-c", &format!("service_tier=\"{}\"", tier.replace('"', ""))]);
    }
    let mcp = figmaboy_mcp_executable()?;
    let data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?;
    let bridge = data_dir.join("editor-bridge.json");
    command.args(["-c", "mcp_servers={}"]);
    command.args([
        "-c",
        &format!("mcp_servers.figmaboy.command={}", toml_string(&mcp)),
    ]);
    command.args([
        "-c",
        &format!(
            "mcp_servers.figmaboy.env.FIGMABOY_BRIDGE_FILE={}",
            toml_string(&bridge)
        ),
    ]);
    command.args(["-c", evolve_tools_config(&request.role)]);
    command.args(["-c", FIGMABOY_MCP_APPROVAL_CONFIG]);
    for path in &image_paths {
        command.arg("--image").arg(path);
    }
    command.args(["--", "-"]);
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_evolve_process(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start evolution worker: {error}"))?;
    let pid = child.id();
    let cancelled = Arc::new(AtomicBool::new(false));
    active
        .lock()
        .map_err(|_| "Evolution worker state is unavailable".to_string())?
        .insert(
            exec_id.clone(),
            EvolveExecHandle {
                run_id: run_id.clone(),
                pid,
                cancelled: cancelled.clone(),
            },
        );
    let _guard = EvolveExecGuard {
        exec_id: exec_id.clone(),
        pid,
        directory: directory.clone(),
        active: active.clone(),
    };
    let mut stdin = child
        .stdin
        .take()
        .ok_or("Could not open evolution worker input")?;
    let prompt_result = stdin
        .write_all(request.prompt.as_bytes())
        .and_then(|_| stdin.flush());
    drop(stdin);
    if let Err(error) = prompt_result {
        terminate_evolve_process(pid, false);
        let _ = child.wait();
        let mut diagnostics = String::new();
        if let Some(mut stderr) = child.stderr.take() {
            let _ = stderr.read_to_string(&mut diagnostics);
        }
        let diagnostics = strip_ansi(&diagnostics).trim().to_string();
        return Err(if diagnostics.is_empty() {
            format!("Evolution worker closed before reading its prompt: {error}")
        } else {
            format!("Evolution worker could not start: {diagnostics}")
        });
    }

    let stdout = child
        .stdout
        .take()
        .ok_or("Could not read evolution worker output")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("Could not read evolution worker logs")?;
    let final_text = Arc::new(Mutex::new(String::new()));
    let failure = Arc::new(Mutex::new(String::new()));
    let output_text = final_text.clone();
    let output_failure = failure.clone();
    let output_app = app.clone();
    let output_exec_id = exec_id.clone();
    let output_run_id = run_id.clone();
    let stdout_thread = thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let Ok(event) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if let Some(text) = evolve_event_text(&event) {
                if let Ok(mut current) = output_text.lock() {
                    *current = text.to_string();
                }
            }
            if matches!(
                event.get("type").and_then(Value::as_str),
                Some("turn.failed" | "error")
            ) {
                if let Ok(mut current) = output_failure.lock() {
                    *current = event
                        .get("error")
                        .and_then(|error| error.get("message").or(Some(error)))
                        .and_then(Value::as_str)
                        .unwrap_or("Evolution worker failed")
                        .to_string();
                }
            }
            let _ = output_app.emit(
                "codex-evolve-event",
                json!({ "execId": output_exec_id, "runId": output_run_id, "event": event }),
            );
        }
    });
    let log_app = app.clone();
    let log_exec_id = exec_id.clone();
    let stderr_thread = thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            let line = strip_ansi(&line);
            if !line.trim().is_empty() {
                let _ = log_app.emit(
                    "codex-evolve-log",
                    json!({ "execId": log_exec_id, "message": line }),
                );
            }
        }
    });

    let mut cancellation_started: Option<std::time::Instant> = None;
    let status = loop {
        if cancelled.load(Ordering::Relaxed) {
            let started = cancellation_started.get_or_insert_with(|| {
                terminate_evolve_process(pid, false);
                std::time::Instant::now()
            });
            if started.elapsed() >= Duration::from_millis(500) {
                terminate_evolve_process(pid, true);
            }
        }
        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
            break status;
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    terminate_evolve_process(pid, false);
    std::thread::sleep(Duration::from_millis(100));
    terminate_evolve_process(pid, true);
    let _ = stdout_thread.join();
    let _ = stderr_thread.join();
    if cancelled.load(Ordering::Relaxed) {
        return Err("Evolution stopped".into());
    }
    let exit_code = status.code().unwrap_or(-1);
    let failure = failure
        .lock()
        .map(|value| value.clone())
        .unwrap_or_default();
    if !status.success() {
        return Err(if failure.is_empty() {
            format!("Evolution worker exited with status {exit_code}")
        } else {
            failure
        });
    }
    let text = final_text
        .lock()
        .map(|value| value.clone())
        .unwrap_or_default();
    if text.trim().is_empty() {
        return Err("Evolution worker returned no structured result".into());
    }
    Ok(EvolveExecResponse {
        exec_id,
        text,
        exit_code,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn codex_evolve_cancel(
    state: State<'_, EvolveExecState>,
    run_id: String,
) -> CommandResult<usize> {
    let run_id = safe_workspace_id(&run_id)?;
    let handles = state
        .active
        .lock()
        .map_err(|_| "Evolution worker state is unavailable".to_string())?;
    let mut cancelled = 0;
    for handle in handles.values().filter(|handle| handle.run_id == run_id) {
        handle.cancelled.store(true, Ordering::Relaxed);
        terminate_evolve_process(handle.pid, false);
        cancelled += 1;
    }
    Ok(cancelled)
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
    fn image_attachment_type_is_validated() {
        let invalid = "data:text/plain;base64,aGVsbG8=";
        let (header, _) = invalid.split_once(',').unwrap();
        assert_ne!(header, "data:image/png;base64");
    }

    #[test]
    fn evolution_images_are_decoded_and_typed() {
        let (bytes, extension) = decode_evolve_image("data:image/png;base64,aGVsbG8=").unwrap();
        assert_eq!(bytes, b"hello");
        assert_eq!(extension, "png");
        assert!(decode_evolve_image("data:image/svg+xml;base64,aGVsbG8=").is_err());
    }

    #[test]
    fn evolution_exec_keeps_only_completed_agent_messages() {
        let event = json!({ "type": "item.completed", "item": { "type": "agent_message", "text": "{\"ok\":true}" } });
        assert_eq!(evolve_event_text(&event), Some("{\"ok\":true}"));
        assert_eq!(evolve_event_text(&json!({ "type": "turn.started" })), None);
    }

    #[test]
    fn evolution_schema_path_immediately_follows_its_flag() {
        let command = evolve_command(
            Path::new("codex"),
            Path::new("/tmp/output-schema.json"),
            Path::new("/tmp/evolve"),
        );
        let arguments: Vec<String> = command
            .get_args()
            .map(|value| value.to_string_lossy().into_owned())
            .collect();
        let schema_flag = arguments
            .iter()
            .position(|value| value == "--output-schema")
            .unwrap();
        assert_eq!(arguments[schema_flag + 1], "/tmp/output-schema.json");
        assert!(arguments
            .windows(2)
            .any(|pair| pair == ["-c", "agents.enabled=false"]));
    }

    #[test]
    fn evolution_workers_receive_only_read_only_design_tools() {
        assert_eq!(
            FIGMABOY_MCP_APPROVAL_CONFIG,
            "mcp_servers.figmaboy.default_tools_approval_mode=\"approve\""
        );
        for tool in [
            "types_get",
            "design_capabilities",
            "icons_search",
            "assets_list",
            "fonts_list",
            "design_audit",
            "frame_screenshot",
        ] {
            assert!(EVOLVE_DIRECTOR_TOOLS_CONFIG.contains(&format!("\"{tool}\"")));
            assert!(EVOLVE_DESIGNER_TOOLS_CONFIG.contains(&format!("\"{tool}\"")));
        }
        for tool in ["evolve_candidate_validate", "evolve_candidate_render"] {
            assert!(!EVOLVE_DIRECTOR_TOOLS_CONFIG.contains(&format!("\"{tool}\"")));
            assert!(EVOLVE_DESIGNER_TOOLS_CONFIG.contains(&format!("\"{tool}\"")));
        }
        for config in [EVOLVE_DIRECTOR_TOOLS_CONFIG, EVOLVE_DESIGNER_TOOLS_CONFIG] {
            for tool in [
                "operations_apply",
                "image_place",
                "evolve_candidate_commit",
                "document_save",
            ] {
                assert!(!config.contains(&format!("\"{tool}\"")));
            }
        }
    }

    #[test]
    fn evolution_roles_receive_visual_and_tool_instructions() {
        let director = evolve_developer_instructions("director");
        assert!(director.contains("first image as the frozen reference"));
        assert!(director.contains("Never mutate the canvas"));
        let designer = evolve_developer_instructions("designer");
        assert!(designer.contains("Call types_get and design_capabilities"));
        assert!(designer.contains("Use icons_search before creating an icon"));
        assert!(designer.contains("first image is the frozen reference"));
        assert!(designer.contains("Figmaboy will always render the returned proposal"));
        let reviewer = evolve_developer_instructions("reviewer");
        assert!(reviewer.contains("exact rendered candidate"));
        assert!(reviewer.contains("Inspect the third image closely"));
        assert!(reviewer.contains("deterministic audit"));
    }
}
