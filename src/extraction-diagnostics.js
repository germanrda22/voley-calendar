import {normalize,parseDate,refereeKeys,functionsFor} from './model.js';
import {getDates} from './calendar.js';
import {detectRound,validDay} from './round.js';

export const fieldLabels={date:'fecha',time:'hora',home:'equipo local',away:'equipo visitante',venue:'pabellón',category:'categoría',first:'primer árbitro',second:'segundo árbitro',scorer:'anotador',role:'función arbitral',identity:'identificación',duplicate:'duplicado',document:'integridad del PDF'};
const pageFor=g=>g.pageNumber||Number(/Página\s+(\d+)/i.exec(g.notes||'')?.[1])||null;
export function diagnostic(g,field,message,severity='error'){
  return {gameId:g.id,page:pageFor(g),match:`${g.home||'Local sin identificar'} vs ${g.away||'Visitante sin identificar'}`,field,severity,message};
}
export function formatDiagnostic(d){return `${d.severity==='warning'?'Advertencia':'Error crítico'} · Página ${d.page||'?'} · ${d.match} · ${fieldLabels[d.field]||d.field}: ${d.message}`;}
export function gameDiagnostics(g){
  const result=[],add=(field,message,severity)=>result.push(diagnostic(g,field,message,severity));
  const raw=(g.notes||'').replace(/^Página\s+\d+:\s*/i,'').split('|').map(normalize);
  for(const issue of g.issues||[]){
    const crossed=/^Texto que cruza columnas: (\w+)$/.exec(issue)?.[1];
    // A crossing is cosmetic only when the complete reconstructed value is
    // preserved verbatim in the source cell. Unknown/merged values stay errors.
    if(crossed&&g[crossed]?.trim()&&raw.includes(normalize(g[crossed]))){
      add(crossed,'El texto sobrepasa el borde de columna, pero el valor completo se conserva en la celda de origen.','warning');
    }else{
      const field=crossed||/sin identificar: (\w+)/.exec(issue)?.[1]||(/duplicado/i.test(issue)?'duplicate':/funciones/i.test(issue)?'role':'identity');
      add(field,issue,'error');
    }
  }
  for(const field of ['date','time','home','away','venue','category'])if(!g[field]?.trim())add(field,'Campo esencial vacío.','error');
  if(g.date&&(!/^\d{4}-\d{2}-\d{2}$/.test(g.date)||!parseDate(g.date.slice(8)+'/'+g.date.slice(5,7)+'/'+g.date.slice(0,4))))add('date','Fecha inválida.','error');
  if(g.date&&g.time){try{getDates(g);}catch(e){add('time',e.message,'error');}}
  if(!refereeKeys.some(k=>normalize(g[k])))add('role','No se han identificado las funciones arbitrales.','error');
  const officials=refereeKeys.map(k=>normalize(g[k])).filter(Boolean);
  if(new Set(officials).size!==officials.length)add('role','Una misma persona figura en varias columnas arbitrales.','error');
  if(g.manual||g.ambiguous&&!(g.issues?.length))add('identity','Identificación del partido insegura.','error');
  if(/\nDuplicado:/i.test(g.notes||''))add('duplicate','El PDF contiene más de un registro para este partido.','error');
  return result;
}
export function assessExtraction(games,headers,{referee='',scannedPages=[],documentPartial=false}={}){
  const diagnostics=games.flatMap(gameDiagnostics),selected=games.filter(g=>functionsFor(g,referee).length||g.manual);
  const selectedIds=new Set(selected.map(g=>g.id));
  const selectedErrors=diagnostics.filter(d=>d.severity==='error'&&selectedIds.has(d.gameId));
  // Detect the interval independently of cosmetic/other-referee cell problems.
  // Every extracted row still contributes its original date and competition.
  const detection=detectRound(games.map(g=>({date:g.date,original:g.original,competition:g.competition,category:g.category})),headers);
  const documentErrors=[];
  const addDocument=message=>documentErrors.push({severity:'error',field:'document',page:null,match:'Documento completo',message});
  if(!games.length)addDocument('No se han extraído partidos.');
  if(documentPartial)addDocument('El documento está declarado parcial.');
  if(scannedPages.length)for(const page of scannedPages)documentErrors.push({severity:'error',field:'document',page,match:'Página sin extracción completa',message:'No se han podido leer todos los partidos de esta página.'});
  if(detection.source!=='header'||detection.headers.length!==1||detection.needsConfirmation||!detection.deletionsAllowed)addDocument('La cabecera o las fechas no acreditan una única jornada completa.');
  for(const g of games){
    const issues=diagnostics.filter(d=>d.gameId===g.id&&d.severity==='error');
    // An uncertain referee assignment could hide a selected referee's match.
    // It must block withdrawals even when the remaining fields belong to others.
    if(issues.some(d=>['identity','role','first','second','scorer','duplicate','date'].includes(d.field)))documentErrors.push(...issues.filter(d=>['identity','role','first','second','scorer','duplicate','date'].includes(d.field)));
  }
  const seen=new Map();
  for(const g of games){
    if(!validDay(g.date)||!g.time||!g.home||!g.away)continue;
    const identity=JSON.stringify([g.date,g.time,normalize(g.home),normalize(g.away)]);
    if(seen.has(identity)){
      for(const duplicate of [seen.get(identity),g])documentErrors.push(diagnostic(duplicate,'duplicate','Partido duplicado en el documento.'));
    }else seen.set(identity,g);
  }
  const complete=documentErrors.length===0;
  return {detection:{...detection,deletionsAllowed:complete},diagnostics:[...diagnostics,...documentErrors.filter(d=>!diagnostics.includes(d))],selectedErrors,documentErrors,selectedValid:selectedErrors.length===0,documentComplete:complete};
}
