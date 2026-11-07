import {invoke,isTauri} from '@tauri-apps/api/core';
export type GlobalSettings={transcriber:string;device:string;modelPaths:Record<string,string>;hfToken:string};
export const defaultSettings:GlobalSettings={transcriber:'basic-pitch',device:'auto',modelPaths:{},hfToken:''};
export const models:Record<string,string>={'basic-pitch':'Basic Pitch','muscriptor-small':'MuScriptor Small · 0,41 GB','muscriptor-medium':'MuScriptor Medium · 1,23 GB','muscriptor-large':'MuScriptor Large · 5,47 GB'};
export const devices:Record<string,string>={auto:'Automatisch · Intel Arc bevorzugen',cpu:'CPU',openvino:'Intel-GPU · OpenVINO'};
export async function loadGlobalSettings():Promise<GlobalSettings>{
 if(isTauri())return invoke('load_global_settings');
 return {...defaultSettings,...JSON.parse(localStorage.getItem('loopstudio.settings.v1')||'{}'),hfToken:''};
}
export async function saveGlobalSettings(settings:GlobalSettings):Promise<void>{
 if(isTauri())await invoke('save_global_settings',{settings});
 else localStorage.setItem('loopstudio.settings.v1',JSON.stringify({...settings,hfToken:''}));
}
