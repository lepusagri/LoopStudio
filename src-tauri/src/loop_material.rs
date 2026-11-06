use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{fs, path::Path};
use tauri::Manager;

fn valid_id(id: &str) -> bool { id.len()==64 && id.bytes().all(|b| b.is_ascii_hexdigit()) }

fn write_material(dir: &Path, data: &str) -> Result<String,String> {
    if data.len()>64*1024*1024 { return Err("Die Notendaten sind zu groß zum Speichern (maximal 64 MB).".into()); }
    let value:Value=serde_json::from_str(data).map_err(|e|e.to_string())?;
    if value["version"]!=1 { return Err("Unbekanntes Notendatenformat".into()); }
    fs::create_dir_all(dir).map_err(|e|e.to_string())?;
    let id=format!("{:x}",Sha256::digest(data.as_bytes()));
    let path=dir.join(format!("{id}.json"));
    if !path.exists() {
        let mut file=tempfile::NamedTempFile::new_in(dir).map_err(|e|e.to_string())?;
        std::io::Write::write_all(&mut file,data.as_bytes()).map_err(|e|e.to_string())?;
        file.persist(&path).map_err(|e|e.to_string())?;
    }
    Ok(id)
}

fn read_material(dir:&Path,id:&str)->Result<String,String> {
    if !valid_id(id) { return Err("Ungültige Notendaten-ID".into()); }
    let bytes=fs::read(dir.join(format!("{id}.json"))).map_err(|_|"Die gespeicherten Notendaten fehlen.".to_owned())?;
    if format!("{:x}",Sha256::digest(&bytes))!=id.to_lowercase() { return Err("Die gespeicherten Notendaten sind beschädigt.".into()); }
    String::from_utf8(bytes).map_err(|e|e.to_string())
}

fn retain_audio(cache:&Path, saved:&Path,value:&mut Value)->Result<(),String> {
    let cache=fs::canonicalize(cache).ok();
    let saved_root=fs::canonicalize(saved).ok();
    if let Some(stems)=value.get_mut("analysis").and_then(|v|v.get_mut("stems")).and_then(Value::as_array_mut){
        for stem in stems {
            let Some(path)=stem["path"].as_str().and_then(|s|fs::canonicalize(s).ok()) else {continue};
            if saved_root.as_ref().is_some_and(|root|path.starts_with(root)){continue;}
            if !cache.as_ref().is_some_and(|root|path.starts_with(root)){return Err("Ungültiger Analysepfad beim Speichern".into());}
            let parent=path.parent().and_then(|p|p.file_name()).and_then(|s|s.to_str()).ok_or("Analyseordner fehlt")?;
            if parent.len()>64 || !parent.bytes().all(|b|b.is_ascii_hexdigit()){return Err("Ungültiger Analyseordner".into());}
            let target=saved.join(parent);fs::create_dir_all(&target).map_err(|e|e.to_string())?;
            let destination=target.join(path.file_name().ok_or("Spurname fehlt")?);
            if !destination.is_file(){
                let mut temporary=tempfile::NamedTempFile::new_in(&target).map_err(|e|e.to_string())?;
                std::io::copy(&mut fs::File::open(&path).map_err(|e|e.to_string())?,&mut temporary).map_err(|e|e.to_string())?;
                temporary.persist(&destination).map_err(|e|e.to_string())?;
            }
            stem["path"]=Value::String(fs::canonicalize(destination).map_err(|e|e.to_string())?.to_string_lossy().into_owned());
        }
    }
    Ok(())
}

