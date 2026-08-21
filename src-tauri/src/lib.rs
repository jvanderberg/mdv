use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    env,
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Emitter, Manager, State,
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

type MdvResult<T> = Result<T, MdvError>;
const SUPPORTED_EXTENSIONS: &[&str] = &["md", "markdown", "mdown", "mkd", "txt"];

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
        let conn = Connection::open(path)?;
        let store = Self { conn };
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
        Ok(())
    }

    fn clear_history(&self) -> MdvResult<()> {
        self.conn.execute("DELETE FROM history", [])?;
        Ok(())
    }

    fn search_history(&self, query: &str) -> MdvResult<Vec<SearchHit>> {
        let query = query.trim();
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let fts_query = query
            .split_whitespace()
            .map(|part| format!("{}*", part.replace('"', "\"\"")))
            .collect::<Vec<_>>()
            .join(" ");
        let mut stmt = self.conn.prepare(
            r#"
            SELECT path, filename, snippet(history_fts, 1, '[', ']', '...', 18)
            FROM history_fts
            WHERE history_fts MATCH ?1
            ORDER BY rank
            LIMIT 50
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
fn load_markdown(path: String, state: State<'_, AppState>) -> MdvResult<LoadedDocument> {
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
    Ok(LoadedDocument {
        path: document_set.primary.to_string_lossy().into_owned(),
        filename: filename(&document_set.primary),
        content,
    })
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
fn remove_history(path: String, state: State<'_, AppState>) -> MdvResult<()> {
    state
        .db
        .lock()
        .map_err(|_| MdvError::App("database lock poisoned".into()))?
        .remove_history(&path)
}

#[tauri::command]
fn clear_history(state: State<'_, AppState>) -> MdvResult<()> {
    state
        .db
        .lock()
        .map_err(|_| MdvError::App("database lock poisoned".into()))?
        .clear_history()
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
    path: String,
    title: String,
    block_index: i64,
    block_fingerprint: String,
    state: State<'_, AppState>,
) -> MdvResult<Bookmark> {
    state
        .db
        .lock()
        .map_err(|_| MdvError::App("database lock poisoned".into()))?
        .add_bookmark(&path, &title, block_index, &block_fingerprint)
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
fn remove_bookmark(id: i64, state: State<'_, AppState>) -> MdvResult<()> {
    state
        .db
        .lock()
        .map_err(|_| MdvError::App("database lock poisoned".into()))?
        .remove_bookmark(id)
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

    #[cfg(target_os = "macos")]
    {
        Command::new("/usr/bin/open")
            .arg("-a")
            .arg(editor_path)
            .arg(document_path)
            .spawn()
            .map_err(|error| MdvError::App(error.to_string()))?;
        return Ok(());
    }

    #[cfg(not(target_os = "macos"))]
    {
        Command::new(editor_path)
            .arg(document_path)
            .spawn()
            .map_err(|error| MdvError::App(error.to_string()))?;
        Ok(())
    }
}

#[tauri::command]
fn install_cli(app: AppHandle) -> MdvResult<String> {
    const DESTINATION: &str = "/usr/local/bin/mdv";
    let source = cli_source_path(&app)
        .ok_or_else(|| MdvError::App("The bundled mdv CLI helper was not found.".into()))?;

    if fs::read_link(DESTINATION)
        .map(|target| target == source)
        .unwrap_or(false)
    {
        return Ok(format!("{DESTINATION} already points to this app."));
    }

    if symlink_unprivileged(&source, Path::new(DESTINATION)).is_ok() {
        return Ok(format!(
            "Command line tool installed: {DESTINATION} -> {}",
            source.to_string_lossy()
        ));
    }

    #[cfg(target_os = "macos")]
    {
        symlink_with_admin_auth(&source, Path::new(DESTINATION))?;
        return Ok(format!(
            "Command line tool installed: {DESTINATION} -> {}",
            source.to_string_lossy()
        ));
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err(MdvError::App(format!(
            "Could not install {DESTINATION}; check directory permissions."
        )))
    }
}

fn app_db_path(app: &AppHandle) -> MdvResult<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| MdvError::App(e.to_string()))?;
    Ok(dir.join("mdv-tauri.db"))
}

fn filename(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Untitled.md")
        .to_string()
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

fn cli_source_path(app: &AppHandle) -> Option<PathBuf> {
    resource_candidate(app, "mdv").or_else(|| env::current_dir().ok().map(|dir| dir.join("bin").join("mdv")).filter(|path| path.is_file()))
}

fn help_document_path(app: &AppHandle) -> Option<PathBuf> {
    resource_candidate(app, "Help.md").or_else(|| {
        env::current_dir()
            .ok()
            .map(|dir| dir.join("mdv").join("Help.md"))
            .filter(|path| path.is_file())
    })
}

fn resource_candidate(app: &AppHandle, name: &str) -> Option<PathBuf> {
    app.path()
        .resource_dir()
        .ok()
        .map(|dir| dir.join(name))
        .filter(|path| path.is_file())
}

fn symlink_unprivileged(source: &Path, destination: &Path) -> std::io::Result<()> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    if destination.exists() || fs::read_link(destination).is_ok() {
        fs::remove_file(destination)?;
    }
    std::os::unix::fs::symlink(source, destination)
}

#[cfg(target_os = "macos")]
fn symlink_with_admin_auth(source: &Path, destination: &Path) -> MdvResult<()> {
    let parent = destination
        .parent()
        .ok_or_else(|| MdvError::App("CLI destination has no parent directory.".into()))?;
    let shell = format!(
        "/bin/mkdir -p {} && /bin/ln -sf {} {}",
        shell_quote(parent),
        shell_quote(source),
        shell_quote(destination)
    );
    let escaped = shell.replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!("do shell script \"{escaped}\" with administrator privileges");
    let status = Command::new("/usr/bin/osascript")
        .arg("-e")
        .arg(script)
        .status()
        .map_err(|error| MdvError::App(error.to_string()))?;
    if status.success() {
        Ok(())
    } else {
        Err(MdvError::App("CLI install was cancelled or failed.".into()))
    }
}

#[cfg(target_os = "macos")]
fn shell_quote(path: &Path) -> String {
    let value = path.to_string_lossy();
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn mdv_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let app_menu = Submenu::with_items(
        app,
        "mdv",
        true,
        &[
            &PredefinedMenuItem::about(app, None, None)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "install-cli", "Install Command Line Tool...", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItem::with_id(app, "open", "Open...", true, Some("Cmd+O"))?,
            &MenuItem::with_id(
                app,
                "open-new-window",
                "Open in New Window...",
                true,
                Some("Cmd+Shift+O"),
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
                        Some("Cmd+E"),
                    )?,
                    &MenuItem::with_id(app, "choose-editor", "Choose Editor...", true, None::<&str>)?,
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
            &MenuItem::with_id(app, "find", "Find...", true, Some("Cmd+F"))?,
            &MenuItem::with_id(
                app,
                "search-history",
                "Search History...",
                true,
                Some("Cmd+Shift+F"),
            )?,
        ],
    )?;
    let navigate = Submenu::with_items(
        app,
        "Navigate",
        true,
        &[
            &MenuItem::with_id(app, "back", "Back", true, Some("Cmd+Left"))?,
            &MenuItem::with_id(app, "forward", "Forward", true, Some("Cmd+Right"))?,
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
                Some("Cmd+Ctrl+S"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "zoom-in", "Zoom In", true, Some("Cmd+="))?,
            &MenuItem::with_id(app, "zoom-out", "Zoom Out", true, Some("Cmd+-"))?,
            &MenuItem::with_id(app, "actual-size", "Actual Size", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "smart-typography", "Smart Typography", true, None::<&str>)?,
            &MenuItem::with_id(
                app,
                "load-remote-images",
                "Load Remote Images",
                true,
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
                Some("Cmd+D"),
            )?,
            &MenuItem::with_id(app, "set-placeholder", "Set Placeholder", true, Some("Cmd+Shift+0"))?,
            &MenuItem::with_id(
                app,
                "jump-to-placeholder",
                "Jump to Placeholder",
                true,
                Some("Cmd+0"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "bookmark-slot-1", "Slot 1 - Empty", false, Some("Cmd+1"))?,
            &MenuItem::with_id(app, "bookmark-slot-2", "Slot 2 - Empty", false, Some("Cmd+2"))?,
            &MenuItem::with_id(app, "bookmark-slot-3", "Slot 3 - Empty", false, Some("Cmd+3"))?,
            &MenuItem::with_id(app, "bookmark-slot-4", "Slot 4 - Empty", false, Some("Cmd+4"))?,
            &MenuItem::with_id(app, "bookmark-slot-5", "Slot 5 - Empty", false, Some("Cmd+5"))?,
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
        &[&MenuItem::with_id(app, "help", "mdv Help", true, Some("Cmd+?"))?],
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

fn file_mtime_secs(path: &Path) -> i64 {
    fs::metadata(path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

pub fn run() {
    tauri::Builder::default()
        .menu(mdv_menu)
        .on_menu_event(|app, event| {
            let command = event.id().as_ref();
            match command {
                "help" => {
                    if let Some(help) = help_document_path(app) {
                        queue_open_paths(app, vec![help.to_string_lossy().into_owned()]);
                    }
                }
                "install-cli" => emit_menu_command(app, "install-cli"),
                id => emit_menu_command(app, id),
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let db_path = app_db_path(app.handle())?;
            let store = Store::open(db_path)?;
            app.manage(AppState {
                db: Mutex::new(store),
                pending_open_paths: Mutex::new(supported_open_args(env::args_os().skip(1))),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_markdown,
            resolve_local_image,
            list_history,
            remove_history,
            clear_history,
            search_history,
            add_bookmark,
            list_bookmarks,
            remove_bookmark,
            save_scroll_position,
            load_scroll_position,
            take_pending_open_paths,
            open_in_editor,
            install_cli
        ])
        .build(tauri::generate_context!())
        .expect("error while building mdv")
        .run(|app, event| {
            #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
            if let tauri::RunEvent::Opened { urls } = event {
                let paths = urls
                    .into_iter()
                    .filter_map(|url| url.to_file_path().ok())
                    .filter(|path| path.is_dir() || is_supported_document(path))
                    .map(|path| path.to_string_lossy().into_owned())
                    .collect::<Vec<_>>();
                queue_open_paths(app, paths);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

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
        assert!(hits[0].snippet.contains("[Needle]"));

        store.remove_history(&first.to_string_lossy()).unwrap();
        assert!(store.search_history("needle").unwrap().is_empty());
        assert_eq!(store.list_history().unwrap().len(), 1);

        store.clear_history().unwrap();
        assert!(store.list_history().unwrap().is_empty());
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
