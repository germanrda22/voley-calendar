import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {extractPage} from '../src/extract.js';
import {functionsFor} from '../src/model.js';
import {captureOriginal} from '../src/google-identity.js';
import {createGoogleService,googleEvent,scopes} from '../src/google.js';
import {metadata,privateData,fingerprint} from '../src/sync.js';
import {detectRound,automaticScope,findHeaderIntervals,confirmRound} from '../src/round.js';

const game=(changes={})=>captureOriginal({id:crypto.randomUUID(),date:'2026-10-17',time:'10:00',home:'Local',away:'Visitante',category:'Júnior',competition:'Oro',venue:'Pabellón',referee:'Germán Ruiz',role:'Primer árbitro',first:'Germán Ruiz',...changes});
const scope={calendar:'calendar/test',referee:'Germán Ruiz',round:'2026-jornada-3',from:'2026-10-12',to:'2026-10-18',complete:false,extractionReliable:true};
const response=(data,status=200)=>({status,ok:status<300,json:async()=>{if(status===204)throw Error('No body');return structuredClone(data);},headers:{get:()=>null}});
function harness(){
  const store=new Map(),calls=[];let version=0,fault=null;
  const sdk={initTokenClient:config=>({requestAccessToken:()=>config.callback({access_token:'memory',scope:scopes.join(' '),expires_in:3600})})};
  const service=createGoogleService({oauth:()=>sdk,sleep:async()=>{},fetcher:async(url,options)=>{
    calls.push({url,options});if(fault){const result=await fault(url,options);if(result)return result;}
    const u=new URL(url),path=u.pathname,method=options.method||'GET';
    if(path.endsWith('/calendarList'))return response({items:[{id:scope.calendar,accessRole:'owner'}]});
    const eventId=path.split('/events/')[1];
    if(eventId){
      const previous=store.get(decodeURIComponent(eventId));if(!previous)return response({},404);
      if(method==='GET')return response(previous);
      if(options.headers['If-Match']!==previous.etag)return response({},412);
      if(method==='PATCH'){
        const patch=JSON.parse(options.body),saved={...previous,...patch,extendedProperties:{...previous.extendedProperties,...patch.extendedProperties},etag:`"${++version}"`};
        store.set(saved.id,saved);return response(saved);
      }
      if(method==='DELETE'){store.set(previous.id,{id:previous.id,status:'cancelled',etag:`"${++version}"`});return response({},204);}
    }
    if(method==='POST'){
      const body=JSON.parse(options.body);if(store.has(body.id))return response({},409);
      const saved={...body,etag:`"${++version}"`,status:'confirmed'};store.set(saved.id,saved);return response(saved);
    }
    let items=[...store.values()];
    const property=u.searchParams.get('privateExtendedProperty');
    if(property){const split=property.indexOf('=');items=items.filter(e=>privateData(e)[property.slice(0,split)]===property.slice(split+1));}
    const min=u.searchParams.get('timeMin'),max=u.searchParams.get('timeMax');
    if(min&&max)items=items.filter(e=>!e.start||e.start.dateTime>=min&&e.start.dateTime<=max);
    return response({items});
  }});
  return {service,store,calls,setFault:fn=>fault=fn,async seed(g,extra={}){const payload=await googleEvent(g);const saved={...payload,extendedProperties:{private:await metadata(g,payload,{round:scope.round})},etag:`"${++version}"`,status:'confirmed',...extra};store.set(saved.id,saved);return saved;}};
}
const connect=h=>h.service.connect('id');
const select=plan=>plan.rows.filter(r=>r.action).map(r=>r.key);

