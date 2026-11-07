export function TabStringSelection({value,onChange,disabled=false}:{value:number;onChange:(value:number)=>void;disabled?:boolean}) {
 return <label>Tabulatur <select value={value} disabled={disabled} onChange={e=>onChange(+e.target.value)}>
  <option value={6}>Gitarre · 6 Saiten</option><option value={7}>Gitarre · 7 Saiten</option><option value={4}>Bass · 4 Saiten</option><option value={5}>Bass · 5 Saiten</option><option value={0}>Saitenzahl automatisch</option>
 </select></label>;
}
