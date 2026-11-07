use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, io::Write, path::Path};
use tauri::Manager;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase", default)]
pub struct GlobalSettings {
    transcriber: String,
    device: String,
    model_paths: BTreeMap<String,String>,
    hf_token: String,
}
impl Default for GlobalSettings {
    fn default()->Self { Self{transcriber:"basic-pitch".into(),device:"auto".into(),model_paths:BTreeMap::new(),hf_token:String::new()} }
}
#[derive(Serialize,Deserialize)]
#[serde(rename_all="camelCase")]
struct StoredSettings { version:u8, transcriber:String, device:String, model_paths:BTreeMap<String,String>, protected_token:String }
fn validate(settings:&GlobalSettings)->Result<(),String>{
    if !["basic-pitch","muscriptor-small","muscriptor-medium","muscriptor-large"].contains(&settings.transcriber.as_str())||!["auto","cpu","openvino"].contains(&settings.device.as_str())||settings.hf_token.len()>4096||settings.model_paths.len()>3||settings.model_paths.iter().any(|(key,path)|!["muscriptor-small","muscriptor-medium","muscriptor-large"].contains(&key.as_str())||path.len()>32768){return Err("Ungültige Analyse-Einstellungen".into());}
    Ok(())
}

#[cfg(windows)]
fn protect(data:&[u8],encrypt:bool)->Result<Vec<u8>,String>{
    use std::ffi::c_void;
    #[repr(C)] struct Blob{size:u32,data:*mut u8}
    #[link(name="crypt32")] unsafe extern "system" {
        fn CryptProtectData(input:*const Blob,description:*const u16,entropy:*const Blob,reserved:*mut c_void,prompt:*mut c_void,flags:u32,output:*mut Blob)->i32;
        fn CryptUnprotectData(input:*const Blob,description:*mut *mut u16,entropy:*const Blob,reserved:*mut c_void,prompt:*mut c_void,flags:u32,output:*mut Blob)->i32;
    }
    #[link(name="kernel32")] unsafe extern "system" { fn LocalFree(memory:*mut c_void)->*mut c_void; }
    let input=Blob{size:data.len() as u32,data:data.as_ptr() as *mut u8};
    let mut output=Blob{size:0,data:std::ptr::null_mut()};
    unsafe{
        let success=if encrypt {CryptProtectData(&input,std::ptr::null(),std::ptr::null(),std::ptr::null_mut(),std::ptr::null_mut(),1,&mut output)}else{CryptUnprotectData(&input,std::ptr::null_mut(),std::ptr::null(),std::ptr::null_mut(),std::ptr::null_mut(),1,&mut output)};
        if success==0{return Err("Windows konnte den gespeicherten Zugangstoken nicht verarbeiten.".into());}
        let value=if output.size==0{Vec::new()}else{std::slice::from_raw_parts(output.data,output.size as usize).to_vec()};
        LocalFree(output.data.cast());
        Ok(value)
    }
}
#[cfg(not(windows))]
fn protect(_data:&[u8],_encrypt:bool)->Result<Vec<u8>,String>{Err("Token-Speicherung benötigt die Windows-App.".into())}

fn store(path:&Path,settings:GlobalSettings)->Result<(),String>{
    validate(&settings)?;
    let protected_token=if settings.hf_token.is_empty(){String::new()}else{STANDARD.encode(protect(settings.hf_token.as_bytes(),true)?)};
    let stored=StoredSettings{version:1,transcriber:settings.transcriber,device:settings.device,model_paths:settings.model_paths,protected_token};
    let parent=path.parent().ok_or("Einstellungsordner fehlt")?;
    fs::create_dir_all(parent).map_err(|e|e.to_string())?;
    let mut file=tempfile::NamedTempFile::new_in(parent).map_err(|e|e.to_string())?;
    file.write_all(&serde_json::to_vec_pretty(&stored).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    file.as_file().sync_all().map_err(|e|e.to_string())?;
    file.persist(path).map_err(|e|e.error.to_string())?;
    Ok(())
}
fn load(path:&Path)->Result<GlobalSettings,String>{
    if !path.exists(){return Ok(GlobalSettings::default());}
    let stored:StoredSettings=serde_json::from_slice(&fs::read(path).map_err(|e|e.to_string())?).map_err(|_|"Gespeicherte Einstellungen sind beschädigt.")?;
    if stored.version!=1{return Err("Unbekanntes Einstellungsformat".into());}
    let hf_token=if stored.protected_token.is_empty(){String::new()}else{String::from_utf8(protect(&STANDARD.decode(stored.protected_token).map_err(|_|"Ungültiger Tokenspeicher")?,false)?).map_err(|_|"Ungültiger Tokenspeicher")?};
    let settings=GlobalSettings{transcriber:stored.transcriber,device:stored.device,model_paths:stored.model_paths,hf_token};
    validate(&settings)?;Ok(settings)
}
#[tauri::command]
pub fn load_global_settings(app:tauri::AppHandle)->Result<GlobalSettings,String>{load(&app.path().app_config_dir().map_err(|e|e.to_string())?.join("settings.json"))}
#[tauri::command]
pub fn save_global_settings(app:tauri::AppHandle,settings:GlobalSettings)->Result<(),String>{store(&app.path().app_config_dir().map_err(|e|e.to_string())?.join("settings.json"),settings)}

#[cfg(test)] mod tests{
    use super::*;
    #[test] fn preferences_survive_restart_and_replace_existing_file(){
        let dir=tempfile::tempdir().unwrap();let path=dir.path().join("settings.json");
        assert_eq!(load(&path).unwrap().transcriber,"basic-pitch");
        let mut settings=GlobalSettings::default();settings.transcriber="muscriptor-small".into();settings.model_paths.insert("muscriptor-small".into(),"C:/models/small.safetensors".into());
        store(&path,settings.clone()).unwrap();settings.device="cpu".into();store(&path,settings).unwrap();
        let loaded=load(&path).unwrap();assert_eq!(loaded.device,"cpu");assert_eq!(loaded.model_paths.len(),1);
    }
    #[cfg(windows)] #[test] fn token_is_encrypted_on_disk_and_can_be_removed(){
        let dir=tempfile::tempdir().unwrap();let path=dir.path().join("settings.json");let mut settings=GlobalSettings::default();settings.hf_token="test-secret-token".into();
        store(&path,settings).unwrap();assert!(!fs::read_to_string(&path).unwrap().contains("test-secret-token"));
        assert_eq!(load(&path).unwrap().hf_token,"test-secret-token");store(&path,GlobalSettings::default()).unwrap();assert!(load(&path).unwrap().hf_token.is_empty());
    }
}