test('regresión: importación v2 de 6 partidos y PDF actualizado de 5 propone retirar Monachil–Albolote',async()=>{
  const read=async file=>{const pdf=await getDocument({data:new Uint8Array(fs.readFileSync('fixtures/'+file))}).promise;try{const all=[],headers=[];for(let n=1;n<=pdf.numPages;n++){const page=await pdf.getPage(n),text=await page.getTextContent();headers.push(...findHeaderIntervals(text.items.map(i=>i.str).join(' ')));all.push(...extractPage(text.items,page.getViewport({scale:1}).width,n));}return {games:all.filter(g=>functionsFor(g,scope.referee).length).map(g=>({...captureOriginal(g),referee:scope.referee,role:functionsFor(g,scope.referee).join(' / ')})),context:automaticScope(detectRound(all,headers),{...scope,complete:true,extractionReliable:all.length>0&&all.every(g=>!g.issues.length)})};}finally{await pdf.destroy();}};
  const original=await read(fs.readdirSync('fixtures').find(f=>f.startsWith('DESIGNACION'))),updated=await read('designaciones_actualizadas_sin_monachil_albolote.pdf');
  assert.equal(original.games.length,6);assert.equal(updated.games.length,5);
  assert.equal(updated.context.from,'2026-10-12');assert.equal(updated.context.to,'2026-10-18');assert(updated.context.extractionReliable);
  const h=harness();await connect(h);
  for(const g of original.games){const event=await h.seed(g);h.store.set(event.id,{...event,extendedProperties:{private:{voleyId:event.id,voleyVersion:'2'}}});}
  const plan=await h.service.checkChanges(updated.games,updated.context);
  const removed=plan.rows.filter(row=>row.status==='possible-delete');assert.equal(removed.length,1);
  assert.match(removed[0].event.summary,/ACADEMIA VOLEIBOL MONACHIL vs RADIOKABLE ALBOLOTE ROJO/i);
  assert.equal(removed[0].event.start.dateTime,'2026-10-17T08:00:00.000Z');
  assert.deepEqual([plan.diagnostics.queried,plan.diagnostics.forReferee,plan.diagnostics.matched,plan.diagnostics.proposed],[6,6,5,1]);
  const intervalQuery=h.calls.map(call=>new URL(call.url)).find(url=>url.searchParams.has('timeMin'));
  assert(new Date(intervalQuery.searchParams.get('timeMin'))<=new Date('2026-10-12T00:00:00Z'));
  assert(new Date(intervalQuery.searchParams.get('timeMax'))>new Date('2026-10-18T23:59:59Z'));
  assert.equal(h.store.get(removed[0].event.id).status,'confirmed');assert(!h.calls.some(call=>call.options.method));
});

test('regresión: eventos antiguos retirados del primer o último día se encuentran por el intervalo completo',async()=>{
  for(const date of ['2026-10-12','2026-10-18']){
    const h=harness(),original=[game(),game({date,time:'00:30',home:'Monachil',away:'Albolote'})];await connect(h);
    for(const g of original){const event=await h.seed(g);h.store.set(event.id,{...event,extendedProperties:{private:{voleyId:event.id,voleyVersion:'2'}}});}
    const updated=[game()],context=automaticScope(detectRound(updated,[{from:'2026-10-12',to:'2026-10-18'}]),{...scope,complete:true});
    const plan=await h.service.checkChanges(updated,context);const removed=plan.rows.filter(r=>r.action==='delete');assert.equal(removed.length,1);assert.equal(removed[0].game.date,date);
  }
});

test('diagnóstico diferencia integridad sin confirmar, PDF parcial y errores de extracción',async()=>{
  const h=harness();await h.seed(game());await h.seed(game({home:'Retirado'}));await connect(h);const updated=[game()];
  for(const options of [{complete:false},{complete:true,documentPartial:true},{complete:true,extractionReliable:false,extractionIssues:['Página sin texto'] }]){
    const context=automaticScope(detectRound(updated,[{from:'2026-10-12',to:'2026-10-18'}]),{...scope,...options}),plan=await h.service.checkChanges(updated,context);
    assert(!plan.rows.some(r=>r.action==='delete'));const message=plan.diagnostics.messages.join(' ');
    if(options.documentPartial)assert.match(message,/declarado parcial/);
    else if(options.extractionReliable===false)assert.match(message,/Página sin texto/);
    else {assert.match(message,/no has confirmado/);assert(!message.includes('PDF parcial'));}
  }
});

