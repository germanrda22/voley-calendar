import {prepareEvent,eventGame} from './prepare.js';
import {fold} from './calendar.js';
import {assignmentId} from './google-identity.js';
import {normalize} from './model.js';

const stamp = value => new Date(value).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
export const escapeText = value => String(value ?? '')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,'')
  .replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');

export async function generateICS(games,duration=120,reminder=0) {
  const selected=games.filter(game=>game.selected!==false);
  if(!selected.length)throw Error('Selecciona al menos un partido para exportar a Apple Calendar.');
  if(!Number.isInteger(Number(reminder))||reminder<0||reminder>10080)throw Error('Recordatorio válido: de 0 a 10080 minutos enteros.');
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Voley Calendar//ES','CALSCALE:GREGORIAN','X-WR-TIMEZONE:Europe/Madrid'];
  const timestamp=stamp(new Date());
  for(const game of selected){
    const reviewed=eventGame({...game,roleOverrides:{...game.roleOverrides,...(game.role?{[normalize(game.referee)]:game.role}:{})}},game.referee);
    const prepared=prepareEvent(reviewed,reviewed.referee,duration);
    if(!game.date||!game.time||!game.home?.trim()||!game.away?.trim()||!game.referee?.trim()||!reviewed.role?.trim())throw Error('Completa fecha, hora, equipos, árbitro y función antes de exportar.');
    // Reuse original assignment identity only for UID; all visible data is reviewed.
    const uid=await assignmentId(game);
    lines.push('BEGIN:VEVENT',`UID:${uid}@voley-calendar.local`,`DTSTAMP:${timestamp}`,
      `DTSTART:${stamp(prepared.start.dateTime)}`,`DTEND:${stamp(prepared.end.dateTime)}`,
      `SUMMARY:${escapeText(prepared.summary)}`,`LOCATION:${escapeText(prepared.location)}`,`DESCRIPTION:${escapeText(prepared.description)}`);
    if(reminder>0)lines.push('BEGIN:VALARM','ACTION:DISPLAY',`DESCRIPTION:${escapeText(prepared.summary)}`,`TRIGGER:-PT${Number(reminder)}M`,'END:VALARM');
    lines.push('END:VEVENT');
  }
  return lines.concat('END:VCALENDAR').map(fold).join('\r\n')+'\r\n';
}

// Keep the URL alive until replaced or the page closes. Safari may need it after
// the click, and the visible link lets the user retry without another export.
export function offerICSDownload(content,link,{urlApi=URL}={}) {
  const blob=new Blob([content],{type:'text/calendar;charset=utf-8'});
  const url=urlApi.createObjectURL(blob);
  link.href=url;link.download='voley-calendar.ics';link.hidden=false;
  let automaticDownloadStarted=true;
  try{link.click();}catch{automaticDownloadStarted=false;}
  return {revoke:()=>urlApi.revokeObjectURL(url),automaticDownloadStarted};
}
