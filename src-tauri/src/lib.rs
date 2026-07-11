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
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

mod terminal;

type CommandResult<T> = Result<T, String>;

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
fn install_linux_touchpad_zoom(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use gtk::prelude::{EventControllerExt, GestureExt};

    let window = app
        .get_webview_window("main")
        .ok_or("The main webview is unavailable")?;
    let event_window = window.clone();
    window.with_webview(move |platform_webview| {
        let webview = platform_webview.inner();
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
    assets: Vec<PackageAsset>,
}

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
                document_json TEXT NOT NULL
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
            INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, datetime('now'));
            "#,
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

#[tauri::command]
fn library_snapshot(state: State<'_, AppState>) -> CommandResult<LibrarySnapshot> {
    let connection = database(&state)?;
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
            .prepare("SELECT id, project_id, name, starred, created_at, updated_at, last_opened_at, trashed_at, thumbnail FROM design_files ORDER BY updated_at DESC")
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
    let documents: Vec<(PageMeta, Value)> = source_pages
        .into_iter()
        .map(|page| page_document(&connection, &page.id).map(|document| (page, document)))
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
    for (page, document) in documents {
        transaction
            .execute(
                "INSERT INTO pages(id, file_id, name, position, revision, document_json) VALUES (?1, ?2, ?3, ?4, 0, ?5)",
                params![new_id("page"), copy.id, page.name, page.position, document.to_string()],
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
    let mut connection = database(&state)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let changed = transaction
        .execute(
            "UPDATE pages SET document_json = ?1, revision = revision + 1 WHERE id = ?2 AND revision = ?3",
            params![document.to_string(), page_id, expected_revision],
        )
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("REVISION_CONFLICT".into());
    }
    transaction
        .execute(
            "UPDATE design_files SET updated_at = ?1, thumbnail = COALESCE(?2, thumbnail) WHERE id = (SELECT file_id FROM pages WHERE id = ?3)",
            params![now(), thumbnail, page_id],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(expected_revision + 1)
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
    connection
        .execute(
            "INSERT INTO pages(id, file_id, name, position, revision, document_json) VALUES (?1, ?2, ?3, ?4, 0, ?5)",
            params![page.id, page.file_id, page.name, page.position, document.to_string()],
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

#[tauri::command]
fn import_image(
    app: AppHandle,
    state: State<'_, AppState>,
) -> CommandResult<Option<ImportedAsset>> {
    let Some(selection) = app
        .dialog()
        .file()
        .add_filter("Images", &["png", "jpg", "jpeg", "webp"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = picked_path(selection)?;
    let data = fs::read(&path).map_err(|error| format!("Could not read the image: {error}"))?;
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
    database(&state)?
        .execute(
            "INSERT OR IGNORE INTO assets(id, content_hash, mime, data, width, height, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, hash, mime, data, width, height, now()],
        )
        .map_err(|error| error.to_string())?;
    Ok(Some(ImportedAsset {
        id,
        mime: mime.into(),
        data_url: format!("data:{mime};base64,{}", BASE64.encode(data)),
        width,
        height,
    }))
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

#[tauri::command(rename_all = "camelCase")]
fn export_render(
    app: AppHandle,
    name: String,
    extension: String,
    data: String,
) -> CommandResult<bool> {
    if extension != "svg" && extension != "png" {
        return Err("Unsupported export format".into());
    }
    let file_name = format!("{}.{}", safe_filename(&name), extension);
    let Some(selection) = app
        .dialog()
        .file()
        .add_filter(extension.to_uppercase(), &[&extension])
        .set_file_name(&file_name)
        .blocking_save_file()
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
) -> CommandResult<(PackageWorkspace, Vec<(String, Vec<u8>)>)> {
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
    let mut asset_ids = HashSet::new();
    for file in &files {
        for page in pages_for_file(connection, &file.id)? {
            let document = page_document(connection, &page.id)?;
            collect_asset_ids(&document, &mut asset_ids);
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
            assets,
        },
        asset_data,
    ))
}

#[tauri::command]
fn export_package(
    app: AppHandle,
    kind: String,
    id: String,
    state: State<'_, AppState>,
) -> CommandResult<bool> {
    if kind != "project" && kind != "file" {
        return Err("Unsupported package kind".into());
    }
    let connection = database(&state)?;
    let (workspace, assets) = package_workspace(&connection, &kind, &id)?;
    let suggested = workspace
        .projects
        .first()
        .map(|project| project.name.as_str())
        .or_else(|| workspace.files.first().map(|file| file.name.as_str()))
        .unwrap_or("Figmaboy design");
    let Some(selection) = app
        .dialog()
        .file()
        .add_filter("Figmaboy package", &["figmaboy"])
        .set_file_name(&format!("{}.figmaboy", safe_filename(suggested)))
        .blocking_save_file()
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
fn import_package(app: AppHandle, state: State<'_, AppState>) -> CommandResult<bool> {
    let Some(selection) = app
        .dialog()
        .file()
        .add_filter("Figmaboy package", &["figmaboy"])
        .blocking_pick_file()
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
            transaction
                .execute(
                    "INSERT INTO pages(id, file_id, name, position, revision, document_json) VALUES (?1, ?2, ?3, ?4, 0, ?5)",
                    params![new_id("page"), file_id, source_page.name, source_page.position, document.to_string()],
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
            app.manage(terminal::TerminalState::default());
            #[cfg(target_os = "linux")]
            install_linux_touchpad_zoom(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            library_snapshot,
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
            load_page,
            create_page,
            rename_page,
            duplicate_page,
            delete_page,
            reorder_pages,
            import_image,
            read_asset,
            export_package,
            import_package,
            export_render,
            terminal::terminal_start,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_close,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Figmaboy");
}

#[cfg(test)]
mod tests {
    use super::*;

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
    }

    #[test]
    fn filenames_are_safe() {
        assert_eq!(safe_filename("../../My: Design"), "______My_ Design");
    }
}
