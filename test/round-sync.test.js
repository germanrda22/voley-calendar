import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRoundSync} from '../src/round-sync.js';
import {googleEvent} from '../src/google.js';
import {automaticRoundKey} from '../src/round.js';
import {normalize} from '../src/model.js';
const scope={from:'2026-10-19',to:'2026-10-25',referee:'German Ruiz',calendar:'target',automatic:true,competitionScope:'VOLEIBOL',complete:true,extractionReliable:true,deletionsAllowed:true};scope.round=automaticRoundKey(scope);
const game=(id='one',changes={})=>({id,date:'2026-10-24',time:'18:00',home:'Local '+id,away:'Visitante '+id,category:'Junior',competition:'Oro',venue:'Pabellón',role:'Anotador',scorer:'German Ruiz',referee:'German Ruiz',issues:[],documentRound:scope,...changes});
function harness(){
  const events=new Map(),calls=[];let revision=0,fail=null,readHook=null;
  const error=status=>Object.assign(Error('Google '+status),{status});
  const request=async(path,init={})=>{
    const method=init.method||'GET',id=path.split('/').at(-1);calls.push({method,id});
    if(fail){const result=await fail(path,init);if(result)throw result;}
    if(method==='POST'){
      const payload=JSON.parse(init.body);if(events.has(payload.id))throw error(409);
      const event={...payload,etag:'e'+ ++revision,status:'confirmed'};events.set(event.id,event);return structuredClone(event);
    }
    const found=events.get(id);if(!found)throw error(404);
    if(method==='DELETE'){
      if(init.headers['If-Match']!==found.etag)throw error(412);
      found.status='cancelled';found.etag='e'+ ++revision;return {};
    }
    await readHook?.(id);
    return structuredClone(found);
  };
  const list=async(_path,params)=>{
    if(fail){const result=await fail(_path,{});if(result)throw result;}
    let result=[...events.values()].filter(e=>e.status!=='cancelled');
    if(params.privateExtendedProperty){const [key,value]=params.privateExtendedProperty.split('=');result=result.filter(e=>e.extendedProperties?.private?.[key]===value);}
    else result=result.filter(e=>e.start?.dateTime>=params.timeMin&&e.start?.dateTime<params.timeMax);
    return structuredClone(result);
  };
  const sync=createRoundSync({request,list,buildEvent:googleEvent});
  return {sync,events,calls,setFail:fn=>fail=fn,setReadHook:fn=>readHook=fn,error,
    async seed(g,changes={}){const event={...await googleEvent(g),etag:'e'+ ++revision,...changes};events.set(event.id,event);return event;},active:()=>[...events.values()].filter(e=>e.status!=='cancelled')};
}

test('jornada repetida: primera creación, segunda sin escrituras y verificación antes de borrar',async()=>{
  const h=harness(),games=[game(),game('two')];
  const first=await h.sync.synchronize(games,scope);assert.equal(first.created,2);assert.equal(first.deleted,0);
  h.calls.length=0;const repeated=await h.sync.synchronize(games,scope);
  assert.equal(repeated.created,0);assert.equal(repeated.deleted,0);assert.equal(repeated.unchanged,2);
  assert(h.calls.every(c=>c.method==='GET'));assert.equal(h.active().length,2);
});

test('Google puede omitir la lista vacía de recordatorios sin provocar sustituciones',async()=>{
  const h=harness(),existing=await h.seed(game());existing.reminders={useDefault:false};
  const result=await h.sync.synchronize([game()],scope);
  assert.equal(result.unchanged,1);assert.equal(result.created,0);assert.equal(result.deleted,0);
  assert(h.calls.every(c=>c.method==='GET'));
});

for(const [field,value] of [['venue','Otro pabellón'],['time','20:00'],['role','Primer árbitro']])test(`cambio de ${field}: crea y verifica antes de eliminar el anterior`,async()=>{
  const h=harness(),old=await h.seed(game());
  const updated=game('one',{[field]:value}),preview=await h.sync.inspect([updated],scope);
  assert.equal(preview.replacing,1);assert.equal(preview.new,1);
  const result=await h.sync.synchronize([updated],scope);
  assert.equal(result.created,1);assert.equal(result.deleted,1);assert.deepEqual(result.errors,[]);
  assert.equal(h.events.get(old.id).status,'cancelled');assert.equal(h.active().length,1);
  const post=h.calls.findIndex(c=>c.method==='POST'),del=h.calls.findIndex(c=>c.method==='DELETE');
  assert(post<del);const newId=h.active()[0].id;
  assert(h.calls.slice(post+1,del).some(c=>c.method==='GET'&&c.id===newId));
  assert.equal((await h.sync.synchronize([updated],scope)).created,0);
});

