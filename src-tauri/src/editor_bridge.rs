use serde::{Deserialize, Serialize};
use serde_json::Value;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::{TcpListener, TcpStream},
    sync::oneshot,
    time::timeout,
};
use uuid::Uuid;

type PendingReply = oneshot::Sender<Result<Value, String>>;

pub struct EditorBridgeState {
    pending: Mutex<HashMap<String, PendingReply>>,
}

impl Default for EditorBridgeState {
    fn default() -> Self {
        Self {
            pending: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeRequest {
    id: String,
    token: String,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EditorRequest {
    id: String,
    method: String,
    params: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BridgeResponse {
    id: String,
    result: Option<Value>,
    error: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeDiscovery {
    pub port: u16,
    pub token: String,
    pub pid: u32,
}

pub fn discovery_path(data_dir: &Path) -> PathBuf {
    data_dir.join("editor-bridge.json")
}

pub async fn start(app: AppHandle, data_dir: PathBuf) -> Result<(), String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|error| format!("Could not start editor bridge: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    let discovery = BridgeDiscovery {
        port,
        token: Uuid::new_v4().simple().to_string(),
        pid: std::process::id(),
    };
    fs::write(
        discovery_path(&data_dir),
        serde_json::to_vec(&discovery).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("Could not write editor bridge discovery: {error}"))?;
    #[cfg(unix)]
    fs::set_permissions(discovery_path(&data_dir), fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("Could not protect editor bridge discovery: {error}"))?;
    let token = discovery.token;

    loop {
        let (stream, _) = listener.accept().await.map_err(|error| error.to_string())?;
        let app = app.clone();
        let token = token.clone();
        tauri::async_runtime::spawn(async move {
            let _ = handle_connection(app, stream, &token).await;
        });
    }
}

async fn handle_connection(app: AppHandle, stream: TcpStream, token: &str) -> Result<(), String> {
    let (reader, mut writer) = stream.into_split();
    let mut line = String::new();
    BufReader::new(reader)
        .read_line(&mut line)
        .await
        .map_err(|error| error.to_string())?;
    let request: BridgeRequest = serde_json::from_str(&line).map_err(|error| error.to_string())?;
    let response = if request.token != token {
        BridgeResponse {
            id: request.id,
            result: None,
            error: Some("Unauthorized editor bridge request".into()),
        }
    } else {
        forward_to_editor(&app, request).await
    };
    let mut encoded = serde_json::to_vec(&response).map_err(|error| error.to_string())?;
    encoded.push(b'\n');
    writer
        .write_all(&encoded)
        .await
        .map_err(|error| error.to_string())
}

async fn forward_to_editor(app: &AppHandle, request: BridgeRequest) -> BridgeResponse {
    let (sender, receiver) = oneshot::channel();
    let state = app.state::<EditorBridgeState>();
    if let Ok(mut pending) = state.pending.lock() {
        pending.insert(request.id.clone(), sender);
    } else {
        return BridgeResponse {
            id: request.id,
            result: None,
            error: Some("Editor bridge state is unavailable".into()),
        };
    }
    let event = EditorRequest {
        id: request.id.clone(),
        method: request.method,
        params: request.params,
    };
    if let Err(error) = app.emit("editor-rpc-request", event) {
        if let Ok(mut pending) = state.pending.lock() {
            pending.remove(&request.id);
        }
        return BridgeResponse {
            id: request.id,
            result: None,
            error: Some(error.to_string()),
        };
    }
    match timeout(Duration::from_secs(10), receiver).await {
        Ok(Ok(Ok(result))) => BridgeResponse {
            id: request.id,
            result: Some(result),
            error: None,
        },
        Ok(Ok(Err(error))) => BridgeResponse {
            id: request.id,
            result: None,
            error: Some(error),
        },
        Ok(Err(_)) => BridgeResponse {
            id: request.id,
            result: None,
            error: Some("Editor response channel closed".into()),
        },
        Err(_) => {
            if let Ok(mut pending) = state.pending.lock() {
                pending.remove(&request.id);
            }
            BridgeResponse {
                id: request.id,
                result: None,
                error: Some("NO_ACTIVE_EDITOR: open a design file in Figma Boy".into()),
            }
        }
    }
}

#[tauri::command]
pub fn editor_bridge_complete(
    state: State<'_, EditorBridgeState>,
    id: String,
    result: Option<Value>,
    error: Option<String>,
) -> Result<(), String> {
    let sender = state
        .pending
        .lock()
        .map_err(|_| "Editor bridge state is unavailable".to_string())?
        .remove(&id)
        .ok_or_else(|| "Editor bridge request expired".to_string())?;
    sender
        .send(error.map_or_else(|| Ok(result.unwrap_or(Value::Null)), Err))
        .map_err(|_| "Editor bridge requester disconnected".to_string())
}
