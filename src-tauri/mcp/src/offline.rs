use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use directories::BaseDirs;
use rusqlite::{params, Connection, OpenFlags, OptionalExtension, Row};
use serde_json::{json, Map, Value};
use std::{collections::HashSet, path::PathBuf};

#[derive(Clone)]
pub struct OfflineLibrary {
    database_path: PathBuf,
}

pub struct OfflineContext {
    pub value: Value,
    pub preview_data_url: Option<String>,
}

#[derive(Debug, Clone)]
struct FileRecord {
    id: String,
    project_id: Option<String>,
    project_name: Option<String>,
    name: String,
    created_at: String,
    updated_at: String,
    last_opened_at: Option<String>,
    trashed_at: Option<String>,
    thumbnail: Option<String>,
}

#[derive(Debug, Clone)]
struct PageRecord {
    id: String,
    file_id: String,
    name: String,
    position: i64,
    revision: i64,
    document_json: String,
    preview: Option<String>,
}

impl OfflineLibrary {
    pub fn from_env() -> Result<Self, String> {
        let database_path = if let Some(path) = std::env::var_os("FIGMABOY_DB_PATH") {
            PathBuf::from(path)
        } else {
            BaseDirs::new()
                .ok_or_else(|| "Could not locate the user data directory".to_string())?
                .data_local_dir()
                .join("com.miki.figmaboy")
                .join("figmaboy.sqlite3")
        };
        Ok(Self { database_path })
    }

    #[cfg(test)]
    fn new(database_path: PathBuf) -> Self {
        Self { database_path }
    }

    fn connect(&self) -> Result<Connection, String> {
        if !self.database_path.is_file() {
            return Err(format!(
                "No saved Figmaboy workspace was found at {}. Open Figmaboy once to create it, or set FIGMABOY_DB_PATH.",
                self.database_path.display()
            ));
        }
        let connection = Connection::open_with_flags(
            &self.database_path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|error| format!("Could not open the Figmaboy workspace read-only: {error}"))?;
        connection
            .execute_batch("PRAGMA query_only = ON; PRAGMA foreign_keys = ON;")
            .map_err(|error| format!("Could not prepare the Figmaboy workspace: {error}"))?;
        Ok(connection)
    }

    pub async fn list_designs(
        &self,
        query: Option<String>,
        limit: Option<usize>,
        include_trashed: bool,
    ) -> Result<Value, String> {
        let store = self.clone();
        tokio::task::spawn_blocking(move || {
            store.list_designs_sync(query.as_deref(), limit, include_trashed)
        })
        .await
        .map_err(|error| format!("Offline design lookup stopped unexpectedly: {error}"))?
    }

