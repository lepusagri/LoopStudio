import {useState,type ReactNode} from 'react';
import {ChevronLeft,ChevronRight} from 'lucide-react';

export function PlayerMixerLayout({children,hasMixer,onMixerHost}:{children:ReactNode;hasMixer:boolean;onMixerHost:(host:HTMLDivElement|null)=>void}){
 const [collapsed,setCollapsed]=useState(false);
 return <div className={`player-mixer-layout ${hasMixer?'has-mixer':''} ${collapsed?'mixer-collapsed':''}`}>
 {children}
 {hasMixer&&<aside className={`player-mixer-sidebar ${collapsed?'is-collapsed':''}`} aria-label="Mixerbereich">
 <button className="mixer-collapse-toggle" aria-label={collapsed?'Spurmixer öffnen':'Spurmixer seitlich einklappen'} aria-expanded={!collapsed} onClick={()=>setCollapsed(value=>!value)}>{collapsed?<ChevronLeft size={16}/>:<ChevronRight size={16}/>}<span>{collapsed?'Spurmixer öffnen':'Mixer einklappen'}</span></button>
 <div className="player-mixer-host" ref={onMixerHost}/>
 </aside>}
 </div>;
}