test('evento antiguo sin árbitro requiere vinculación manual y otra comprobación antes de retirarlo',async()=>{
  const h=harness(),g=game({home:'Monachil',away:'Albolote'}),old=await h.seed(g);await connect(h);
  h.store.set(old.id,{...old,description:'Categoría: Júnior\nCompetición: Oro',extendedProperties:{private:{voleyId:old.id,voleyVersion:'2'}}});
  const context=automaticScope(detectRound([game()],[{from:'2026-10-12',to:'2026-10-18'}]),{...scope,complete:true});
  let plan=await h.service.checkChanges([],context);assert(!plan.rows.some(r=>r.action==='delete'));assert.match(plan.diagnostics.blocked[0].reason,/No consta el árbitro/);
  const pending=plan.rows.find(r=>r.kind==='legacy-link');assert(pending);assert.equal(pending.action,null);
  await h.service.resolveChange(plan,pending.key,'link-unmatched');assert.equal(pending.action,'metadata');
  const result=await h.service.applyChanges(plan,[pending.key]);assert.equal(result[0].status,'success');assert.equal(h.store.get(old.id).status,'confirmed');
  const patch=JSON.parse(h.calls.find(call=>call.options.method==='PATCH').options.body);assert.deepEqual(Object.keys(patch),['extendedProperties']);
  plan=await h.service.checkChanges([],context);assert.equal(plan.rows.filter(r=>r.action==='delete').length,1);assert.equal(h.store.get(old.id).status,'confirmed');
});

test('no se vinculan ni retiran eventos de otros árbitros, de otro origen ni personales',async()=>{
  const h=harness();const other=await h.seed(game({referee:'Alba Jiménez'}));const foreign=await h.seed(game({home:'Otro origen'}));
  h.store.set(foreign.id,{...foreign,extendedProperties:{private:{...privateData(foreign),voleyOrigin:'otro-origen'}}});h.store.set('personal',{id:'personal',summary:'Monachil vs Albolote',start:{dateTime:'2026-10-17T08:00:00Z'}});
  await connect(h);const context=automaticScope(detectRound([game()],[{from:'2026-10-12',to:'2026-10-18'}]),{...scope,complete:true});
  const plan=await h.service.checkChanges([],context);assert(!plan.rows.some(r=>r.action==='delete'||r.kind==='legacy-link'));
  assert(plan.diagnostics.blocked.some(item=>item.eventId===foreign.id));assert.equal(h.store.get(other.id).status,'confirmed');
});

test('PDF real idéntico dos veces: crear y después sin cambios, sin escrituras innecesarias',async()=>{
  const file=fs.readdirSync('fixtures').find(f=>f.endsWith('.pdf'));
  const pdf=await getDocument({data:new Uint8Array(fs.readFileSync('fixtures/'+file))}).promise;
  try{
    const read=async()=>{const games=[];for(let n=1;n<=pdf.numPages;n++){const p=await pdf.getPage(n);games.push(...extractPage((await p.getTextContent()).items,p.getViewport({scale:1}).width,n));}return games.filter(g=>functionsFor(g,scope.referee).length).map(g=>({...captureOriginal(g),referee:scope.referee,role:functionsFor(g,scope.referee).join(' / ')}));};
    const h=harness();await connect(h);let plan=await h.service.checkChanges(await read(),scope);
    assert(plan.rows.every(r=>r.status==='new'));assert(!h.calls.some(c=>c.options.method));
    const result=await h.service.applyChanges(plan,select(plan));assert(result.every(r=>r.status==='success'));
    plan=await h.service.checkChanges(await read(),scope);assert(plan.rows.every(r=>r.status==='unchanged'&&!r.action));
    assert.equal(h.calls.filter(c=>c.options.method==='POST').length,6);
  }finally{await pdf.destroy();}
});

