import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createDirectImport,importSummary} from '../src/direct-import.js';
import {createGoogleService,scopes,googleEvent} from '../src/google.js';
import {automaticRoundKey} from '../src/round.js';
const scope={calendar:'target',referee:'German Ruiz',round:'week',from:'2026-10-19',to:'2026-10-25',extractionReliable:true,automatic:true,competitionScope:'VOLEIBOL',intervalSource:'header'};
scope.round=automaticRoundKey(scope);
const game=(id='one')=>({id,date:'2026-10-24',time:'18:00',home:'Local '+id,away:'Visitante '+id,category:'Junior',competition:'Oro',venue:'Pabellón',role:'Anotador',scorer:'German Ruiz',referee:'German Ruiz',issues:[],documentRound:scope});
const snapshot=(games=[game()])=>({games,scope,duration:120,reminder:0});
const row=(g,status='new',action='create')=>({key:g.id,game:g,payload:{id:g.id},status,action,candidates:[]});

test('importación directa vuelve a consultar y solo envía nuevos: nunca aplica modificaciones ni retiradas',async()=>{
  const games=['new','old','changed','conflict'].map(game),calls=[];
  const plan={scope,rows:[row(games[0]),row(games[1],'unchanged','metadata'),row(games[2],'modified','update'),row(games[3],'doubtful',null),{action:'delete',status:'possible-delete'}]};
  const service={checkChanges:async()=>{calls.push('check');return plan;},importGames:async(g)=>{calls.push(g.map(x=>x.id));return g.map(game=>({game,status:'created'}));},applyChanges:()=>assert.fail('No debe aplicar una revisión')};
  const result=await createDirectImport({service,getSnapshot:()=>snapshot(games)})();
  assert.deepEqual(calls,['check',['new']]);
  assert.equal(result.results.filter(r=>r.status==='created').length,1);
  assert.equal(result.results.filter(r=>r.status==='existing').length,1);
  assert.equal(result.results.filter(r=>r.status==='review').length,2);
  assert.deepEqual(importSummary(plan),{new:1,existing:1,modified:1,ambiguous:1});
});

test('errores de extracción, campos incompletos, duplicados y fallos de Google bloquean escrituras',async()=>{
  let creates=0;
  const service={checkChanges:async()=>{throw Error('Google no disponible');},importGames:async()=>creates++};
  for(const value of [snapshot([{...game(),ambiguous:true}]),snapshot([{...game(),venue:''}]),snapshot([game(),game()]),{...snapshot(),scope:{...scope,extractionReliable:false}},snapshot()]){
    await assert.rejects(()=>createDirectImport({service,getSnapshot:()=>value})());
  }
  assert.equal(creates,0);
});

test('descarta cambios durante la lectura y bloquea doble clic; permite reintentar',async()=>{
  let release,creates=0,current=true;
  const g=game(),service={checkChanges:()=>new Promise(resolve=>release=()=>resolve({scope,rows:[row(g)]})),importGames:async()=>{creates++;return [];}};
  const run=createDirectImport({service,getSnapshot:()=>snapshot(),isCurrent:()=>current});
  const first=run();await assert.rejects(run,/en curso/);current=false;release();await assert.rejects(()=>first,/cambiaron/);assert.equal(creates,0);
  current=true;const second=run();release();await second;assert.equal(creates,1);
});

const response=(body,status=200)=>({ok:status<300,status,json:async()=>body,headers:{get:()=>null}});
async function calendarHarness(){
  const events=[],writes=[];let afterCheck=null;
  const service=createGoogleService({sleep:async()=>{},oauth:()=>({initTokenClient:config=>({requestAccessToken:()=>config.callback({access_token:'test',expires_in:3600,scope:scopes.join(' ')})})}),fetcher:async(url,init)=>{
    const u=new URL(url);
    if(url.includes('calendarList'))return response({items:[{id:'target',accessRole:'owner'}]});
    if(init.method){writes.push(init.method);assert.equal(init.method,'POST');const body=JSON.parse(init.body);if(events.some(e=>e.id===body.id))return response({},409);events.push(body);return response(body);}
    if(!u.pathname.endsWith('/events')){const found=events.find(e=>url.endsWith('/'+e.id));return response(found||{},found?200:404);}
    const property=u.searchParams.get('privateExtendedProperty');
    return response({items:property?events.filter(e=>{const [key,value]=property.split('=');return e.extendedProperties?.private?.[key]===value;}):events});
  }});
  await service.connect('test');
  const wrapped={checkChanges:async(...args)=>{const result=await service.checkChanges(...args);await afterCheck?.();return result;},importGames:service.importGames};
  return {service:wrapped,events,writes,setAfterCheck:fn=>afterCheck=fn};
}

test('Google simulado: repetición idempotente, omisiones y ninguna modificación o eliminación',async()=>{
  const h=await calendarHarness(),g=game();
  const run=createDirectImport({service:h.service,getSnapshot:()=>snapshot([g])});
  assert.equal((await run()).results[0].status,'created');
  assert.equal((await run()).results[0].status,'existing');
  h.events[0].location='Cambio en Google';
  assert.equal((await run()).results[0].status,'review');
  assert.deepEqual(h.writes,['POST']);assert.equal(h.events[0].location,'Cambio en Google');
});

test('Google simulado: un evento aparece tras comparar y se omite al comprobar antes de crear',async()=>{
  const h=await calendarHarness(),g=game();h.setAfterCheck(async()=>h.events.push(await googleEvent(g)));
  const result=await createDirectImport({service:h.service,getSnapshot:()=>snapshot([g])})();
  assert.equal(result.results[0].status,'existing');assert.deepEqual(h.writes,[]);
});

test('carga y consulta permanecen en la pantalla única de sincronización',()=>{
  const app=fs.readFileSync('app.js','utf8'),html=fs.readFileSync('index.html','utf8');
  assert(!app.includes("router.navigate('/revision')"));
  assert.match(html,/id="syncRound"[^>]*>Sincronizar jornada/);
  assert(!html.includes('id="importDirect"'));assert(!html.includes('id="reviewChanges"'));
  assert.match(html,/id="existing"/);assert.match(html,/id="result"/);
});