test('retirada y jornada sin partidos del árbitro conservan otras jornadas, árbitros y eventos personales',async()=>{
  const h=harness(),retired=await h.seed(game('retired')),remaining=await h.seed(game());
  const otherScope={...scope,from:'2026-10-26',to:'2026-11-01'};otherScope.round=automaticRoundKey(otherScope);
  const otherRound=await h.seed(game('other',{date:'2026-10-30',documentRound:otherScope}));
  const otherRef=await h.seed(game('ref',{referee:'Otra persona'}));
  const personal={id:'personal',etag:'p',summary:'🏐 Reunión personal',start:{dateTime:'2026-10-24T10:00:00Z'}};h.events.set(personal.id,personal);
  const result=await h.sync.synchronize([game()],scope);
  assert.equal(result.deleted,1);assert.equal(result.created,0);assert.equal(result.preserved,1);
  assert.equal(h.events.get(retired.id).status,'cancelled');
  for(const e of [remaining,otherRound,otherRef,personal])assert.notEqual(h.events.get(e.id).status,'cancelled');
  const empty=await h.sync.synchronize([],scope);assert.equal(empty.deleted,1);assert.notEqual(h.events.get(otherRound.id).status,'cancelled');
});

test('PDF incompleto o ambiguo se bloquea antes de consultar o escribir',async()=>{
  const h=harness();
  for(const bad of [{complete:false},{documentPartial:true},{extractionReliable:false},{deletionsAllowed:false},{needsConfirmation:true}])await assert.rejects(()=>h.sync.synchronize([game()],{...scope,...bad}),/bloqueada/);
  await assert.rejects(()=>h.sync.synchronize([game('one',{issues:['Columnas desconocidas']})],scope),/ambiguos/);
  await assert.rejects(()=>h.sync.synchronize([game('one',{venue:''})],scope),/incompleto/);
  assert.equal(h.calls.length,0);
});

test('Google falla al crear: conserva todos los anteriores y reutiliza creaciones parciales al reintentar',async()=>{
  const h=harness(),old=await h.seed(game()),retired=await h.seed(game('retired'));let posts=0;
  h.setFail(async(_path,init)=>init.method==='POST'&&++posts===2?h.error(503):null);
  const desired=[game('one',{venue:'Nuevo'}),game('new')];
  const failed=await h.sync.synchronize(desired,scope);
  assert(failed.errors.length);assert.equal(failed.deleted,0);assert(!h.calls.some(c=>c.method==='DELETE'));
  for(const e of [old,retired])assert.notEqual(h.events.get(e.id).status,'cancelled');
  h.setFail(null);const retry=await h.sync.synchronize(desired,scope);
  assert.equal(retry.created,1);assert.equal(retry.deleted,2);assert.equal(h.active().length,2);
});

test('fallo de verificación conserva los anteriores; fallo de borrado se reintenta sin duplicar',async()=>{
  const h=harness(),old=await h.seed(game());let posts=false;
  h.setFail(async(path,init)=>{if(init.method==='POST')posts=true;return posts&&!init.method&&!path.endsWith(old.id)?h.error(503):null;});
  const desired=[game('one',{venue:'Nuevo'})];
  const result=await h.sync.synchronize(desired,scope);assert(result.errors.length);assert.equal(result.deleted,0);
  assert.notEqual(h.events.get(old.id).status,'cancelled');
  h.setFail(async(_path,init)=>init.method==='DELETE'?h.error(503):null);
  const failedDelete=await h.sync.synchronize(desired,scope);assert(failedDelete.errors.length);assert.equal(failedDelete.created,0);
  h.setFail(null);const retry=await h.sync.synchronize(desired,scope);assert.equal(retry.created,0);assert.equal(retry.deleted,1);assert.equal(h.active().length,1);
});

test('ETag concurrente y fallo de consulta de Google impiden borrar',async()=>{
  const h=harness(),old=await h.seed(game());h.setReadHook(id=>{if(id===old.id)h.events.get(id).etag='changed';});
  const result=await h.sync.synchronize([game('one',{time:'20:00'})],scope);assert(result.errors.length);assert.equal(result.deleted,0);
  h.setFail(()=>h.error(403));await assert.rejects(()=>h.sync.inspect([game()],scope),/403/);
});

test('sincronizaciones simultáneas bloqueadas; volver a una versión eliminada usa otra identidad',async()=>{
  const h=harness();let release,started;const entered=new Promise(resolve=>started=resolve);h.setFail(()=>new Promise(resolve=>{release=()=>resolve(null);started();}));
  const pending=h.sync.synchronize([game()],scope);await entered;await assert.rejects(()=>h.sync.synchronize([game()],scope),/en curso/);
  h.setFail(null);release();await pending;
  const changed=[game('one',{time:'20:00'})];await h.sync.synchronize(changed,scope);
  const reverted=await h.sync.synchronize([game()],scope);assert.equal(reverted.created,1);assert.equal(h.active().length,1);
});