    fn list_designs_sync(
        &self,
        query: Option<&str>,
        limit: Option<usize>,
        include_trashed: bool,
    ) -> Result<Value, String> {
        let connection = self.connect()?;
        let query = query.unwrap_or("").trim();
        let limit = limit.unwrap_or(50).clamp(1, 200) as i64;
        let mut statement = connection
            .prepare(
                r#"
                SELECT f.id, f.project_id, p.name, f.name, f.created_at, f.updated_at,
                       f.last_opened_at, f.trashed_at, f.thumbnail,
                       (SELECT COUNT(*) FROM pages page WHERE page.file_id = f.id)
                FROM design_files f
                LEFT JOIN projects p ON p.id = f.project_id
                WHERE (?1 = 1 OR f.trashed_at IS NULL)
                  AND (?2 = '' OR lower(f.name) LIKE '%' || lower(?2) || '%'
                       OR lower(COALESCE(p.name, '')) LIKE '%' || lower(?2) || '%')
                ORDER BY f.updated_at DESC
                LIMIT ?3
                "#,
            )
            .map_err(|error| error.to_string())?;
        let designs = statement
            .query_map(params![include_trashed as i64, query, limit], |row| {
                let file = file_from_row(row)?;
                let page_count: i64 = row.get(9)?;
                Ok(file_json(&file, Some(page_count)))
            })
            .map_err(|error| error.to_string())?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|error| error.to_string())?;
        Ok(json!({
            "source": "saved",
            "readOnly": true,
            "designs": designs,
            "lookup": "Pass fileId to design_context_get for an exact match, or fileName for convenience."
        }))
    }

    pub async fn design_context(
        &self,
        file_id: Option<String>,
        file_name: Option<String>,
        page_id: Option<String>,
        page_name: Option<String>,
    ) -> Result<OfflineContext, String> {
        let store = self.clone();
        tokio::task::spawn_blocking(move || {
            store.design_context_sync(
                file_id.as_deref(),
                file_name.as_deref(),
                page_id.as_deref(),
                page_name.as_deref(),
            )
        })
        .await
        .map_err(|error| format!("Offline design lookup stopped unexpectedly: {error}"))?
    }

    fn design_context_sync(
        &self,
        file_id: Option<&str>,
        file_name: Option<&str>,
        page_id: Option<&str>,
        page_name: Option<&str>,
    ) -> Result<OfflineContext, String> {
        if file_id.is_some() == file_name.is_some() {
            return Err("Provide exactly one of fileId or fileName".into());
        }
        if page_id.is_some() && page_name.is_some() {
            return Err("Provide pageId or pageName, not both".into());
        }

        let connection = self.connect()?;
        let file = resolve_file(&connection, file_id, file_name)?;
        let has_preview = table_has_column(&connection, "pages", "preview")?;
        let pages = load_pages(&connection, &file.id, has_preview)?;
        let page = resolve_page(&pages, page_id, page_name)?;
        let document: Value = serde_json::from_str(&page.document_json)
            .map_err(|error| format!("The saved page data is damaged: {error}"))?;
        let preview = page.preview.clone().or_else(|| file.thumbnail.clone());
        let preview_source = if page.preview.is_some() {
            Some("page")
        } else if file.thumbnail.is_some() {
            Some("legacy_file_thumbnail")
        } else {
            None
        };
        let assets = load_asset_metadata(&connection, &document)?;
        let page_summaries = pages.iter().map(page_json).collect::<Vec<_>>();

        Ok(OfflineContext {
            value: json!({
                "source": "saved",
                "readOnly": true,
                "file": file_json(&file, Some(pages.len() as i64)),
                "page": page_json(page),
                "pages": page_summaries,
                "layerTree": layer_tree(&document),
                "document": document,
                "assets": assets,
                "preview": {
                    "available": preview.is_some(),
                    "source": preview_source,
                    "note": if preview_source == Some("legacy_file_thumbnail") {
                        Some("This design predates per-page previews; open and save this page in Figmaboy to refresh it.")
                    } else {
                        None
                    }
                }
            }),
            preview_data_url: preview,
        })
    }
}

fn file_from_row(row: &Row<'_>) -> rusqlite::Result<FileRecord> {
    Ok(FileRecord {
        id: row.get(0)?,
        project_id: row.get(1)?,
        project_name: row.get(2)?,
        name: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
        last_opened_at: row.get(6)?,
        trashed_at: row.get(7)?,
        thumbnail: row.get(8)?,
    })
}

fn file_json(file: &FileRecord, page_count: Option<i64>) -> Value {
    json!({
        "id": file.id,
        "name": file.name,
        "projectId": file.project_id,
        "projectName": file.project_name,
        "createdAt": file.created_at,
        "updatedAt": file.updated_at,
        "lastOpenedAt": file.last_opened_at,
        "trashed": file.trashed_at.is_some(),
        "pageCount": page_count,
    })
}

