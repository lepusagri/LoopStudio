//! Native names and installed resource locations shared by the app and workers.
#![allow(dead_code)]
use std::path::{Path,PathBuf};
use std::sync::OnceLock;
static INSTALLED:OnceLock<PathBuf>=OnceLock::new();
pub fn binary(name:&str)->String{if cfg!(windows){format!("{name}.exe")}else{name.into()}}
pub fn library(name:&str)->String{if cfg!(windows){format!("{name}.dll")}else if cfg!(target_os="macos"){format!("lib{name}.dylib")}else{format!("lib{name}.so")}}
pub fn native(home:&Path,name:&str)->PathBuf{home.join("runtime").join(library(name))}
pub fn openvino(home:&Path)->PathBuf{home.join("runtime/openvino-2026.4.1").join(library("openvino_c"))}
pub fn installed(name:&str)->Option<PathBuf>{INSTALLED.get().map(|root|root.join(name))}
pub fn python(home:&Path)->PathBuf{
    let names=if cfg!(windows){vec!["python/python.exe","Scripts/python.exe"]}else{vec!["python/bin/python3","bin/python3","bin/python"]};
    names.iter().map(|n|home.join(n)).find(|p|p.is_file()).unwrap_or_else(||home.join(names[0]))
}
pub fn ffmpeg(home:&Path)->PathBuf{
    let name=binary("ffmpeg");let bundled=home.join("runtime").join(&name);
    if bundled.is_file(){return bundled;}
    std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).map(|p|p.join(&name)).find(|p|p.is_file()).unwrap_or(bundled)
}
pub fn install_resources(resources:&Path,data:&Path)->std::io::Result<()>{
    #[cfg(windows)] { let _=data;let _=INSTALLED.set(resources.into()); }
    #[cfg(unix)] {
        // AppImage and /usr/lib resources are read-only. File links keep large
        // libraries/models shared; caches and newly downloaded models stay writable.
        fn link_tree(source:&Path,target:&Path)->std::io::Result<()>{
            std::fs::create_dir_all(target)?;
            for entry in std::fs::read_dir(source)?{
                let entry=entry?;let from=entry.path();let to=target.join(entry.file_name());
                if from.is_dir(){link_tree(&from,&to)?;}else{
                    if std::fs::symlink_metadata(&to).is_ok_and(|m|m.file_type().is_symlink()){std::fs::remove_file(&to)?;}
                    if !to.exists(){std::os::unix::fs::symlink(&from,&to)?;}
                }
            }Ok(())
        }
        let writable=data.join("runtimes");
        for name in ["LoopStudio-runtime","LoopStudio-tools-runtime"]{let source=resources.join(name);if source.is_dir(){link_tree(&source,&writable.join(name))?;}}
        let _=INSTALLED.set(writable);
    }
    Ok(())
}
#[cfg(test)]mod tests{use super::*;#[test]fn native_names_match_target(){assert_eq!(binary("worker"),if cfg!(windows){"worker.exe"}else{"worker"});assert_eq!(library("onnxruntime"),if cfg!(windows){"onnxruntime.dll"}else if cfg!(target_os="macos"){"libonnxruntime.dylib"}else{"libonnxruntime.so"});}}
