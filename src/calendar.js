import {normalize,refereeKeys,roles} from './model.js';
export const timezone = 'Europe/Madrid';
const formatter = new Intl.DateTimeFormat('en-GB',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function wall(ms) { const p=Object.fromEntries(formatter.formatToParts(new Date(ms)).map(p=>[p.type,p.value])); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; }
export function getDates(g, defaultDuration=120) {
  const target = `${g.date}T${g.time}`, naive = Date.parse(target+':00Z');
  if (!Number.isFinite(naive) || new Date(naive).toISOString().slice(0,16)!==target) throw Error('Fecha u hora no válida');
  const candidates = [naive-7200000, naive-3600000].filter(ms=>wall(ms)===target);
  if (!candidates.length) throw Error('Hora inexistente por el cambio de horario de Europe/Madrid');
  if (candidates.length>1 && !g.dstChoice) throw Error('Hora ambigua por cambio de horario: elige primera o segunda ocurrencia');
  const duration = Number(g.duration === '' || g.duration == null ? defaultDuration : g.duration);
  if (!Number.isInteger(duration) || duration < 1 || duration > 1440) throw Error('Duración válida: entre 1 y 1440 minutos enteros');
  const start = new Date(candidates[g.dstChoice==='second'?candidates.length-1:0]);
  return {start,end:new Date(+start+duration*60000)};
}
export const title = g => `🏐 ${g.role} | ${g.home} vs ${g.away}`;
export const description = g => [g.category && `Categoría: ${g.category}`,g.competition && `Competición: ${g.competition}`,g.role && `Función arbitral: ${g.role}`,g.referee && `Árbitro: ${g.referee}`,
  ...refereeKeys.flatMap((key,i)=>g[key]?.trim() && normalize(g[key])!==normalize(g.referee) ? [`${roles[i]}: ${g[key]}`] : []),g.notes].filter(Boolean).join('\n');
export async function stableId(g) {
  const value=[g.date,g.time,g.home,g.away,g.referee,g.role].map(normalize).join('|');
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');
}
export function fold(line) {
  const chunks=[]; let current=''; let length=0;
  for (const c of line) {const bytes=new TextEncoder().encode(c).length; if(length+bytes>75){chunks.push(current);current=' ';length=1;} current+=c;length+=bytes;}
  chunks.push(current);return chunks.join('\r\n');
}
