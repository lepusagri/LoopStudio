use std::process::{Command,Stdio};
use tauri::Manager;
#[tauri::command]
pub async fn install_standard_models(app:tauri::AppHandle)->Result<(),String>{
    tauri::async_runtime::spawn_blocking(move||{
        let resources=app.path().resource_dir().map_err(|e|e.to_string())?;
        let script=resources.join("install-models.py");
        if !script.is_file(){return Err("Die Modell-Einrichtung ist in den Installer-Versionen enthalten.".into());}
        let analysis=crate::analysis::runtime_dir()?;
        let root=analysis.parent().ok_or("Laufzeitordner fehlt")?;
        let python=crate::platform_paths::python(&root.join("LoopStudio-tools-runtime"));
        let mut command=Command::new(python);
        #[cfg(windows)]{use std::os::windows::process::CommandExt;command.creation_flags(0x08000000);}
        let result=command.arg(script).arg("--root").arg(root).env("PYTHONUTF8","1").stdin(Stdio::null()).output().map_err(|e|e.to_string())?;
        if !result.status.success(){return Err(format!("Modelle konnten nicht eingerichtet werden: {}",String::from_utf8_lossy(&result.stderr)));}
        Ok(())
    }).await.map_err(|e|e.to_string())?
}