test('cambios de hora, pabellón y función actualizan el mismo ID con ETag y conservan ajustes',async()=>{
  for(const edits of [{time:'18:00'},{venue:'Otro pabellón'},{role:'Anotador'}]){
    const h=harness(),g=game();const old=await h.seed(g,{reminders:{useDefault:false,overrides:[{method:'email',minutes:30}]},colorId:'5',attendees:[{email:'existing@example.test'}],visibility:'private'});
    await connect(h);const plan=await h.service.checkChanges([game(edits)],scope);
    assert.equal(plan.rows[0].status,'modified');const result=await h.service.applyChanges(plan,select(plan));assert.equal(result[0].status,'success');
    const saved=h.store.get(old.id);assert.equal(saved.id,old.id);assert.deepEqual(saved.reminders,old.reminders);assert.deepEqual(saved.attendees,old.attendees);assert.equal(saved.colorId,'5');assert.equal(saved.visibility,'private');
    const patch=h.calls.find(c=>c.options.method==='PATCH');assert.equal(patch.options.headers['If-Match'],old.etag);assert(!('reminders' in JSON.parse(patch.options.body)));
  }
});

test('cambio de fecha, equipos o categoría exige correspondencia manual y persiste alias',async()=>{
  for(const edits of [{date:'2026-10-19'},{home:'Local corregido'},{category:'Sénior'}]){
    const h=harness(),old=await h.seed(game());await connect(h);
    let plan=await h.service.checkChanges([game(edits)],scope);assert.equal(plan.rows[0].status,'doubtful');assert.equal(plan.rows[0].action,null);
    await assert.rejects(h.service.applyChanges(plan,[plan.rows[0].key]),/Resuelve/);
    await h.service.resolveChange(plan,plan.rows[0].key,old.id);assert.equal(plan.rows[0].status,'modified');
    assert.equal((await h.service.applyChanges(plan,select(plan)))[0].status,'success');
    plan=await h.service.checkChanges([game(edits)],scope);assert.equal(plan.rows[0].status,'unchanged');assert.equal(h.store.size,1);
    const imported=await h.service.importGames([game(edits)],scope.calendar,120,0);assert.equal(imported[0].status,'existing');assert.equal(h.store.size,1);
  }
});

test('retirada solo se ofrece para jornada completa, extracción fiable, mismo árbitro y origen',async()=>{
  const h=harness();const removed=await h.seed(game()),other=await h.seed(game({home:'Otro equipo',referee:'Alba Jiménez'}));await connect(h);
  const current=game({home:'Equipo nuevo',away:'Otro rival'});
  for(const partial of [{complete:false},{complete:true,extractionReliable:false}]){
    const plan=await h.service.checkChanges([current],{...scope,...partial});assert(!plan.rows.some(r=>r.action==='delete'));
  }
  const full=await h.service.checkChanges([current],{...scope,complete:true});const deletion=full.rows.find(r=>r.action==='delete');assert.equal(deletion.event.id,removed.id);assert(!full.rows.some(r=>r.event?.id===other.id));
  await assert.rejects(h.service.applyChanges(full,[deletion.key]),/Confirma explícitamente/);
  assert.equal(h.store.get(removed.id).status,'confirmed');
  assert.equal((await h.service.applyChanges(full,[deletion.key],{confirmDeletions:true}))[0].status,'success');
  assert.equal(h.store.get(removed.id).status,'cancelled');assert.equal(h.store.get(other.id).status,'confirmed');
});

test('dos partidos con los mismos equipos y candidatos múltiples nunca se vinculan automáticamente',async()=>{
  const h=harness();await h.seed(game());await h.seed(game({date:'2026-10-18'}));await connect(h);
  const plan=await h.service.checkChanges([game({date:'2026-10-19'})],scope);assert.equal(plan.rows[0].status,'doubtful');assert.equal(plan.rows[0].candidates.length,2);
  const duplicate=await h.service.checkChanges([game(),game({time:'18:00'})],scope);assert(duplicate.rows.every(r=>r.status==='doubtful'));
});

test('modificación manual en Google se señala y cambios después de la vista previa no se sobrescriben',async()=>{
  const h=harness(),old=await h.seed(game());await connect(h);
  h.store.set(old.id,{...old,location:'Cambiado en Google',etag:'"manual"'});
  let plan=await h.service.checkChanges([game()],scope);assert.equal(plan.rows[0].status,'modified');assert(plan.rows[0].manualConflict);
  h.store.set(old.id,{...h.store.get(old.id),summary:'Cambio concurrente',etag:'"concurrent"'});
  const result=await h.service.applyChanges(plan,select(plan));assert.equal(result[0].status,'error');assert.match(result[0].detail,/412/);assert(!h.calls.some(c=>c.options.method==='PATCH'));
});

