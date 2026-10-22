import {createAutoCheck} from './src/auto-check.js';
import {setupRouter} from './src/router.js';
import {blank, normalize, referees, functionsFor, filterGames, refereeKeys} from './src/model.js';
import {readPDF} from './src/pdf.js';
import {extractPage} from './src/extract.js';
import {getDates,title} from './src/calendar.js';
import {createGoogleService,preferredCalendar} from './src/google.js';
import {captureOriginal} from './src/google-identity.js';
import {orderedGames,eventGame,prepareEvent,duplicateGroups} from './src/prepare.js';
import {generateICS as createICS,offerICSDownload} from './src/ics.js';
import {setupSyncUI} from './src/sync-ui.js';
import {findHeaderIntervals,detectRound,automaticScope} from './src/round.js';
const $=id=>document.getElementById(id);
let games=[],files=[],busy=false;
let router,autoCheck;
let icsMode=false,documentVersion=0,sessionVersion=0,lastPresentedContext='';
let appleBusy=false,appleDownload;
let lastExtractionReliable=false,syncBusy=false;
let extractionIssues=[];
let documentHeaders=[];
const progress=text=>$('status').textContent=text;
const selectedName=()=>normalize($('referee').value||$('refereeSelect').value);
const googleClientId=import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim()||'';
$('images').onchange=e=>{files=[...e.target.files];$('files').textContent=files.map(f=>f.name).join(' · ');$('scan').disabled=!files.length;progress(`${files.length} documento(s) preparado(s)`);if(files.length)scan();};
function refreshNames(){
  const previous=$('refereeSelect').value, names=referees(games);
  $('refereeSelect').replaceChildren(new Option('Selecciona un árbitro',''),...names.map(([key,name])=>new Option(name,key)));
  $('refereeSelect').value=names.some(([key])=>key===previous)?previous:'';
  $('namesStatus').textContent=`${games.length} partidos detectados · ${names.length} árbitros únicos`;
}
const refereeName=()=>$('referee').value||referees(games).find(([key])=>key===selectedName())?.[1]||'';
function roleGame(g){return eventGame(g,refereeName());}
function updateSummary(){
  const selected=orderedGames(games,selectedName(),$('duration').value).filter(g=>g.selected);
  const duplicates=duplicateGroups(selected.map(roleGame),$('duration').value);
  $('exportSummary').textContent=selectedName()?`${selected.length} partido(s) seleccionado(s) para exportar · Europe/Madrid`:'Selecciona un árbitro para preparar los eventos.';
  $('duplicateStatus').textContent=duplicates.length?`Posibles duplicados: ${duplicates.length} grupo(s). Corrige o deselecciona las repeticiones antes de exportar.\n`+duplicates.map(group=>`${group[0].date} ${group[0].time} · ${group[0].home} vs ${group[0].away} (${group.length} partidos)`).join('\n'):'';
  for(const card of $('games').children)if(card.dataset.gameId)card.classList.toggle('possible-duplicate',duplicates.some(group=>group.some(g=>g.id===card.dataset.gameId)));
  syncGoogleUI();
  syncController.suggest(games);syncController.invalidate();
}
function validation(g){
  const errors=[]; const value=roleGame(g);
  for(const [key,label] of [['date','fecha'],['time','hora'],['home','equipo local'],['away','equipo visitante'],['role','función arbitral']]) if(!value[key]?.trim())errors.push(`Falta ${label}`);
  try{getDates(g,$('duration').value);}catch(e){errors.push(e.message);}
  if(g.issues.length&&!g.reviewed)errors.push(...g.issues);
  return errors;
}
const cardViews=new Map(); // Estado visual de los desplegables, independiente de los partidos.
function render(){
  const visible=orderedGames(games,selectedName(),$('duration').value);
  $('count').textContent=`${visible.length} partido(s)${selectedName()?' del árbitro':''}`;
  const container=$('games'); container.replaceChildren();
  if(!visible.length){const p=document.createElement('p');p.className='muted';p.textContent='No hay partidos para mostrar. Sube documentos o añade uno manualmente.';container.append(p);}
  for(const g of visible){
    const card=document.createElement('article');card.className='game';card.dataset.gameId=g.id;
    const top=document.createElement('div');top.className='game-top';const label=document.createElement('label'),cb=document.createElement('input');cb.type='checkbox';cb.style.width='auto';cb.style.display='inline';cb.checked=g.selected;cb.onchange=()=>{g.selected=cb.checked;updateSummary();};label.append(cb,document.createTextNode(' Exportar partido'));
    const remove=document.createElement('button');remove.className='remove';remove.textContent='Eliminar';remove.onclick=()=>{games=games.filter(x=>x!==g);refreshNames();render();};top.append(label,remove);card.append(top);
    const view=cardViews.get(g.id)||{editing:!!g.manual};
    const overview=document.createElement('div');overview.className='game-overview';
    const teams=document.createElement('h3'),meta=document.createElement('p');meta.className='game-meta';overview.append(teams,meta);card.append(overview);
    const editor=document.createElement('details'),editorTitle=document.createElement('summary');editor.className='game-editor';editorTitle.textContent='Editar partido';editor.open=view.editing;editor.ontoggle=()=>{view.editing=editor.open;cardViews.set(g.id,view);};editor.append(editorTitle);
    const grid=document.createElement('div');grid.className='game-grid';
    const advanced=document.createElement('details'),advancedTitle=document.createElement('summary'),advancedGrid=document.createElement('div');advancedTitle.textContent='Árbitros y otros datos';advancedGrid.className='game-grid';advanced.open=!!view.advanced;advanced.ontoggle=()=>{view.advanced=advanced.open;cardViews.set(g.id,view);};advanced.append(advancedTitle,advancedGrid);
    const state=document.createElement('p'),end=document.createElement('p');end.className='muted';
    const preview=document.createElement('details'),previewLabel=document.createElement('summary'),previewText=document.createElement('p');previewLabel.textContent='Vista previa del evento';previewText.className='event-preview';preview.append(previewLabel,previewText);
    const update=()=>{teams.textContent=`${g.home||'Equipo local'} vs ${g.away||'Equipo visitante'}`;meta.textContent=[g.date,g.time,g.category,g.venue,roleGame(g).role].filter(Boolean).join(' · ');const errors=validation(g);state.className=errors.length?'warning':'ok';state.textContent=errors.length?'Revisión necesaria: '+[...new Set(errors)].join(' · '):'Validado';try{end.textContent='Finalización: '+new Intl.DateTimeFormat('es-ES',{timeZone:'Europe/Madrid',dateStyle:'short',timeStyle:'short'}).format(getDates(g,$('duration').value).end);}catch{end.textContent='Finalización pendiente de fecha y hora válidas';}};
    const fields=[['date','Fecha','date'],['time','Hora de inicio','time'],['category','Categoría','text'],['competition','Competición / grupo','text'],['home','Equipo local','text'],['away','Equipo visitante','text'],['venue','Pabellón','text'],['first','Primer árbitro','text'],['second','Segundo árbitro','text'],['scorer','Anotador','text'],['roleOverride','Función del árbitro seleccionado','select'],['duration','Duración propia (min, opcional)','number'],['dstChoice','Hora repetida en octubre','dst'],['notes','Texto original / observaciones','text']];
    for(const [key,text,type] of fields){
      const field=document.createElement('label');field.textContent=text;let input;
      if(type==='select'||type==='dst'){input=document.createElement('select');const options=type==='dst'?[['','Elegir si la hora es ambigua'],['first','Primera ocurrencia (verano)'],['second','Segunda ocurrencia (invierno)']]:[['',functionsFor(g,selectedName()).join(' / ')||'Sin identificar'],...['Primer árbitro','Segundo árbitro','Anotador','Otro'].map(v=>[v,v])];for(const [value,text]of options)input.add(new Option(text,value));}
      else{input=document.createElement('input');input.type=type;if(type==='number'){input.min='1';input.max='1440';}}
      input.value=key==='roleOverride'?(g.roleOverrides?.[selectedName()]||''):(g[key]??'');
      if(key==='duration')input.placeholder=`${$('duration').value} min (predeterminada)`;
      input.oninput=()=>{if(key==='roleOverride'){g.roleOverrides||={};g.roleOverrides[selectedName()]=input.value;}else g[key]=input.value;g.reviewed=false;reviewCheck.checked=false;update();updatePreview();updateSummary();};
      if(key==='date'||key==='time'||key==='dstChoice')input.onchange=render;
      if(refereeKeys.includes(key))input.onchange=()=>{refreshNames();render();};
      field.append(input);(['competition','first','second','scorer','dstChoice','notes'].includes(key)?advancedGrid:grid).append(field);
    }
    const review=document.createElement('label'),reviewCheck=document.createElement('input');reviewCheck.type='checkbox';reviewCheck.style.width='auto';reviewCheck.checked=g.reviewed;reviewCheck.onchange=()=>{g.reviewed=reviewCheck.checked;update();syncGoogleUI();};review.append(reviewCheck,document.createTextNode(' He revisado las advertencias y contrastado las funciones con el documento'));
    function updatePreview(){
      try{const event=prepareEvent(g,refereeName(),$('duration').value);previewText.textContent=[event.summary,`Ubicación: ${event.location || 'Sin especificar'}`,event.description,`Zona horaria: ${event.start.timeZone}`].join('\n');}
      catch(e){previewText.textContent=`${title(roleGame(g))}\n${e.message}`;}
    }
    editor.append(grid,advanced);review.className='review-check';card.append(end,state,editor,review,preview);update();updatePreview();container.append(card);
  }
  updateSummary();
}
$('refereeSelect').onchange=()=>{$('referee').value='';render();};
$('referee').oninput=render;
$('duration').oninput=render;
$('add').onclick=()=>{const g=blank();g.manual=true;games.push(g);refreshNames();render();};
for(const [id,value]of [['selectAll',true],['selectNone',false]])$(id).onclick=()=>{for(const g of filterGames(games,selectedName()))g.selected=value;render();};
async function ocr(source,page,worker){
  progress(`OCR: página ${page}…`);
  const {data}=await worker.recognize(source,{}, {blocks:true,text:true});
  documentHeaders.push(...findHeaderIntervals(data.text));
  const canvas=source instanceof HTMLCanvasElement?source:null;
  let width=canvas?.width,height=canvas?.height;
  if(!canvas){const bitmap=await createImageBitmap(source);width=bitmap.width;height=bitmap.height;bitmap.close();}
  const words=(data.blocks||[]).flatMap(b=>b.paragraphs||[]).flatMap(p=>p.lines||[]).flatMap(l=>l.words||[]);
  const items=words.map(w=>({str:w.text,transform:[1,0,0,w.bbox.y1-w.bbox.y0,w.bbox.x0,height-w.bbox.y1],width:w.bbox.x1-w.bbox.x0}));
  const found=extractPage(items,width,page);
  for(const g of found)g.issues.push('OCR: verifica todas las columnas y nombres con el original');
  if(!found.length){const g=blank();g.manual=true;g.notes=data.text;g.issues.push('OCR sin tabla reconocida: completa los datos y los nombres manualmente');found.push(g);}
  return found;
}
async function scan(useOCR=false){
  if(busy||syncBusy||googleBusy)return;busy=true;documentVersion++;$('scan').disabled=true;$('ocr').disabled=true;$('images').disabled=true;
  lastExtractionReliable=false;extractionIssues=[];$('syncComplete').checked=false;syncController.invalidate();
  documentHeaders=[];
  syncGoogleUI();
  let worker;const next=[],warnings=[];
  try{
    const needsOCR=useOCR||files.some(f=>f.type.startsWith('image/'));
    if(needsOCR){if(!window.Tesseract)throw Error('No se pudo cargar Tesseract. Comprueba la conexión para usar OCR.');worker=await window.Tesseract.createWorker('spa+eng',1,{logger:m=>{if(m.status==='recognizing text')progress(`Reconociendo texto: ${Math.round(m.progress*100)} %`);}});}
    let missingText=false;
    for(const file of files){
      try{
        if(file.type==='application/pdf'||/\.pdf$/i.test(file.name)){
          const result=await readPDF(file,progress,useOCR?(canvas,n)=>ocr(canvas,n,worker):undefined);next.push(...result.games);
          documentHeaders.push(...result.headers);
          if(result.scannedPages.length){missingText=true;warnings.push(`${file.name}: páginas ${result.scannedPages.join(', ')} sin texto seleccionable. Pulsa «Procesar con OCR».`);}
          if(!result.games.length&&!result.scannedPages.length)warnings.push(`${file.name}: no se encontraron filas de partidos. Revisa el formato de tabla o prueba OCR con una imagen.`);
        }else if(file.type.startsWith('image/'))next.push(...await ocr(file,1,worker));
        else warnings.push(`Formato no admitido: ${file.name}`);
      }catch(e){warnings.push(`${file.name}: ${e.message}`);}
    }
    lastExtractionReliable=!!next.length&&!warnings.length&&next.every(g=>!g.issues.length);
    extractionIssues=[...new Set([...warnings,...next.flatMap(g=>g.issues)])].slice(0,5);
    games=next.map(captureOriginal);
    const detected=detectRound(games,documentHeaders);
    if(!detected.needsConfirmation)for(const game of games)game.documentRound=automaticScope(detected,{});
    syncController.setDocument(games,documentHeaders);refreshNames();render();$('ocr').hidden=!missingText;
    progress([`${games.length} partidos extraídos. Selecciona un árbitro y revisa sus partidos.`,...warnings].join(' '));
  }catch(e){progress('Error de lectura: '+e.message);}
  finally{if(worker)await worker.terminate();busy=false;$('scan').disabled=!files.length;$('ocr').disabled=false;$('images').disabled=false;syncGoogleUI();}
}
$('scan').onclick=()=>scan();$('ocr').onclick=()=>scan(true);
function selectedGames(){
  if(!selectedName())throw Error('Selecciona o escribe el nombre del árbitro antes de exportar');
  const selected=orderedGames(games,selectedName(),$('duration').value).filter(g=>g.selected);
  if(!selected.length)throw Error('Selecciona al menos un partido');
  for(const g of selected)if(validation(g).length)throw Error('Completa y revisa todos los partidos seleccionados: '+validation(g).join(' · '));
  if(duplicateGroups(selected.map(roleGame),$('duration').value).length)throw Error('Hay posibles duplicados seleccionados. Corrígelos o deselecciona las repeticiones antes de exportar.');
  return selected.map(g=>roleGame(captureOriginal(g)));
}
const reminder=()=>{const n=Number($('reminder').value);if(!Number.isInteger(n)||n<0||n>10080)throw Error('Recordatorio válido: de 0 a 10080 minutos');return n;};
$('ics').onclick=async()=>{
  if(appleBusy)return;
  try{
    if(!filterGames(games,selectedName()).some(g=>g.selected))throw Error('Selecciona al menos un partido para exportar a Apple Calendar.');
    const items=structuredClone(selectedGames()),duration=Number($('duration').value),alarm=reminder();
    appleBusy=true;$('ics').disabled=true;$('exportStatus').textContent='Preparando archivo para Apple Calendar…';
    const ics=await createICS(items,duration,alarm);
    appleDownload?.revoke();appleDownload=offerICSDownload(ics,$('icsDownload'));
    $('exportStatus').textContent=`Archivo ICS preparado con ${items.length} partido(s). Si no se inicia la descarga, pulsa «Descargar archivo .ics».`;
  }catch(e){$('exportStatus').textContent=e.message;}
  finally{appleBusy=false;$('ics').disabled=busy;}
};
window.addEventListener('pagehide',event=>{if(!event.persisted)appleDownload?.revoke();});
let googleBusy=false,googleConnecting=false,calendars=[],expiryTimer,hadGoogleConnection=false;
const googleService=createGoogleService({onState:state=>{
  if(hadGoogleConnection&&!state.connected&&!googleConnecting)$('googleStatus').textContent='La autorización de Calendar ha caducado o se ha cerrado. Conecta Google de nuevo para continuar.';
  hadGoogleConnection=state.connected;
  clearTimeout(expiryTimer);syncGoogleUI();
  if(state.connected)expiryTimer=setTimeout(()=>{syncGoogleUI();$('googleStatus').textContent='La sesión ha caducado. Conecta Google de nuevo.';},Math.max(0,state.expiresAt-Date.now()+10));
}});
function syncGoogleUI(){
  const connected=googleService.isConnected();
  $('connect').disabled=syncBusy||googleBusy||googleConnecting||busy||!googleClientId;
  $('disconnect').disabled=syncBusy||googleBusy||googleConnecting||!connected;
  $('calendar').disabled=syncBusy||googleBusy||googleConnecting||!connected;

  $('scan').disabled=syncBusy||googleBusy||busy||!files.length;$('images').disabled=syncBusy||googleBusy||busy;$('ocr').disabled=syncBusy||googleBusy||busy;
  $('googleConnection').textContent=googleConnecting?'Conectando…':connected?'Cuenta conectada':'Sin conexión con Google';
  $('accessGoogle').disabled=$('connect').disabled;
  $('continueICS').disabled=googleConnecting||syncBusy||busy;
  $('accessGoogle').textContent=connected?'Continuar a mis designaciones':googleConnecting?'Conectando con Google…':'Continuar con Google';
  $('offlineNotice').hidden=connected;
  const primary=connected?calendars.find(c=>c.primary):null;
  $('accountLabel').textContent=primary?'Calendario principal: '+(primary.summary||primary.id):'';
  router?.refresh();
  autoCheck?.schedule();
  syncController?.refresh();
}
function calendarDetails(){
  const calendar=calendars.find(c=>c.id===$('calendar').value);
  $('calendarDescription').textContent=calendar?.description||'';
  syncController.refresh();
}
$('calendar').onchange=()=>{localStorage.setItem('voley_google_calendar',$('calendar').value);calendarDetails();syncController.invalidate();syncGoogleUI();};
async function connectGoogle(){
  if(googleBusy||googleConnecting)return;
  googleConnecting=true;syncGoogleUI();$('googleStatus').textContent='Esperando autorización de Google…';
  try{
    calendars=await googleService.connect(googleClientId);
    $('calendar').replaceChildren(...calendars.map(c=>new Option(c.summary||c.id,c.id)));
    $('calendar').value=preferredCalendar(calendars,localStorage.getItem('voley_google_calendar'));
    if($('calendar').value)localStorage.setItem('voley_google_calendar',$('calendar').value);
    sessionVersion++;icsMode=false;
    if(!games.length||location.pathname==='/')router?.navigate('/nueva');
    calendarDetails();syncController.invalidate();$('googleStatus').textContent=calendars.length?'Selecciona el calendario de destino.':'No hay calendarios con permiso para crear eventos.';
  }catch(e){calendars=[];$('calendar').replaceChildren(new Option('Conecta Google para seleccionar',''));calendarDetails();$('googleStatus').textContent=e.message;}
  finally{googleConnecting=false;syncGoogleUI();}
}
$('connect').onclick=connectGoogle;
$('accessGoogle').onclick=()=>googleService.isConnected()?router.navigate('/nueva'):connectGoogle();
$('continueICS').onclick=()=>{if(googleService.isConnected())$('disconnect').onclick();icsMode=true;router.navigate('/nueva');syncGoogleUI();};
$('disconnect').onclick=()=>{icsMode=false;sessionVersion++;autoCheck?.cancel();googleService.disconnect();syncController.invalidate({force:true});calendars=[];$('calendar').replaceChildren(new Option('Conecta Google para seleccionar',''));calendarDetails();$('googleStatus').textContent='Google desconectado. El token se ha eliminado de la memoria.';syncGoogleUI();};
if(!googleClientId)$('googleStatus').textContent='Configura VITE_GOOGLE_CLIENT_ID en .env.local y reinicia Vite para conectar Google.';
const syncController=setupSyncUI({service:googleService,
  getGames:()=>{
    if(!selectedName())throw Error('Selecciona o escribe un árbitro antes de comprobar cambios.');
    const all=orderedGames(games,selectedName(),$('duration').value);
    for(const g of all)if(validation(g).length)throw Error('Revisa todos los partidos del árbitro antes de comprobar cambios: '+validation(g).join(' · '));
    if(duplicateGroups(all.map(roleGame),$('duration').value).length)throw Error('Resuelve los duplicados del documento antes de comparar.');
    return all.map(g=>roleGame(captureOriginal(g)));
  },
  getContext:()=>({calendar:$('calendar').value,referee:refereeName(),extractionReliable:lastExtractionReliable,extractionIssues}),
  setBusy:value=>{syncBusy=value;syncGoogleUI();},
  onChange:()=>{try{syncController.signature();}catch{autoCheck?.reset();}autoCheck?.schedule();},
  canUse:()=>googleService.isConnected()&&calendars.some(c=>c.id===$('calendar').value)&&!googleBusy&&!googleConnecting&&!busy
});
render();

