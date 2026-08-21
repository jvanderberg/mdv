use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    env,
    ffi::OsString,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu},
    AppHandle, Emitter, Manager, State, Theme, WebviewUrl, WebviewWindowBuilder,
};
use thiserror::Error;

#[derive(Debug, Error)]
enum MdvError {
    #[error("{0}")]
    Io(String),
    #[error("{0}")]
    Db(String),
    #[error("{0}")]
    App(String),
}

impl serde::Serialize for MdvError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeBookmarkSlotState {
    title: String,
    enabled: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeMenuState {
    has_document: bool,
    has_editor: bool,
    can_go_back: bool,
    can_go_forward: bool,
    sidebar_visible: bool,
    smart_typography: bool,
    smart_typography_allowed: bool,
    load_remote_images: bool,
    bookmark_slots: Vec<NativeBookmarkSlotState>,
}

impl From<std::io::Error> for MdvError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value.to_string())
    }
}

impl From<rusqlite::Error> for MdvError {
    fn from(value: rusqlite::Error) -> Self {
        Self::Db(value.to_string())
    }
}

impl From<tauri::Error> for MdvError {
    fn from(value: tauri::Error) -> Self {
        Self::App(value.to_string())
    }
}

type MdvResult<T> = Result<T, MdvError>;
const SUPPORTED_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd", "txt"];
const HELP_DOCUMENT: &str = include_str!("../resources/Help.md");
const STORE_OPEN_FLAGS: OpenFlags = OpenFlags::SQLITE_OPEN_READ_WRITE
    .union(OpenFlags::SQLITE_OPEN_CREATE)
    .union(OpenFlags::SQLITE_OPEN_FULL_MUTEX);

