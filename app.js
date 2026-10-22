import {blank, normalize, referees, functionsFor, filterGames, refereeKeys} from './src/model.js';
import {readPDF} from './src/pdf.js';
import {extractPage} from './src/extract.js';
import {getDates,createICS,title} from './src/calendar.js';
import {createGoogleService,preferredCalendar} from './src/google.js';
import {captureOriginal} from './src/google-identity.js';
import {orderedGames,eventGame,prepareEvent,duplicateGroups} from './src/prepare.js';
const $=id=>document.getElementById(id);
let games=[],files=[],busy=false;
const progress=text=>$('status').textContent=text;
const selectedName=()=>normalize($('referee').value||$('refereeSelect').value);
const googleClientId=import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim()||'';
$('images').onchange=e=>{files=[...e.target.files];$('files').textContent=files.map(f=>f.name).join(' · ');$('scan').disabled=!files.length;progress(`${files.length} documento(s) preparado(s)`);};
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
}
function validation(g){
  const errors=[]; const value=roleGame(g);
  for(const [key,label] of [['date','fecha'],['time','hora'],['home','equipo local'],['away','equipo visitante'],['role','función arbitral']]) if(!value[key]?.trim())errors.push(`Falta ${label}`);
  try{getDates(g,$('duration').value);}catch(e){errors.push(e.message);}
  if(g.issues.length&&!g.reviewed)errors.push(...g.issues);
  return errors;
}
function render(){
  const visible=orderedGames(games,selectedName(),$('duration').value);
  $('count').textContent=`${visible.length} partido(s)${selectedName()?' del árbitro':''}`;
  const container=$('games'); container.replaceChildren();
  if(!visible.length){const p=document.createElement('p');p.className='muted';p.textContent='No hay partidos para mostrar. Sube documentos o añade uno manualmente.';container.append(p);}
  for(const g of visible){
    const card=document.createElement('article');card.className='game';card.dataset.gameId=g.id;
    const top=document.createElement('div');top.className='game-top';const label=document.createElement('label'),cb=document.createElement('input');cb.type='checkbox';cb.style.width='auto';cb.style.display='inline';cb.checked=g.selected;cb.onchange=()=>{g.selected=cb.checked;updateSummary();};label.append(cb,document.createTextNode(' Exportar partido'));
    const remove=document.createElement('button');remove.className='remove';remove.textContent='Eliminar';remove.onclick=()=>{games=games.filter(x=>x!==g);refreshNames();render();};top.append(label,remove);card.append(top);
    const grid=document.createElement('div');grid.className='game-grid';
    const state=document.createElement('p'),end=document.createElement('p');end.className='muted';
    const preview=document.createElement('details'),previewLabel=document.createElement('summary'),previewText=document.createElement('p');previewLabel.textContent='Vista previa del evento';previewText.className='event-preview';preview.append(previewLabel,previewText);
    const update=()=>{const errors=validation(g);state.className=errors.length?'warning':'ok';state.textContent=errors.length?'Revisión necesaria: '+[...new Set(errors)].join(' · '):'Validado';try{end.textContent='Finalización: '+new Intl.DateTimeFormat('es-ES',{timeZone:'Europe/Madrid',dateStyle:'short',timeStyle:'short'}).format(getDates(g,$('duration').value).end);}catch{end.textContent='Finalización pendiente de fecha y hora válidas';}};
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
      field.append(input);grid.append(field);
    }
    const review=document.createElement('label'),reviewCheck=document.createElement('input');reviewCheck.type='checkbox';reviewCheck.style.width='auto';reviewCheck.checked=g.reviewed;reviewCheck.onchange=()=>{g.reviewed=reviewCheck.checked;update();syncGoogleUI();};review.append(reviewCheck,document.createTextNode(' He revisado las advertencias y contrastado las funciones con el documento'));
    function updatePreview(){
      try{const event=prepareEvent(g,refereeName(),$('duration').value);previewText.textContent=[event.summary,`Ubicación: ${event.location || 'Sin especificar'}`,event.description,`Zona horaria: ${event.start.timeZone}`].join('\n');}
      catch(e){previewText.textContent=`${title(roleGame(g))}\n${e.message}`;}
    }
    card.append(grid,end,state,review,preview);update();updatePreview();container.append(card);
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
  if(busy)return;busy=true;$('scan').disabled=true;$('ocr').disabled=true;$('images').disabled=true;
  batch=null;googleResults.clear();showGoogleResults();syncGoogleUI();
  let worker;const next=[],warnings=[];
  try{
    const needsOCR=useOCR||files.some(f=>f.type.startsWith('image/'));
    if(needsOCR){if(!window.Tesseract)throw Error('No se pudo cargar Tesseract. Comprueba la conexión para usar OCR.');worker=await window.Tesseract.createWorker('spa+eng',1,{logger:m=>{if(m.status==='recognizing text')progress(`Reconociendo texto: ${Math.round(m.progress*100)} %`);}});}
    let missingText=false;
    for(const file of files){
      try{
        if(file.type==='application/pdf'||/\.pdf$/i.test(file.name)){
          const result=await readPDF(file,progress,useOCR?(canvas,n)=>ocr(canvas,n,worker):undefined);next.push(...result.games);
          if(result.scannedPages.length){missingText=true;warnings.push(`${file.name}: páginas ${result.scannedPages.join(', ')} sin texto seleccionable. Pulsa «Procesar con OCR».`);}
          if(!result.games.length&&!result.scannedPages.length)warnings.push(`${file.name}: no se encontraron filas de partidos. Revisa el formato de tabla o prueba OCR con una imagen.`);
        }else if(file.type.startsWith('image/'))next.push(...await ocr(file,1,worker));
        else warnings.push(`Formato no admitido: ${file.name}`);
      }catch(e){warnings.push(`${file.name}: ${e.message}`);}
    }
    games=next.map(captureOriginal);refreshNames();render();$('ocr').hidden=!missingText;
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
$('ics').onclick=async()=>{try{const items=selectedGames(),ics=await createICS(items,$('duration').value,reminder()),url=URL.createObjectURL(new Blob([ics],{type:'text/calendar;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='voley-calendar.ics';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);$('exportStatus').textContent=`Archivo ICS generado: ${items.length} partidos.`;}catch(e){$('exportStatus').textContent=e.message;}};
let googleBusy=false,googleConnecting=false,calendars=[],batch=null,expiryTimer;
const googleResults=new Map();
const googleService=createGoogleService({onState:state=>{
  clearTimeout(expiryTimer);syncGoogleUI();
  if(state.connected)expiryTimer=setTimeout(()=>{syncGoogleUI();$('googleStatus').textContent='La sesión ha caducado. Conecta Google de nuevo.';},Math.max(0,state.expiresAt-Date.now()+10));
}});
const resultLabels={checking:'Comprobando duplicados…',creating:'Creando evento…',created:'Creado (confirmado por Google)',existing:'Ya existente',pending:'Pendiente de actualización (sin modificar)',review:'Coincidencia dudosa: revisar en Google (sin crear)',error:'Error'};
function syncGoogleUI(){
  const connected=googleService.isConnected(),selected=filterGames(games,selectedName()).filter(g=>g.selected);
  const valid=!!selectedName()&&selected.length>0&&selected.every(g=>!validation(g).length)&&!duplicateGroups(selected.map(roleGame),$('duration').value).length;
  $('connect').disabled=googleBusy||googleConnecting||busy||!googleClientId;
  $('disconnect').disabled=googleBusy||googleConnecting||!connected;
  $('calendar').disabled=googleBusy||googleConnecting||!connected;
  $('google').disabled=googleBusy||googleConnecting||busy||!connected||!$('calendar').value||!valid;
  $('retryGoogle').hidden=![...googleResults.values()].some(r=>r.status==='error');
  $('retryGoogle').disabled=googleBusy||googleConnecting||busy||!connected||!batch||batch.calendar!==$('calendar').value;
  $('scan').disabled=googleBusy||busy||!files.length;$('images').disabled=googleBusy||busy;$('ocr').disabled=googleBusy||busy;
  $('googleConnection').textContent=googleConnecting?'Conectando…':connected?'Cuenta conectada':'Sin conexión con Google';
}
function calendarDetails(){
  const calendar=calendars.find(c=>c.id===$('calendar').value);
  $('calendarDescription').textContent=calendar?.description||'';
}
function showGoogleResults(){
  $('googleResults').replaceChildren();
  const counts={created:0,existing:0,pending:0,review:0,error:0};
  for(const result of googleResults.values()){
    if(result.status in counts)counts[result.status]++;
    const item=document.createElement('li');item.className=result.status==='error'?'warning':'';
    item.textContent=`${result.game.date} ${result.game.time} · ${title(result.game)}: ${resultLabels[result.status]}${result.detail?' — '+result.detail:''}`;
    for(const match of result.matches||[]){
      const detail=document.createElement('p');detail.className='muted';detail.textContent=`En Google: ${match.summary||'Sin título'} · ${match.start?.dateTime||match.start?.date||''} · ${match.location||'Sin ubicación'}`;
      if(match.htmlLink?.startsWith('https://calendar.google.com/')||match.htmlLink?.startsWith('https://www.google.com/calendar/')){const link=document.createElement('a');link.href=match.htmlLink;link.target='_blank';link.rel='noopener noreferrer';link.textContent=' Abrir en Google Calendar';detail.append(link);}
      item.append(detail);
    }
    $('googleResults').append(item);
  }
  const finished=[...googleResults.values()].filter(r=>r.status in counts).length;
  $('googleImportSummary').textContent=batch?`${googleBusy?'Progreso':'Resultado'}: ${finished}/${batch.games.length} · ${counts.created} creados · ${counts.existing} existentes · ${counts.pending} pendientes de actualización · ${counts.review} para revisión · ${counts.error} errores. Calendario: ${batch.calendarName}`:'';
}
$('calendar').onchange=()=>{localStorage.setItem('voley_google_calendar',$('calendar').value);calendarDetails();syncGoogleUI();};
$('connect').onclick=async()=>{
  if(googleBusy||googleConnecting)return;
  googleConnecting=true;syncGoogleUI();$('googleStatus').textContent='Esperando autorización de Google…';
  try{
    calendars=await googleService.connect(googleClientId);
    $('calendar').replaceChildren(...calendars.map(c=>new Option(c.summary||c.id,c.id)));
    $('calendar').value=preferredCalendar(calendars,localStorage.getItem('voley_google_calendar'));
    if($('calendar').value)localStorage.setItem('voley_google_calendar',$('calendar').value);
    calendarDetails();$('googleStatus').textContent=calendars.length?'Selecciona el calendario de destino.':'No hay calendarios con permiso para crear eventos.';
  }catch(e){calendars=[];$('calendar').replaceChildren(new Option('Conecta Google para seleccionar',''));calendarDetails();$('googleStatus').textContent=e.message;}
  finally{googleConnecting=false;syncGoogleUI();}
};
$('disconnect').onclick=()=>{googleService.disconnect();calendars=[];$('calendar').replaceChildren(new Option('Conecta Google para seleccionar',''));calendarDetails();$('googleStatus').textContent='Google desconectado. El token se ha eliminado de la memoria.';syncGoogleUI();};
async function runGoogle(retry=false){
  if(googleBusy)return;
  try{
    if(!googleService.isConnected())throw Error('Conecta Google antes de importar.');
    let items;
    if(retry){
      if(!batch||batch.calendar!==$('calendar').value)throw Error('Selecciona el calendario de la importación anterior para reintentar.');
      items=[...googleResults.values()].filter(r=>r.status==='error').map(r=>r.game);
    }else{
      items=structuredClone(selectedGames());
      batch={games:items,calendar:$('calendar').value,calendarName:calendars.find(c=>c.id===$('calendar').value)?.summary||$('calendar').value,duration:Number($('duration').value),reminder:reminder()};
      googleResults.clear();
    }
    if(!items.length)throw Error('No hay partidos fallidos para reintentar.');
    googleBusy=true;syncGoogleUI();
    for(const game of items)googleResults.set(game.id,{game,status:'checking'});
    showGoogleResults();$('googleStatus').textContent=retry?'Reintentando únicamente los partidos fallidos con los datos de la importación anterior…':'Importación en curso…';
    await googleService.importGames(items,batch.calendar,batch.duration,batch.reminder,result=>{googleResults.set(result.game.id,result);showGoogleResults();});
    $('googleStatus').textContent='Proceso terminado. Consulta el resultado de cada partido.';
  }catch(e){$('googleStatus').textContent=e.message;}
  finally{googleBusy=false;showGoogleResults();syncGoogleUI();}
}
$('google').onclick=()=>runGoogle();$('retryGoogle').onclick=()=>runGoogle(true);
if(!googleClientId)$('googleStatus').textContent='Configura VITE_GOOGLE_CLIENT_ID en .env.local y reinicia Vite para conectar Google.';
render();