test('eventos antiguos sin jornada: correspondencia única permite reemplazar, retirada no identificable se conserva',async()=>{
  const h=harness(),old=await h.seed(game()),unknown=await h.seed(game('retired'));
  for(const e of [old,unknown]){const p=e.extendedProperties.private;delete p.voleyRoundFrom;delete p.voleyRoundTo;delete p.voleyCompetitionScope;delete p.voleyRound;}
  const result=await h.sync.synchronize([game('one',{time:'20:00'})],scope);
  assert.equal(result.deleted,1);assert.equal(result.preserved,1);assert.notEqual(h.events.get(unknown.id).status,'cancelled');
});

test('PDF reales original/actualizado: jornada completa y retirada, segunda sincronización sin cambios',async()=>{
  const fs=await import('node:fs');const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const {extractPage}=await import('../src/extract.js');const {eventGame}=await import('../src/prepare.js');
  const {filterGames}=await import('../src/model.js');const {detectRound,findHeaderIntervals,automaticScope}=await import('../src/round.js');
  async function load(file){
    const pdf=await getDocument({data:new Uint8Array(fs.readFileSync('fixtures/'+file))}).promise;
    const all=[],headers=[];
    try{for(let n=1;n<=pdf.numPages;n++){const p=await pdf.getPage(n),text=await p.getTextContent();headers.push(...findHeaderIntervals(text.items.map(i=>i.str).join(' ')));all.push(...extractPage(text.items,p.getViewport({scale:1}).width,n));}}
    finally{await pdf.destroy();}
    const round=automaticScope(detectRound(all,headers),{complete:true,extractionReliable:all.every(g=>!g.issues.length),calendar:'target',referee:'German Ruiz'});
    return {scope:round,games:filterGames(all,'GERMAN RUIZ').map(g=>({...eventGame(g,'German Ruiz'),documentRound:round}))};
  }
  const original=await load('DESIGNACION ARBITRAL DEL 12 AL 18 DE OCTUBRE DE 2026.pdf');
  const updated=await load('designaciones_actualizadas_sin_monachil_albolote.pdf');
  assert.equal(original.games.length,6);assert.equal(updated.games.length,5);
  const h=harness();for(const g of original.games)await h.seed(g);
  const result=await h.sync.synchronize(updated.games,updated.scope);
  assert.deepEqual(result.errors,[]);assert.equal(h.active().length,5);assert(result.deleted>=1);
  h.calls.length=0;const repeated=await h.sync.synchronize(updated.games,updated.scope);
  assert.equal(repeated.created,0);assert.equal(repeated.deleted,0);assert.equal(repeated.unchanged,5);
  assert(h.calls.every(c=>c.method==='GET'));
});

test('PDF real 19–25 con avisos ajenos: consulta, sincroniza cinco partidos y conserva eventos ajenos',async()=>{
  const fs=await import('node:fs'),{getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const {extractPage}=await import('../src/extract.js'),{findHeaderIntervals,automaticScope}=await import('../src/round.js');
  const {assessExtraction}=await import('../src/extraction-diagnostics.js'),{eventGame}=await import('../src/prepare.js'),{filterGames}=await import('../src/model.js');
  const pdf=await getDocument({data:new Uint8Array(fs.readFileSync('fixtures/DESIGNACION ARBITRAL DEL 19 AL 25 DE OCTUBRE DE 2026.pdf'))}).promise;
  const all=[],headers=[];
  try{for(let n=1;n<=pdf.numPages;n++){const page=await pdf.getPage(n),text=await page.getTextContent();all.push(...extractPage(text.items,page.getViewport({scale:1}).width,n));headers.push(...findHeaderIntervals(text.items.map(i=>i.str).join(' ')));}}
  finally{await pdf.destroy();}
  const assessment=assessExtraction(all,headers,{referee:'GERMAN RUIZ'});
  const selectedScope=automaticScope(assessment.detection,{calendar:'VOLEY',referee:'GERMAN RUIZ',extractionReliable:assessment.selectedValid,documentIntegrity:assessment.documentComplete,complete:assessment.documentComplete});
  const selected=filterGames(all,'GERMAN RUIZ').map(g=>({...eventGame(g,'GERMAN RUIZ'),documentRound:selectedScope}));
  const h=harness(),old=await h.seed(game('retired',{documentRound:selectedScope}));
  const personal={id:'personal',etag:'p',summary:'🏐 Personal',start:{dateTime:'2026-10-24T10:00:00Z'}};h.events.set(personal.id,personal);
  const preview=await h.sync.inspect(selected,selectedScope);assert.equal(preview.new,5);assert.equal(preview.replacing,1);
  const result=await h.sync.synchronize(selected,selectedScope);
  assert.equal(result.created,5);assert.equal(result.deleted,1);assert.deepEqual(result.errors,[]);
  assert.equal(h.events.get(old.id).status,'cancelled');assert.notEqual(h.events.get(personal.id).status,'cancelled');
  const repeated=await h.sync.synchronize(selected,selectedScope);assert.equal(repeated.created,0);assert.equal(repeated.deleted,0);assert.equal(repeated.unchanged,5);
  await assert.rejects(()=>h.sync.synchronize(selected,{...selectedScope,documentIntegrity:false}),/bloqueada/);
});