pub fn authorize_analysis(app:&tauri::AppHandle, result:&Value)->Result<(),String> {
    let root=app.path().app_cache_dir().map_err(|e|e.to_string())?.join("analysis");
    let root=fs::canonicalize(root).ok();
    let saved=fs::canonicalize(app.path().app_data_dir().map_err(|e|e.to_string())?.join("loop-audio")).ok();
    if let Some(stems)=result["stems"].as_array() {
        for stem in stems {
            if let Some(path)=stem["path"].as_str().and_then(|p|fs::canonicalize(p).ok()) {
                if !root.as_ref().is_some_and(|r|path.starts_with(r)) && !saved.as_ref().is_some_and(|r|path.starts_with(r)) { return Err("Die gespeicherte Audiospur liegt außerhalb des Analyseordners.".into()); }
                app.asset_protocol_scope().allow_file(path).map_err(|e|e.to_string())?;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn save_loop_material(app:tauri::AppHandle,data:String)->Result<String,String> {
    let dir=app.path().app_data_dir().map_err(|e|e.to_string())?;
    let cache=app.path().app_cache_dir().map_err(|e|e.to_string())?.join("analysis");
    tauri::async_runtime::spawn_blocking(move|| {
        if data.len()>64*1024*1024 {return Err("Maximal 64 MB Notendaten pro Loop".into());}
        let mut value:Value=serde_json::from_str(&data).map_err(|e|e.to_string())?;
        retain_audio(&cache,&dir.join("loop-audio"),&mut value)?;
        write_material(&dir.join("loop-materials"),&value.to_string())
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub async fn load_loop_material(app:tauri::AppHandle,id:String)->Result<String,String> {
    tauri::async_runtime::spawn_blocking(move|| {
        let data=read_material(&app.path().app_data_dir().map_err(|e|e.to_string())?.join("loop-materials"),&id)?;
        let value:Value=serde_json::from_str(&data).map_err(|e|e.to_string())?;
        if !value["analysis"].is_null() { authorize_analysis(&app,&value["analysis"])?; }
        Ok(data)
    }).await.map_err(|e|e.to_string())?
}

#[cfg(test)] mod tests {
    use super::*;
    #[test] fn score_only_loop_remains_without_analysis() {
        let dir=tempfile::tempdir().unwrap();
        let mut value=serde_json::json!({"version":1,"analysis":null,"score":{"name":"song.gp5","gp":"R1A1"}});
        let original=value.clone();
        retain_audio(dir.path(),&dir.path().join("saved"),&mut value).unwrap();
        assert_eq!(value,original);
        let id=write_material(dir.path(),&value.to_string()).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&read_material(dir.path(),&id).unwrap()).unwrap(),original);
    }
    #[test] fn saved_loop_audio_survives_removal_of_analysis_cache() {
        let dir=tempfile::tempdir().unwrap();let cache=dir.path().join("cache");
        fs::create_dir_all(cache.join("abc123")).unwrap();
        let source=cache.join("abc123/guitar.wav");fs::write(&source,b"test-audio").unwrap();
        let saved=dir.path().join("saved");
        let mut value=serde_json::json!({"analysis":{"stems":[{"path":source}]}});
        retain_audio(&cache,&saved,&mut value).unwrap();
        fs::remove_file(source).unwrap();
        assert_eq!(fs::read(value["analysis"]["stems"][0]["path"].as_str().unwrap()).unwrap(),b"test-audio");
        retain_audio(&cache,&saved,&mut value).unwrap();
    }
    #[test] fn restart_roundtrip_deduplicates_and_detects_missing_or_damaged_data() {
        let dir=tempfile::tempdir().unwrap();
        let data=r#"{"version":1,"analysis":{"stems":[{"notes":[{"midi":64}]}]},"score":{"gp":"R1A1"}}"#;
        let id=write_material(dir.path(),data).unwrap();
        assert_eq!(write_material(dir.path(),data).unwrap(),id);
        assert_eq!(read_material(dir.path(),&id).unwrap(),data);
        assert!(read_material(dir.path(),"../sessions").is_err());
        fs::write(dir.path().join(format!("{id}.json")),"broken").unwrap();
        assert!(read_material(dir.path(),&id).is_err());
    }
}