fn resolve_file(
    connection: &Connection,
    file_id: Option<&str>,
    file_name: Option<&str>,
) -> Result<FileRecord, String> {
    if let Some(file_id) = file_id {
        return connection
            .query_row(
                r#"
                SELECT f.id, f.project_id, p.name, f.name, f.created_at, f.updated_at,
                       f.last_opened_at, f.trashed_at, f.thumbnail
                FROM design_files f LEFT JOIN projects p ON p.id = f.project_id
                WHERE f.id = ?1 AND f.trashed_at IS NULL
                "#,
                [file_id],
                file_from_row,
            )
            .optional()
            .map_err(|error| error.to_string())?
            .ok_or_else(|| format!("No active design has fileId {file_id}"));
    }

    let file_name = file_name.unwrap_or_default().trim();
    if file_name.is_empty() {
        return Err("fileName cannot be empty".into());
    }
    let mut statement = connection
        .prepare(
            r#"
            SELECT f.id, f.project_id, p.name, f.name, f.created_at, f.updated_at,
                   f.last_opened_at, f.trashed_at, f.thumbnail
            FROM design_files f LEFT JOIN projects p ON p.id = f.project_id
            WHERE lower(f.name) = lower(?1) AND f.trashed_at IS NULL
            ORDER BY f.updated_at DESC
            "#,
        )
        .map_err(|error| error.to_string())?;
    let matches = statement
        .query_map([file_name], file_from_row)
        .map_err(|error| error.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| error.to_string())?;
    match matches.as_slice() {
        [] => Err(format!(
            "No active design is named \"{file_name}\". Call designs_list to search saved designs."
        )),
        [file] => Ok(file.clone()),
        files => {
            let candidates = files
                .iter()
                .map(|file| {
                    format!(
                        "{} ({})",
                        file.id,
                        file.project_name.as_deref().unwrap_or("Drafts")
                    )
                })
                .collect::<Vec<_>>()
                .join(", ");
            Err(format!(
                "Multiple active designs are named \"{file_name}\". Retry with fileId. Candidates: {candidates}"
            ))
        }
    }
}

fn table_has_column(connection: &Connection, table: &str, column: &str) -> Result<bool, String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|error| error.to_string())?;
    let names = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| error.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| error.to_string())?;
    Ok(names.iter().any(|name| name == column))
}

fn load_pages(
    connection: &Connection,
    file_id: &str,
    has_preview: bool,
) -> Result<Vec<PageRecord>, String> {
    let preview_column = if has_preview { "preview" } else { "NULL" };
    let sql = format!(
        "SELECT id, file_id, name, position, revision, document_json, {preview_column} FROM pages WHERE file_id = ?1 ORDER BY position"
    );
    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| error.to_string())?;
    let pages = statement
        .query_map([file_id], |row| {
            Ok(PageRecord {
                id: row.get(0)?,
                file_id: row.get(1)?,
                name: row.get(2)?,
                position: row.get(3)?,
                revision: row.get(4)?,
                document_json: row.get(5)?,
                preview: row.get(6)?,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| error.to_string())?;
    Ok(pages)
}

fn resolve_page<'a>(
    pages: &'a [PageRecord],
    page_id: Option<&str>,
    page_name: Option<&str>,
) -> Result<&'a PageRecord, String> {
    if pages.is_empty() {
        return Err("The design contains no pages".into());
    }
    if let Some(page_id) = page_id {
        return pages
            .iter()
            .find(|page| page.id == page_id)
            .ok_or_else(|| format!("The design has no page with pageId {page_id}"));
    }
    if let Some(page_name) = page_name {
        let matches = pages
            .iter()
            .filter(|page| page.name.eq_ignore_ascii_case(page_name.trim()))
            .collect::<Vec<_>>();
        return match matches.as_slice() {
            [] => Err(format!("The design has no page named \"{page_name}\"")),
            [page] => Ok(*page),
            _ => Err(format!(
                "Multiple pages are named \"{page_name}\". Retry with pageId."
            )),
        };
    }
    Ok(&pages[0])
}

fn page_json(page: &PageRecord) -> Value {
    json!({
        "id": page.id,
        "fileId": page.file_id,
        "name": page.name,
        "position": page.position,
        "revision": page.revision,
    })
}

fn layer_tree(document: &Value) -> Vec<Value> {
    let Some(nodes) = document.get("nodes").and_then(Value::as_object) else {
        return Vec::new();
    };
    let Some(root_ids) = document.get("rootIds").and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut path = HashSet::new();
    root_ids
        .iter()
        .filter_map(Value::as_str)
        .filter_map(|id| layer_summary(id, nodes, &mut path))
        .collect()
}

