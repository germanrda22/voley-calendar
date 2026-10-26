import {createAutoCheck} from './src/auto-check.js';
import {normalize,filterGames} from './src/model.js';
import {readPDF} from './src/pdf.js';
import {detectRound,automaticScope} from './src/round.js';
import {createGoogleService,preferredCalendar} from './src/google.js';
import {captureOriginal} from './src/google-identity.js';
import {eventGame} from './src/prepare.js';
import {generateICS,offerICSDownload} from './src/ics.js';
import {validateRound} from './src/round-sync.js';
import {assessExtraction,formatDiagnostic,gameDiagnostics} from './src/extraction-diagnostics.js';
import {createAccountPreferences} from './src/account-preferences.js';
import {setupRefereePicker} from './src/referee-picker.js';
const $=id=>document.getElementById(id);
const clientId=import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim()||'';
let games=[],headers=[],scannedPages=[],file=null,calendars=[],reading=false,connecting=false,working=false,version=0,plan=null,previewKey='',download,autoCheck;
let picker,hadSession=false,activeAccount='';
const preferences=createAccountPreferences(localStorage);
const service=createGoogleService({onState:state=>{
  if(!state.connected&&activeAccount){activeAccount='';preferences.useAccount('');calendars=[];$('calendar').replaceChildren(new Option('Conecta Google',''));picker?.setName('');plan=null;previewKey='';version++;autoCheck?.reset();}
  refresh();autoCheck?.schedule();
}});
const name=()=>picker?.getName()||'';
const savePreferences=()=>preferences.save({referee:name(),calendar:$('calendar').value});
picker=setupRefereePicker({onChange:()=>{savePreferences();changed();}});
function snapshot(){
  const assessment=assessExtraction(games,headers,{referee:name(),scannedPages}),detection=assessment.detection;
  if(!file||!games.length)throw Error('Selecciona un PDF de designaciones.');
  if(!normalize(name()))throw Error('Selecciona tu nombre como árbitro.');
  if(!service.isConnected()||!calendars.some(c=>c.id===$('calendar').value))throw Error('Conecta Google y selecciona un calendario de destino.');
  if(detection.source!=='header')throw Error('No hay una cabecera de jornada inequívoca. No se sustituirán eventos.');
  if(assessment.selectedErrors.length||assessment.documentErrors.length)throw Error([...new Set([...assessment.selectedErrors,...assessment.documentErrors].map(formatDiagnostic))].join('\n'));
  const scope=automaticScope(detection,{calendar:$('calendar').value,referee:name(),extractionReliable:assessment.selectedValid,documentIntegrity:assessment.documentComplete,complete:assessment.documentComplete});
  const selected=filterGames(games,normalize(name())).map(g=>eventGame(g,name()));
  validateRound(selected,scope);
  return {games:selected,scope,version};
}
function key(){try{return JSON.stringify(snapshot());}catch{return null;}}
function refresh(){
  $('connect').disabled=connecting||working||reading||!clientId;
  $('disconnect').disabled=!service.isConnected()||working||reading||connecting;
  $('images').disabled=reading||working||connecting; $('selectPDF').disabled=$('images').disabled;picker.setDisabled(working||reading||connecting);
  $('connect').textContent=service.isConnected()?'Cambiar cuenta de Google':'Conectar Google Calendar';
  $('calendar').disabled=!service.isConnected()||working||reading||connecting;
  const detection=detectRound(games,headers);
  const assessment=assessExtraction(games,headers,{referee:name(),scannedPages});
  $('extractionDiagnostics').textContent=assessment.diagnostics.length?assessment.diagnostics.map(formatDiagnostic).join('\n'):'Sin incidencias de extracción.';
  $('round').textContent=detection.from?`${detection.from} — ${detection.to}`:'Pendiente de PDF';
  $('count').textContent=String(name()?filterGames(games,normalize(name())).length:games.length);
  let reason='';try{snapshot();}catch(e){reason=e.message;}
  const current=key();
  if(current!==previewKey)plan=null;
  $('existing').textContent=plan?String(plan.replacing):'Pendiente de consulta';
  $('newCount').textContent=plan?String(plan.new):'Pendiente de consulta';
  $('unchanged').textContent=plan?String(plan.unchanged):'0';
  $('syncRound').disabled=working||reading||connecting||!plan||!!reason;
  $('ics').disabled=working||reading||!name()||!games.length;
  $('reason').textContent=reason||(!plan?'Comprobando el calendario antes de sincronizar…':'');
  if(plan?.uncertain.length)$('reason').textContent=`Se conservarán ${plan.uncertain.length} evento(s) sin identificación segura.`;
}
function changed(){version++;plan=null;previewKey='';$('result').textContent='';refresh();autoCheck?.schedule();}
$('selectPDF').onclick=()=>{if(!$('images').disabled)$('images').click();};
$('images').onchange=async event=>{
  if(working||reading)return;
  const selectedName=name();
  file=event.target.files[0]||null;games=[];headers=[];scannedPages=[];picker.setGames([]);picker.setName(selectedName);changed();
  $('files').textContent=file?.name||'Ningún archivo seleccionado';
  if(!file)return;
  reading=true;refresh();
  try{
    const result=await readPDF(file,text=>$('status').textContent=text);
    games=result.games.map(captureOriginal);headers=result.headers;
    scannedPages=result.scannedPages;
    const previousName=name();picker.setGames(games);picker.setName(previousName);
    const assessment=assessExtraction(games,headers,{referee:name(),scannedPages});
    const warnings=assessment.diagnostics.filter(d=>d.severity==='warning').length;
    $('status').textContent=`${games.length} partidos extraídos · ${warnings} advertencia(s) de formato. La validez se comprueba para el árbitro seleccionado y la integridad del documento por separado.`;
  }catch(e){$('status').textContent=e.message;}
  finally{reading=false;changed();}
};
$('calendar').onchange=()=>{savePreferences();changed();};
function resetSession(){
  autoCheck?.reset();activeAccount='';preferences.useAccount('');calendars=[];games=[];headers=[];scannedPages=[];file=null;
  $('images').value='';$('files').textContent='Ningún archivo seleccionado';$('calendar').replaceChildren(new Option('Conecta Google',''));
  picker.setGames([]);picker.setName('');download?.revoke();download=null;$('icsDownload').hidden=true;
  $('status').textContent='';changed();
}
$('connect').onclick=async()=>{
  if(connecting||working||reading)return;
  if(hadSession)resetSession();
  connecting=true;refresh();$('status').textContent='Esperando autorización de Google…';
  try{
    calendars=await service.connect(clientId);
    hadSession=true;activeAccount=service.getAccountKey?.()||'';preferences.useAccount(activeAccount);
    const saved=preferences.load();
    $('calendar').replaceChildren(...calendars.map(c=>new Option(c.summary||c.id,c.id)));
    $('calendar').value=preferredCalendar(calendars,saved.calendar);
    if(saved.referee)picker.setName(saved.referee);
    savePreferences();
    $('status').textContent='Google conectado. Selecciona el PDF y tu nombre.';
  }catch(e){calendars=[];$('status').textContent=e.message;}
  finally{connecting=false;changed();}
};
$('disconnect').onclick=()=>{if(working||reading)return;service.disconnect();resetSession();};
autoCheck=createAutoCheck({getKey:()=>reading||working||connecting?null:key(),check:async()=>{
  const before=key(),data=snapshot();
  try{
    const result=await service.inspectRound(data.games,data.scope);
    if(key()===before){plan=result;previewKey=before;$('status').textContent='Jornada preparada para sincronizar.';}
  }catch(e){if(key()===before){plan=null;$('status').textContent=e.message;}}
  finally{refresh();}
}});
$('syncRound').onclick=async()=>{
  if(working||reading||!plan)return;
  if(!window.confirm('¿Confirmas que el PDF contiene la jornada completa y has contrastado todas sus filas? Se crearán y verificarán los partidos antes de eliminar los eventos anteriores identificados con seguridad.'))return;
  working=true;autoCheck.cancel();refresh();$('result').textContent='Creando y verificando los partidos de la jornada…';
  try{
    const data=snapshot();
    const run=()=>service.synchronizeRound(data.games,data.scope);
    const result=globalThis.navigator?.locks?await navigator.locks.request('voley-calendar-round-sync',{ifAvailable:true},lock=>{if(!lock)throw Error('Hay otra sincronización abierta en este navegador.');return run();}):await run();
    $('result').textContent=`Creados: ${result.created} · Eliminados: ${result.deleted} · Sin cambios: ${result.unchanged} · Conservados por seguridad: ${result.preserved} · Errores: ${result.errors.length}\n${[...result.warnings,...result.errors].join('\n')}`;
  }catch(e){$('result').textContent=e.message;}
  finally{working=false;plan=null;previewKey='';autoCheck.reset();refresh();autoCheck.schedule();}
};
$('ics').onclick=async()=>{
  try{
    const selected=filterGames(games,normalize(name())).map(g=>eventGame(g,name()));
    if(!selected.length)throw Error('No hay partidos del árbitro seleccionado.');
    const errors=selected.flatMap(gameDiagnostics).filter(d=>d.severity==='error');
    if(errors.length)throw Error(errors.map(formatDiagnostic).join('\n'));
    const ics=await generateICS(selected,120,0);download?.revoke();download=offerICSDownload(ics,$('icsDownload'));
    $('result').textContent=`ICS preparado con ${selected.length} partidos.`;
  }catch(e){$('result').textContent=e.message;}
};
window.addEventListener('beforeunload',event=>{if(working){event.preventDefault();event.returnValue='';}});
window.addEventListener('pagehide',()=>download?.revoke());
refresh();