router=setupRouter({hasAccess:()=>googleService.isConnected()||icsMode,hasWork:()=>files.length>0||games.length>0,isBusy:()=>busy||googleBusy||syncBusy||googleConnecting});

function automaticKey({force=false}={}){
  if(!googleService.isConnected()||icsMode||busy||syncBusy||googleConnecting)return null;
  if(!games.length||!selectedName()){ $('autoStatus').textContent='Sube un PDF y selecciona tu nombre para comprobar tu calendario.';return null; }
  if(!filterGames(games,selectedName()).length&&!$('syncComplete').checked){$('autoStatus').textContent='No hay partidos de este nombre en el PDF. Si es una jornada actualizada completa, confirma su integridad en la revisión antes de comparar.';return null;}
  if(!calendars.some(c=>c.id===$('calendar').value)){ $('autoStatus').textContent='Selecciona un calendario con permiso de escritura.';return null; }
  try{
    const signature=syncController.signature();
    if(!force&&syncController.hasResults()&&signature===syncController.checkedSignature())return null;
    return JSON.stringify([documentVersion,sessionVersion,signature]);
  }
  catch(e){$('autoStatus').textContent=e.message;return null;}
}
autoCheck=createAutoCheck({getKey:automaticKey,check:async()=>{await syncController.check();$('autoStatus').textContent=$('syncStatus').textContent;},onStart:()=>{
  const context=JSON.stringify([documentVersion,sessionVersion,selectedName(),$('calendar').value]);
  if(lastPresentedContext!==context){lastPresentedContext=context;router.navigate('/revision');}
  $('autoStatus').textContent='Consultando Google Calendar. No se crean ni modifican eventos durante la comprobación.';
},onError:error=>{$('syncStatus').textContent=error.message;}});
$('checkSync').onclick=()=>autoCheck.schedule({force:true});
$('reminder').oninput=()=>syncController.invalidate();
syncGoogleUI();
