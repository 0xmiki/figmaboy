use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::Utc;
use image::GenericImageView;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
#[cfg(target_os = "linux")]
use tauri::Emitter;
use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_dialog::{DialogExt, FileDialogBuilder, FilePath};
use uuid::Uuid;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

mod codex;
mod editor_bridge;

type CommandResult<T> = Result<T, String>;

// A home-screen preview is a cache, not document data. Keeping this limit at
// the bridge prevents one legacy SVG with embedded source images from sending
// tens of megabytes through the WebView IPC channel.
const MAX_LIBRARY_THUMBNAIL_BYTES: usize = 512 * 1024;

struct AppState {
    database: Mutex<Connection>,
}

#[cfg(target_os = "linux")]
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeTouchpadZoom {
    phase: &'static str,
    scale: f64,
    x: f64,
    y: f64,
}

#[cfg(target_os = "linux")]
fn configure_linux_webview(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use gtk::prelude::{EventControllerExt, GestureExt};
    use webkit2gtk::{SettingsExt, WebViewExt};

    let window = app
        .get_webview_window("main")
        .ok_or("The main webview is unavailable")?;
    let event_window = window.clone();
    window.with_webview(move |platform_webview| {
        let webview = platform_webview.inner();
        // WebKitGTK enables animated scrolling for the entire webview by
        // default, including nested overflow containers such as chat, menus,
        // and layer lists. Desktop editor scrolling should track the wheel or
        // touchpad directly instead of easing after input has stopped.
        if let Some(settings) = webview.settings() {
            settings.set_enable_smooth_scrolling(false);
        }
        let gesture = gtk::GestureZoom::new(&webview);
        gesture.set_propagation_phase(gtk::PropagationPhase::Capture);

        let start_window = event_window.clone();
        gesture.connect_begin(move |gesture, _| {
            gesture.set_state(gtk::EventSequenceState::Claimed);
            let (x, y) = gesture.bounding_box_center().unwrap_or((0.0, 0.0));
            let _ = start_window.emit(
                "native-touchpad-zoom",
                NativeTouchpadZoom {
                    phase: "start",
                    scale: 1.0,
                    x,
                    y,
                },
            );
        });

        let change_window = event_window.clone();
        gesture.connect_scale_changed(move |gesture, scale| {
            let (x, y) = gesture.bounding_box_center().unwrap_or((0.0, 0.0));
            let _ = change_window.emit(
                "native-touchpad-zoom",
                NativeTouchpadZoom {
                    phase: "change",
                    scale,
                    x,
                    y,
                },
            );
        });

        gesture.connect_end(move |gesture, _| {
            let (x, y) = gesture.bounding_box_center().unwrap_or((0.0, 0.0));
            let _ = event_window.emit(
                "native-touchpad-zoom",
                NativeTouchpadZoom {
                    phase: "end",
                    scale: gesture.scale_delta(),
                    x,
                    y,
                },
            );
        });

        // GTK event controllers are reference-counted independently of the
        // widget. Keep this controller alive for the lifetime of the webview.
        std::mem::forget(gesture);
    })?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Project {
    id: String,
    name: String,
    created_at: String,
    updated_at: String,
    trashed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesignFile {
    id: String,
    project_id: Option<String>,
    name: String,
    starred: bool,
    created_at: String,
    updated_at: String,
    last_opened_at: Option<String>,
    trashed_at: Option<String>,
    thumbnail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PageMeta {
    id: String,
    file_id: String,
    name: String,
    position: i64,
    revision: i64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LibrarySnapshot {
    projects: Vec<Project>,
    files: Vec<DesignFile>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenedFile {
    file: DesignFile,
    pages: Vec<PageMeta>,
    page: PageMeta,
    document: Value,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PagePayload {
    page: PageMeta,
    document: Value,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportedAsset {
    id: String,
    mime: String,
    data_url: String,
    width: u32,
    height: u32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackageManifest {
    format: String,
    schema_version: u32,
    kind: String,
    exported_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackageAsset {
    id: String,
    mime: String,
    width: u32,
    height: u32,
    path: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackageWorkspace {
    projects: Vec<Project>,
    files: Vec<DesignFile>,
    pages: Vec<PageMeta>,
    documents: HashMap<String, Value>,
    #[serde(default)]
    previews: HashMap<String, String>,
    assets: Vec<PackageAsset>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtensionVersionSummary {
    hash: String,
    version: String,
    created_at: String,
    status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstalledExtension {
    id: String,
    name: String,
    enabled: bool,
    active_hash: Option<String>,
    preview_hash: Option<String>,
    active: Option<Value>,
    preview: Option<Value>,
    versions: Vec<ExtensionVersionSummary>,
}

type PackagedWorkspace = (PackageWorkspace, Vec<(String, Vec<u8>)>);

fn now() -> String {
    Utc::now().to_rfc3339()
}

fn new_id(prefix: &str) -> String {
    format!("{prefix}_{}", Uuid::new_v4())
}

fn empty_document() -> Value {
    json!({
        "schemaVersion": 1,
        "rootIds": [],
        "nodes": {},
        "viewport": { "x": 0, "y": 0, "zoom": 1 },
        "prototypeStartFrameId": Value::Null,
    })
}

fn database<'a>(
    state: &'a State<'_, AppState>,
) -> CommandResult<std::sync::MutexGuard<'a, Connection>> {
    state
        .database
        .lock()
        .map_err(|_| "The local database is unavailable".to_string())
}

fn initialize_database(path: &Path) -> Result<Connection, String> {
    let connection = Connection::open(path).map_err(|error| error.to_string())?;
    connection
        .execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;
            PRAGMA synchronous = NORMAL;
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                trashed_at TEXT
            );
            CREATE TABLE IF NOT EXISTS design_files (
                id TEXT PRIMARY KEY,
                project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                starred INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_opened_at TEXT,
                trashed_at TEXT,
                thumbnail TEXT
            );
            CREATE INDEX IF NOT EXISTS design_files_project_idx ON design_files(project_id);
            CREATE INDEX IF NOT EXISTS design_files_updated_idx ON design_files(updated_at DESC);
            CREATE TABLE IF NOT EXISTS pages (
                id TEXT PRIMARY KEY,
                file_id TEXT NOT NULL REFERENCES design_files(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                position INTEGER NOT NULL,
                revision INTEGER NOT NULL DEFAULT 0,
                document_json TEXT NOT NULL,
                preview TEXT
            );
            CREATE INDEX IF NOT EXISTS pages_file_idx ON pages(file_id, position);
            CREATE TABLE IF NOT EXISTS assets (
                id TEXT PRIMARY KEY,
                content_hash TEXT NOT NULL UNIQUE,
                mime TEXT NOT NULL,
                data BLOB NOT NULL,
                width INTEGER NOT NULL,
                height INTEGER NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS extension_versions (
                hash TEXT PRIMARY KEY,
                extension_id TEXT NOT NULL,
                version TEXT NOT NULL,
                manifest_json TEXT NOT NULL,
                status TEXT NOT NULL CHECK(status IN ('candidate', 'release')),
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS extension_versions_id_idx ON extension_versions(extension_id, created_at DESC);
            CREATE TABLE IF NOT EXISTS extension_installs (
                extension_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                active_hash TEXT,
                preview_hash TEXT,
                enabled INTEGER NOT NULL DEFAULT 1,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS extension_events (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                extension_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                before_hash TEXT,
                after_hash TEXT,
                created_at TEXT NOT NULL
            );
            INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, datetime('now'));
            "#,
        )
        .map_err(|error| error.to_string())?;
    let has_page_preview = {
        let mut statement = connection
            .prepare("PRAGMA table_info(pages)")
            .map_err(|error| error.to_string())?;
        let names = statement
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|error| error.to_string())?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| error.to_string())?;
        names.iter().any(|name| name == "preview")
    };
    if !has_page_preview {
        connection
            .execute("ALTER TABLE pages ADD COLUMN preview TEXT", [])
            .map_err(|error| error.to_string())?;
    }
    connection
        .execute(
            "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (2, datetime('now'))",
            [],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (3, datetime('now'))",
            [],
        )
        .map_err(|error| error.to_string())?;
    Ok(connection)
}

fn project_from_row(row: &Row<'_>) -> rusqlite::Result<Project> {
    Ok(Project {
        id: row.get(0)?,
        name: row.get(1)?,
        created_at: row.get(2)?,
        updated_at: row.get(3)?,
        trashed_at: row.get(4)?,
    })
}

fn file_from_row(row: &Row<'_>) -> rusqlite::Result<DesignFile> {
    Ok(DesignFile {
        id: row.get(0)?,
        project_id: row.get(1)?,
        name: row.get(2)?,
        starred: row.get::<_, i64>(3)? != 0,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
        last_opened_at: row.get(6)?,
        trashed_at: row.get(7)?,
        thumbnail: row.get(8)?,
    })
}

fn page_from_row(row: &Row<'_>) -> rusqlite::Result<PageMeta> {
    Ok(PageMeta {
        id: row.get(0)?,
        file_id: row.get(1)?,
        name: row.get(2)?,
        position: row.get(3)?,
        revision: row.get(4)?,
    })
}

fn get_file(connection: &Connection, id: &str) -> CommandResult<DesignFile> {
    connection
        .query_row(
            "SELECT id, project_id, name, starred, created_at, updated_at, last_opened_at, trashed_at, thumbnail FROM design_files WHERE id = ?1",
            [id],
            file_from_row,
        )
        .map_err(|_| "Design file not found".to_string())
}

fn pages_for_file(connection: &Connection, file_id: &str) -> CommandResult<Vec<PageMeta>> {
    let mut statement = connection
        .prepare("SELECT id, file_id, name, position, revision FROM pages WHERE file_id = ?1 ORDER BY position")
        .map_err(|error| error.to_string())?;
    let pages = statement
        .query_map([file_id], page_from_row)
        .map_err(|error| error.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| error.to_string())?;
    Ok(pages)
}

fn page_document(connection: &Connection, page_id: &str) -> CommandResult<Value> {
    let raw: String = connection
        .query_row(
            "SELECT document_json FROM pages WHERE id = ?1",
            [page_id],
            |row| row.get(0),
        )
        .map_err(|_| "Page not found".to_string())?;
    serde_json::from_str(&raw).map_err(|error| format!("The page data is damaged: {error}"))
}

fn page_preview(connection: &Connection, page_id: &str) -> CommandResult<Option<String>> {
    connection
        .query_row(
            "SELECT preview FROM pages WHERE id = ?1",
            [page_id],
            |row| row.get(0),
        )
        .map_err(|_| "Page not found".to_string())
}

#[tauri::command]
fn library_snapshot(state: State<'_, AppState>) -> CommandResult<LibrarySnapshot> {
    let connection = database(&state)?;
    library_snapshot_from_connection(&connection)
}

fn library_snapshot_from_connection(connection: &Connection) -> CommandResult<LibrarySnapshot> {
    let projects = {
        let mut statement = connection
            .prepare("SELECT id, name, created_at, updated_at, trashed_at FROM projects ORDER BY updated_at DESC")
            .map_err(|error| error.to_string())?;
        let projects = statement
            .query_map([], project_from_row)
            .map_err(|error| error.to_string())?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| error.to_string())?;
        projects
    };
    let files = {
        let mut statement = connection
            .prepare("SELECT id, project_id, name, starred, created_at, updated_at, last_opened_at, trashed_at, NULL FROM design_files ORDER BY updated_at DESC")
            .map_err(|error| error.to_string())?;
        let files = statement
            .query_map([], file_from_row)
            .map_err(|error| error.to_string())?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| error.to_string())?;
        files
    };
    Ok(LibrarySnapshot { projects, files })
}

#[tauri::command(rename_all = "camelCase")]
fn file_thumbnail(file_id: String, state: State<'_, AppState>) -> CommandResult<Option<String>> {
    let connection = database(&state)?;
    file_thumbnail_from_connection(&connection, &file_id)
}

fn file_thumbnail_from_connection(
    connection: &Connection,
    file_id: &str,
) -> CommandResult<Option<String>> {
    connection
        .query_row(
            "SELECT CASE WHEN length(CAST(thumbnail AS BLOB)) <= ?2 THEN thumbnail ELSE NULL END FROM design_files WHERE id = ?1",
            params![file_id, MAX_LIBRARY_THUMBNAIL_BYTES],
            |row| row.get(0),
        )
        .map_err(|_| "Design file not found".to_string())
}

#[tauri::command]
fn create_project(name: String, state: State<'_, AppState>) -> CommandResult<Project> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 120 {
        return Err("Project names must contain 1–120 characters".into());
    }
    let timestamp = now();
    let project = Project {
        id: new_id("project"),
        name: name.to_string(),
        created_at: timestamp.clone(),
        updated_at: timestamp,
        trashed_at: None,
    };
    database(&state)?
        .execute(
            "INSERT INTO projects(id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params![
                project.id,
                project.name,
                project.created_at,
                project.updated_at
            ],
        )
        .map_err(|error| error.to_string())?;
    Ok(project)
}

#[tauri::command]
fn rename_project(id: String, name: String, state: State<'_, AppState>) -> CommandResult<()> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Project name cannot be empty".into());
    }
    database(&state)?
        .execute(
            "UPDATE projects SET name = ?1, updated_at = ?2 WHERE id = ?3",
            params![name, now(), id],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn trash_project(id: String, state: State<'_, AppState>) -> CommandResult<()> {
    let timestamp = now();
    let mut connection = database(&state)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "UPDATE projects SET trashed_at = ?1, updated_at = ?1 WHERE id = ?2",
            params![timestamp, id],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "UPDATE design_files SET trashed_at = ?1, updated_at = ?1 WHERE project_id = ?2",
            params![timestamp, id],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
fn create_file(
    project_id: Option<String>,
    state: State<'_, AppState>,
) -> CommandResult<OpenedFile> {
    let timestamp = now();
    let file = DesignFile {
        id: new_id("file"),
        project_id,
        name: "Untitled".into(),
        starred: false,
        created_at: timestamp.clone(),
        updated_at: timestamp.clone(),
        last_opened_at: Some(timestamp),
        trashed_at: None,
        thumbnail: None,
    };
    let page = PageMeta {
        id: new_id("page"),
        file_id: file.id.clone(),
        name: "Page 1".into(),
        position: 0,
        revision: 0,
    };
    let document = empty_document();
    let mut connection = database(&state)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "INSERT INTO design_files(id, project_id, name, starred, created_at, updated_at, last_opened_at) VALUES (?1, ?2, ?3, 0, ?4, ?5, ?6)",
            params![file.id, file.project_id, file.name, file.created_at, file.updated_at, file.last_opened_at],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "INSERT INTO pages(id, file_id, name, position, revision, document_json) VALUES (?1, ?2, ?3, 0, 0, ?4)",
            params![page.id, page.file_id, page.name, document.to_string()],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(OpenedFile {
        file,
        pages: vec![page.clone()],
        page,
        document,
    })
}

#[tauri::command]
fn open_file(id: String, state: State<'_, AppState>) -> CommandResult<OpenedFile> {
    let connection = database(&state)?;
    let mut file = get_file(&connection, &id)?;
    if file.trashed_at.is_some() {
        return Err("Restore this design before opening it".into());
    }
    let timestamp = now();
    connection
        .execute(
            "UPDATE design_files SET last_opened_at = ?1 WHERE id = ?2",
            params![timestamp, id],
        )
        .map_err(|error| error.to_string())?;
    file.last_opened_at = Some(timestamp);
    // The editor does not render the home-screen thumbnail. Do not attach a
    // potentially huge legacy preview to the document-opening response.
    file.thumbnail = None;
    let pages = pages_for_file(&connection, &file.id)?;
    let page = pages
        .first()
        .cloned()
        .ok_or_else(|| "Design file has no pages".to_string())?;
    let document = page_document(&connection, &page.id)?;
    Ok(OpenedFile {
        file,
        pages,
        page,
        document,
    })
}

#[tauri::command]
fn rename_file(id: String, name: String, state: State<'_, AppState>) -> CommandResult<()> {
    let name = name.trim();
    if name.is_empty() {
        return Err("File name cannot be empty".into());
    }
    database(&state)?
        .execute(
            "UPDATE design_files SET name = ?1, updated_at = ?2 WHERE id = ?3",
            params![name, now(), id],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn star_file(id: String, starred: bool, state: State<'_, AppState>) -> CommandResult<()> {
    database(&state)?
        .execute(
            "UPDATE design_files SET starred = ?1 WHERE id = ?2",
            params![starred as i64, id],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
fn move_file(
    id: String,
    project_id: Option<String>,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    database(&state)?
        .execute(
            "UPDATE design_files SET project_id = ?1, updated_at = ?2 WHERE id = ?3",
            params![project_id, now(), id],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn duplicate_file(id: String, state: State<'_, AppState>) -> CommandResult<DesignFile> {
    let mut connection = database(&state)?;
    let source = get_file(&connection, &id)?;
    let source_pages = pages_for_file(&connection, &id)?;
    let timestamp = now();
    let copy = DesignFile {
        id: new_id("file"),
        project_id: source.project_id,
        name: format!("{} copy", source.name),
        starred: false,
        created_at: timestamp.clone(),
        updated_at: timestamp,
        last_opened_at: None,
        trashed_at: None,
        thumbnail: source.thumbnail,
    };
    let documents: Vec<(PageMeta, Value, Option<String>)> = source_pages
        .into_iter()
        .map(|page| {
            let document = page_document(&connection, &page.id)?;
            let preview = page_preview(&connection, &page.id)?;
            Ok((page, document, preview))
        })
        .collect::<CommandResult<_>>()?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "INSERT INTO design_files(id, project_id, name, starred, created_at, updated_at, thumbnail) VALUES (?1, ?2, ?3, 0, ?4, ?5, ?6)",
            params![copy.id, copy.project_id, copy.name, copy.created_at, copy.updated_at, copy.thumbnail],
        )
        .map_err(|error| error.to_string())?;
    for (page, document, preview) in documents {
        transaction
            .execute(
                "INSERT INTO pages(id, file_id, name, position, revision, document_json, preview) VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6)",
                params![new_id("page"), copy.id, page.name, page.position, document.to_string(), preview],
            )
            .map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(copy)
}

#[tauri::command]
fn trash_file(id: String, state: State<'_, AppState>) -> CommandResult<()> {
    database(&state)?
        .execute(
            "UPDATE design_files SET trashed_at = ?1, updated_at = ?1 WHERE id = ?2",
            params![now(), id],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn restore_item(kind: String, id: String, state: State<'_, AppState>) -> CommandResult<()> {
    let mut connection = database(&state)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    if kind == "project" {
        transaction
            .execute(
                "UPDATE projects SET trashed_at = NULL, updated_at = ?1 WHERE id = ?2",
                params![now(), id],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "UPDATE design_files SET trashed_at = NULL WHERE project_id = ?1",
                [id],
            )
            .map_err(|error| error.to_string())?;
    } else {
        let project_trashed: Option<String> = transaction
            .query_row(
                "SELECT p.trashed_at FROM design_files f LEFT JOIN projects p ON p.id = f.project_id WHERE f.id = ?1",
                [&id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .flatten();
        transaction
            .execute(
                "UPDATE design_files SET trashed_at = NULL, project_id = CASE WHEN ?1 IS NULL THEN project_id ELSE NULL END WHERE id = ?2",
                params![project_trashed, id],
            )
            .map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_item(kind: String, id: String, state: State<'_, AppState>) -> CommandResult<()> {
    let connection = database(&state)?;
    if kind == "project" {
        connection.execute(
            "DELETE FROM projects WHERE id = ?1 AND trashed_at IS NOT NULL",
            [id],
        )
    } else {
        connection.execute(
            "DELETE FROM design_files WHERE id = ?1 AND trashed_at IS NOT NULL",
            [id],
        )
    }
    .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
fn save_page(
    page_id: String,
    expected_revision: i64,
    document: Value,
    thumbnail: Option<String>,
    state: State<'_, AppState>,
) -> CommandResult<i64> {
    if document.get("schemaVersion").and_then(Value::as_u64) != Some(1) {
        return Err("Unsupported page schema".into());
    }
    if thumbnail
        .as_ref()
        .is_some_and(|value| value.len() > MAX_LIBRARY_THUMBNAIL_BYTES)
    {
        return Err("The page preview is too large".into());
    }
    let mut connection = database(&state)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let changed = transaction
        .execute(
            "UPDATE pages SET document_json = ?1, revision = revision + 1, preview = COALESCE(?4, preview) WHERE id = ?2 AND revision = ?3",
            params![document.to_string(), page_id, expected_revision, thumbnail.as_deref()],
        )
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("REVISION_CONFLICT".into());
    }
    transaction
        .execute(
            "UPDATE design_files SET updated_at = ?1, thumbnail = COALESCE(?2, thumbnail) WHERE id = (SELECT file_id FROM pages WHERE id = ?3)",
            params![now(), thumbnail.as_deref(), page_id],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(expected_revision + 1)
}

#[tauri::command(rename_all = "camelCase")]
fn save_page_preview(
    page_id: String,
    thumbnail: String,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    if thumbnail.len() > MAX_LIBRARY_THUMBNAIL_BYTES {
        return Err("The page preview is too large".into());
    }
    let mut connection = database(&state)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "UPDATE pages SET preview = ?1 WHERE id = ?2",
            params![thumbnail.as_str(), page_id.as_str()],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "UPDATE design_files SET thumbnail = ?1 WHERE id = (SELECT file_id FROM pages WHERE id = ?2)",
            params![thumbnail.as_str(), page_id.as_str()],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
fn load_page(page_id: String, state: State<'_, AppState>) -> CommandResult<PagePayload> {
    let connection = database(&state)?;
    let page = connection
        .query_row(
            "SELECT id, file_id, name, position, revision FROM pages WHERE id = ?1",
            [&page_id],
            page_from_row,
        )
        .map_err(|_| "Page not found".to_string())?;
    let document = page_document(&connection, &page_id)?;
    Ok(PagePayload { page, document })
}

#[tauri::command(rename_all = "camelCase")]
fn create_page(
    file_id: String,
    name: String,
    state: State<'_, AppState>,
) -> CommandResult<PagePayload> {
    let connection = database(&state)?;
    let position: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM pages WHERE file_id = ?1",
            [&file_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    let page = PageMeta {
        id: new_id("page"),
        file_id,
        name,
        position,
        revision: 0,
    };
    let document = empty_document();
    connection
        .execute(
            "INSERT INTO pages(id, file_id, name, position, revision, document_json) VALUES (?1, ?2, ?3, ?4, 0, ?5)",
            params![page.id, page.file_id, page.name, page.position, document.to_string()],
        )
        .map_err(|error| error.to_string())?;
    Ok(PagePayload { page, document })
}

#[tauri::command(rename_all = "camelCase")]
fn rename_page(page_id: String, name: String, state: State<'_, AppState>) -> CommandResult<()> {
    if name.trim().is_empty() {
        return Err("Page name cannot be empty".into());
    }
    database(&state)?
        .execute(
            "UPDATE pages SET name = ?1 WHERE id = ?2",
            params![name.trim(), page_id],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
fn duplicate_page(page_id: String, state: State<'_, AppState>) -> CommandResult<PagePayload> {
    let connection = database(&state)?;
    let source = connection
        .query_row(
            "SELECT id, file_id, name, position, revision FROM pages WHERE id = ?1",
            [&page_id],
            page_from_row,
        )
        .map_err(|_| "Page not found".to_string())?;
    let position: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM pages WHERE file_id = ?1",
            [&source.file_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    let page = PageMeta {
        id: new_id("page"),
        file_id: source.file_id,
        name: format!("{} copy", source.name),
        position,
        revision: 0,
    };
    let document = page_document(&connection, &page_id)?;
    let preview = page_preview(&connection, &page_id)?;
    connection
        .execute(
            "INSERT INTO pages(id, file_id, name, position, revision, document_json, preview) VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6)",
            params![page.id, page.file_id, page.name, page.position, document.to_string(), preview],
        )
        .map_err(|error| error.to_string())?;
    Ok(PagePayload { page, document })
}

#[tauri::command(rename_all = "camelCase")]
fn delete_page(page_id: String, state: State<'_, AppState>) -> CommandResult<()> {
    let mut connection = database(&state)?;
    let file_id: String = connection
        .query_row(
            "SELECT file_id FROM pages WHERE id = ?1",
            [&page_id],
            |row| row.get(0),
        )
        .map_err(|_| "Page not found".to_string())?;
    let count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM pages WHERE file_id = ?1",
            [&file_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if count <= 1 {
        return Err("A design file needs at least one page".into());
    }
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM pages WHERE id = ?1", [page_id])
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "WITH ranked AS (SELECT id, ROW_NUMBER() OVER (ORDER BY position) - 1 AS next_position FROM pages WHERE file_id = ?1) UPDATE pages SET position = (SELECT next_position FROM ranked WHERE ranked.id = pages.id) WHERE file_id = ?1",
            [file_id],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
fn reorder_pages(
    file_id: String,
    page_ids: Vec<String>,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    let mut connection = database(&state)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    for (position, page_id) in page_ids.iter().enumerate() {
        transaction
            .execute(
                "UPDATE pages SET position = ?1 WHERE id = ?2 AND file_id = ?3",
                params![position as i64, page_id, file_id],
            )
            .map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(())
}

fn picked_path(path: tauri_plugin_dialog::FilePath) -> CommandResult<PathBuf> {
    path.into_path().map_err(|error| error.to_string())
}

async fn pick_file<R: Runtime>(dialog: FileDialogBuilder<R>) -> CommandResult<Option<FilePath>> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    dialog.pick_file(move |selection| {
        let _ = sender.send(selection);
    });
    receiver
        .await
        .map_err(|_| "The file picker closed unexpectedly".to_string())
}

async fn save_file<R: Runtime>(dialog: FileDialogBuilder<R>) -> CommandResult<Option<FilePath>> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    dialog.save_file(move |selection| {
        let _ = sender.send(selection);
    });
    receiver
        .await
        .map_err(|_| "The file picker closed unexpectedly".to_string())
}

#[tauri::command]
async fn import_image(
    app: AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<Option<ImportedAsset>> {
    let Some(selection) = pick_file(
        app.dialog()
            .file()
            .add_filter("Images", &["png", "jpg", "jpeg", "webp"]),
    )
    .await?
    else {
        return Ok(None);
    };
    let path = picked_path(selection)?;
    let data = fs::read(&path).map_err(|error| format!("Could not read the image: {error}"))?;
    if data.len() > 50 * 1024 * 1024 {
        return Err("Images must be smaller than 50 MB".into());
    }
    store_image_data(data, &state).map(Some)
}

fn store_image_data(data: Vec<u8>, state: &State<'_, AppState>) -> CommandResult<ImportedAsset> {
    if data.len() > 50 * 1024 * 1024 {
        return Err("Images must be smaller than 50 MB".into());
    }
    let format =
        image::guess_format(&data).map_err(|_| "Choose a PNG, JPEG, or WebP image".to_string())?;
    let mime = match format {
        image::ImageFormat::Png => "image/png",
        image::ImageFormat::Jpeg => "image/jpeg",
        image::ImageFormat::WebP => "image/webp",
        _ => return Err("Choose a PNG, JPEG, or WebP image".into()),
    };
    let decoded = image::load_from_memory_with_format(&data, format)
        .map_err(|error| format!("The image is damaged: {error}"))?;
    let (width, height) = decoded.dimensions();
    let hash = format!("{:x}", Sha256::digest(&data));
    let id = format!("asset_{}", &hash[..32]);
    database(state)?
        .execute(
            "INSERT OR IGNORE INTO assets(id, content_hash, mime, data, width, height, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, hash, mime, data, width, height, now()],
        )
        .map_err(|error| error.to_string())?;
    Ok(ImportedAsset {
        id,
        mime: mime.into(),
        data_url: format!("data:{mime};base64,{}", BASE64.encode(data)),
        width,
        height,
    })
}

#[tauri::command]
fn import_image_data(
    data_base64: String,
    state: State<'_, AppState>,
) -> CommandResult<ImportedAsset> {
    let data = BASE64
        .decode(data_base64)
        .map_err(|_| "The generated image payload is not valid base64".to_string())?;
    store_image_data(data, &state)
}

#[cfg(target_os = "linux")]
#[tauri::command]
fn copy_image_to_clipboard(
    app: AppHandle,
    data_base64: String,
    filename: String,
) -> CommandResult<String> {
    let encoded = BASE64
        .decode(data_base64)
        .map_err(|_| "The rendered frame is not valid base64".to_string())?;
    if image::guess_format(&encoded)
        .map_err(|_| "The rendered frame is not an image".to_string())?
        != image::ImageFormat::Png
    {
        return Err("Copy as image requires PNG data".into());
    }
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("clipboard");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let mut safe = safe_filename(&filename);
    if safe.trim().is_empty() {
        safe = "Frame.png".into();
    } else if !safe.to_ascii_lowercase().ends_with(".png") {
        safe.push_str(".png");
    }
    let path = directory.join(safe);
    fs::write(&path, &encoded)
        .map_err(|error| format!("Could not cache the frame image: {error}"))?;
    let uri = gtk::glib::filename_to_uri(&path, None)
        .map_err(|error| format!("Could not create the frame file URI: {error}"))?
        .to_string();
    let targets = [
        gtk::TargetEntry::new("image/png", gtk::TargetFlags::empty(), 0),
        gtk::TargetEntry::new("text/uri-list", gtk::TargetFlags::empty(), 1),
        gtk::TargetEntry::new("x-special/gnome-copied-files", gtk::TargetFlags::empty(), 2),
        gtk::TargetEntry::new("application/x-kde4-urilist", gtk::TargetFlags::empty(), 3),
        gtk::TargetEntry::new(
            "application/x-kde-cutselection",
            gtk::TargetFlags::empty(),
            4,
        ),
    ];
    let png = encoded;
    let offered_uri = uri.clone();
    let clipboard = gtk::Clipboard::get(&gtk::gdk::SELECTION_CLIPBOARD);
    let accepted =
        clipboard.set_with_data(&targets, move |_clipboard, selection, info| match info {
            0 => selection.set(&gtk::gdk::Atom::intern("image/png"), 8, &png),
            1 | 3 => {
                selection.set_uris(&[offered_uri.as_str()]);
            }
            2 => selection.set(
                &gtk::gdk::Atom::intern("x-special/gnome-copied-files"),
                8,
                format!("copy\n{offered_uri}\n").as_bytes(),
            ),
            4 => selection.set(
                &gtk::gdk::Atom::intern("application/x-kde-cutselection"),
                8,
                b"0",
            ),
            _ => {}
        });
    if !accepted {
        return Err("The Wayland clipboard rejected the frame image".into());
    }
    clipboard.store();
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
fn copy_image_to_clipboard(_data_base64: String, _filename: String) -> CommandResult<String> {
    Err("Native image clipboard support is currently available on Linux".into())
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum NativeClipboardContent {
    Image {
        #[serde(rename = "dataUrl")]
        data_url: String,
        name: String,
    },
    Text {
        text: String,
    },
    Empty,
}

#[cfg(target_os = "linux")]
#[tauri::command]
fn codex_clipboard_read() -> CommandResult<NativeClipboardContent> {
    const MAX_ATTACHMENT_BYTES: usize = 20 * 1024 * 1024;
    let clipboard = gtk::Clipboard::get(&gtk::gdk::SELECTION_CLIPBOARD);
    if clipboard.wait_is_image_available() {
        let pixbuf = clipboard
            .wait_for_image()
            .ok_or_else(|| "The clipboard image is no longer available".to_string())?;
        let png = pixbuf
            .save_to_bufferv("png", &[])
            .map_err(|error| format!("Could not read the clipboard image: {error}"))?;
        if png.len() > MAX_ATTACHMENT_BYTES {
            return Err("The clipboard image is larger than 20 MB".into());
        }
        return Ok(NativeClipboardContent::Image {
            data_url: format!("data:image/png;base64,{}", BASE64.encode(png)),
            name: format!("pasted-image-{}.png", Uuid::new_v4().simple()),
        });
    }
    Ok(match clipboard.wait_for_text() {
        Some(text) => NativeClipboardContent::Text {
            text: text.to_string(),
        },
        None => NativeClipboardContent::Empty,
    })
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
fn codex_clipboard_read() -> CommandResult<NativeClipboardContent> {
    Ok(NativeClipboardContent::Empty)
}

#[tauri::command]
fn read_asset(id: String, state: State<'_, AppState>) -> CommandResult<String> {
    let connection = database(&state)?;
    let (mime, data): (String, Vec<u8>) = connection
        .query_row("SELECT mime, data FROM assets WHERE id = ?1", [id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .map_err(|_| "Asset not found".to_string())?;
    Ok(format!("data:{mime};base64,{}", BASE64.encode(data)))
}

fn safe_filename(name: &str) -> String {
    let safe: String = name
        .chars()
        .map(|character| {
            if character.is_alphanumeric() || " -_".contains(character) {
                character
            } else {
                '_'
            }
        })
        .collect();
    if safe.trim().is_empty() {
        "Untitled".into()
    } else {
        safe.trim().into()
    }
}

fn extension_manifest_identity(manifest: &Value) -> CommandResult<(String, String, String)> {
    let object = manifest
        .as_object()
        .ok_or_else(|| "Extension manifest must be an object".to_string())?;
    if object.get("format").and_then(Value::as_str) != Some("figmaboy-extension") {
        return Err("Extension format must be figmaboy-extension".into());
    }
    if object.get("apiVersion").and_then(Value::as_u64) != Some(1) {
        return Err("This extension API version is not supported".into());
    }
    let field = |name: &str, maximum: usize| -> CommandResult<String> {
        let value = object
            .get(name)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| format!("Extension {name} is required"))?;
        if value.len() > maximum {
            return Err(format!("Extension {name} is too long"));
        }
        Ok(value.to_string())
    };
    let id = field("id", 120)?;
    if !id.chars().all(|character| {
        character.is_ascii_lowercase()
            || character.is_ascii_digit()
            || matches!(character, '.' | '-' | '_')
    }) {
        return Err("Extension id contains unsupported characters".into());
    }
    Ok((id, field("name", 120)?, field("version", 80)?))
}

fn extension_manifest_by_hash(connection: &Connection, hash: &str) -> CommandResult<Option<Value>> {
    let manifest: Option<String> = connection
        .query_row(
            "SELECT manifest_json FROM extension_versions WHERE hash = ?1",
            [hash],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    manifest
        .map(|value| serde_json::from_str(&value).map_err(|error| error.to_string()))
        .transpose()
}

fn extension_record(connection: &Connection, id: &str) -> CommandResult<InstalledExtension> {
    let (name, active_hash, preview_hash, enabled): (String, Option<String>, Option<String>, i64) = connection
        .query_row(
            "SELECT name, active_hash, preview_hash, enabled FROM extension_installs WHERE extension_id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(|_| "Extension is not installed".to_string())?;
    let active = active_hash
        .as_deref()
        .map(|hash| extension_manifest_by_hash(connection, hash))
        .transpose()?
        .flatten();
    let preview = preview_hash
        .as_deref()
        .map(|hash| extension_manifest_by_hash(connection, hash))
        .transpose()?
        .flatten();
    let mut statement = connection
        .prepare("SELECT hash, version, created_at, status FROM extension_versions WHERE extension_id = ?1 ORDER BY created_at DESC")
        .map_err(|error| error.to_string())?;
    let versions = statement
        .query_map([id], |row| {
            Ok(ExtensionVersionSummary {
                hash: row.get(0)?,
                version: row.get(1)?,
                created_at: row.get(2)?,
                status: row.get(3)?,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| error.to_string())?;
    Ok(InstalledExtension {
        id: id.to_string(),
        name,
        enabled: enabled != 0,
        active_hash,
        preview_hash,
        active,
        preview,
        versions,
    })
}

#[tauri::command]
fn extensions_list(state: State<'_, AppState>) -> CommandResult<Vec<InstalledExtension>> {
    let connection = database(&state)?;
    let mut statement = connection
        .prepare("SELECT extension_id FROM extension_installs ORDER BY name COLLATE NOCASE")
        .map_err(|error| error.to_string())?;
    let ids = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| error.to_string())?;
    ids.iter()
        .map(|id| extension_record(&connection, id))
        .collect()
}

#[tauri::command]
fn extension_stage(
    manifest: Value,
    state: State<'_, AppState>,
) -> CommandResult<InstalledExtension> {
    let (id, name, version) = extension_manifest_identity(&manifest)?;
    let bytes = serde_json::to_vec(&manifest).map_err(|error| error.to_string())?;
    if bytes.len() > 1024 * 1024 {
        return Err("Extension manifests must be smaller than 1 MB".into());
    }
    let hash = format!("{:x}", Sha256::digest(&bytes));
    let timestamp = now();
    let mut connection = database(&state)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let (before, previous_preview): (Option<String>, Option<String>) = transaction
        .query_row(
            "SELECT active_hash, preview_hash FROM extension_installs WHERE extension_id = ?1",
            [&id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .unwrap_or((None, None));
    transaction
        .execute(
            "INSERT OR IGNORE INTO extension_versions(hash, extension_id, version, manifest_json, status, created_at) VALUES (?1, ?2, ?3, ?4, 'candidate', ?5)",
            params![hash, id, version, String::from_utf8(bytes).map_err(|error| error.to_string())?, timestamp],
        )
        .map_err(|error| error.to_string())?;
    if previous_preview.as_deref() != Some(hash.as_str()) {
        if let Some(previous_hash) = previous_preview {
            transaction
                .execute(
                    "DELETE FROM extension_versions WHERE hash = ?1 AND status = 'candidate'",
                    [previous_hash],
                )
                .map_err(|error| error.to_string())?;
        }
    }
    transaction
        .execute(
            "INSERT INTO extension_installs(extension_id, name, preview_hash, enabled, updated_at) VALUES (?1, ?2, ?3, 1, ?4) ON CONFLICT(extension_id) DO UPDATE SET name = excluded.name, preview_hash = excluded.preview_hash, updated_at = excluded.updated_at",
            params![id, name, hash, timestamp],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "INSERT INTO extension_events(extension_id, kind, before_hash, after_hash, created_at) VALUES (?1, 'stage', ?2, ?3, ?4)",
            params![id, before, hash, timestamp],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    extension_record(&connection, &id)
}

#[tauri::command]
fn extension_keep(
    extension_id: String,
    hash: String,
    state: State<'_, AppState>,
) -> CommandResult<InstalledExtension> {
    let timestamp = now();
    let mut connection = database(&state)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let (before, preview): (Option<String>, Option<String>) = transaction
        .query_row(
            "SELECT active_hash, preview_hash FROM extension_installs WHERE extension_id = ?1",
            [&extension_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| "Extension is not installed".to_string())?;
    if preview.as_deref() != Some(hash.as_str()) {
        return Err("Only the current preview can be kept".into());
    }
    transaction
        .execute(
            "UPDATE extension_versions SET status = 'release' WHERE hash = ?1 AND extension_id = ?2",
            params![hash, extension_id],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "UPDATE extension_installs SET active_hash = ?2, preview_hash = NULL, enabled = 1, updated_at = ?3 WHERE extension_id = ?1",
            params![extension_id, hash, timestamp],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "INSERT INTO extension_events(extension_id, kind, before_hash, after_hash, created_at) VALUES (?1, 'keep', ?2, ?3, ?4)",
            params![extension_id, before, hash, timestamp],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    extension_record(&connection, &extension_id)
}

#[tauri::command]
fn extension_discard(
    extension_id: String,
    hash: String,
    state: State<'_, AppState>,
) -> CommandResult<Vec<InstalledExtension>> {
    let timestamp = now();
    let mut connection = database(&state)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let preview: Option<String> = transaction
        .query_row(
            "SELECT preview_hash FROM extension_installs WHERE extension_id = ?1",
            [&extension_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .flatten();
    if preview.as_deref() != Some(hash.as_str()) {
        return Err("This candidate is no longer being previewed".into());
    }
    transaction
        .execute("UPDATE extension_installs SET preview_hash = NULL, updated_at = ?2 WHERE extension_id = ?1", params![extension_id, timestamp])
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "DELETE FROM extension_versions WHERE hash = ?1 AND status = 'candidate'",
            [&hash],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "INSERT INTO extension_events(extension_id, kind, before_hash, after_hash, created_at) VALUES (?1, 'discard', ?2, NULL, ?3)",
            params![extension_id, hash, timestamp],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM extension_installs WHERE extension_id = ?1 AND active_hash IS NULL AND preview_hash IS NULL", [&extension_id])
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    drop(connection);
    extensions_list(state)
}

#[tauri::command]
fn extension_set_enabled(
    extension_id: String,
    enabled: bool,
    state: State<'_, AppState>,
) -> CommandResult<InstalledExtension> {
    let connection = database(&state)?;
    let active: Option<String> = connection
        .query_row(
            "SELECT active_hash FROM extension_installs WHERE extension_id = ?1",
            [&extension_id],
            |row| row.get(0),
        )
        .map_err(|_| "Extension is not installed".to_string())?;
    if active.is_none() {
        return Err("Keep an extension before enabling it".into());
    }
    let timestamp = now();
    connection
        .execute(
            "UPDATE extension_installs SET enabled = ?2, updated_at = ?3 WHERE extension_id = ?1",
            params![extension_id, enabled, timestamp],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "INSERT INTO extension_events(extension_id, kind, before_hash, after_hash, created_at) VALUES (?1, ?2, ?3, ?3, ?4)",
            params![extension_id, if enabled { "enable" } else { "disable" }, active, timestamp],
        )
        .map_err(|error| error.to_string())?;
    extension_record(&connection, &extension_id)
}

#[tauri::command]
fn extension_rollback(
    extension_id: String,
    hash: String,
    state: State<'_, AppState>,
) -> CommandResult<InstalledExtension> {
    let connection = database(&state)?;
    let status: Option<String> = connection
        .query_row(
            "SELECT status FROM extension_versions WHERE extension_id = ?1 AND hash = ?2",
            params![extension_id, hash],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if status.as_deref() != Some("release") {
        return Err("Rollback requires a kept extension version".into());
    }
    let before: Option<String> = connection
        .query_row(
            "SELECT active_hash FROM extension_installs WHERE extension_id = ?1",
            [&extension_id],
            |row| row.get(0),
        )
        .map_err(|_| "Extension is not installed".to_string())?;
    let timestamp = now();
    connection
        .execute("UPDATE extension_installs SET active_hash = ?2, preview_hash = NULL, enabled = 1, updated_at = ?3 WHERE extension_id = ?1", params![extension_id, hash, timestamp])
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "INSERT INTO extension_events(extension_id, kind, before_hash, after_hash, created_at) VALUES (?1, 'rollback', ?2, ?3, ?4)",
            params![extension_id, before, hash, timestamp],
        )
        .map_err(|error| error.to_string())?;
    extension_record(&connection, &extension_id)
}

#[tauri::command]
fn extension_remove(
    extension_id: String,
    state: State<'_, AppState>,
) -> CommandResult<Vec<InstalledExtension>> {
    let mut connection = database(&state)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let active_row: Option<Option<String>> = transaction
        .query_row(
            "SELECT active_hash FROM extension_installs WHERE extension_id = ?1",
            [&extension_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let active = active_row.ok_or_else(|| "Extension is not installed".to_string())?;
    transaction
        .execute(
            "INSERT INTO extension_events(extension_id, kind, before_hash, after_hash, created_at) VALUES (?1, 'remove', ?2, NULL, ?3)",
            params![extension_id, active, now()],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "DELETE FROM extension_installs WHERE extension_id = ?1",
            [&extension_id],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "DELETE FROM extension_versions WHERE extension_id = ?1",
            [&extension_id],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    drop(connection);
    extensions_list(state)
}

#[tauri::command]
async fn extension_import(app: AppHandle) -> CommandResult<Option<Value>> {
    let Some(selection) = pick_file(
        app.dialog()
            .file()
            .add_filter("Figmaboy extension", &["json", "figmaboy-extension"]),
    )
    .await?
    else {
        return Ok(None);
    };
    let path = picked_path(selection)?;
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if metadata.len() > 1024 * 1024 {
        return Err("Extension manifests must be smaller than 1 MB".into());
    }
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|_| "The extension file is not valid JSON".to_string())
}

#[tauri::command(rename_all = "camelCase")]
async fn export_render(
    app: AppHandle,
    name: String,
    extension: String,
    data: String,
) -> CommandResult<bool> {
    if extension != "svg" && extension != "png" {
        return Err("Unsupported export format".into());
    }
    let file_name = format!("{}.{}", safe_filename(&name), extension);
    let Some(selection) = save_file(
        app.dialog()
            .file()
            .add_filter(extension.to_uppercase(), &[&extension])
            .set_file_name(&file_name),
    )
    .await?
    else {
        return Ok(false);
    };
    let path = picked_path(selection)?;
    let encoded = data
        .split_once(',')
        .map(|(_, value)| value)
        .ok_or_else(|| "Invalid export data".to_string())?;
    let bytes = BASE64
        .decode(encoded)
        .map_err(|_| "Invalid export data".to_string())?;
    fs::write(path, bytes).map_err(|error| format!("Could not save the export: {error}"))?;
    Ok(true)
}

fn collect_asset_ids(value: &Value, ids: &mut HashSet<String>) {
    match value {
        Value::Object(map) => {
            if let Some(Value::String(id)) = map.get("assetId") {
                ids.insert(id.clone());
            }
            map.values().for_each(|value| collect_asset_ids(value, ids));
        }
        Value::Array(values) => values
            .iter()
            .for_each(|value| collect_asset_ids(value, ids)),
        _ => {}
    }
}

fn package_workspace(
    connection: &Connection,
    kind: &str,
    id: &str,
) -> CommandResult<PackagedWorkspace> {
    let (projects, files) = if kind == "project" {
        let project = connection
            .query_row(
                "SELECT id, name, created_at, updated_at, trashed_at FROM projects WHERE id = ?1",
                [id],
                project_from_row,
            )
            .map_err(|_| "Project not found".to_string())?;
        let mut statement = connection
            .prepare("SELECT id, project_id, name, starred, created_at, updated_at, last_opened_at, trashed_at, thumbnail FROM design_files WHERE project_id = ?1 AND trashed_at IS NULL")
            .map_err(|error| error.to_string())?;
        let files = statement
            .query_map([id], file_from_row)
            .map_err(|error| error.to_string())?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| error.to_string())?;
        (vec![project], files)
    } else {
        (Vec::new(), vec![get_file(connection, id)?])
    };
    let mut pages = Vec::new();
    let mut documents = HashMap::new();
    let mut previews = HashMap::new();
    let mut asset_ids = HashSet::new();
    for file in &files {
        for page in pages_for_file(connection, &file.id)? {
            let document = page_document(connection, &page.id)?;
            collect_asset_ids(&document, &mut asset_ids);
            if let Some(preview) = page_preview(connection, &page.id)? {
                previews.insert(page.id.clone(), preview);
            }
            documents.insert(page.id.clone(), document);
            pages.push(page);
        }
    }
    let mut assets = Vec::new();
    let mut asset_data = Vec::new();
    for id in asset_ids {
        let row: Option<(String, Vec<u8>, u32, u32)> = connection
            .query_row(
                "SELECT mime, data, width, height FROM assets WHERE id = ?1",
                [&id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if let Some((mime, data, width, height)) = row {
            let extension = match mime.as_str() {
                "image/jpeg" => "jpg",
                "image/webp" => "webp",
                _ => "png",
            };
            let path = format!("assets/{id}.{extension}");
            assets.push(PackageAsset {
                id,
                mime,
                width,
                height,
                path: path.clone(),
            });
            asset_data.push((path, data));
        }
    }
    Ok((
        PackageWorkspace {
            projects,
            files,
            pages,
            documents,
            previews,
            assets,
        },
        asset_data,
    ))
}

#[tauri::command]
async fn export_package(
    app: AppHandle,
    kind: String,
    id: String,
    state: State<'_, AppState>,
) -> CommandResult<bool> {
    if kind != "project" && kind != "file" {
        return Err("Unsupported package kind".into());
    }
    let (workspace, assets) = {
        let connection = database(&state)?;
        package_workspace(&connection, &kind, &id)?
    };
    let suggested = workspace
        .projects
        .first()
        .map(|project| project.name.as_str())
        .or_else(|| workspace.files.first().map(|file| file.name.as_str()))
        .unwrap_or("Figmaboy design");
    let Some(selection) = save_file(
        app.dialog()
            .file()
            .add_filter("Figmaboy package", &["figmaboy"])
            .set_file_name(format!("{}.figmaboy", safe_filename(suggested))),
    )
    .await?
    else {
        return Ok(false);
    };
    let path = picked_path(selection)?;
    let file =
        File::create(path).map_err(|error| format!("Could not create the package: {error}"))?;
    let mut archive = ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o644);
    let manifest = PackageManifest {
        format: "figmaboy".into(),
        schema_version: 1,
        kind,
        exported_at: now(),
    };
    archive
        .start_file("manifest.json", options)
        .map_err(|error| error.to_string())?;
    archive
        .write_all(
            serde_json::to_string_pretty(&manifest)
                .map_err(|error| error.to_string())?
                .as_bytes(),
        )
        .map_err(|error| error.to_string())?;
    archive
        .start_file("workspace.json", options)
        .map_err(|error| error.to_string())?;
    archive
        .write_all(
            serde_json::to_string(&workspace)
                .map_err(|error| error.to_string())?
                .as_bytes(),
        )
        .map_err(|error| error.to_string())?;
    for (path, data) in assets {
        archive
            .start_file(path, options)
            .map_err(|error| error.to_string())?;
        archive
            .write_all(&data)
            .map_err(|error| error.to_string())?;
    }
    archive.finish().map_err(|error| error.to_string())?;
    Ok(true)
}

fn read_zip_entry(
    archive: &mut ZipArchive<File>,
    name: &str,
    max_size: u64,
) -> CommandResult<Vec<u8>> {
    let mut entry = archive
        .by_name(name)
        .map_err(|_| format!("Package is missing {name}"))?;
    if entry.size() > max_size {
        return Err(format!("Package entry {name} is too large"));
    }
    if entry.enclosed_name().is_none() {
        return Err("Package contains an unsafe path".into());
    }
    let mut data = Vec::with_capacity(entry.size() as usize);
    entry
        .read_to_end(&mut data)
        .map_err(|error| error.to_string())?;
    Ok(data)
}

#[tauri::command]
async fn import_package(app: AppHandle, state: State<'_, AppState>) -> CommandResult<bool> {
    let Some(selection) = pick_file(
        app.dialog()
            .file()
            .add_filter("Figmaboy package", &["figmaboy"]),
    )
    .await?
    else {
        return Ok(false);
    };
    let path = picked_path(selection)?;
    if fs::metadata(&path)
        .map_err(|error| error.to_string())?
        .len()
        > 512 * 1024 * 1024
    {
        return Err("Packages must be smaller than 512 MB".into());
    }
    let file = File::open(path).map_err(|error| format!("Could not open the package: {error}"))?;
    let mut archive =
        ZipArchive::new(file).map_err(|_| "This is not a valid Figmaboy package".to_string())?;
    if archive.len() > 10_000 {
        return Err("Package contains too many files".into());
    }
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(|error| error.to_string())?;
        if entry.enclosed_name().is_none() {
            return Err("Package contains an unsafe path".into());
        }
    }
    let manifest: PackageManifest =
        serde_json::from_slice(&read_zip_entry(&mut archive, "manifest.json", 128 * 1024)?)
            .map_err(|_| "Package manifest is invalid".to_string())?;
    if manifest.format != "figmaboy" || manifest.schema_version != 1 {
        return Err("This package was created by an unsupported Figmaboy version".into());
    }
    let workspace: PackageWorkspace = serde_json::from_slice(&read_zip_entry(
        &mut archive,
        "workspace.json",
        128 * 1024 * 1024,
    )?)
    .map_err(|error| format!("Package workspace is invalid: {error}"))?;
    if workspace.files.is_empty() {
        return Err("Package contains no design files".into());
    }
    let mut asset_payloads = Vec::new();
    for asset in &workspace.assets {
        let data = read_zip_entry(&mut archive, &asset.path, 50 * 1024 * 1024)?;
        let hash = format!("{:x}", Sha256::digest(&data));
        asset_payloads.push((asset, data, hash));
    }
    let timestamp = now();
    let mut connection = database(&state)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let mut project_ids = HashMap::new();
    for project in &workspace.projects {
        let next_id = new_id("project");
        project_ids.insert(project.id.clone(), next_id.clone());
        transaction
            .execute(
                "INSERT INTO projects(id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
                params![next_id, format!("{} imported", project.name), timestamp],
            )
            .map_err(|error| error.to_string())?;
    }
    for (asset, data, hash) in asset_payloads {
        transaction
            .execute(
                "INSERT OR IGNORE INTO assets(id, content_hash, mime, data, width, height, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![asset.id, hash, asset.mime, data, asset.width, asset.height, timestamp],
            )
            .map_err(|error| error.to_string())?;
    }
    for source_file in &workspace.files {
        let file_id = new_id("file");
        let project_id = source_file
            .project_id
            .as_ref()
            .and_then(|id| project_ids.get(id))
            .cloned();
        transaction
            .execute(
                "INSERT INTO design_files(id, project_id, name, starred, created_at, updated_at, thumbnail) VALUES (?1, ?2, ?3, 0, ?4, ?4, ?5)",
                params![file_id, project_id, format!("{} imported", source_file.name), timestamp, source_file.thumbnail],
            )
            .map_err(|error| error.to_string())?;
        for source_page in workspace
            .pages
            .iter()
            .filter(|page| page.file_id == source_file.id)
        {
            let document = workspace
                .documents
                .get(&source_page.id)
                .cloned()
                .unwrap_or_else(empty_document);
            let preview = workspace.previews.get(&source_page.id);
            transaction
                .execute(
                    "INSERT INTO pages(id, file_id, name, position, revision, document_json, preview) VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6)",
                    params![new_id("page"), file_id, source_page.name, source_page.position, document.to_string(), preview],
                )
                .map_err(|error| error.to_string())?;
        }
    }
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(true)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            let data_dir = app.path().app_local_data_dir()?;
            fs::create_dir_all(&data_dir)?;
            let connection =
                initialize_database(&data_dir.join("figmaboy.sqlite3")).map_err(|error| {
                    std::io::Error::other(format!("Could not initialize local storage: {error}"))
                })?;
            app.manage(AppState {
                database: Mutex::new(connection),
            });
            app.manage(codex::CodexState::default());
            app.manage(codex::EvolveExecState::default());
            app.manage(editor_bridge::EditorBridgeState::default());
            let bridge_app = app.handle().clone();
            let bridge_data_dir = data_dir.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = editor_bridge::start(bridge_app, bridge_data_dir).await {
                    eprintln!("Figmaboy editor bridge stopped: {error}");
                }
            });
            #[cfg(target_os = "linux")]
            configure_linux_webview(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            library_snapshot,
            file_thumbnail,
            create_project,
            rename_project,
            trash_project,
            create_file,
            open_file,
            rename_file,
            star_file,
            move_file,
            duplicate_file,
            trash_file,
            restore_item,
            delete_item,
            save_page,
            save_page_preview,
            load_page,
            create_page,
            rename_page,
            duplicate_page,
            delete_page,
            reorder_pages,
            import_image,
            import_image_data,
            copy_image_to_clipboard,
            read_asset,
            export_package,
            import_package,
            export_render,
            extensions_list,
            extension_stage,
            extension_keep,
            extension_discard,
            extension_set_enabled,
            extension_rollback,
            extension_remove,
            extension_import,
            codex::codex_connect,
            codex::codex_request,
            codex::codex_respond,
            codex::codex_disconnect,
            codex::codex_evolve_exec,
            codex::codex_evolve_cancel,
            codex::codex_ui_state_read,
            codex::codex_ui_state_write,
            codex::codex_attachment_save,
            codex_clipboard_read,
            editor_bridge::editor_bridge_complete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Figmaboy");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_clipboard_image_uses_camel_case_data_url() {
        let value = serde_json::to_value(NativeClipboardContent::Image {
            data_url: "data:image/png;base64,test".into(),
            name: "paste.png".into(),
        })
        .expect("clipboard content should serialize");
        assert_eq!(value["kind"], "image");
        assert_eq!(value["dataUrl"], "data:image/png;base64,test");
        assert!(value.get("data_url").is_none());
    }

    #[test]
    fn new_document_is_empty() {
        let document = empty_document();
        assert_eq!(document["schemaVersion"], 1);
        assert_eq!(document["rootIds"].as_array().unwrap().len(), 0);
        assert_eq!(document["nodes"].as_object().unwrap().len(), 0);
    }

    #[test]
    fn schema_and_revision_guard_work() {
        let connection = initialize_database(Path::new(":memory:")).unwrap();
        let timestamp = now();
        connection
            .execute(
                "INSERT INTO design_files(id, name, created_at, updated_at) VALUES ('file', 'Test', ?1, ?1)",
                [&timestamp],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO pages(id, file_id, name, position, document_json) VALUES ('page', 'file', 'Page 1', 0, ?1)",
                [empty_document().to_string()],
            )
            .unwrap();
        assert_eq!(pages_for_file(&connection, "file").unwrap()[0].revision, 0);
        assert_eq!(page_preview(&connection, "page").unwrap(), None);
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM schema_migrations WHERE version IN (2, 3)",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            2
        );
        for table in [
            "extension_versions",
            "extension_installs",
            "extension_events",
        ] {
            assert_eq!(
                connection
                    .query_row(
                        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                        [table],
                        |row| row.get::<_, i64>(0),
                    )
                    .unwrap(),
                1
            );
        }
    }

    #[test]
    fn library_metadata_omits_thumbnails_and_preview_loading_has_a_size_limit() {
        let connection = initialize_database(Path::new(":memory:")).unwrap();
        let timestamp = now();
        let small = "data:image/jpeg;base64,small";
        let oversized = "x".repeat(MAX_LIBRARY_THUMBNAIL_BYTES + 1);
        for (id, thumbnail) in [("small", small), ("large", oversized.as_str())] {
            connection
                .execute(
                    "INSERT INTO design_files(id, name, created_at, updated_at, thumbnail) VALUES (?1, ?1, ?2, ?2, ?3)",
                    params![id, timestamp, thumbnail],
                )
                .unwrap();
        }

        let snapshot = library_snapshot_from_connection(&connection).unwrap();
        assert!(snapshot.files.iter().all(|file| file.thumbnail.is_none()));
        assert_eq!(
            file_thumbnail_from_connection(&connection, "small").unwrap(),
            Some(small.to_string())
        );
        assert_eq!(
            file_thumbnail_from_connection(&connection, "large").unwrap(),
            None
        );
    }

    #[test]
    fn extension_identity_rejects_unsafe_ids() {
        let valid = json!({
            "format": "figmaboy-extension",
            "apiVersion": 1,
            "id": "local.selection-tools",
            "name": "Selection tools",
            "version": "1.0.0"
        });
        assert_eq!(
            extension_manifest_identity(&valid).unwrap().0,
            "local.selection-tools"
        );
        let invalid = json!({ "format": "figmaboy-extension", "apiVersion": 1, "id": "../../Plugin", "name": "Bad", "version": "1.0.0" });
        assert!(extension_manifest_identity(&invalid).is_err());
    }

    #[test]
    fn existing_databases_gain_per_page_previews() {
        let path = std::env::temp_dir().join(format!(
            "figmaboy-schema-test-{}.sqlite3",
            Uuid::new_v4().simple()
        ));
        let legacy = Connection::open(&path).unwrap();
        legacy
            .execute_batch(
                r#"
                CREATE TABLE pages (
                    id TEXT PRIMARY KEY,
                    file_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    position INTEGER NOT NULL,
                    revision INTEGER NOT NULL DEFAULT 0,
                    document_json TEXT NOT NULL
                );
                "#,
            )
            .unwrap();
        drop(legacy);

        let migrated = initialize_database(&path).unwrap();
        let columns = migrated
            .prepare("PRAGMA table_info(pages)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        assert!(columns.iter().any(|name| name == "preview"));
        assert_eq!(
            migrated
                .query_row(
                    "SELECT COUNT(*) FROM schema_migrations WHERE version = 2",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1
        );
        drop(migrated);
        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(path.with_extension("sqlite3-wal"));
        let _ = fs::remove_file(path.with_extension("sqlite3-shm"));
    }

    #[test]
    fn filenames_are_safe() {
        assert_eq!(safe_filename("../../My: Design"), "______My_ Design");
    }
}
