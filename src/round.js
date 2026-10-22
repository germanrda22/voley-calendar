import {normalize,parseDate} from './model.js';

const months=['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
export function validDay(value){return /^\d{4}-\d{2}-\d{2}$/.test(value||'') && parseDate(value.slice(8)+'-'+value.slice(5,7)+'-'+value.slice(0,4))===value;}
const spanishDate=(day,month,year)=>parseDate(`${day}-${months.indexOf(month==='SETIEMBRE'?'SEPTIEMBRE':month)+1}-${year}`);
export function findHeaderIntervals(text){
  const value=normalize(text),intervals=[];
  const add=(from,to)=>{if(validDay(from)&&validDay(to)&&from<=to)intervals.push({from,to});};
  for(const m of value.matchAll(/JORNADA\s+(?:DEL?\s+)?(\d{1,2})\s+DE\s+([A-Z]+)\s+DE\s+(\d{4})\s+(?:AL|A|HASTA(?:\s+EL)?)\s+(\d{1,2})\s+DE\s+([A-Z]+)\s+DE\s+(\d{4})/g))add(spanishDate(m[1],m[2],m[3]),spanishDate(m[4],m[5],m[6]));
  for(const m of value.matchAll(/JORNADA\s+(?:DEL?\s+)?(\d{1,2})\s+AL\s+(\d{1,2})\s+DE\s+([A-Z]+)\s+DE\s+(\d{4})/g))add(spanishDate(m[1],m[3],m[4]),spanishDate(m[2],m[3],m[4]));
  for(const m of value.matchAll(/JORNADA\s+(?:DEL?\s+)?(\d{1,2}[-/.]\d{1,2}[-/.](?:\d{4}|\d{2}))\s+(?:AL|A)\s+(\d{1,2}[-/.]\d{1,2}[-/.](?:\d{4}|\d{2}))/g))add(parseDate(m[1]),parseDate(m[2]));
  return [...new Map(intervals.map(range=>[range.from+'/'+range.to,range])).values()];
}
export function detectRound(games,headers=[]){
  const unique=[...new Map(headers.filter(h=>validDay(h.from)&&validDay(h.to)&&h.from<=h.to).map(h=>[h.from+'/'+h.to,h])).values()];
  const dates=games.map(g=>g.original?.date??g.date),valid=dates.filter(validDay).sort();
  const missing=dates.some(date=>!validDay(date)),warnings=[];
  let from='',to='',source='matches',needsConfirmation=false;
  if(unique.length===1){({from,to}=unique[0]);source='header';}
  else{
    const all=[...valid,...unique.flatMap(h=>[h.from,h.to])].sort();from=all[0]||'';to=all.at(-1)||'';
    if(unique.length>1){source='ambiguous';warnings.push('El documento contiene cabeceras de jornadas diferentes. Confirma qué intervalo deseas comparar.');needsConfirmation=true;}
    else if(!valid.length||new Set(valid).size<2||missing||Date.parse(to)-Date.parse(from)>31*86400000||[...new Set(valid)].some((date,i,all)=>i>0&&Date.parse(date)-Date.parse(all[i-1])>3*86400000)){needsConfirmation=true;warnings.push('Las fechas de los partidos no bastan para identificar una jornada inequívoca. Confirma el intervalo.');}
  }
  const outside=valid.filter(date=>from&&to&&(date<from||date>to));
  if(outside.length){needsConfirmation=true;warnings.push('Hay partidos fuera del intervalo de la cabecera. Revisa y confirma el intervalo; no se ampliará automáticamente.');}
  const competitionKeys=[...new Set(games.map(g=>{const data=g.original||g;return JSON.stringify([normalize(data.competition),normalize(data.category)]);} ))].sort();
  const extractionAmbiguous=games.some(g=>g.ambiguous||g.manual||g.issues?.length);
  return {from,to,source,competitionScope:'VOLEIBOL',competitionKeys,needsConfirmation,warnings,headers:unique,outside:[...new Set(outside)],deletionsAllowed:!extractionAmbiguous&&unique.length<=1&&!outside.length&&!missing};
}
export function confirmRound(detection,from,to){
  if(!validDay(from)||!validDay(to)||from>to)throw Error('Confirma un intervalo de fechas válido.');
  return {...detection,from,to,source:'confirmed',needsConfirmation:false,confirmed:true,
    confirmationBasedOnMatches:detection.headers.length===0&&from===detection.from&&to===detection.to,
    warnings:detection.headers.length>1?['El documento contiene varias jornadas; no se ofrecerán eliminaciones.']:detection.outside.length?['Hay partidos fuera de la cabecera; no se ofrecerán eliminaciones.']:detection.deletionsAllowed?[]:['Hay fechas sin identificar; no se ofrecerán eliminaciones.'],
    // An inconsistent or merged document cannot prove withdrawals.
    deletionsAllowed:detection.deletionsAllowed&&detection.headers.length<=1};
}
export const automaticRoundKey=scope=>`AUTO4|GRANADA-DESIGNACIONES|${normalize(scope.competitionScope||'VOLEIBOL')}|${scope.from}|${scope.to}`;
export function automaticScope(detection,context){
  if(detection.needsConfirmation||!validDay(detection.from)||!validDay(detection.to))throw Error('Confirma el intervalo detectado antes de comprobar los cambios.');
  return {...context,...detection,round:automaticRoundKey(detection),automatic:true,intervalSource:detection.source,
    completenessConfirmed:!!context.complete,complete:!!context.complete&&detection.deletionsAllowed&&!context.documentPartial,extractionReliable:!!context.extractionReliable};
}