test('evento eliminado previamente requiere confirmación manual para recrear, nunca se restaura solo',async()=>{
  const h=harness(),old=await h.seed(game());h.store.set(old.id,{id:old.id,status:'cancelled',etag:'"deleted"'});await connect(h);
  let plan=await h.service.checkChanges([game()],scope);assert.equal(plan.rows[0].status,'doubtful');assert.equal(plan.rows[0].action,null);
  await h.service.resolveChange(plan,plan.rows[0].key,'new');assert.notEqual(plan.rows[0].payload.id,old.id);
  assert.equal((await h.service.applyChanges(plan,select(plan)))[0].status,'success');
  plan=await h.service.checkChanges([game()],scope);assert.equal(plan.rows[0].status,'unchanged');
});

test('evento ajeno no se puede actualizar ni eliminar, y metadatos antiguos requieren registrar jornada',async()=>{
  const h=harness(),legacy=await h.seed(game());
  h.store.set(legacy.id,{...legacy,extendedProperties:{private:{voleyId:legacy.id,voleyVersion:'2'}}});
  const personal={id:'personal',summary:'🏐 Primer árbitro | Otro vs Rival',description:'Árbitro: Germán Ruiz',start:{dateTime:'2026-10-17T08:00:00Z'},etag:'"private"'};h.store.set(personal.id,personal);
  await connect(h);let plan=await h.service.checkChanges([game()],{...scope,complete:true});assert.equal(plan.rows[0].action,'metadata');assert(!plan.rows.some(r=>r.action==='delete'));
  assert.equal((await h.service.applyChanges(plan,select(plan)))[0].status,'success');
  plan=await h.service.checkChanges([game({home:'Otro',away:'Rival'})],scope);const row=plan.rows.find(r=>r.status==='doubtful');assert(row);
  await assert.rejects(h.service.resolveChange(plan,row.key,'personal'),/gestionados/);assert.equal(h.store.get(personal.id),personal);
});

test('fallo de red al actualizar: solo se reintentan fallidos y se recupera respuesta perdida sin escribir dos veces',async()=>{
  const h=harness(),old=await h.seed(game());await connect(h);
  const plan=await h.service.checkChanges([game({venue:'Nuevo'}),game({home:'Equipo nuevo',away:'Rival nuevo'})],scope);
  let fail=true;h.setFault(async(_url,options)=>{if(options.method==='PATCH'&&fail)throw TypeError('offline');});
  const first=await h.service.applyChanges(plan,select(plan));assert.deepEqual(first.map(r=>r.status),['error','success']);
  fail=false;const failed=plan.rows.filter(r=>r.result?.status==='error').map(r=>r.key);
  assert.equal((await h.service.applyChanges(plan,failed,{retryOnly:true}))[0].status,'success');assert.equal(h.store.size,2);
  await assert.rejects(h.service.applyChanges(plan,select(plan),{retryOnly:true}),/fallidas/);
  assert.equal(h.store.get(old.id).location,'Nuevo');
});

test('412 devuelto por Google respeta el ETag; DELETE 204 no intenta leer JSON',async()=>{
  const h=harness();await h.seed(game());await connect(h);
  let plan=await h.service.checkChanges([game({venue:'Otro'})],scope);
  h.setFault(async(_url,options)=>options.method==='PATCH'?response({},412):undefined);
  const result=await h.service.applyChanges(plan,select(plan));assert.equal(result[0].status,'error');assert.match(result[0].detail,/412/);
  h.setFault(null);plan=await h.service.checkChanges([],{...scope,complete:true});assert.equal(plan.rows[0].action,'delete');
  assert.equal((await h.service.applyChanges(plan,select(plan),{confirmDeletions:true}))[0].status,'success');
});

