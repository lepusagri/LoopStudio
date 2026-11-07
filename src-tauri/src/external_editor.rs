//! Explicit Guitar Pro round trips. Working copies are never overwritten by export.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};
use tauri::Manager;

const MAX_GP: usize = 20 * 1024 * 1024;
const WORKING_FILE: &str = "Loop-Partitur.gp";
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Session {
    version: u8,
    document_id: String,
    context: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Exported {
    session_id: String,
    path: String,
    baseline_hash: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Imported {
    gp: String,
    hash: String,
    path: String,
    backup_path: String,
}

fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn valid_id(id: &str) -> bool {
    (6..=80).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}
fn valid_owner(document_id: &str, context: &str) -> Result<(), String> {
    if document_id.is_empty()
        || document_id.len() > 200
        || context.is_empty()
        || context.len() > 200
    {
        return Err("Ungültige Zuordnung der externen Partitur.".into());
    }
    Ok(())
}
fn gp_bytes(encoded: &str) -> Result<Vec<u8>, String> {
    if encoded.len() > MAX_GP.div_ceil(3) * 4 {
        return Err("Die Partitur überschreitet 20 MB.".into());
    }
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| "Ungültige Notendaten.")?;
    if bytes.len() > MAX_GP || !bytes.starts_with(b"PK\x03\x04") {
        return Err("Bitte eine gültige Guitar-Pro-Datei im .gp-Format verwenden.".into());
    }
    Ok(bytes)
}
fn bounded_read(path: &Path) -> Result<Vec<u8>, String> {
    let file = fs::File::open(path)
        .map_err(|e| format!("Externe Partitur konnte nicht gelesen werden: {e}"))?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_GP as u64 {
        return Err("Externe Partitur fehlt oder überschreitet 20 MB.".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_GP as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > MAX_GP {
        return Err("Die Partitur überschreitet 20 MB.".into());
    }
    Ok(bytes)
}
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut temporary = tempfile::NamedTempFile::new_in(path.parent().ok_or("Notenordner fehlt")?)
        .map_err(|e| e.to_string())?;
    temporary.write_all(bytes).map_err(|e| e.to_string())?;
    temporary.as_file().sync_all().map_err(|e| e.to_string())?;
    temporary.persist(path).map_err(|e| e.error.to_string())?;
    Ok(())
}
fn root(app: &tauri::AppHandle, project: Option<&str>) -> Result<PathBuf, String> {
    let directory = match project {
        Some(path) => crate::projects::external_editor_dir(path)?,
        None => app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("external-scores"),
    };
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    fs::canonicalize(directory).map_err(|e| e.to_string())
}
fn contained(root: &Path, path: &Path) -> Result<PathBuf, String> {
    let root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    let path = fs::canonicalize(path)
        .map_err(|_| "Die externe Arbeitskopie fehlt. Bitte erneut in Guitar Pro öffnen.")?;
    if !path.starts_with(&root) {
        return Err("Die externe Datei liegt außerhalb des Notenordners.".into());
    }
    Ok(path)
}
fn session_dir(root: &Path, id: &str, document_id: &str, context: &str) -> Result<PathBuf, String> {
    valid_owner(document_id, context)?;
    if !valid_id(id) {
        return Err("Ungültige externe Partitur-ID.".into());
    }
    let directory = contained(root, &root.join(id))?;
    let manifest = contained(root, &directory.join("session.json"))?;
    if fs::metadata(&manifest).map_err(|e| e.to_string())?.len() > 4096 {
        return Err("Ungültige externe Partitur-Zuordnung.".into());
    }
    let session: Session = serde_json::from_slice(&fs::read(manifest).map_err(|e| e.to_string())?)
        .map_err(|_| "Externe Partitur-Zuordnung ist beschädigt.")?;
    if session.version != 1 || session.document_id != document_id || session.context != context {
        return Err("Die externe Partitur gehört zu einem anderen Loop oder Dokument.".into());
    }
    Ok(directory)
}
fn export(
    root: &Path,
    document_id: &str,
    context: &str,
    encoded: &str,
) -> Result<Exported, String> {
    valid_owner(document_id, context)?;
    let bytes = gp_bytes(encoded)?;
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let directory = tempfile::Builder::new()
        .prefix("score-")
        .tempdir_in(root)
        .map_err(|e| e.to_string())?;
    let path = directory.path().join(WORKING_FILE);
    atomic_write(&path, &bytes)?;
    fs::create_dir(directory.path().join("history")).map_err(|e| e.to_string())?;
    atomic_write(
        &directory
            .path()
            .join("history")
            .join(format!("{}.gp", hash(&bytes))),
        &bytes,
    )?;
    atomic_write(
        &directory.path().join("session.json"),
        &serde_json::to_vec(&Session {
            version: 1,
            document_id: document_id.into(),
            context: context.into(),
        })
        .map_err(|e| e.to_string())?,
    )?;
    let directory = directory.keep();
    Ok(Exported {
        session_id: directory
            .file_name()
            .ok_or("Partitur-ID fehlt")?
            .to_string_lossy()
            .into_owned(),
        path: dunce::simplified(&path).to_string_lossy().into_owned(),
        baseline_hash: hash(&bytes),
    })
}
fn read_changes(
    root: &Path,
    id: &str,
    document_id: &str,
    context: &str,
    baseline: &str,
    current: &str,
) -> Result<Imported, String> {
    let directory = session_dir(root, id, document_id, context)?;
    let current = gp_bytes(current)?;
    if hash(&current) != baseline {
        return Err("Die Partitur wurde inzwischen in LoopStudio geändert. Bitte eine neue Arbeitskopie in Guitar Pro öffnen; die bisherige externe Datei bleibt erhalten.".into());
    }
    let path = contained(root, &directory.join(WORKING_FILE))?;
    let first = bounded_read(&path)?;
    std::thread::sleep(Duration::from_millis(180));
    let path = contained(root, &directory.join(WORKING_FILE))?;
    let bytes = bounded_read(&path)?;
    if first != bytes {
        return Err("Guitar Pro speichert noch. Bitte kurz warten und erneut übernehmen.".into());
    }
    if !bytes.starts_with(b"PK\x03\x04") {
        return Err(
            "Die externe Datei ist noch nicht vollständig gespeichert oder kein .gp-Dokument."
                .into(),
        );
    }
    let history = contained(root, &directory.join("history"))?;
    let backup = history.join(format!("{baseline}.gp"));
    if backup.exists() {
        let backup = contained(root, &backup)?;
        if bounded_read(&backup)? != current {
            return Err("Die Sicherung der bisherigen Notenfassung ist beschädigt.".into());
        }
    } else {
        let mut temporary = tempfile::NamedTempFile::new_in(&history).map_err(|e| e.to_string())?;
        temporary.write_all(&current).map_err(|e| e.to_string())?;
        temporary.as_file().sync_all().map_err(|e| e.to_string())?;
        temporary
            .persist_noclobber(&backup)
            .map_err(|e| e.error.to_string())?;
    }
    Ok(Imported {
        hash: hash(&bytes),
        gp: STANDARD.encode(bytes),
        path: dunce::simplified(&path).to_string_lossy().into_owned(),
        backup_path: dunce::simplified(&backup).to_string_lossy().into_owned(),
    })
}

fn executable(path: &Path) -> Result<PathBuf, String> {
    let path = fs::canonicalize(path)
        .map_err(|_| "Guitar Pro wurde nicht gefunden. Bitte GuitarPro.exe auswählen.")?;
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .replace([' ', '-', '_'], "");
    if !path.is_file() || !name.starts_with("guitarpro") || !name.ends_with(".exe") {
        return Err(
            "Bitte die GuitarPro.exe der installierten Guitar-Pro-Version auswählen.".into(),
        );
    }
    Ok(path)
}
fn discover() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        use winreg::{
            enums::{
                HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WOW64_32KEY, KEY_WOW64_64KEY,
            },
            RegKey,
        };
        for name in ["GuitarPro.exe", "GuitarPro8.exe", "GuitarPro7.exe"] {
            for hive in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
                for view in [KEY_WOW64_64KEY, KEY_WOW64_32KEY] {
                    if let Ok(key) = RegKey::predef(hive).open_subkey_with_flags(
                        format!(r"Software\Microsoft\Windows\CurrentVersion\App Paths\{name}"),
                        KEY_READ | view,
                    ) {
                        if let Ok(path) = key.get_value::<String, _>("") {
                            if let Ok(path) = executable(Path::new(path.trim_matches('"'))) {
                                return Some(path);
                            }
                        }
                    }
                }
            }
        }
    }
    for variable in [
        "ProgramW6432",
        "ProgramFiles",
        "ProgramFiles(x86)",
        "LOCALAPPDATA",
    ] {
        if let Some(base) = std::env::var_os(variable) {
            for prefix in ["Arobas Music", "Programs/Arobas Music"] {
                if let Ok(entries) = fs::read_dir(PathBuf::from(&base).join(prefix)) {
                    let mut versions: Vec<_> = entries.flatten().map(|e| e.path()).collect();
                    versions.sort();
                    versions.reverse();
                    for directory in versions {
                        if let Ok(path) = executable(&directory.join("GuitarPro.exe")) {
                            return Some(path);
                        }
                    }
                }
            }
        }
    }
    #[cfg(unix)]
    if let Some(home)=std::env::var_os("HOME") {
        let prefix=std::env::var_os("WINEPREFIX").map(PathBuf::from).unwrap_or_else(||PathBuf::from(home).join(".wine"));
        for folder in ["Program Files", "Program Files (x86)"] {
            for version in ["Guitar Pro 8","Guitar Pro 7"] {
                if let Ok(path)=executable(&prefix.join("drive_c").join(folder).join("Arobas Music").join(version).join("GuitarPro.exe")){return Some(path);}
            }
        }
    }
    None
}
fn config(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("guitar-pro.json"))
}
#[tauri::command]
pub fn guitar_pro_path(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let saved = fs::read(config(&app)?)
        .ok()
        .and_then(|b| serde_json::from_slice::<String>(&b).ok())
        .and_then(|p| executable(Path::new(&p)).ok());
    Ok(saved
        .or_else(discover)
        .map(|p| p.to_string_lossy().into_owned()))
}
#[tauri::command]
pub fn set_guitar_pro_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let path = executable(Path::new(&path))?;
    let target = config(&app)?;
    fs::create_dir_all(target.parent().ok_or("Einstellungsordner fehlt")?)
        .map_err(|e| e.to_string())?;
    atomic_write(
        &target,
        &serde_json::to_vec(&path.to_string_lossy()).map_err(|e| e.to_string())?,
    )
}
#[tauri::command]
pub async fn export_external_score(
    app: tauri::AppHandle,
    project: Option<String>,
    document_id: String,
    context: String,
    gp: String,
) -> Result<Exported, String> {
    tauri::async_runtime::spawn_blocking(move || {
        export(
            &root(&app, project.as_deref())?,
            &document_id,
            &context,
            &gp,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn read_external_score(
    app: tauri::AppHandle,
    project: Option<String>,
    session_id: String,
    document_id: String,
    context: String,
    baseline_hash: String,
    gp: String,
) -> Result<Imported, String> {
    tauri::async_runtime::spawn_blocking(move || {
        read_changes(
            &root(&app, project.as_deref())?,
            &session_id,
            &document_id,
            &context,
            &baseline_hash,
            &gp,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn launch_external_score(
    app: tauri::AppHandle,
    project: Option<String>,
    session_id: String,
    document_id: String,
    context: String,
) -> Result<String, String> {
    let root = root(&app, project.as_deref())?;
    let directory = session_dir(&root, &session_id, &document_id, &context)?;
    let path = contained(&root, &directory.join(WORKING_FILE))?;
    let program = guitar_pro_path(app)?
        .ok_or("Guitar Pro wurde nicht gefunden. Bitte GuitarPro.exe auswählen.")?;
    // Direct argument passing; never a command shell or file association.
    let mut command=if cfg!(windows){
        let mut command=Command::new(&program);command.arg(dunce::simplified(&path));command
    }else{
        let converted=Command::new("winepath").arg("-w").arg(&path).output().map_err(|_|"Guitar Pro benötigt unter Linux Wine und winepath. Bitte Wine einrichten.")?;
        if !converted.status.success(){return Err("Wine konnte den Notendateipfad nicht umwandeln.".into());}
        let mut command=Command::new("wine");command.arg(&program).arg(String::from_utf8_lossy(&converted.stdout).trim());command
    };
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Guitar Pro konnte nicht gestartet werden: {e}"))?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(dunce::simplified(&path).to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn encoded(value: &str) -> String {
        STANDARD.encode(format!("PK\x03\x04{value}"))
    }
    #[test]
    fn exports_are_separate_and_previous_versions_survive_import_and_restart() {
        let root = tempfile::tempdir().unwrap();
        let original = encoded("original");
        let one = export(root.path(), "doc", "loop:1", &original).unwrap();
        let two = export(root.path(), "doc", "loop:1", &original).unwrap();
        assert_ne!(one.session_id, two.session_id);
        fs::write(&one.path, b"PK\x03\x04external").unwrap();
        let imported = read_changes(
            root.path(),
            &one.session_id,
            "doc",
            "loop:1",
            &one.baseline_hash,
            &original,
        )
        .unwrap();
        assert_eq!(
            fs::read(&imported.backup_path).unwrap(),
            b"PK\x03\x04original"
        );
        assert_eq!(
            STANDARD.decode(&imported.gp).unwrap(),
            b"PK\x03\x04external"
        );
        assert_eq!(fs::read(&two.path).unwrap(), b"PK\x03\x04original");
        fs::write(&one.path, b"PK\x03\x04second edit").unwrap();
        let second = read_changes(
            root.path(),
            &one.session_id,
            "doc",
            "loop:1",
            &imported.hash,
            &imported.gp,
        )
        .unwrap();
        assert_eq!(fs::read(second.backup_path).unwrap(), b"PK\x03\x04external");
        assert_eq!(
            fs::read(imported.backup_path).unwrap(),
            b"PK\x03\x04original"
        );
    }
    #[test]
    fn refuses_wrong_loop_traversal_conflicts_and_incomplete_files() {
        let root = tempfile::tempdir().unwrap();
        let original = encoded("original");
        let session = export(root.path(), "doc", "loop:1", &original).unwrap();
        assert!(session_dir(root.path(), "../outside", "doc", "loop:1").is_err());
        assert!(session_dir(root.path(), &session.session_id, "other", "loop:1").is_err());
        assert!(session_dir(root.path(), &session.session_id, "doc", "loop:2").is_err());
        assert!(read_changes(
            root.path(),
            &session.session_id,
            "doc",
            "loop:1",
            &session.baseline_hash,
            &encoded("internal edit")
        )
        .is_err());
        fs::write(&session.path, b"unfinished").unwrap();
        assert!(read_changes(
            root.path(),
            &session.session_id,
            "doc",
            "loop:1",
            &session.baseline_hash,
            &original
        )
        .is_err());
        let oversized = fs::File::create(&session.path).unwrap();
        oversized.set_len(MAX_GP as u64 + 1).unwrap();
        drop(oversized);
        assert!(read_changes(
            root.path(),
            &session.session_id,
            "doc",
            "loop:1",
            &session.baseline_hash,
            &original
        )
        .is_err());
    }
    #[test]
    fn moving_a_project_keeps_relative_session_links_usable() {
        let temporary = tempfile::tempdir().unwrap();
        let before = temporary.path().join("before");
        let after = temporary.path().join("after");
        let original = encoded("original");
        let session = export(&before, "doc", "workspace", &original).unwrap();
        fs::rename(&before, &after).unwrap();
        let root = fs::canonicalize(after).unwrap();
        assert!(read_changes(
            &root,
            &session.session_id,
            "doc",
            "workspace",
            &session.baseline_hash,
            &original
        )
        .is_ok());
    }
}