pub struct AppState {
    db: Mutex<Store>,
    pending_open_paths: Mutex<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HistoryEntry {
    pub path: String,
    pub filename: String,
    pub added_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Bookmark {
    pub id: i64,
    pub path: String,
    pub title: String,
    pub sort_order: i64,
    pub created_at: i64,
    pub block_index: i64,
    pub block_fingerprint: String,
    pub file_exists: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SearchHit {
    pub path: String,
    pub filename: String,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LoadedDocument {
    pub path: String,
    pub filename: String,
    pub content: String,
    pub file_mtime_ms: i64,
    pub file_size: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FileSignature {
    pub path: String,
    pub file_mtime_ms: i64,
    pub file_size: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ScrollPosition {
    pub path: String,
    pub block_index: i64,
    pub block_fingerprint: String,
    pub scroll_top: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ResolvedLocalImage {
    pub path: String,
    pub exists: bool,
}

struct Store {
    conn: Connection,
}

impl Store {
    fn open(path: impl AsRef<Path>) -> MdvResult<Self> {
        if let Some(parent) = path.as_ref().parent() {
            fs::create_dir_all(parent)?;
        }
        let conn = Connection::open_with_flags(path, STORE_OPEN_FLAGS)?;
        let store = Self { conn };
        store.migrate()?;
        Ok(store)
    }

    fn open_in_memory() -> MdvResult<Self> {
        let store = Self {
            conn: Connection::open_in_memory()?,
        };
        store.migrate()?;
        Ok(store)
    }

    fn migrate(&self) -> MdvResult<()> {
        self.conn.execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;

            CREATE TABLE IF NOT EXISTS history (
                path TEXT PRIMARY KEY NOT NULL,
                filename TEXT NOT NULL,
                added_at INTEGER NOT NULL,
                content TEXT NOT NULL DEFAULT '',
                indexed_at INTEGER NOT NULL DEFAULT 0,
                file_mtime INTEGER NOT NULL DEFAULT 0,
                file_size INTEGER NOT NULL DEFAULT 0
            );

            CREATE VIRTUAL TABLE IF NOT EXISTS history_fts USING fts5(
                filename,
                content,
                path UNINDEXED,
                content='history',
                content_rowid='rowid',
                tokenize='unicode61 remove_diacritics 2'
            );

            CREATE TRIGGER IF NOT EXISTS history_ai AFTER INSERT ON history BEGIN
                INSERT INTO history_fts(rowid, filename, content, path)
                VALUES (new.rowid, new.filename, new.content, new.path);
            END;

            CREATE TRIGGER IF NOT EXISTS history_ad AFTER DELETE ON history BEGIN
                INSERT INTO history_fts(history_fts, rowid, filename, content, path)
                VALUES ('delete', old.rowid, old.filename, old.content, old.path);
            END;

            CREATE TRIGGER IF NOT EXISTS history_au AFTER UPDATE ON history BEGIN
                INSERT INTO history_fts(history_fts, rowid, filename, content, path)
                VALUES ('delete', old.rowid, old.filename, old.content, old.path);
                INSERT INTO history_fts(rowid, filename, content, path)
                VALUES (new.rowid, new.filename, new.content, new.path);
            END;

            CREATE TABLE IF NOT EXISTS bookmarks (
                id INTEGER PRIMARY KEY,
                path TEXT NOT NULL,
                title TEXT NOT NULL,
                sort_order INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                block_index INTEGER NOT NULL DEFAULT 0,
                block_fingerprint TEXT NOT NULL DEFAULT ''
            );

            CREATE INDEX IF NOT EXISTS bookmarks_sort ON bookmarks(sort_order, created_at);

            CREATE TABLE IF NOT EXISTS scroll_positions (
                path TEXT PRIMARY KEY NOT NULL,
                block_index INTEGER NOT NULL,
                block_fingerprint TEXT NOT NULL,
                scroll_top INTEGER NOT NULL,
                file_mtime INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            "#,
        )?;
        Ok(())
    }

    fn add_history(&self, path: &Path, content: &str) -> MdvResult<HistoryEntry> {
        let now = now_secs();
        let filename = filename(path);
        let metadata = fs::metadata(path).ok();
        let modified = metadata
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let size = metadata.map(|m| m.len() as i64).unwrap_or(content.len() as i64);

        self.conn.execute(
            r#"
            INSERT INTO history(path, filename, added_at, content, indexed_at, file_mtime, file_size)
            VALUES (?1, ?2, ?3, ?4, ?3, ?5, ?6)
            ON CONFLICT(path) DO UPDATE SET
                filename = excluded.filename,
                added_at = excluded.added_at,
                content = excluded.content,
                indexed_at = excluded.indexed_at,
                file_mtime = excluded.file_mtime,
                file_size = excluded.file_size
            "#,
            params![path.to_string_lossy(), filename, now, content, modified, size],
        )?;

        Ok(HistoryEntry {
            path: path.to_string_lossy().into_owned(),
            filename,
            added_at: now,
        })
    }

    fn list_history(&self) -> MdvResult<Vec<HistoryEntry>> {
        let mut stmt = self.conn.prepare(
            "SELECT path, filename, added_at FROM history ORDER BY added_at DESC, rowid DESC LIMIT 100",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(HistoryEntry {
                path: row.get(0)?,
                filename: row.get(1)?,
                added_at: row.get(2)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    fn remove_history(&self, path: &str) -> MdvResult<()> {
        self.conn.execute("DELETE FROM history WHERE path = ?1", [path])?;
        self.conn
            .execute("DELETE FROM scroll_positions WHERE path = ?1", [path])?;
        Ok(())
    }

    fn clear_history(&self) -> MdvResult<()> {
        self.conn.execute("DELETE FROM history", [])?;
        self.conn.execute("DELETE FROM scroll_positions", [])?;
        Ok(())
    }

    fn search_history(&self, query: &str) -> MdvResult<Vec<SearchHit>> {
        let query = query.trim();
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let fts_query = make_fts_query(query);
        if fts_query.is_empty() {
            return Ok(Vec::new());
        }
        let mut stmt = self.conn.prepare(
            r#"
            SELECT path, filename, snippet(history_fts, 1, char(2), char(3), '…', 14)
            FROM history_fts
            WHERE history_fts MATCH ?1
            ORDER BY rank
            LIMIT 80
            "#,
        )?;
        let rows = stmt.query_map([fts_query], |row| {
            Ok(SearchHit {
                path: row.get(0)?,
                filename: row.get(1)?,
                snippet: row.get(2)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    fn add_bookmark(
        &self,
        path: &str,
        title: &str,
        block_index: i64,
        block_fingerprint: &str,
    ) -> MdvResult<Bookmark> {
        let next_order = self
            .conn
            .query_row(
                "SELECT COALESCE(MAX(sort_order) + 1, 0) FROM bookmarks",
                [],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .unwrap_or(0);
        let now = now_secs();
        self.conn.execute(
            r#"
            INSERT INTO bookmarks(path, title, sort_order, created_at, block_index, block_fingerprint)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            "#,
            params![path, title, next_order, now, block_index, block_fingerprint],
        )?;
        let id = self.conn.last_insert_rowid();
        Ok(Bookmark {
            id,
            path: path.to_string(),
            title: title.to_string(),
            sort_order: next_order,
            created_at: now,
            block_index,
            block_fingerprint: block_fingerprint.to_string(),
            file_exists: Path::new(path).exists(),
        })
    }

    fn list_bookmarks(&self) -> MdvResult<Vec<Bookmark>> {
        let mut stmt = self.conn.prepare(
            r#"
            SELECT id, path, title, sort_order, created_at, block_index, block_fingerprint
            FROM bookmarks
            ORDER BY sort_order, created_at
            "#,
        )?;
        let rows = stmt.query_map([], |row| {
            let path: String = row.get(1)?;
            Ok(Bookmark {
                id: row.get(0)?,
                file_exists: Path::new(&path).exists(),
                path,
                title: row.get(2)?,
                sort_order: row.get(3)?,
                created_at: row.get(4)?,
                block_index: row.get(5)?,
                block_fingerprint: row.get(6)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    fn remove_bookmark(&self, id: i64) -> MdvResult<()> {
        self.conn.execute("DELETE FROM bookmarks WHERE id = ?1", [id])?;
        self.renormalize_bookmark_order()
    }

    fn reorder_bookmarks(&self, ids: Vec<i64>) -> MdvResult<Vec<Bookmark>> {
        let existing = {
            let mut stmt = self
                .conn
                .prepare("SELECT id FROM bookmarks ORDER BY sort_order, created_at")?;
            let rows = stmt.query_map([], |row| row.get::<_, i64>(0))?;
            rows.collect::<Result<Vec<_>, _>>()?
        };
        let mut expected = existing.clone();
        let mut received = ids.clone();
        expected.sort_unstable();
        received.sort_unstable();
        if expected != received {
            return Err(MdvError::App("bookmark reorder ids do not match current bookmarks".into()));
        }

        for (sort_order, id) in ids.into_iter().enumerate() {
            self.conn.execute(
                "UPDATE bookmarks SET sort_order = ?1 WHERE id = ?2",
                params![sort_order as i64, id],
            )?;
        }
        self.list_bookmarks()
    }

    fn save_scroll_position(
        &self,
        path: &str,
        block_index: i64,
        block_fingerprint: &str,
        scroll_top: i64,
    ) -> MdvResult<()> {
        let file_mtime = file_mtime_secs(Path::new(path));
        let now = now_secs();
        self.conn.execute(
            r#"
            INSERT INTO scroll_positions(
                path,
                block_index,
                block_fingerprint,
                scroll_top,
                file_mtime,
                updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(path) DO UPDATE SET
                block_index = excluded.block_index,
                block_fingerprint = excluded.block_fingerprint,
                scroll_top = excluded.scroll_top,
                file_mtime = excluded.file_mtime,
                updated_at = excluded.updated_at
            "#,
            params![path, block_index, block_fingerprint, scroll_top, file_mtime, now],
        )?;
        Ok(())
    }

    fn load_scroll_position(&self, path: &str) -> MdvResult<Option<ScrollPosition>> {
        let saved = self
            .conn
            .query_row(
                r#"
                SELECT path, block_index, block_fingerprint, scroll_top, file_mtime
                FROM scroll_positions
                WHERE path = ?1
                "#,
                [path],
                |row| {
                    Ok((
                        ScrollPosition {
                            path: row.get(0)?,
                            block_index: row.get(1)?,
                            block_fingerprint: row.get(2)?,
                            scroll_top: row.get(3)?,
                        },
                        row.get::<_, i64>(4)?,
                    ))
                },
            )
            .optional()?;
        let Some((position, file_mtime)) = saved else {
            return Ok(None);
        };
        if file_mtime != file_mtime_secs(Path::new(path)) {
            return Ok(None);
        }
        Ok(Some(position))
    }

    fn renormalize_bookmark_order(&self) -> MdvResult<()> {
        let ids = {
            let mut stmt = self
                .conn
                .prepare("SELECT id FROM bookmarks ORDER BY sort_order, created_at")?;
            let rows = stmt.query_map([], |row| row.get::<_, i64>(0))?;
            rows.collect::<Result<Vec<_>, _>>()?
        };

        for (sort_order, id) in ids.into_iter().enumerate() {
            self.conn.execute(
                "UPDATE bookmarks SET sort_order = ?1 WHERE id = ?2",
                params![sort_order as i64, id],
            )?;
        }
        Ok(())
    }
}

#[tauri::command]
fn load_markdown(
    app: AppHandle,
    path: String,
    state: State<'_, AppState>,
) -> MdvResult<LoadedDocument> {
    let path_buf = PathBuf::from(path);
    let document_set = resolve_markdown_selection(&path_buf)?;
    let content = fs::read_to_string(&document_set.primary)?;
    let store = state.db.lock().map_err(|_| MdvError::App("database lock poisoned".into()))?;
    for sibling in document_set.siblings.iter().rev() {
        if let Ok(sibling_content) = fs::read_to_string(sibling) {
            store.add_history(sibling, &sibling_content)?;
        }
    }
    store.add_history(&document_set.primary, &content)?;
    emit_shared_state_changed(&app, "history");
    let signature = file_signature_for_path(&document_set.primary)?;
    Ok(LoadedDocument {
        path: document_set.primary.to_string_lossy().into_owned(),
        filename: filename(&document_set.primary),
        content,
        file_mtime_ms: signature.file_mtime_ms,
        file_size: signature.file_size,
    })
}

#[tauri::command]
fn file_signature(path: String) -> MdvResult<FileSignature> {
    file_signature_for_path(Path::new(&path))
}

#[tauri::command]
fn open_new_window(app: AppHandle, path: String) -> MdvResult<()> {
    let path = validate_open_target(Path::new(&path))?;
    let filename = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("mdv")
        .to_string();
    let label = format!("mdv-window-{}", now_millis());
    let url = format!(
        "index.html?mdvOpenPath={}",
        percent_encode_component(&path.to_string_lossy())
    );
    let window = WebviewWindowBuilder::new(&app, label, WebviewUrl::App(url.into()))
        .title(filename)
        .inner_size(1080.0, 720.0)
        .min_inner_size(760.0, 520.0)
        .build()
        .map_err(|error| MdvError::App(error.to_string()))?;
    window
        .set_theme(Some(Theme::Light))
        .map_err(|error| MdvError::App(error.to_string()))?;
    Ok(())
}

#[tauri::command]
fn resolve_local_image(document_path: String, src: String) -> MdvResult<ResolvedLocalImage> {
    if has_external_scheme(&src) && !src.starts_with("file://") {
        return Err(MdvError::App(format!("Unsupported local image URL: {src}")));
    }
    let raw_path = if src.starts_with("file://") {
        PathBuf::from(src.trim_start_matches("file://"))
    } else {
        PathBuf::from(percent_decode_path(&src))
    };
    let path = if raw_path.is_absolute() {
        raw_path
    } else {
        PathBuf::from(document_path)
            .parent()
            .unwrap_or_else(|| Path::new("/"))
            .join(raw_path)
    };
    let normalized = path.components().collect::<PathBuf>();
    Ok(ResolvedLocalImage {
        exists: normalized.is_file(),
        path: normalized.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
fn list_history(state: State<'_, AppState>) -> MdvResult<Vec<HistoryEntry>> {
    state
        .db
        .lock()
        .map_err(|_| MdvError::App("database lock poisoned".into()))?
        .list_history()
}

#[tauri::command]
fn remove_history(app: AppHandle, path: String, state: State<'_, AppState>) -> MdvResult<()> {
    state
        .db
        .lock()
        .map_err(|_| MdvError::App("database lock poisoned".into()))?
        .remove_history(&path)?;
    emit_shared_state_changed(&app, "history");
    Ok(())
}

#[tauri::command]
fn clear_history(app: AppHandle, state: State<'_, AppState>) -> MdvResult<()> {
    state
        .db
        .lock()
        .map_err(|_| MdvError::App("database lock poisoned".into()))?
        .clear_history()?;
    emit_shared_state_changed(&app, "history");
    Ok(())
}

#[tauri::command]
fn search_history(query: String, state: State<'_, AppState>) -> MdvResult<Vec<SearchHit>> {
    state
        .db
        .lock()
        .map_err(|_| MdvError::App("database lock poisoned".into()))?
        .search_history(&query)
}

#[tauri::command]
fn add_bookmark(
    app: AppHandle,
    path: String,
    title: String,
    block_index: i64,
    block_fingerprint: String,
    state: State<'_, AppState>,
) -> MdvResult<Bookmark> {
    let bookmark = state
        .db
        .lock()
        .map_err(|_| MdvError::App("database lock poisoned".into()))?
        .add_bookmark(&path, &title, block_index, &block_fingerprint)?;
    emit_shared_state_changed(&app, "bookmarks");
    Ok(bookmark)
}

#[tauri::command]
fn list_bookmarks(state: State<'_, AppState>) -> MdvResult<Vec<Bookmark>> {
    state
        .db
        .lock()
        .map_err(|_| MdvError::App("database lock poisoned".into()))?
        .list_bookmarks()
}

#[tauri::command]
fn remove_bookmark(app: AppHandle, id: i64, state: State<'_, AppState>) -> MdvResult<()> {
    state
        .db
        .lock()
        .map_err(|_| MdvError::App("database lock poisoned".into()))?
        .remove_bookmark(id)?;
    emit_shared_state_changed(&app, "bookmarks");
    Ok(())
}

#[tauri::command]
fn reorder_bookmarks(
    app: AppHandle,
    ids: Vec<i64>,
    state: State<'_, AppState>,
) -> MdvResult<Vec<Bookmark>> {
    let bookmarks = state
        .db
        .lock()
        .map_err(|_| MdvError::App("database lock poisoned".into()))?
        .reorder_bookmarks(ids)?;
    emit_shared_state_changed(&app, "bookmarks");
    Ok(bookmarks)
}

#[tauri::command]
fn save_scroll_position(
    path: String,
    block_index: i64,
    block_fingerprint: String,
    scroll_top: i64,
    state: State<'_, AppState>,
) -> MdvResult<()> {
    state
        .db
        .lock()
        .map_err(|_| MdvError::App("database lock poisoned".into()))?
        .save_scroll_position(&path, block_index, &block_fingerprint, scroll_top)
}

#[tauri::command]
fn load_scroll_position(
    path: String,
    state: State<'_, AppState>,
) -> MdvResult<Option<ScrollPosition>> {
    state
        .db
        .lock()
        .map_err(|_| MdvError::App("database lock poisoned".into()))?
        .load_scroll_position(&path)
}

#[tauri::command]
fn take_pending_open_paths(state: State<'_, AppState>) -> MdvResult<Vec<String>> {
    let mut paths = state
        .pending_open_paths
        .lock()
        .map_err(|_| MdvError::App("pending open path lock poisoned".into()))?;
    Ok(paths.drain(..).collect())
}

#[tauri::command]
fn open_in_editor(editor_path: String, document_path: String) -> MdvResult<()> {
    if !Path::new(&editor_path).exists() {
        return Err(MdvError::App(format!("Editor not found: {editor_path}")));
    }
    if !Path::new(&document_path).is_file() {
        return Err(MdvError::App(format!("Document not found: {document_path}")));
    }

    Command::new(editor_path)
        .arg(document_path)
        .spawn()
        .map_err(|error| MdvError::App(error.to_string()))?;
    Ok(())
}

fn app_db_path(app: &AppHandle) -> MdvResult<PathBuf> {
    if let Ok(path) = env::var("MDV_TAURI_DB_PATH") {
        return Ok(PathBuf::from(path));
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| MdvError::App(e.to_string()))?;
    Ok(dir.join("mdv-tauri.db"))
}

fn startup_log_path() -> PathBuf {
    #[cfg(target_os = "macos")]
    if let Some(home) = env::var_os("HOME").map(PathBuf::from) {
        return home.join("Library").join("Logs").join("mdvx-startup.log");
    }
    env::temp_dir().join("mdvx-startup.log")
}

fn log_startup(message: impl AsRef<str>) {
    let path = startup_log_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_secs())
            .unwrap_or(0);
        let _ = writeln!(file, "[{timestamp}] {}", message.as_ref());
    }
}

fn install_panic_diagnostics() {
    let previous_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log_startup(format!("panic: {info}"));
        previous_hook(info);
    }));
}

fn open_store_with_recovery(path: &Path) -> Store {
    match Store::open(path) {
        Ok(store) => store,
        Err(error) => {
            log_startup(format!(
                "persistent store failed at {}: {error}",
                path.display()
            ));
            quarantine_store_files(path);
            match Store::open(path) {
                Ok(store) => {
                    log_startup("persistent store recreated after quarantine");
                    store
                }
                Err(retry_error) => {
                    log_startup(format!(
                        "persistent store retry failed: {retry_error}; using in-memory store"
                    ));
                    Store::open_in_memory()
                        .expect("in-memory SQLite store could not be initialized")
                }
            }
        }
    }
}

fn quarantine_store_files(path: &Path) {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    for candidate in [
        path.to_path_buf(),
        PathBuf::from(format!("{}-wal", path.display())),
        PathBuf::from(format!("{}-shm", path.display())),
    ] {
        if candidate.exists() {
            let quarantine = PathBuf::from(format!("{}.failed-{suffix}", candidate.display()));
            if let Err(error) = fs::rename(&candidate, &quarantine) {
                log_startup(format!(
                    "could not quarantine {}: {error}",
                    candidate.display()
                ));
            }
        }
    }
}

#[tauri::command]
fn update_menu_state(app: AppHandle, state: NativeMenuState) -> MdvResult<()> {
    let Some(menu) = app.menu() else {
        return Ok(());
    };

    set_menu_item_text(&menu, "toggle-sidebar", if state.sidebar_visible { "Hide Sidebar" } else { "Show Sidebar" })?;
    set_menu_item_enabled(&menu, "edit-current-file", state.has_document)?;
    set_menu_item_enabled(&menu, "choose-editor", true)?;
    set_menu_item_enabled(&menu, "forget-editor", state.has_editor)?;
    set_menu_item_enabled(&menu, "back", state.can_go_back)?;
    set_menu_item_enabled(&menu, "forward", state.can_go_forward)?;
    set_menu_item_enabled(&menu, "bookmark-current-spot", state.has_document)?;
    set_menu_item_enabled(&menu, "set-placeholder", state.has_document)?;
    set_menu_item_enabled(&menu, "jump-to-placeholder", state.has_document)?;
    set_check_menu_item_state(
        &menu,
        "smart-typography",
        if state.smart_typography_allowed {
            "Smart Typography"
        } else {
            "Smart Typography (off for this theme)"
        },
        state.smart_typography_allowed,
        state.smart_typography && state.smart_typography_allowed,
    )?;
    set_check_menu_item_state(
        &menu,
        "load-remote-images",
        "Load Remote Images",
        state.has_document,
        state.load_remote_images,
    )?;

    for (index, slot) in state.bookmark_slots.iter().take(5).enumerate() {
        let id = format!("bookmark-slot-{}", index + 1);
        let text = if slot.enabled {
            format!("Slot {} — {}", index + 1, slot.title)
        } else {
            format!("Slot {} — Empty", index + 1)
        };
        set_menu_item_text(&menu, &id, &text)?;
        set_menu_item_enabled(&menu, &id, slot.enabled)?;
    }

    Ok(())
}

fn set_menu_item_text(menu: &Menu<tauri::Wry>, id: &str, text: &str) -> MdvResult<()> {
    let Some(item) = menu.get(id) else {
        return Ok(());
    };
    match item {
        MenuItemKind::MenuItem(item) => item.set_text(text)?,
        MenuItemKind::Check(item) => item.set_text(text)?,
        _ => {}
    }
    Ok(())
}

fn set_menu_item_enabled(menu: &Menu<tauri::Wry>, id: &str, enabled: bool) -> MdvResult<()> {
    let Some(item) = menu.get(id) else {
        return Ok(());
    };
    match item {
        MenuItemKind::MenuItem(item) => item.set_enabled(enabled)?,
        MenuItemKind::Check(item) => item.set_enabled(enabled)?,
        _ => {}
    }
    Ok(())
}

fn set_check_menu_item_state(
    menu: &Menu<tauri::Wry>,
    id: &str,
    text: &str,
    enabled: bool,
    checked: bool,
) -> MdvResult<()> {
    let Some(item) = menu.get(id) else {
        return Ok(());
    };
    if let MenuItemKind::Check(item) = item {
        item.set_text(text)?;
        item.set_enabled(enabled)?;
        item.set_checked(checked)?;
    }
    Ok(())
}

fn filename(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Untitled.md")
        .to_string()
}

fn make_fts_query(input: &str) -> String {
    input
        .split_whitespace()
        .filter_map(|token| {
            let cleaned = token
                .chars()
                .filter(|ch| !matches!(ch, '"' | '(' | ')' | ':' | '*' | '^'))
                .collect::<String>();
            if cleaned.is_empty() {
                None
            } else {
                Some(format!("\"{}\"*", cleaned))
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[derive(Debug, PartialEq, Eq)]
struct DocumentSet {
    primary: PathBuf,
    siblings: Vec<PathBuf>,
}

fn resolve_markdown_selection(path: &Path) -> MdvResult<DocumentSet> {
    if path.is_dir() {
        let entries = markdown_files_in_directory(path)?;
        let primary = entries
            .iter()
            .find(|entry| is_readme(entry))
            .cloned()
            .or_else(|| entries.first().cloned())
            .ok_or_else(|| {
                MdvError::App(format!(
                    "No Markdown or text documents found in {}",
                    path.to_string_lossy()
                ))
            })?;
        let siblings = entries
            .into_iter()
            .filter(|entry| entry != &primary)
            .collect::<Vec<_>>();
        return Ok(DocumentSet { primary, siblings });
    }

    if !is_supported_document(path) {
        return Err(MdvError::App(format!(
            "Unsupported document type: {}",
            path.to_string_lossy()
        )));
    }

    Ok(DocumentSet {
        primary: path.to_path_buf(),
        siblings: Vec::new(),
    })
}

fn markdown_files_in_directory(path: &Path) -> MdvResult<Vec<PathBuf>> {
    let mut entries = fs::read_dir(path)?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|entry| entry.is_file())
        .filter(|entry| !is_hidden(entry))
        .filter(|entry| is_supported_document(entry))
        .collect::<Vec<_>>();
    entries.sort_by(|left, right| sort_key(left).cmp(&sort_key(right)));
    Ok(entries)
}

fn is_supported_document(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            let normalized = extension.to_ascii_lowercase();
            SUPPORTED_EXTENSIONS.contains(&normalized.as_str())
        })
        .unwrap_or(false)
}

fn has_external_scheme(value: &str) -> bool {
    value
        .find(':')
        .map(|index| {
            let scheme = &value[..index];
            !scheme.is_empty()
                && scheme
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '+' | '-' | '.'))
        })
        .unwrap_or(false)
}

fn percent_decode_path(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(hex) = u8::from_str_radix(&value[i + 1..i + 3], 16) {
                out.push(hex);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| value.to_string())
}

fn is_readme(path: &Path) -> bool {
    path.file_stem()
        .and_then(|stem| stem.to_str())
        .map(|stem| stem.eq_ignore_ascii_case("readme"))
        .unwrap_or(false)
}

fn is_hidden(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.starts_with('.'))
        .unwrap_or(false)
}

fn sort_key(path: &Path) -> String {
    filename(path).to_ascii_lowercase()
}

fn supported_open_args<I>(args: I) -> Vec<String>
where
    I: IntoIterator<Item = OsString>,
{
    args.into_iter()
        .map(PathBuf::from)
        .filter(|path| path.exists())
        .filter(|path| path.is_dir() || is_supported_document(path))
        .map(|path| path.to_string_lossy().into_owned())
        .collect()
}

fn validate_open_target(path: &Path) -> MdvResult<PathBuf> {
    if !path.exists() {
        return Err(MdvError::App("Selected file does not exist.".into()));
    }
    if path.is_dir() || is_supported_document(path) {
        return Ok(path.to_path_buf());
    }
    Err(MdvError::App("Selected file is not a supported document.".into()))
}

fn queue_open_paths(app: &AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }

    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut pending_paths) = state.pending_open_paths.lock() {
            pending_paths.extend(paths.clone());
        }
    }

    let _ = app.emit("mdv://open-paths", paths);
}

fn emit_menu_command(app: &AppHandle, command: &str) {
    let _ = app.emit("mdv://menu-command", command);
}

fn emit_shared_state_changed(app: &AppHandle, kind: &str) {
    let _ = app.emit("mdv://shared-state-changed", kind);
}

fn help_document_path(app: &AppHandle) -> Option<PathBuf> {
    resource_candidate(app, "Help.md")
        .or_else(|| resource_candidate(app, "resources/Help.md"))
        .or_else(|| {
            let path = app.path().app_data_dir().ok()?.join("Help.md");
            if !path.is_file() {
                fs::create_dir_all(path.parent()?).ok()?;
                fs::write(&path, HELP_DOCUMENT).ok()?;
            }
            Some(path)
        })
}

fn resource_candidate(app: &AppHandle, name: &str) -> Option<PathBuf> {
    app.path()
        .resource_dir()
        .ok()
        .map(|dir| dir.join(name))
        .filter(|path| path.is_file())
}

fn mdv_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let app_menu = Submenu::with_items(
        app,
        "mdv",
        true,
        &[
            &PredefinedMenuItem::about(app, None, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItem::with_id(app, "open", "Open…", true, Some("CmdOrCtrl+O"))?,
            &MenuItem::with_id(
                app,
                "open-new-window",
                "Open in New Window…",
                true,
                Some("CmdOrCtrl+Shift+O"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &MenuItem::with_id(
                        app,
                        "edit-current-file",
                        "Edit Current File",
                        true,
                        Some("CmdOrCtrl+E"),
                    )?,
                    &MenuItem::with_id(app, "choose-editor", "Choose Editor…", true, None::<&str>)?,
                    &MenuItem::with_id(app, "forget-editor", "Forget Editor", true, None::<&str>)?,
                ],
            )?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "find", "Find…", true, Some("CmdOrCtrl+F"))?,
            &MenuItem::with_id(
                app,
                "search-history",
                "Search History…",
                true,
                Some("CmdOrCtrl+Shift+F"),
            )?,
        ],
    )?;
    let navigate = Submenu::with_items(
        app,
        "Navigate",
        true,
        &[
            &MenuItem::with_id(app, "back", "Back", true, Some("CmdOrCtrl+ArrowLeft"))?,
            &MenuItem::with_id(app, "forward", "Forward", true, Some("CmdOrCtrl+ArrowRight"))?,
        ],
    )?;
    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &MenuItem::with_id(
                app,
                "toggle-sidebar",
                "Hide Sidebar",
                true,
                Some("CmdOrCtrl+Shift+S"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "zoom-in", "Zoom In", true, Some("CmdOrCtrl+="))?,
            &MenuItem::with_id(app, "zoom-out", "Zoom Out", true, Some("CmdOrCtrl+-"))?,
            &MenuItem::with_id(app, "actual-size", "Actual Size", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &CheckMenuItem::with_id(
                app,
                "smart-typography",
                "Smart Typography",
                true,
                true,
                None::<&str>,
            )?,
            &CheckMenuItem::with_id(
                app,
                "load-remote-images",
                "Load Remote Images",
                true,
                false,
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;
    let bookmarks = Submenu::with_items(
        app,
        "Bookmarks",
        true,
        &[
            &MenuItem::with_id(
                app,
                "bookmark-current-spot",
                "Bookmark Current Spot",
                true,
                Some("CmdOrCtrl+D"),
            )?,
            &MenuItem::with_id(app, "set-placeholder", "Set Placeholder", true, Some("CmdOrCtrl+Shift+0"))?,
            &MenuItem::with_id(
                app,
                "jump-to-placeholder",
                "Jump to Placeholder",
                true,
                Some("CmdOrCtrl+0"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "bookmark-slot-1", "Slot 1 — Empty", false, Some("CmdOrCtrl+1"))?,
            &MenuItem::with_id(app, "bookmark-slot-2", "Slot 2 — Empty", false, Some("CmdOrCtrl+2"))?,
            &MenuItem::with_id(app, "bookmark-slot-3", "Slot 3 — Empty", false, Some("CmdOrCtrl+3"))?,
            &MenuItem::with_id(app, "bookmark-slot-4", "Slot 4 — Empty", false, Some("CmdOrCtrl+4"))?,
            &MenuItem::with_id(app, "bookmark-slot-5", "Slot 5 — Empty", false, Some("CmdOrCtrl+5"))?,
        ],
    )?;
    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;
    let help = Submenu::with_items(
        app,
        "Help",
        true,
        &[&MenuItem::with_id(app, "help", "mdv Help", true, Some("CmdOrCtrl+?"))?],
    )?;

    Menu::with_items(
        app,
        &[
            &app_menu, &file, &edit, &navigate, &view, &bookmarks, &window, &help,
        ],
    )
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn percent_encode_component(value: &str) -> String {
    value
        .bytes()
        .flat_map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                vec![byte as char]
            }
            _ => format!("%{byte:02X}").chars().collect(),
        })
        .collect()
}

fn file_mtime_secs(path: &Path) -> i64 {
    fs::metadata(path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

fn file_signature_for_path(path: &Path) -> MdvResult<FileSignature> {
    let metadata = fs::metadata(path)?;
    let file_mtime_ms = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0);
    Ok(FileSignature {
        path: path.to_string_lossy().into_owned(),
        file_mtime_ms,
        file_size: metadata.len() as i64,
    })
}

pub fn run() {
    install_panic_diagnostics();
    log_startup(format!(
        "mdvx {} process start on {} {}",
        env!("CARGO_PKG_VERSION"),
        env::consts::OS,
        env::consts::ARCH
    ));

    let builder = tauri::Builder::default()
        .menu(mdv_menu)
        .on_menu_event(|app, event| {
            let command = event.id().as_ref();
            match command {
                "help" => {
                    if let Some(help) = help_document_path(app) {
                        queue_open_paths(app, vec![help.to_string_lossy().into_owned()]);
                    }
                }
                id => emit_menu_command(app, id),
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .on_page_load(|_webview, payload| {
            log_startup(format!(
                "page load {:?}: {}",
                payload.event(),
                payload.url()
            ));
        })
        .setup(|app| {
            log_startup("setup started");
            let store = match app_db_path(app.handle()) {
                Ok(db_path) => open_store_with_recovery(&db_path),
                Err(error) => {
                    log_startup(format!(
                        "application data path failed: {error}; using in-memory store"
                    ));
                    Store::open_in_memory()?
                }
            };
            app.manage(AppState {
                db: Mutex::new(store),
                pending_open_paths: Mutex::new(supported_open_args(env::args_os().skip(1))),
            });
            if let Some(window) = app.get_webview_window("main") {
                if let Err(error) = window.set_theme(Some(Theme::Light)) {
                    log_startup(format!("could not set initial window theme: {error}"));
                }
            }
            log_startup("setup completed");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_markdown,
            open_new_window,
            file_signature,
            resolve_local_image,
            list_history,
            remove_history,
            clear_history,
            search_history,
            add_bookmark,
            list_bookmarks,
            remove_bookmark,
            reorder_bookmarks,
            save_scroll_position,
            load_scroll_position,
            take_pending_open_paths,
            open_in_editor,
            update_menu_state
        ]);

    #[cfg(any(target_os = "macos", target_os = "ios"))]
    let builder = builder.on_web_content_process_terminate(|webview| {
        log_startup(format!(
            "web content process terminated for {}",
            webview.label()
        ));
    });

    builder
        .build(tauri::generate_context!())
        .expect("error while building mdv")
        .run(|_app, _event| {
            #[cfg(any(target_os = "ios", target_os = "android"))]
            if let tauri::RunEvent::Opened { urls } = _event {
                let paths = urls
                    .into_iter()
                    .filter_map(|url| url.to_file_path().ok())
                    .filter(|path| path.is_dir() || is_supported_document(path))
                    .map(|path| path.to_string_lossy().into_owned())
                    .collect::<Vec<_>>();
                queue_open_paths(_app, paths);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn store_opens_sqlite_with_full_mutex() {
        assert!(STORE_OPEN_FLAGS.contains(OpenFlags::SQLITE_OPEN_FULL_MUTEX));
        assert!(STORE_OPEN_FLAGS.contains(OpenFlags::SQLITE_OPEN_READ_WRITE));
        assert!(STORE_OPEN_FLAGS.contains(OpenFlags::SQLITE_OPEN_CREATE));
    }

    #[test]
    fn corrupt_persistent_store_is_quarantined_and_recreated() {
        let temp = tempfile::tempdir().unwrap();
        let db = temp.path().join("mdv.db");
        fs::write(&db, "not a sqlite database").unwrap();

        let store = open_store_with_recovery(&db);

        assert!(store.list_history().unwrap().is_empty());
        assert!(db.is_file());
        assert!(fs::read_dir(temp.path())
            .unwrap()
            .filter_map(Result::ok)
            .any(|entry| entry
                .file_name()
                .to_string_lossy()
                .starts_with("mdv.db.failed-")));
    }

    #[test]
    fn history_is_recent_first_and_searchable() {
        let temp = tempfile::tempdir().unwrap();
        let db = temp.path().join("mdv.db");
        let first = temp.path().join("first.md");
        let second = temp.path().join("second.md");
        fs::write(&first, "# Alpha\n\nNeedle paragraph").unwrap();
        fs::write(&second, "# Beta\n\nDifferent content").unwrap();

        let store = Store::open(db).unwrap();
        store.add_history(&first, "# Alpha\n\nNeedle paragraph").unwrap();
        store.add_history(&second, "# Beta\n\nDifferent content").unwrap();

        let history = store.list_history().unwrap();
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].filename, "second.md");

        let hits = store.search_history("needle").unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].filename, "first.md");
        assert!(hits[0].snippet.contains("\u{2}Needle\u{3}"));

        let prefix_hits = store.search_history("nee (").unwrap();
        assert_eq!(prefix_hits.len(), 1);
        assert_eq!(prefix_hits[0].filename, "first.md");

        store.remove_history(&first.to_string_lossy()).unwrap();
        assert!(store.search_history("needle").unwrap().is_empty());
        assert_eq!(store.list_history().unwrap().len(), 1);

        store.clear_history().unwrap();
        assert!(store.list_history().unwrap().is_empty());
    }

    #[test]
    fn fts_query_sanitizes_prefix_queries() {
        assert_eq!(make_fts_query(" auth token "), r#""auth"* "token"*"#);
        assert_eq!(
            make_fts_query(r#"need"le (alpha): ^beta*"#),
            r#""needle"* "alpha"* "beta"*"#,
        );
        assert_eq!(make_fts_query(r#" " () : * ^ "#), "");
    }

    #[test]
    fn file_signature_tracks_size_and_mtime() {
        let temp = tempfile::tempdir().unwrap();
        let doc = temp.path().join("watched.md");
        fs::write(&doc, "# One\n").unwrap();

        let signature = file_signature_for_path(&doc).unwrap();

        assert_eq!(signature.path, doc.to_string_lossy());
        assert_eq!(signature.file_size, 6);
        assert!(signature.file_mtime_ms > 0);
    }

    #[test]
    fn new_window_targets_accept_supported_files_and_directories() {
        let temp = tempfile::tempdir().unwrap();
        let doc = temp.path().join("guide.md");
        let dir = temp.path().join("folder");
        let image = temp.path().join("image.png");
        fs::write(&doc, "# Guide").unwrap();
        fs::create_dir(&dir).unwrap();
        fs::write(&image, "not markdown").unwrap();

        assert_eq!(validate_open_target(&doc).unwrap(), doc);
        assert_eq!(validate_open_target(&dir).unwrap(), dir);
        assert!(validate_open_target(&image).is_err());
    }

    #[test]
    fn new_window_initial_path_is_url_encoded() {
        assert_eq!(
            percent_encode_component("/tmp/has spaces/quote#.md"),
            "%2Ftmp%2Fhas%20spaces%2Fquote%23.md"
        );
    }

    #[test]
    fn bookmarks_keep_order_and_file_existence() {
        let temp = tempfile::tempdir().unwrap();
        let db = temp.path().join("mdv.db");
        let doc = temp.path().join("doc.md");
        fs::write(&doc, "# Title").unwrap();

        let store = Store::open(db).unwrap();
        store
            .add_bookmark(&doc.to_string_lossy(), "Intro", 0, "title")
            .unwrap();
        store
            .add_bookmark("/missing.md", "Missing", 3, "missing")
            .unwrap();

        let bookmarks = store.list_bookmarks().unwrap();
        assert_eq!(bookmarks[0].title, "Intro");
        assert!(bookmarks[0].file_exists);
        assert_eq!(bookmarks[1].sort_order, 1);
        assert!(!bookmarks[1].file_exists);

        let reordered = store
            .reorder_bookmarks(vec![bookmarks[1].id, bookmarks[0].id])
            .unwrap();
        assert_eq!(reordered[0].title, "Missing");
        assert_eq!(reordered[0].sort_order, 0);
        assert_eq!(reordered[1].title, "Intro");
        assert!(store.reorder_bookmarks(vec![bookmarks[0].id]).is_err());

        store.remove_bookmark(bookmarks[0].id).unwrap();
        let bookmarks = store.list_bookmarks().unwrap();
        assert_eq!(bookmarks.len(), 1);
        assert_eq!(bookmarks[0].sort_order, 0);
        assert_eq!(bookmarks[0].title, "Missing");
    }

    #[test]
    fn scroll_positions_are_restored_until_document_changes() {
        let temp = tempfile::tempdir().unwrap();
        let db = temp.path().join("mdv.db");
        let doc = temp.path().join("doc.md");
        fs::write(&doc, "# Title\n\nBody").unwrap();

        let store = Store::open(db).unwrap();
        store
            .save_scroll_position(&doc.to_string_lossy(), 4, "body", 960)
            .unwrap();

        let position = store
            .load_scroll_position(&doc.to_string_lossy())
            .unwrap()
            .unwrap();
        assert_eq!(position.block_index, 4);
        assert_eq!(position.block_fingerprint, "body");
        assert_eq!(position.scroll_top, 960);

        std::thread::sleep(std::time::Duration::from_secs(1));
        fs::write(&doc, "# Title\n\nChanged body").unwrap();

        assert!(store
            .load_scroll_position(&doc.to_string_lossy())
            .unwrap()
            .is_none());
    }

    #[test]
    fn removing_history_clears_matching_scroll_position() {
        let temp = tempfile::tempdir().unwrap();
        let db = temp.path().join("mdv.db");
        let doc = temp.path().join("doc.md");
        fs::write(&doc, "# Title\n\nBody").unwrap();

        let store = Store::open(db).unwrap();
        let path = doc.to_string_lossy();
        store.add_history(&doc, "# Title\n\nBody").unwrap();
        store.save_scroll_position(&path, 2, "body", 480).unwrap();
        assert!(store.load_scroll_position(&path).unwrap().is_some());

        store.remove_history(&path).unwrap();
        assert!(store.load_scroll_position(&path).unwrap().is_none());
    }

    #[test]
    fn local_images_resolve_relative_to_document_and_report_missing_files() {
        let temp = tempfile::tempdir().unwrap();
        let doc = temp.path().join("guide").join("doc.md");
        let image = temp.path().join("guide").join("images").join("icon file.png");
        fs::create_dir_all(image.parent().unwrap()).unwrap();
        fs::write(&doc, "# Doc").unwrap();
        fs::write(&image, "png").unwrap();

        let resolved = resolve_local_image(
            doc.to_string_lossy().into_owned(),
            "images/icon%20file.png".to_string(),
        )
        .unwrap();
        assert!(resolved.exists);
        assert_eq!(resolved.path, image.to_string_lossy());

        let missing = resolve_local_image(
            doc.to_string_lossy().into_owned(),
            "images/missing.png".to_string(),
        )
        .unwrap();
        assert!(!missing.exists);
        assert!(missing.path.ends_with("images/missing.png"));
    }

    #[test]
    fn directory_selection_prefers_readme_and_lists_siblings() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path();
        let alpha = dir.join("alpha.md");
        let readme = dir.join("README.markdown");
        let notes = dir.join("notes.txt");
        fs::write(&alpha, "# Alpha").unwrap();
        fs::write(&readme, "# Read Me").unwrap();
        fs::write(&notes, "# Notes").unwrap();
        fs::write(dir.join(".hidden.md"), "# Hidden").unwrap();
        fs::write(dir.join("image.png"), "not markdown").unwrap();

        let selection = resolve_markdown_selection(dir).unwrap();

        assert_eq!(selection.primary, readme);
        assert_eq!(selection.siblings, vec![alpha, notes]);
    }

    #[test]
    fn directory_selection_falls_back_to_first_supported_file() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path();
        let alpha = dir.join("alpha.md");
        let zeta = dir.join("zeta.mkd");
        fs::write(&zeta, "# Zeta").unwrap();
        fs::write(&alpha, "# Alpha").unwrap();

        let selection = resolve_markdown_selection(dir).unwrap();

        assert_eq!(selection.primary, alpha);
        assert_eq!(selection.siblings, vec![zeta]);
    }

    #[test]
    fn unsupported_file_selection_is_rejected() {
        let temp = tempfile::tempdir().unwrap();
        let image = temp.path().join("image.png");
        fs::write(&image, "not markdown").unwrap();

        let error = resolve_markdown_selection(&image).unwrap_err();

        assert!(error.to_string().contains("Unsupported document type"));
    }

    #[test]
    fn empty_directory_selection_is_rejected() {
        let temp = tempfile::tempdir().unwrap();

        let error = resolve_markdown_selection(temp.path()).unwrap_err();

        assert!(error.to_string().contains("No Markdown or text documents"));
    }

    #[test]
    fn supported_open_args_keep_documents_and_directories() {
        let temp = tempfile::tempdir().unwrap();
        let doc = temp.path().join("doc.mdown");
        let plain = temp.path().join("notes.txt");
        let image = temp.path().join("image.png");
        let missing = temp.path().join("missing.md");
        fs::write(&doc, "# Doc").unwrap();
        fs::write(&plain, "Notes").unwrap();
        fs::write(&image, "not markdown").unwrap();

        let paths = supported_open_args([
            doc.clone().into_os_string(),
            plain.clone().into_os_string(),
            image.into_os_string(),
            temp.path().to_path_buf().into_os_string(),
            missing.into_os_string(),
        ]);

        assert_eq!(
            paths,
            vec![
                doc.to_string_lossy().into_owned(),
                plain.to_string_lossy().into_owned(),
                temp.path().to_string_lossy().into_owned(),
            ],
        );
    }
}