test('ambos equipos corregidos se pueden vincular manualmente y retirar la posible eliminación',async()=>{
  const h=harness(),old=await h.seed(game());await connect(h);
  const plan=await h.service.checkChanges([game({home:'Nombre A corregido',away:'Nombre B corregido',category:'Corregida'})],{...scope,complete:true});
  const row=plan.rows.find(r=>r.status==='new');assert(row.candidates.some(e=>e.id===old.id));assert(plan.rows.some(r=>r.action==='delete'));
  await h.service.resolveChange(plan,row.key,old.id);assert.equal(row.status,'modified');assert(!plan.rows.some(r=>r.action==='delete'));
  assert.equal((await h.service.applyChanges(plan,[row.key]))[0].status,'success');assert.equal(h.store.size,1);
});

test('PATCH confirmado cuya respuesta se pierde se reconoce al reintentar sin repetir la escritura',async()=>{
  const h=harness(),old=await h.seed(game());await connect(h);
  const plan=await h.service.checkChanges([game({venue:'Corregido'})],scope);let writes=0;
  h.setFault(async(_url,options)=>{
    if(options.method==='PATCH'&&writes===0){const patch=JSON.parse(options.body);h.store.set(old.id,{...old,...patch,etag:'"lost-response"'});writes++;throw TypeError('connection lost');}
  });
  assert.equal((await h.service.applyChanges(plan,select(plan)))[0].status,'error');
  const patches=h.calls.filter(c=>c.options.method==='PATCH').length;
  assert.equal((await h.service.applyChanges(plan,select(plan),{retryOnly:true}))[0].status,'success');
  assert.equal(h.calls.filter(c=>c.options.method==='PATCH').length,patches);assert.equal(writes,1);
});

test('vinculación manual sin diferencias visibles registra el alias una sola vez',async()=>{
  const h=harness(),old=await h.seed(game());await connect(h);
  const revised=game({date:'2026-10-19'});revised.date='2026-10-17';
  let plan=await h.service.checkChanges([revised],scope);assert.equal(plan.rows[0].status,'doubtful');
  await h.service.resolveChange(plan,plan.rows[0].key,old.id);assert.equal(plan.rows[0].status,'unchanged');assert.equal(plan.rows[0].action,'metadata');
  assert.equal((await h.service.applyChanges(plan,select(plan)))[0].status,'success');
  plan=await h.service.checkChanges([revised],scope);assert.equal(plan.rows[0].status,'unchanged');assert.equal(plan.rows[0].action,null);
});

test('doble clic no duplica la sincronización y conflicto 409 ajeno nunca se sobrescribe',async()=>{
  const h=harness();await connect(h);
  let plan=await h.service.checkChanges([game()],scope);
  const active=h.service.applyChanges(plan,select(plan));
  await assert.rejects(h.service.applyChanges(plan,select(plan)),/en curso/);
  await active;assert.equal(h.calls.filter(c=>c.options.method==='POST').length,1);
  plan=await h.service.checkChanges([game({home:'Nuevo',away:'Rival distinto'})],scope);
  const row=plan.rows.find(r=>r.action==='create'),personal={id:row.payload.id,summary:'Evento personal concurrente',etag:'"mine"'};
  h.store.set(personal.id,personal);
  const result=await h.service.applyChanges(plan,[row.key]);assert.equal(result[0].status,'error');assert.equal(h.store.get(personal.id),personal);
});

const header=[{from:'2026-10-12',to:'2026-10-18'}];
const auto=(games,options={},headers=header)=>automaticScope(detectRound(games,headers),{...scope,...options});
const documented=g=>({...g,documentRound:auto([g])});

test('jornada automática: sábado a domingo es modificado fiable y conserva el ID',async()=>{
  const h=harness(),old=await h.seed(documented(game()));await connect(h);
  const moved=documented(game({date:'2026-10-18'})),plan=await h.service.checkChanges([moved],auto([moved]));
  assert.equal(plan.rows[0].status,'modified');assert.equal(plan.rows[0].event.id,old.id);
  assert.equal((await h.service.applyChanges(plan,select(plan)))[0].status,'success');assert.equal(h.store.size,1);
  const again=await h.service.checkChanges([moved],auto([moved]));assert.equal(again.rows[0].status,'unchanged');
  const imported=await h.service.importGames([moved],scope.calendar,120,0);assert.equal(imported[0].status,'existing');
});

