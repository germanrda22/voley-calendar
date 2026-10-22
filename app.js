import {blank, normalize, referees, functionsFor, filterGames, refereeKeys} from './src/model.js';
import {readPDF} from './src/pdf.js';
import {extractPage} from './src/extract.js';
import {getDates,createICS,title} from './src/calendar.js';
import {connect,exportGoogle} from './src/google.js';
const $=id=>document.getElementById(id);
let games=[],files=[],busy=false;
const progress=text=>$('status').textContent=text;
const selectedName=()=>normalize($('referee').value||$('refereeSelect').value);
$('clientId').value=localStorage.getItem('voley_google_client')||'';
$('clientId').onchange=e=>localStorage.setItem('voley_google_client',e.target.value.trim());
$('images').onchange=e=>{files=[...e.target.files];$('files').textContent=files.map(f=>f.name).join(' · ');$('scan').disabled=!files.length;progress(`${files.length} documento(s) preparado(s)`);};
function refreshNames(){
  const previous=$('refereeSelect').value, names=referees(games);
  $('refereeSelect').replaceChildren(new Option('Selecciona un árbitro',''),...names.map(([key,name])=>new Option(name,key)));
  $('refereeSelect').value=names.some(([key])=>key===previous)?previous:'';
  $('namesStatus').textContent=`${games.length} partidos detectados · ${names.length} árbitros únicos`;
}
function roleGame(g){return {...g,role:g.roleOverrides?.[selectedName()]||functionsFor(g,selectedName()).join(' / '),referee:$('referee').value||$('refereeSelect').selectedOptions[0]?.textContent||''};}
function validation(g){
  const errors=[]; const value=roleGame(g);
  for(const [key,label] of [['date','fecha'],['time','hora'],['home','equipo local'],['away','equipo visitante'],['role','función arbitral']]) if(!value[key]?.trim())errors.push(`Falta ${label}`);
  try{getDates(g,$('duration').value);}catch(e){errors.push(e.message);}
  if(g.issues.length&&!g.reviewed)errors.push(...g.issues);
  return errors;
}
function render(){
  const visible=filterGames(games,selectedName());
  $('count').textContent=`${visible.length} partido(s)${selectedName()?' del árbitro':''}`;
  const container=$('games'); container.replaceChildren();
  if(!visible.length){const p=document.createElement('p');p.className='muted';p.textContent='No hay partidos para mostrar. Sube documentos o añade uno manualmente.';container.append(p);}
  for(const g of visible){
    const card=document.createElement('article');card.className='game';
    const top=document.createElement('div');top.className='game-top';const label=document.createElement('label'),cb=document.createElement('input');cb.type='checkbox';cb.style.width='auto';cb.style.display='inline';cb.checked=g.selected;cb.onchange=()=>g.selected=cb.checked;label.append(cb,document.createTextNode(' Exportar partido'));
    const remove=document.createElement('button');remove.className='remove';remove.textContent='Eliminar';remove.onclick=()=>{games=games.filter(x=>x!==g);refreshNames();render();};top.append(label,remove);card.append(top);
    const grid=document.createElement('div');grid.className='game-grid';
    const state=document.createElement('p'),end=document.createElement('p');end.className='muted';
    const update=()=>{const errors=validation(g);state.className=errors.length?'warning':'ok';state.textContent=errors.length?'Revisión necesaria: '+[...new Set(errors)].join(' · '):'Validado';try{end.textContent='Finalización: '+new Intl.DateTimeFormat('es-ES',{timeZone:'Europe/Madrid',dateStyle:'short',timeStyle:'short'}).format(getDates(g,$('duration').value).end);}catch{end.textContent='Finalización pendiente de fecha y hora válidas';}};
    const fields=[['date','Fecha','date'],['time','Hora de inicio','time'],['category','Categoría','text'],['competition','Competición / grupo','text'],['home','Equipo local','text'],['away','Equipo visitante','text'],['venue','Pabellón','text'],['first','Primer árbitro','text'],['second','Segundo árbitro','text'],['scorer','Anotador','text'],['roleOverride','Función del árbitro seleccionado','select'],['duration','Duración propia (min, opcional)','number'],['dstChoice','Hora repetida en octubre','dst'],['notes','Texto original / observaciones','text']];
    for(const [key,text,type] of fields){
      const field=document.createElement('label');field.textContent=text;let input;
      if(type==='select'||type==='dst'){input=document.createElement('select');const options=type==='dst'?[['','Elegir si la hora es ambigua'],['first','Primera ocurrencia (verano)'],['second','Segunda ocurrencia (invierno)']]:[['',functionsFor(g,selectedName()).join(' / ')||'Sin identificar'],...['Primer árbitro','Segundo árbitro','Anotador','Otro'].map(v=>[v,v])];for(const [value,text]of options)input.add(new Option(text,value));}
      else{input=document.createElement('input');input.type=type;if(type==='number'){input.min='1';input.max='1440';}}
      input.value=key==='roleOverride'?(g.roleOverrides?.[selectedName()]||''):(g[key]||'');
      input.oninput=()=>{if(key==='roleOverride'){g.roleOverrides||={};g.roleOverrides[selectedName()]=input.value;}else g[key]=input.value;g.reviewed=false;reviewCheck.checked=false;update();};
      if(refereeKeys.includes(key))input.onchange=()=>{refreshNames();render();};
      field.append(input);grid.append(field);
    }
    const review=document.createElement('label'),reviewCheck=document.createElement('input');reviewCheck.type='checkbox';reviewCheck.style.width='auto';reviewCheck.checked=g.reviewed;reviewCheck.onchange=()=>{g.reviewed=reviewCheck.checked;update();};review.append(reviewCheck,document.createTextNode(' He revisado las advertencias y contrastado las funciones con el documento'));
    card.append(grid,end,state,review);update();container.append(card);
  }
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
    games=next;refreshNames();render();$('ocr').hidden=!missingText;
    progress([`${games.length} partidos extraídos. Selecciona un árbitro y revisa sus partidos.`,...warnings].join(' '));
  }catch(e){progress('Error de lectura: '+e.message);}
  finally{if(worker)await worker.terminate();busy=false;$('scan').disabled=!files.length;$('ocr').disabled=false;$('images').disabled=false;}
}
$('scan').onclick=()=>scan();$('ocr').onclick=()=>scan(true);
function selectedGames(){
  if(!selectedName())throw Error('Selecciona o escribe el nombre del árbitro antes de exportar');
  const selected=filterGames(games,selectedName()).filter(g=>g.selected);
  if(!selected.length)throw Error('Selecciona al menos un partido');
  for(const g of selected)if(validation(g).length)throw Error('Completa y revisa todos los partidos seleccionados: '+validation(g).join(' · '));
  return selected.map(roleGame);
}
const reminder=()=>{const n=Number($('reminder').value);if(!Number.isInteger(n)||n<0||n>10080)throw Error('Recordatorio válido: de 0 a 10080 minutos');return n;};
$('ics').onclick=async()=>{try{const items=selectedGames(),ics=await createICS(items,$('duration').value,reminder()),url=URL.createObjectURL(new Blob([ics],{type:'text/calendar;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='voley-calendar.ics';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);$('exportStatus').textContent=`Archivo ICS generado: ${items.length} partidos.`;}catch(e){$('exportStatus').textContent=e.message;}};
$('connect').onclick=async()=>{try{$('connect').disabled=true;$('exportStatus').textContent='Esperando autorización de Google…';const calendars=await connect($('clientId').value.trim());$('calendar').replaceChildren(...calendars.map(c=>new Option(c.summary,c.id)));$('exportStatus').textContent=`Sesión iniciada. ${calendars.length} calendarios disponibles.`;}catch(e){$('exportStatus').textContent=e.message;}finally{$('connect').disabled=false;}};
$('google').onclick=async()=>{try{$('google').disabled=true;const items=selectedGames(),messages=[];$('exportStatus').textContent='Comprobando duplicados…';await exportGoogle(items,$('calendar').value,$('duration').value,reminder(),(g,result)=>{messages.push(`${title(g)}: ${result}`);$('exportStatus').textContent=messages.join('\n');});}catch(e){$('exportStatus').textContent=e.message;}finally{$('google').disabled=false;}};
render();
