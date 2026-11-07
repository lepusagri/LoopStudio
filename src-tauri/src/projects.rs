//! Self-contained practice projects. Only relative paths are written into a project.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager};

const FORMAT: &str = "loopstudio-project";
const MANIFEST: &str = "project.loopstudio";
const MAX_JSON: u64 = 64 * 1024 * 1024;
#[derive(Default)]
pub struct ProjectsState(pub Mutex<()>);
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMedia {
    file: String,
    name: String,
    kind: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub material_id: Option<String>,
    pub selected_loop_id: Option<String>,
    pub a: Option<f64>,
    pub b: Option<f64>,
    pub looping: bool,
    pub view: String,
    pub volume: f64,
}
impl Default for Workspace {
    fn default() -> Self {
        Self {
            material_id: None,
            selected_loop_id: None,
            a: None,
            b: None,
            looping: false,
            view: "notation".into(),
            volume: 0.7,
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    format: String,
    version: u8,
    name: String,
    media: ProjectMedia,
    pub session: crate::PracticeSession,
    pub workspace: Workspace,
    updated_at: u64,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentProject {
    path: String,
    name: String,
    media_name: String,
    loop_count: usize,
    updated_at: u64,
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn id_ok(id: &str) -> bool {
    id.len() == 64 && id.bytes().all(|b| b.is_ascii_hexdigit())
}
fn read_json(path: &Path) -> Result<Value, String> {
    if fs::metadata(path).map_err(|e| e.to_string())?.len() > MAX_JSON {
        return Err("Projektdatei überschreitet 64 MB.".into());
    }
    serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}
fn atomic_write(path: &Path, data: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Speicherordner fehlt")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    temp.write_all(data).map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    temp.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}
fn inside(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative);
    if relative.is_empty()
        || !path.components().all(|c| matches!(c, Component::Normal(_)))
        || relative.contains('\\')
        || relative.contains(':')
    {
        return Err("Ungültiger relativer Projektpfad".into());
    }
    let resolved =
        fs::canonicalize(root.join(path)).map_err(|_| format!("Projektdatei fehlt: {relative}"))?;
    if !resolved.starts_with(root) || !resolved.is_file() {
        return Err("Datei liegt außerhalb des Projekts".into());
    }
    Ok(resolved)
}
// Verify every parent before creating project assets, including on junction-based filesystems.
fn destination(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative);
    if !path.components().all(|c| matches!(c, Component::Normal(_)))
        || relative.contains('\\')
        || relative.contains(':')
    {
        return Err("Ungültiger Projektzielpfad".into());
    }
    let mut parent = root.to_path_buf();
    if let Some(parts) = path.parent() {
        for component in parts.components() {
            parent.push(component);
            if !parent.exists() {
                fs::create_dir(&parent).map_err(|e| e.to_string())?;
            }
            if !fs::canonicalize(&parent)
                .map_err(|e| e.to_string())?
                .starts_with(root)
            {
                return Err("Projektziel liegt außerhalb des Projektordners".into());
            }
        }
    }
    let target = root.join(path);
    if target.exists()
        && !fs::canonicalize(&target)
            .map_err(|e| e.to_string())?
            .starts_with(root)
    {
        return Err("Projektziel liegt außerhalb des Projektordners".into());
    }
    Ok(target)
}
fn validate(project: &Project) -> Result<(), String> {
    if project.format != FORMAT || project.version != 1 {
        return Err("Unbekanntes LoopStudio-Projektformat".into());
    }
    if project.name.trim().is_empty()
        || project.name.len() > 300
        || !["audio", "video"].contains(&project.media.kind.as_str())
    {
        return Err("Ungültige Projektangaben".into());
    }
    crate::validate_session(&project.session)?;
    let w = &project.workspace;
    if w.material_id.as_ref().is_some_and(|id| !id_ok(id))
        || !w.volume.is_finite()
        || !(0.0..=1.0).contains(&w.volume)
        || !["guitar", "piano", "notation", "edit"].contains(&w.view.as_str())
        || [w.a, w.b]
            .into_iter()
            .flatten()
            .any(|v| !v.is_finite() || !(0.0..=86400.).contains(&v))
        || w.a.zip(w.b).is_some_and(|(a, b)| b <= a)
        || w.selected_loop_id
            .as_ref()
            .is_some_and(|id| !project.session.loops.iter().any(|l| &l.id == id))
    {
        return Err("Ungültiger Projekt-Arbeitsstand".into());
    }
    Ok(())
}
fn project_at(path: &Path) -> Result<(PathBuf, Project), String> {
    let path =
        fs::canonicalize(path).map_err(|e| format!("Projekt konnte nicht geöffnet werden: {e}"))?;
    if path.extension().and_then(|e| e.to_str()) != Some("loopstudio") {
        return Err("Bitte eine .loopstudio-Projektdatei wählen.".into());
    }
    let project: Project = serde_json::from_value(read_json(&path)?)
        .map_err(|e| format!("Beschädigte Projektdatei: {e}"))?;
    validate(&project)?;
    Ok((path, project))
}

pub(crate) fn external_editor_dir(path: &str) -> Result<PathBuf, String> {
    let (manifest, _) = project_at(Path::new(path))?;
    let root = manifest.parent().ok_or("Projektordner fehlt")?;
    let target = destination(root, "assets/external-editor/marker")?;
    Ok(target.parent().ok_or("Notenordner fehlt")?.to_path_buf())
}
fn read_material(root: &Path, id: &str) -> Result<Value, String> {
    if !id_ok(id) {
        return Err("Ungültige Notendaten-ID".into());
    }
    let path = inside(root, &format!("materials/{id}.json"))?;
    if fs::metadata(&path).map_err(|e| e.to_string())?.len() > MAX_JSON {
        return Err("Notendaten zu groß".into());
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    if format!("{:x}", Sha256::digest(&bytes)) != id {
        return Err("Gespeicherte Projekt-Notendaten sind beschädigt.".into());
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    if value["version"] != 1 {
        return Err("Unbekanntes Notendatenformat".into());
    }
    Ok(value)
}
fn resolve_material(root: &Path, mut value: Value) -> Result<Value, String> {
    if let Some(stems) = value
        .get_mut("analysis")
        .and_then(|v| v.get_mut("stems"))
        .and_then(Value::as_array_mut)
    {
        for stem in stems {
            let file = inside(root, stem["path"].as_str().ok_or("Audiospur-Pfad fehlt")?)?;
            stem["path"] = json!(file.to_string_lossy());
        }
    }
    Ok(value)
}
fn copy_file(source: &Path, destination: &Path) -> Result<(), String> {
    let parent = destination.parent().ok_or("Zielordner fehlt")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    std::io::copy(
        &mut fs::File::open(source).map_err(|e| e.to_string())?,
        &mut temp,
    )
    .map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    temp.persist(destination).map_err(|e| e.to_string())?;
    Ok(())
}
fn save_material(root: &Path, allowed: &[PathBuf], mut value: Value) -> Result<String, String> {
    if value["version"] != 1 {
        return Err("Unbekanntes Notendatenformat".into());
    }
    if let Some(stems) = value
        .get_mut("analysis")
        .and_then(|v| v.get_mut("stems"))
        .and_then(Value::as_array_mut)
    {
        for stem in stems {
            let input = stem["path"].as_str().ok_or("Audiospur-Pfad fehlt")?;
            let source = if Path::new(input).is_absolute() {
                fs::canonicalize(input)
                    .map_err(|_| "Eine analysierte Audiospur fehlt.".to_owned())?
            } else {
                inside(root, input)?
            };
            let relative = if source.starts_with(root) {
                source
                    .strip_prefix(root)
                    .map_err(|e| e.to_string())?
                    .to_string_lossy()
                    .replace('\\', "/")
            } else {
                if !source.is_file() || !allowed.iter().any(|p| source.starts_with(p)) {
                    return Err("Audiospur liegt außerhalb der erlaubten Analyseordner".into());
                }
                let metadata = source.metadata().map_err(|e| e.to_string())?;
                let key = format!(
                    "{}:{}:{:?}",
                    source.display(),
                    metadata.len(),
                    metadata.modified().ok()
                );
                let relative = format!("assets/audio/{:x}.wav", Sha256::digest(key.as_bytes()));
                let destination = destination(root, &relative)?;
                if !destination.exists() {
                    copy_file(&source, &destination)?;
                }
                relative
            };
            stem["path"] = json!(relative);
        }
    }
    // Preserve original GP/MIDI files as usable files as well as in the editable snapshot.
    for (field, default_ext) in [("gp", "gp5"), ("midi", "mid")] {
        if let Some(encoded) = value["score"][field].as_str() {
            let bytes = STANDARD
                .decode(encoded)
                .map_err(|_| "Original-Notendatei ist beschädigt".to_owned())?;
            if bytes.len() > 20 * 1024 * 1024 {
                return Err("Original-Notendatei überschreitet 20 MB".into());
            }
            let ext = Path::new(value["score"]["name"].as_str().unwrap_or(""))
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or(default_ext)
                .to_ascii_lowercase();
            let ext = if field == "midi" {
                "mid"
            } else if field == "gp" && value["score"]["gpFormat"].as_str() == Some("gp7") {
                "gp"
            } else if ["gp3", "gp4", "gp5", "gpx", "gp", "mid", "midi"].contains(&ext.as_str()) {
                ext.as_str()
            } else {
                default_ext
            };
            let destination = destination(
                root,
                &format!("assets/notation/{:x}.{ext}", Sha256::digest(&bytes)),
            )?;
            if !destination.exists() {
                atomic_write(&destination, &bytes)?;
            }
        }
    }
    let data = serde_json::to_vec(&value).map_err(|e| e.to_string())?;
    if data.len() as u64 > MAX_JSON {
        return Err("Maximal 64 MB Notendaten pro Loop".into());
    }
    let id = format!("{:x}", Sha256::digest(&data));
    let target = destination(root, &format!("materials/{id}.json"))?;
    if !target.exists() {
        atomic_write(&target, &data)?;
    }
    Ok(id)
}
fn refs(project: &Project) -> impl Iterator<Item = &str> {
    project
        .session
        .loops
        .iter()
        .filter_map(|l| l.material_id.as_deref())
        .chain(project.workspace.material_id.as_deref())
}
fn write_project(path: &Path, project: &Project) -> Result<(), String> {
    validate(project)?;
    let root = path.parent().ok_or("Projektordner fehlt")?;
    inside(root, &project.media.file)?;
    for id in refs(project) {
        inside(root, &format!("materials/{id}.json"))?;
    }
    atomic_write(
        path,
        &serde_json::to_vec_pretty(project).map_err(|e| e.to_string())?,
    )
}
fn recent(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("projects.json"))
}
fn list_recent(path: &Path) -> Result<Vec<RecentProject>, String> {
    if !path.exists() {
        return Ok(vec![]);
    }
    serde_json::from_value(read_json(path)?)
        .map_err(|e| format!("Projektliste konnte nicht geladen werden: {e}"))
}
fn remember(app: &tauri::AppHandle, path: &Path, project: &Project) -> Result<(), String> {
    let index = recent(app)?;
    let mut list = list_recent(&index)?;
    let entry = RecentProject {
        path: path.to_string_lossy().into_owned(),
        name: project.name.clone(),
        media_name: project.media.name.clone(),
        loop_count: project.session.loops.len(),
        updated_at: now(),
    };
    list.retain(|e| e.path != entry.path);
    list.insert(0, entry);
    list.truncate(100);
    atomic_write(
        &index,
        &serde_json::to_vec_pretty(&list).map_err(|e| e.to_string())?,
    )
}
fn allowed(app: &tauri::AppHandle) -> Result<Vec<PathBuf>, String> {
    Ok([
        app.path()
            .app_cache_dir()
            .map_err(|e| e.to_string())?
            .join("analysis"),
        app.path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("loop-audio"),
    ]
    .into_iter()
    .filter_map(|p| fs::canonicalize(p).ok())
    .collect())
}
fn response(app: &tauri::AppHandle, path: &Path, project: &Project) -> Result<Value, String> {
    let root = path.parent().ok_or("Projektordner fehlt")?;
    let media = inside(root, &project.media.file)?;
    app.asset_protocol_scope()
        .allow_file(&media)
        .map_err(|e| e.to_string())?;
    let mut warnings = vec![];
    for id in refs(project).collect::<std::collections::HashSet<_>>() {
        if let Err(error) = read_material(root, id).and_then(|m| resolve_material(root, m)) {
            warnings.push(format!("Notendaten {id}: {error}"));
        }
    }
    if let Err(error) = remember(app, path, project) {
        warnings.push(error);
    }
    Ok(json!({"path":path,"mediaPath":media,"snapshot":project,"warnings":warnings}))
}
#[tauri::command]
pub fn list_projects(
    app: tauri::AppHandle,
    state: tauri::State<ProjectsState>,
) -> Result<Vec<RecentProject>, String> {
    let _guard = state.0.lock().map_err(|e| e.to_string())?;
    list_recent(&recent(&app)?)
}
#[tauri::command]
pub fn default_project_dir(app: tauri::AppHandle) -> Result<String, String> {
    Ok(app
        .path()
        .document_dir()
        .map_err(|e| e.to_string())?
        .join("LoopStudio/Projekte")
        .to_string_lossy()
        .into_owned())
}
#[tauri::command]
pub async fn open_project(app: tauri::AppHandle, path: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<ProjectsState>();
        let _guard = state.0.lock().map_err(|e| e.to_string())?;
        let (path, project) = project_at(Path::new(&path))?;
        response(&app, &path, &project)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn save_project_material(
    app: tauri::AppHandle,
    path: String,
    data: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if data.len() as u64 > MAX_JSON {
            return Err("Notendaten überschreiten 64 MB".into());
        }
        let state = app.state::<ProjectsState>();
        let _guard = state.0.lock().map_err(|e| e.to_string())?;
        let (path, _) = project_at(Path::new(&path))?;
        save_material(
            path.parent().ok_or("Projektordner fehlt")?,
            &allowed(&app)?,
            serde_json::from_str(&data).map_err(|e| e.to_string())?,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn load_project_material(
    app: tauri::AppHandle,
    path: String,
    id: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (path, _) = project_at(Path::new(&path))?;
        let root = path.parent().ok_or("Projektordner fehlt")?;
        let value = resolve_material(root, read_material(root, &id)?)?;
        if let Some(stems) = value["analysis"]["stems"].as_array() {
            for stem in stems {
                if let Some(path) = stem["path"].as_str() {
                    app.asset_protocol_scope()
                        .allow_file(path)
                        .map_err(|e| e.to_string())?;
                }
            }
        }
        Ok(value.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn save_project(
    app: tauri::AppHandle,
    path: String,
    session: crate::PracticeSession,
    workspace: Workspace,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<ProjectsState>();
        let _guard = state.0.lock().map_err(|e| e.to_string())?;
        let (path, mut project) = project_at(Path::new(&path))?;
        project.session = session;
        project.workspace = workspace;
        project.updated_at = now();
        write_project(&path, &project)?;
        // The project is the source of truth; a recent-list failure must not undo a successful save.
        if let Err(e) = remember(&app, &path, &project) {
            eprintln!("{e}");
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
fn folder_name(name: &str) -> Result<&str, String> {
    let name = name.trim();
    let base = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    if name.is_empty()
        || name.chars().count() > 80
        || name.ends_with(['.', ' '])
        || name
            .chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
        || [
            "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
            "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
        ]
        .contains(&base.as_str())
    {
        return Err(
            "Bitte einen Projektnamen mit maximal 80 Zeichen ohne Windows-Sonderzeichen wählen."
                .into(),
        );
    }
    Ok(name)
}
fn create_on_disk(
    parent: &Path,
    name: &str,
    source: &Path,
    media_name: Option<&str>,
    mut session: crate::PracticeSession,
    mut workspace: Workspace,
    global_materials: &Path,
    allowed: &[PathBuf],
    mut progress: impl FnMut(u64, u64),
) -> Result<(PathBuf, Project), String> {
    let name = folder_name(name)?;
    crate::validate_session(&session)?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let parent = fs::canonicalize(parent).map_err(|e| e.to_string())?;
    let target = parent.join(name);
    if target.exists() {
        return Err("Ein Ordner mit diesem Projektnamen existiert bereits. Bitte einen anderen Namen wählen.".into());
    }
    let source =
        fs::canonicalize(source).map_err(|_| "Aufnahme wurde nicht gefunden.".to_owned())?;
    let metadata = source.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err("Bitte eine Audio-/Videodatei wählen.".into());
    }
    let filename = media_name.map(str::to_owned).unwrap_or_else(|| {
        source
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned()
    });
    if filename.is_empty()
        || filename.contains(['/', '\\', ':'])
        || filename == "."
        || filename == ".."
    {
        return Err("Ungültiger Aufnahmename".into());
    }
    let extension = Path::new(&filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let kind = if ["mp4", "webm", "mov", "mkv", "m4v"].contains(&extension.as_str()) {
        "video"
    } else if ["mp3", "wav", "flac", "ogg", "m4a", "aac", "opus"].contains(&extension.as_str()) {
        "audio"
    } else {
        return Err("Dateiformat der Aufnahme wird nicht unterstützt.".into());
    };
    let temp = tempfile::Builder::new()
        .prefix(".loopstudio-new-")
        .tempdir_in(&parent)
        .map_err(|e| e.to_string())?;
    let root = fs::canonicalize(temp.path()).map_err(|e| e.to_string())?;
    let relative = format!("media/{filename}");
    fs::create_dir(root.join("media")).map_err(|e| e.to_string())?;
    let mut input = fs::File::open(&source).map_err(|e| e.to_string())?;
    let mut output = fs::File::create(root.join(&relative)).map_err(|e| e.to_string())?;
    let mut buffer = vec![0; 4 * 1024 * 1024];
    let mut copied = 0;
    loop {
        let n = input.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        output.write_all(&buffer[..n]).map_err(|e| e.to_string())?;
        copied += n as u64;
        progress(copied, metadata.len());
    }
    output.sync_all().map_err(|e| e.to_string())?;
    drop(output);
    drop(input);
    let after = source.metadata().map_err(|e| e.to_string())?;
    if copied != metadata.len()
        || after.len() != metadata.len()
        || after.modified().ok() != metadata.modified().ok()
    {
        return Err(
            "Die Aufnahme wurde während des Kopierens verändert. Bitte erneut versuchen.".into(),
        );
    }
    let mut mapping = std::collections::HashMap::new();
    for old in session
        .loops
        .iter()
        .filter_map(|l| l.material_id.as_ref())
        .chain(workspace.material_id.as_ref())
    {
        if mapping.contains_key(old) {
            continue;
        }
        if !id_ok(old) {
            return Err("Ungültige bisherige Notendaten".into());
        }
        let bytes = fs::read(global_materials.join(format!("{old}.json"))).map_err(|_| {
            "Bisherige Loop-Notendaten fehlen. Das Projekt wurde nicht angelegt.".to_owned()
        })?;
        if bytes.len() as u64 > MAX_JSON || format!("{:x}", Sha256::digest(&bytes)) != *old {
            return Err("Bisherige Loop-Notendaten sind beschädigt.".into());
        }
        let value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        mapping.insert(old.clone(), save_material(&root, allowed, value)?);
    }
    for l in &mut session.loops {
        if let Some(id) = &l.material_id {
            l.material_id = mapping.get(id).cloned();
        }
    }
    workspace.material_id = workspace
        .material_id
        .and_then(|id| mapping.get(&id).cloned());
    session.key = "project".into();
    let project = Project {
        format: FORMAT.into(),
        version: 1,
        name: name.into(),
        media: ProjectMedia {
            file: relative,
            name: filename,
            kind: kind.into(),
        },
        session,
        workspace,
        updated_at: now(),
    };
    write_project(&root.join(MANIFEST), &project)?;
    // Both paths are verified siblings under the user-selected parent before moving a directory.
    if root.parent() != Some(parent.as_path()) || target.parent() != Some(parent.as_path()) {
        return Err("Ungültiger Projektzielordner".into());
    }
    fs::rename(&root, &target).map_err(|e| e.to_string())?;
    Ok((target.join(MANIFEST), project))
}
#[tauri::command]
pub async fn create_project(
    app: tauri::AppHandle,
    parent: String,
    name: String,
    source: String,
    media_name: Option<String>,
    session: crate::PracticeSession,
    workspace: Workspace,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move||{
        let state=app.state::<ProjectsState>();let _guard=state.0.lock().map_err(|e|e.to_string())?;
        let data=app.path().app_data_dir().map_err(|e|e.to_string())?;
        let(path,project)=create_on_disk(Path::new(&parent),&name,Path::new(&source),media_name.as_deref(),session,workspace,&data.join("loop-materials"),&allowed(&app)?,|copied,total|{let _=app.emit("project-progress",json!({"percent":if total==0{0.0}else{100.0*copied as f64/total as f64},"message":"Aufnahme wird ins Projekt kopiert …"}));})?;
        response(&app,&path,&project)
    }).await.map_err(|e|e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    fn session(loops: Vec<crate::PracticeLoop>) -> crate::PracticeSession {
        crate::PracticeSession {
            key: "old-recording.wav".into(),
            loops,
            speed: 0.75,
            offset: 8.0,
        }
    }
    fn legacy_material(dir: &Path, value: Value) -> String {
        fs::create_dir_all(dir).unwrap();
        let bytes = serde_json::to_vec(&value).unwrap();
        let id = format!("{:x}", Sha256::digest(&bytes));
        fs::write(dir.join(format!("{id}.json")), bytes).unwrap();
        id
    }
    #[test]
    fn project_survives_restart_move_and_removal_of_original_and_global_cache() {
        let scratch = tempfile::tempdir().unwrap();
        let base = fs::canonicalize(scratch.path()).unwrap();
        let source = base.join("recording.wav");
        fs::write(&source, b"the original recording").unwrap();
        let cache = base.join("cache");
        fs::create_dir(&cache).unwrap();
        let stem = cache.join("guitar.wav");
        fs::write(&stem, b"isolated guitar").unwrap();
        let materials = base.join("old-materials");
        let gp = include_bytes!("../../src/fixtures/positions.gp5");
        let midi = b"MThd\0\0\0\x06\0\0\0\x01\0\x60MTrk\0\0\0\x04\0\xff\x2f\0";
        let score = json!({"id":"gp","name":"riff.gp5","gp":STANDARD.encode(gp),"edited":true,"notes":[{"midi":66,"time":0.1,"duration":0.25,"track":0,"velocity":0.8,"position":{"string":0,"fret":2,"source":"manual"}}]});
        let gp_id = legacy_material(
            &materials,
            json!({"version":1,"analysis":{"start":8,"end":10,"stems":[{"id":4,"path":stem,"notes":[{"midi":64}]}]},"score":score,"scoreState":{"track":0,"start":0.5,"end":1.5,"speed":0.75,"loop":true,"alignment":{"mediaStart":8,"mediaEnd":10,"scoreStart":0.5,"scoreEnd":1.5}},"offset":8}),
        );
        let midi_id = legacy_material(
            &materials,
            json!({"version":1,"analysis":null,"score":{"id":"midi","name":"piano.mid","midi":STANDARD.encode(midi),"notes":[{"midi":72,"time":0.3,"duration":0.5}]},"offset":20}),
        );
        let loops = vec![
            crate::PracticeLoop {
                id: "guitar".into(),
                name: "Riff".into(),
                start: 8.,
                end: 10.,
                material_id: Some(gp_id.clone()),
                rhythm: None,
            },
            crate::PracticeLoop {
                id: "piano".into(),
                name: "Piano".into(),
                start: 20.,
                end: 25.,
                material_id: Some(midi_id),
                rhythm: None,
            },
        ];
        let workspace = Workspace {
            material_id: Some(gp_id.clone()),
            selected_loop_id: Some("guitar".into()),
            a: Some(8.),
            b: Some(10.),
            looping: true,
            view: "guitar".into(),
            volume: 0.4,
        };
        let (path, project) = create_on_disk(
            &base,
            "Practice",
            &source,
            None,
            session(loops),
            workspace,
            &materials,
            &[fs::canonicalize(&cache).unwrap()],
            |_, _| {},
        )
        .unwrap();
        let root = path.parent().unwrap();
        assert_eq!(
            fs::read(inside(root, &project.media.file).unwrap()).unwrap(),
            b"the original recording"
        );
        assert_eq!(project.session.speed, 0.75);
        assert_ne!(project.workspace.material_id.as_ref().unwrap(), &gp_id);
        assert!(!fs::read_to_string(&path)
            .unwrap()
            .contains(&base.to_string_lossy().to_string()));
        for id in refs(&project) {
            assert!(!read_material(root, id)
                .unwrap()
                .to_string()
                .contains(&base.to_string_lossy().to_string()));
        }
        assert_eq!(
            fs::read(root.join(format!("assets/notation/{:x}.gp5", Sha256::digest(gp)))).unwrap(),
            gp
        );
        assert_eq!(
            fs::read(root.join(format!("assets/notation/{:x}.mid", Sha256::digest(midi)))).unwrap(),
            midi
        );
        fs::remove_file(&source).unwrap();
        fs::remove_file(&stem).unwrap();
        let moved = base.join("Moved");
        assert_eq!(root.parent(), Some(base.as_path()));
        assert_eq!(moved.parent(), Some(base.as_path()));
        fs::rename(root, &moved).unwrap();
        let (path, loaded) = project_at(&moved.join(MANIFEST)).unwrap();
        let root = path.parent().unwrap();
        assert_eq!(loaded.session.loops.len(), 2);
        assert_eq!(loaded.workspace.selected_loop_id.as_deref(), Some("guitar"));
        let restored = resolve_material(
            root,
            read_material(root, loaded.workspace.material_id.as_ref().unwrap()).unwrap(),
        )
        .unwrap();
        assert_eq!(
            STANDARD
                .decode(restored["score"]["gp"].as_str().unwrap())
                .unwrap(),
            gp
        );
        assert_eq!(restored["score"]["notes"][0]["midi"], 66);
        assert_eq!(restored["score"]["notes"][0]["position"]["fret"], 2);
        assert_eq!(restored["scoreState"]["alignment"]["mediaStart"], 8);
        assert_eq!(
            fs::read(restored["analysis"]["stems"][0]["path"].as_str().unwrap()).unwrap(),
            b"isolated guitar"
        );
        let stable = save_material(root, &[], restored.clone()).unwrap();
        assert_eq!(Some(&stable), loaded.workspace.material_id.as_ref());
        let mut edited = restored;
        edited["score"]["notes"][0]["midi"] = json!(67);
        let edited_id = save_material(root, &[], edited).unwrap();
        assert_ne!(edited_id, stable);
        assert_eq!(
            read_material(root, &stable).unwrap()["score"]["notes"][0]["midi"],
            66
        );
        let mut updated = loaded;
        updated.workspace.material_id = Some(edited_id);
        write_project(&path, &updated).unwrap();
        let (_, reopened) = project_at(&path).unwrap();
        assert_eq!(
            read_material(root, reopened.workspace.material_id.as_ref().unwrap()).unwrap()["score"]
                ["notes"][0]["midi"],
            67
        );
    }
    #[test]
    fn invalid_update_keeps_last_complete_manifest_and_corruption_is_reported() {
        let scratch = tempfile::tempdir().unwrap();
        let base = fs::canonicalize(scratch.path()).unwrap();
        let source = base.join("song.wav");
        fs::write(&source, b"audio").unwrap();
        let (path, mut project) = create_on_disk(
            &base,
            "Project",
            &source,
            None,
            session(vec![]),
            Workspace::default(),
            &base.join("legacy"),
            &[],
            |_, _| {},
        )
        .unwrap();
        let before = fs::read(&path).unwrap();
        project.workspace.material_id = Some("a".repeat(64));
        assert!(write_project(&path, &project).is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
        let root = path.parent().unwrap();
        let id =
            save_material(root, &[], json!({"version":1,"analysis":null,"score":null})).unwrap();
        assert!(read_material(root, &id).unwrap()["analysis"].is_null());
        fs::write(root.join(format!("materials/{id}.json")), b"broken").unwrap();
        assert!(read_material(root, &id).unwrap_err().contains("beschädigt"));
        for path in [
            "../song.wav",
            "/song.wav",
            "media/../../song.wav",
            "C:/song.wav",
            "media\\song.wav",
        ] {
            assert!(inside(root, path).is_err(), "{path}");
        }
        assert!(save_material(
            root,
            &[],
            json!({"version":1,"analysis":{"stems":[{"path":source}]}})
        )
        .is_err());
    }
    #[test]
    fn creation_never_overwrites_projects_and_failed_migration_leaves_no_project() {
        let scratch = tempfile::tempdir().unwrap();
        let base = fs::canonicalize(scratch.path()).unwrap();
        let source = base.join("source.media");
        fs::write(&source, b"drop-imported-audio").unwrap();
        let (path, _) = create_on_disk(
            &base,
            "Original",
            &source,
            Some("imported.wav"),
            session(vec![]),
            Workspace::default(),
            &base.join("legacy"),
            &[],
            |_, _| {},
        )
        .unwrap();
        let before = fs::read(&path).unwrap();
        assert!(create_on_disk(
            &base,
            "Original",
            &source,
            Some("imported.wav"),
            session(vec![]),
            Workspace::default(),
            &base.join("legacy"),
            &[],
            |_, _| {}
        )
        .is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
        let bad = Workspace {
            material_id: Some("a".repeat(64)),
            ..Workspace::default()
        };
        assert!(create_on_disk(
            &base,
            "Failed",
            &source,
            Some("imported.wav"),
            session(vec![]),
            bad,
            &base.join("legacy"),
            &[],
            |_, _| {}
        )
        .is_err());
        assert!(!base.join("Failed").exists());
        assert!(!fs::read_dir(&base).unwrap().any(|e| e
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".loopstudio-new-")));
        for bad in [
            "..",
            "../escape",
            "CON",
            "LPT1.demo",
            "bad:name",
            "trailing.",
        ] {
            assert!(folder_name(bad).is_err(), "{bad}");
        }
    }
    #[test]
    fn canonical_gp7_is_saved_as_gp_even_when_the_import_name_was_midi() {
        let scratch = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(scratch.path()).unwrap();
        let gp = include_bytes!("../../src/fixtures/editor-loop.gp");
        let midi = b"original midi bytes";
        for name in ["import.mid", "import.gp"] {
        let value = json!({"version":1,"analysis":null,"score":{"id":"loop-score","name":name,"gpFormat":"gp7","gp":STANDARD.encode(gp),"midi":STANDARD.encode(midi),"notes":[{"midi":69,"time":0,"duration":0.5,"track":0,"velocity":0.8}]},"scoreState":null,"analysisTrack":0,"offset":8});
        let id = save_material(&root, &[], value.clone()).unwrap();
        let file = root.join(format!("assets/notation/{:x}.gp", Sha256::digest(gp)));
        assert_eq!(fs::read(&file).unwrap(), gp);
        assert!(!root.join(format!("assets/notation/{:x}.mid", Sha256::digest(gp))).exists());
        assert_eq!(fs::read(root.join(format!("assets/notation/{:x}.mid", Sha256::digest(midi)))).unwrap(), midi);
        assert_eq!(read_material(&root, &id).unwrap(), value);
        }
    }

    #[test]
    fn external_editor_uses_a_validated_project_and_moves_with_it() {
        let temporary = tempfile::tempdir().unwrap();
        let base = fs::canonicalize(temporary.path()).unwrap();
        let source = base.join("recording.wav");fs::write(&source,b"media").unwrap();
        let (path, _) = create_on_disk(&base,"External",&source,None,session(vec![]),Workspace::default(),&base.join("legacy"),&[],|_,_|{}).unwrap();
        let directory = external_editor_dir(path.to_str().unwrap()).unwrap();
        assert_eq!(directory,path.parent().unwrap().join("assets/external-editor"));
        fs::write(directory.join("test.gp"),b"score").unwrap();
        let moved = base.join("Moved");fs::rename(path.parent().unwrap(),&moved).unwrap();
        let directory = external_editor_dir(moved.join(MANIFEST).to_str().unwrap()).unwrap();
        assert_eq!(fs::read(directory.join("test.gp")).unwrap(),b"score");
        let invalid=base.join("invalid.loopstudio");fs::write(&invalid,b"{}").unwrap();
        assert!(external_editor_dir(invalid.to_str().unwrap()).is_err());
    }

}