test('importación normal reconoce un cambio de fecha de la jornada automática sin crear duplicados',async()=>{
  const h=harness();await h.seed(documented(game()));await connect(h);
  const result=await h.service.importGames([documented(game({date:'2026-10-18'}))],scope.calendar,120,0);
  assert.equal(result[0].status,'pending');assert.equal(h.store.size,1);
});

test('automática: cambio de pabellón, PDF parcial, jornada próxima y otros árbitros',async()=>{
  const h=harness(),old=await h.seed(documented(game()));await h.seed(documented(game({home:'Retirado',away:'Rival retirado'})));
  const nextHeader=[{from:'2026-10-19',to:'2026-10-25'}],next=game({date:'2026-10-24'});next.documentRound=auto([next],{},nextHeader);const near=await h.seed(next);
  const other=await h.seed(documented(game({home:'Otro árbitro',referee:'Alba Jiménez'})));await connect(h);
  const changed=documented(game({venue:'Pabellón corregido'}));
  let plan=await h.service.checkChanges([changed],auto([changed],{complete:false}));assert.equal(plan.rows[0].status,'modified');assert.equal(plan.rows[0].event.id,old.id);assert(!plan.rows.some(r=>r.action==='delete'));
  plan=await h.service.checkChanges([changed],auto([changed],{complete:true}));assert.equal(plan.rows.filter(r=>r.action==='delete').length,1);assert(!plan.rows.some(r=>[near.id,other.id].includes(r.event?.id)));
  const nextPlan=await h.service.checkChanges([next],auto([next],{},nextHeader));assert.equal(nextPlan.rows[0].event.id,near.id);assert.equal(nextPlan.rows[0].status,'unchanged');
});

test('sin cabecera conserva el intervalo conocido aunque desaparezca el primer partido',async()=>{
  const h=harness(),full=[game({home:'Primero',date:'2026-10-16'}),game(),game({home:'Último',date:'2026-10-18'})];await connect(h);
  const firstScope=auto(full,{},[]),first=await h.service.checkChanges(full,firstScope);await h.service.applyChanges(first,select(first));
  const updated=[game(),game({home:'Último',date:'2026-10-18'})],detected=auto(updated,{complete:true},[]);
  assert.equal(detected.from,'2026-10-17');
  const next=await h.service.checkChanges(updated,detected);assert.equal(next.scope.from,'2026-10-16');assert.equal(next.scope.round,firstScope.round);assert(next.scope.reusedInterval);
  assert.equal(next.rows.filter(r=>r.action==='delete').length,1);
});

test('partido fuera de la cabecera se compara tras confirmar sin permitir eliminaciones',async()=>{
  const h=harness(),old=await h.seed(documented(game()));await h.seed(documented(game({home:'Ausente'})));await connect(h);
  const moved=game({date:'2026-10-19'}),detected=detectRound([moved],header);assert(detected.needsConfirmation);
  const context=automaticScope(confirmRound(detected,header[0].from,header[0].to),{...scope,complete:true});
  const plan=await h.service.checkChanges([moved],context);assert.equal(plan.rows[0].status,'modified');assert.equal(plan.rows[0].event.id,old.id);assert(!plan.rows.some(r=>r.action==='delete'));
});

test('eventos anteriores con evidencia suficiente se migran sin códigos manuales ni eventos personales',async()=>{
  const h=harness(),old=await h.seed(game());await connect(h);
  const changed=game({date:'2026-10-18'}),context=auto([changed]);
  const personal={id:'personal-only',summary:'🏐 Primer árbitro | Local vs Visitante',description:'Categoría: Júnior\nCompetición: Oro\nÁrbitro: Germán Ruiz',start:{dateTime:'2026-10-17T08:00:00Z'}};h.store.set(personal.id,personal);
  const plan=await h.service.checkChanges([changed],context);assert.equal(plan.rows[0].status,'modified');assert.equal(plan.rows[0].event.id,old.id);assert(!plan.rows.some(r=>r.candidates?.some(e=>e.id===personal.id)));
  await h.service.applyChanges(plan,select(plan));assert.equal(privateData(h.store.get(old.id)).voleyVersion,'4');assert.equal(privateData(h.store.get(old.id)).voleyRoundFrom,header[0].from);assert.equal(h.store.get(personal.id),personal);
});