fn layer_summary(
    id: &str,
    nodes: &Map<String, Value>,
    path: &mut HashSet<String>,
) -> Option<Value> {
    let node = nodes.get(id)?.as_object()?;
    if !path.insert(id.to_string()) {
        return Some(json!({ "id": id, "cycle": true }));
    }
    let mut summary = Map::new();
    for key in [
        "id", "name", "type", "x", "y", "width", "height", "rotation", "visible", "opacity",
    ] {
        if let Some(value) = node.get(key) {
            summary.insert(key.to_string(), value.clone());
        }
    }
    if let Some(text) = node.get("text") {
        summary.insert("text".into(), text.clone());
    }
    if let Some(children) = node.get("childIds").and_then(Value::as_array) {
        let children = children
            .iter()
            .filter_map(Value::as_str)
            .filter_map(|child_id| layer_summary(child_id, nodes, path))
            .collect::<Vec<_>>();
        summary.insert("children".into(), Value::Array(children));
    }
    path.remove(id);
    Some(Value::Object(summary))
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

fn load_asset_metadata(connection: &Connection, document: &Value) -> Result<Vec<Value>, String> {
    let mut ids = HashSet::new();
    collect_asset_ids(document, &mut ids);
    let mut statement = connection
        .prepare("SELECT mime, width, height FROM assets WHERE id = ?1")
        .map_err(|error| error.to_string())?;
    let mut assets = Vec::new();
    for id in ids {
        let metadata: Option<(String, u32, u32)> = statement
            .query_row([&id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .optional()
            .map_err(|error| error.to_string())?;
        if let Some((mime_type, width, height)) = metadata {
            assets
                .push(json!({ "id": id, "mimeType": mime_type, "width": width, "height": height }));
        }
    }
    assets.sort_by(|left, right| left["id"].as_str().cmp(&right["id"].as_str()));
    Ok(assets)
}

pub fn preview_image(data_url: &str) -> Result<(String, String, u32, u32), String> {
    if data_url.len() > 24 * 1024 * 1024 {
        return Err("The saved preview is too large to return as MCP context".into());
    }
    let (header, encoded) = data_url
        .split_once(',')
        .ok_or_else(|| "The saved preview is not a valid data URL".to_string())?;
    let mime_type = header
        .strip_prefix("data:")
        .and_then(|value| value.strip_suffix(";base64"))
        .ok_or_else(|| "The saved preview must be base64 encoded".to_string())?;
    let bytes = BASE64
        .decode(encoded)
        .map_err(|_| "The saved preview is not valid base64".to_string())?;

    if matches!(mime_type, "image/png" | "image/jpeg" | "image/webp") {
        let image = image_size_from_raster(&bytes, mime_type)?;
        return Ok((encoded.to_string(), mime_type.to_string(), image.0, image.1));
    }
    if mime_type != "image/svg+xml" {
        return Err(format!("Unsupported saved preview type: {mime_type}"));
    }

    let mut options = resvg::usvg::Options::default();
    options.fontdb_mut().load_system_fonts();
    let tree = resvg::usvg::Tree::from_data(&bytes, &options)
        .map_err(|error| format!("Could not parse the saved SVG preview: {error}"))?;
    let source = tree.size();
    let largest = source.width().max(source.height()).max(1.0);
    let scale = (1600.0 / largest).min(1.0);
    let width = (source.width() * scale).ceil().max(1.0) as u32;
    let height = (source.height() * scale).ceil().max(1.0) as u32;
    let mut pixmap = resvg::tiny_skia::Pixmap::new(width, height)
        .ok_or_else(|| "Could not allocate the saved preview image".to_string())?;
    resvg::render(
        &tree,
        resvg::tiny_skia::Transform::from_scale(scale, scale),
        &mut pixmap.as_mut(),
    );
    let png = pixmap
        .encode_png()
        .map_err(|error| format!("Could not encode the saved preview: {error}"))?;
    Ok((BASE64.encode(png), "image/png".into(), width, height))
}

fn image_size_from_raster(bytes: &[u8], mime_type: &str) -> Result<(u32, u32), String> {
    match mime_type {
        "image/png" if bytes.len() >= 24 && &bytes[..8] == b"\x89PNG\r\n\x1a\n" => Ok((
            u32::from_be_bytes(bytes[16..20].try_into().unwrap()),
            u32::from_be_bytes(bytes[20..24].try_into().unwrap()),
        )),
        _ => Ok((0, 0)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn fixture() -> (TempDir, OfflineLibrary) {
        let directory = TempDir::new().unwrap();
        let path = directory.path().join("figmaboy.sqlite3");
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                r#"
                CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, created_at TEXT, updated_at TEXT, trashed_at TEXT);
                CREATE TABLE design_files (
                    id TEXT PRIMARY KEY, project_id TEXT, name TEXT, starred INTEGER DEFAULT 0,
                    created_at TEXT, updated_at TEXT, last_opened_at TEXT, trashed_at TEXT, thumbnail TEXT
                );
                CREATE TABLE pages (
                    id TEXT PRIMARY KEY, file_id TEXT, name TEXT, position INTEGER,
                    revision INTEGER DEFAULT 0, document_json TEXT, preview TEXT
                );
                CREATE TABLE assets (id TEXT PRIMARY KEY, mime TEXT, width INTEGER, height INTEGER);
                INSERT INTO projects VALUES ('project_a', 'Website', '2026-01-01', '2026-01-01', NULL);
                INSERT INTO design_files VALUES ('file_a', 'project_a', 'Landing Page', 0, '2026-01-01', '2026-01-02', NULL, NULL, NULL);
                INSERT INTO pages VALUES (
                    'page_a', 'file_a', 'Home', 0, 3,
                    '{"schemaVersion":1,"rootIds":["frame_a"],"nodes":{"frame_a":{"id":"frame_a","name":"Desktop","type":"frame","x":0,"y":0,"width":1440,"height":900,"rotation":0,"visible":true,"opacity":1,"childIds":["text_a"]},"text_a":{"id":"text_a","name":"Headline","type":"text","text":"Hello","x":40,"y":40,"width":400,"height":60,"rotation":0,"visible":true,"opacity":1}}}',
                    'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iNTAiPjxyZWN0IHdpZHRoPSIxMDAiIGhlaWdodD0iNTAiIGZpbGw9IiMwZDk5ZmYiLz48L3N2Zz4='
                );
                "#,
            )
            .unwrap();
        drop(connection);
        let store = OfflineLibrary::new(path);
        (directory, store)
    }

    #[tokio::test]
    async fn lists_copyable_design_ids_and_resolves_names() {
        let (_directory, store) = fixture();
        let listed = store
            .list_designs(Some("landing".into()), None, false)
            .await
            .unwrap();
        assert_eq!(listed["designs"][0]["id"], "file_a");

        let context = store
            .design_context(None, Some("Landing Page".into()), None, Some("Home".into()))
            .await
            .unwrap();
        assert_eq!(context.value["file"]["id"], "file_a");
        assert_eq!(context.value["page"]["revision"], 3);
        assert_eq!(
            context.value["layerTree"][0]["children"][0]["text"],
            "Hello"
        );
        assert!(context.preview_data_url.is_some());
    }

    #[tokio::test]
    async fn resolves_an_exact_file_id() {
        let (_directory, store) = fixture();
        let context = store
            .design_context(Some("file_a".into()), None, None, None)
            .await
            .unwrap();
        assert_eq!(context.value["page"]["name"], "Home");
    }

    #[tokio::test]
    async fn requires_an_id_when_names_are_ambiguous() {
        let (_directory, store) = fixture();
        let connection = Connection::open(&store.database_path).unwrap();
        connection
            .execute(
                "INSERT INTO design_files VALUES ('file_b', NULL, 'Landing Page', 0, '2026-01-01', '2026-01-03', NULL, NULL, NULL)",
                [],
            )
            .unwrap();
        drop(connection);

        let error = store
            .design_context(None, Some("Landing Page".into()), None, None)
            .await
            .err()
            .unwrap();
        assert!(error.contains("Retry with fileId"));
        assert!(error.contains("file_a"));
        assert!(error.contains("file_b"));
    }

    #[test]
    fn converts_saved_svg_previews_to_png() {
        let preview = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iNTAiPjxyZWN0IHdpZHRoPSIxMDAiIGhlaWdodD0iNTAiIGZpbGw9IiMwZDk5ZmYiLz48L3N2Zz4=";
        let (encoded, mime_type, width, height) = preview_image(preview).unwrap();
        let png = BASE64.decode(encoded).unwrap();
        assert_eq!(mime_type, "image/png");
        assert_eq!((width, height), (100, 50));
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
    }
}
