const $=id=>document.getElementById(id);let games=[],files=[];const timezone='Europe/Madrid';
$('clientId').value=localStorage.getItem('voley_google_client')||'';$('clientId').addEventListener('change',e=>localStorage.setItem('voley_google_client',e.target.value.trim()));
$('images').addEventListener('change',e=>{files=[...e.target.files];$('files').textContent=files.map(f=>f.name).join(' · ');$('scan').disabled=!files.length;$('status').textContent=`${files.length} imagen(es) preparada(s)`});
function normalize(s){return(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\s+/g,' ').trim()}
function blank(){return{id:crypto.randomUUID(),date:'',time:'',home:'',away:'',category:'',venue:'',role:'',notes:'',selected:true,warning:'Revisa y completa los datos'}}
let scannedTexts=[];
function candidateNames(text){
 const names=new Map();
 for(const raw of text.split(/\n/)){
  // En estas tablas los nombres aparecen a la derecha de fecha y hora.
  const time=/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/.exec(raw);
  if(!time)continue;
  const tail=raw.slice(time.index+time[0].length).trim();
  const chunks=tail.split(/\s{2,}|\t+|\s*[|;]\s*/).map(x=>x.trim()).filter(Boolean);
  for(const chunk of chunks){
   const n=normalize(chunk.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s'-]/g,' '));
   const words=n.split(' ').filter(Boolean);
   if(words.length<2||words.length>4||n.length>38||words.some(w=>w.length<2))continue;
   if(/\b(PABELLON|MUNICIPAL|VOLEIBOL|GRANADA|ANDALUZA|FEMENINA|MASCULINA|CLUB|CADETE|JUNIOR|INFANTIL|JUVENIL)\b/.test(n))continue;
   names.set(n,(names.get(n)||0)+1);
  }
 }
 return names;
}
function refreshNames(){
 const all=new Map();for(const t of scannedTexts)for(const [n,c] of candidateNames(t))all.set(n,(all.get(n)||0)+c);
 const sel=$('refereeSelect'),previous=sel.value;sel.replaceChildren();
 const initial=document.createElement('option');initial.value='';initial.textContent='Selecciona un árbitro';sel.append(initial);
 for(const n of [...all.keys()].sort((a,b)=>a.localeCompare(b,'es'))){const o=document.createElement('option');o.value=n;o.textContent=n;sel.append(o)}
 if(all.has(previous))sel.value=previous;
 $('namesStatus').textContent=`${all.size} nombre(s) candidato(s) detectado(s). Revisa la lista: el OCR puede producir errores o nombres incompletos.`;
}
function parseText(text,name){
 const lines=text.split(/\n/).map(x=>x.trim()).filter(Boolean),found=[];
 if(!name)return found;
 for(const line of lines){
  if(!normalize(line).includes(name))continue;
  const date=(line.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/)||[])[0];
  const time=(line.match(/\b([01]?\d|2[0-3]):[0-5]\d\b/)||[])[0];
  const game=blank();if(date){const a=date.split(/[-/.]/);game.date=`${a[2].length===2?'20'+a[2]:a[2]}-${a[1].padStart(2,'0')}-${a[0].padStart(2,'0')}`}
  game.time=time||'';game.notes=`Texto OCR original: ${line}`;
  game.warning='Revisa los equipos, el pabellón y la función: el OCR todavía no reconstruye las columnas de la tabla';found.push(game);
 }
 return found;
}
function applyFilter(){
 const name=normalize($('referee').value||$('refereeSelect').value);
 games=scannedTexts.flatMap(t=>parseText(t,name));render();
 $('namesStatus').textContent=name?`Filtro: ${name}. ${games.length} fila(s) coincidente(s). Revisa cada partido antes de exportar.`:'Selecciona o escribe un nombre para filtrar los partidos.';
}
$('refereeSelect').addEventListener('change',()=>{$('referee').value='';applyFilter()});
$('referee').addEventListener('input',applyFilter);
$('scan').addEventListener('click',async()=>{
 if(!window.Tesseract){$('status').textContent='No se pudo cargar el motor OCR. Comprueba tu conexión.';return}
 const button=$('scan');button.disabled=true;scannedTexts=[];
 let worker;
 try{
  worker=await Tesseract.createWorker('spa+eng');
  for(let i=0;i<files.length;i++){
   $('status').textContent=`Analizando imagen ${i+1} de ${files.length}…`;
   const result=await worker.recognize(files[i]);scannedTexts.push(result.data.text);
  }
  refreshNames();applyFilter();
  $('status').textContent=`${files.length} captura(s) analizada(s). Selecciona un árbitro para ver sus partidos.`;
 }catch(e){$('status').textContent='Error de reconocimiento: '+e.message}
 finally{if(worker)await worker.terminate();button.disabled=false}
});
$('add').addEventListener('click',()=>{games.push(blank());render()});
function render(){const container=$('games');container.replaceChildren();$('count').textContent=`${games.length} partido(s)`;if(!games.length){container.innerHTML='<p class="muted">Todavía no hay partidos. Sube imágenes o añade uno manualmente.</p>';return}games.forEach((g,index)=>{const card=document.createElement('article');card.className='game';const top=document.createElement('div');top.className='game-top';const check=document.createElement('label');const cb=document.createElement('input');cb.type='checkbox';cb.checked=g.selected;cb.style.width='auto';cb.style.display='inline-block';cb.onchange=e=>g.selected=e.target.checked;check.append(cb,document.createTextNode(` Exportar partido ${index+1}`));const del=document.createElement('button');del.className='remove';del.textContent='Eliminar';del.onclick=()=>{games=games.filter(x=>x.id!==g.id);render()};top.append(check,del);card.append(top);const grid=document.createElement('div');grid.className='game-grid';for(const [key,label,type] of [['date','Fecha','date'],['time','Hora','time'],['home','Equipo local','text'],['away','Equipo visitante','text'],['category','Categoría','text'],['venue','Pabellón','text'],['role','Función arbitral','select'],['notes','Observaciones','text']]){const field=document.createElement('label');field.textContent=label;let input;if(type==='select'){input=document.createElement('select');for(const value of ['','Primer árbitro','Segundo árbitro','Anotador','Otro']){const opt=document.createElement('option');opt.value=value;opt.textContent=value||'Seleccionar función';input.append(opt)}}else{input=document.createElement('input');input.type=type}input.value=g[key];input.oninput=e=>g[key]=e.target.value;field.append(input);grid.append(field)}card.append(grid);if(g.warning){const p=document.createElement('p');p.className='warning';p.textContent='⚠ '+g.warning;card.append(p)}container.append(card)})}
function selectedGames(){const selected=games.filter(g=>g.selected);if(!selected.length)throw Error('Selecciona al menos un partido');for(const g of selected){if(!/^\d{4}-\d{2}-\d{2}$/.test(g.date)||!/^\d{2}:\d{2}$/.test(g.time)||!g.home||!g.away||!g.role)throw Error('Completa fecha, hora, ambos equipos y función en todos los partidos seleccionados')}return selected}
function esc(s){return String(s||'').replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;')}
function localStamp(g){return g.date.replaceAll('-','')+'T'+g.time.replace(':','')+'00'}
function utcStamp(date){return date.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'')}
function getDates(g){const [y,m,d]=g.date.split('-').map(Number),[h,minute]=g.time.split(':').map(Number);const local=new Date(Date.UTC(y,m-1,d,h,minute));const fmt=new Intl.DateTimeFormat('en-GB',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});const parts=Object.fromEntries(fmt.formatToParts(local).map(p=>[p.type,p.value]));const observed=Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute);let start=new Date(local.getTime()+(local.getTime()-observed));const p2=Object.fromEntries(fmt.formatToParts(start).map(p=>[p.type,p.value]));const check=Date.UTC(+p2.year,+p2.month-1,+p2.day,+p2.hour,+p2.minute);if(check!==local.getTime())start=new Date(start.getTime()+(local.getTime()-check));const mins=Number($('duration').value)||120;return {start,end:new Date(start.getTime()+mins*60000)}}
function title(g){return `🏐 ${g.home} vs ${g.away} (${g.role})`}
function description(g){return [`Categoría: ${g.category}`,`Función: ${g.role}`,`Árbitro: ${$('referee').value}`,g.notes].filter(Boolean).join('\n')}
$('ics').onclick=()=>{try{const items=selectedGames(),reminder=Math.max(0,Number($('reminder').value)||0);const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Voley Calendar//ES','CALSCALE:GREGORIAN','METHOD:PUBLISH'];for(const g of items){const {start,end}=getDates(g);lines.push('BEGIN:VEVENT',`UID:${g.id}@voley-calendar.local`,`DTSTAMP:${utcStamp(new Date())}`,`DTSTART:${utcStamp(start)}`,`DTEND:${utcStamp(end)}`,`SUMMARY:${esc(title(g))}`,`DESCRIPTION:${esc(description(g))}`,`LOCATION:${esc(g.venue)}`);if(reminder>0)lines.push('BEGIN:VALARM','ACTION:DISPLAY',`DESCRIPTION:${esc(title(g))}`,`TRIGGER:-PT${reminder}M`,'END:VALARM');lines.push('END:VEVENT')}lines.push('END:VCALENDAR');const blob=new Blob([lines.join('\r\n')+'\r\n'],{type:'text/calendar;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='voley-calendar.ics';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);$('exportStatus').textContent=`Archivo ICS generado con ${items.length} partido(s).` }catch(e){$('exportStatus').textContent=e.message}};
$('google').onclick=async()=>{try{const items=selectedGames();const clientId=$('clientId').value.trim();if(!clientId)throw Error('Configura primero el OAuth Client ID de Google');if(!window.google?.accounts?.oauth2)throw Error('No se ha cargado Google Identity Services');$('exportStatus').textContent='Esperando autorización de Google…';const tokenClient=google.accounts.oauth2.initTokenClient({client_id:clientId,scope:'https://www.googleapis.com/auth/calendar.events',callback:async response=>{if(response.error){$('exportStatus').textContent='Error OAuth: '+response.error;return}let created=0;try{const existingResponse=await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=250&singleEvents=true&timeMin='+encodeURIComponent(new Date(Math.min(...items.map(g=>getDates(g).start.getTime()))-86400000).toISOString()),{headers:{Authorization:'Bearer '+response.access_token}});if(!existingResponse.ok)throw Error('No se pudieron consultar los eventos existentes');const existing=(await existingResponse.json()).items||[];for(const g of items){const {start,end}=getDates(g),summary=title(g);if(existing.some(e=>e.summary===summary&&e.start?.dateTime&&Math.abs(new Date(e.start.dateTime)-start)<60000))continue;const reminder=Math.max(0,Number($('reminder').value)||0);const event={summary,location:g.venue,description:description(g),start:{dateTime:start.toISOString(),timeZone:timezone},end:{dateTime:end.toISOString(),timeZone:timezone},reminders:{useDefault:false,overrides:reminder?[{method:'popup',minutes:reminder}]:[]}};const res=await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events',{method:'POST',headers:{Authorization:'Bearer '+response.access_token,'Content-Type':'application/json'},body:JSON.stringify(event)});if(!res.ok)throw Error('Google rechazó un evento: HTTP '+res.status);created++}$('exportStatus').textContent=`Google Calendar: ${created} evento(s) creados. Los duplicados detectados se omitieron.`}catch(e){$('exportStatus').textContent=e.message}}});tokenClient.requestAccessToken({prompt:'consent'})}catch(e){$('exportStatus').textContent=e.message}};
render();