test('ambigüedad entre partidos idénticos y jornadas solapadas requiere revisión',async()=>{
  const h=harness();await h.seed(documented(game()));await h.seed(documented(game({date:'2026-10-18'})));await connect(h);
  const shifted=game({date:'2026-10-16'}),plan=await h.service.checkChanges([shifted],auto([shifted]));assert.equal(plan.rows[0].status,'doubtful');assert.equal(plan.rows[0].action,null);
});

test('PDF actualizado real: detecta automáticamente el partido retirado y mantiene la jornada',async()=>{
  const h=harness();await connect(h);
  const read=async file=>{const pdf=await getDocument({data:new Uint8Array(fs.readFileSync('fixtures/'+file))}).promise;try{const all=[],headers=[];for(let n=1;n<=pdf.numPages;n++){const p=await pdf.getPage(n),t=await p.getTextContent();headers.push(...findHeaderIntervals(t.items.map(i=>i.str).join(' ')));all.push(...extractPage(t.items,p.getViewport({scale:1}).width,n));}return {all,games:all.filter(g=>functionsFor(g,scope.referee).length).map(g=>({...captureOriginal(g),referee:scope.referee,role:functionsFor(g,scope.referee).join(' / ')})),context:automaticScope(detectRound(all,headers),{...scope,complete:true})};}finally{await pdf.destroy();}};
  const files=fs.readdirSync('fixtures'),before=await read(files.find(f=>f.startsWith('DESIGNACION'))),after=await read('designaciones_actualizadas_sin_monachil_albolote.pdf');
  const initial=await h.service.checkChanges(before.games,before.context);await h.service.applyChanges(initial,select(initial));
  const updated=await h.service.checkChanges(after.games,after.context);assert.equal(updated.scope.round,initial.scope.round);
  const removed=updated.rows.filter(r=>r.status==='possible-delete');assert.equal(removed.length,1);assert.match(removed[0].event.summary,/MONACHIL.*ALBOLOTE/i);
  assert.equal(h.store.get(removed[0].event.id).status,'confirmed');
});

test('sin cabecera y con un único partido restante reutiliza la jornada previa tras confirmar',async()=>{
  const h=harness(),full=[game(),game({home:'Segundo',date:'2026-10-18'})];await connect(h);
  const original=auto(full,{},[]),initial=await h.service.checkChanges(full,original);await h.service.applyChanges(initial,select(initial));
  const remaining=[game({home:'Segundo',date:'2026-10-18'})],detected=detectRound(remaining,[]);assert(detected.needsConfirmation);
  const confirmed=automaticScope(confirmRound(detected,detected.from,detected.to),{...scope,complete:true});
  const plan=await h.service.checkChanges(remaining,confirmed);assert.equal(plan.scope.round,original.round);assert.equal(plan.rows.filter(r=>r.action==='delete').length,1);
});

test('importaciones previas sin jornada: retirada solo con cabecera, cohorte fiable y competición conocida',async()=>{
  const h=harness();await connect(h);const full=[game(),game({home:'Retirado',date:'2026-10-18'})];
  await h.service.importGames(full,scope.calendar,120,0);assert([...h.store.values()].every(e=>privateData(e).voleyRound===''));
  const personal={id:'mine',summary:'Partido personal',start:{dateTime:'2026-10-18T08:00:00Z'}};h.store.set(personal.id,personal);
  const current=[game()],context=auto(current,{complete:true});
  const plan=await h.service.checkChanges(current,context);assert(plan.scope.legacyUnscoped);assert.equal(plan.rows.filter(r=>r.action==='delete').length,1);assert(!plan.rows.some(r=>r.event?.id==='mine'));
});
