import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGoogleService,googleEvent,classifyExisting,legacyMatch,writableCalendars,preferredCalendar,scopes} from '../src/google.js';
import {assignmentId,captureOriginal} from '../src/google-identity.js';

const game=(overrides={})=>captureOriginal({id:crypto.randomUUID(),date:'2026-10-17',time:'10:00',home:'Local',away:'Visitante',role:'Primer árbitro',referee:'Germán Ruiz',first:'Germán Ruiz',second:'Alba Jiménez',scorer:'Lucía Rojas',category:'Júnior',competition:'Oro',venue:'Pabellón',...overrides});
const response=(body={},status=200)=>({ok:status<300,status,json:async()=>body,headers:{get:()=>null}});
function harness(options={}) {
  let timestamp=0,oauthResponse={access_token:'memory-token',expires_in:3600,scope:scopes.join(' ')};
  const calls=[],waits=[],states=[],events=[];
  const calendars=[{id:'readonly',accessRole:'reader'},{id:'target/calendar',summary:'Destino',description:'Descripción',primary:true,accessRole:'owner'}];
  const sdk={initTokenClient:config=>({requestAccessToken:()=>config.callback(oauthResponse)}),revoke:(_token,callback)=>callback()};
  const fetcher=async(url,init)=>{
    calls.push({url,init});
    if(options.handler){const result=await options.handler(url,init,events,calls);if(result)return result;}
    if(url.includes('calendarList'))return response({items:calendars});
    if(init.method==='POST'){const body=JSON.parse(init.body);if(events.some(e=>e.id===body.id))return response({},409);events.push(body);return response({...body,status:'confirmed'});}
    const parsed=new URL(url),identity=parsed.searchParams.get('privateExtendedProperty');
    if(parsed.pathname.endsWith('/events'))return response({items:identity?events.filter(e=>identity===`voleyId=${e.extendedProperties?.private?.voleyId}`):events});
    const found=events.find(e=>url.endsWith('/'+e.id));return found?response(found):response({},404);
  };
  const service=createGoogleService({fetcher,oauth:()=>sdk,now:()=>timestamp,sleep:async ms=>waits.push(ms),onState:state=>states.push(state)});
  return {service,calls,waits,states,events,setTime:value=>timestamp=value,setOAuth:value=>oauthResponse=value};
}

test('identidad original estable al editar fecha, hora, equipos, categoría, función y pabellón',async()=>{
  const g=game(),id=await assignmentId(g);
  Object.assign(g,{date:'2026-11-01',time:'18:00',home:'Corregido',category:'Editada',venue:'Otro',role:'Anotador',duration:90});
  assert.equal(await assignmentId(g),id);
  assert.equal(await assignmentId(game()),id);
  assert.notEqual(await assignmentId(game({referee:'Alba Jiménez'})),id);
  assert.notEqual(await assignmentId(game({date:'2026-10-18'})),id);
});

test('conversión reutiliza preparación: título, Madrid, duración y descripción de árbitros',async()=>{
  const g=game({duration:75}),event=await googleEvent(g,120,60);
  assert.equal(event.summary,'🏐 Primer árbitro | Local vs Visitante');
  assert.equal(event.start.timeZone,'Europe/Madrid');assert.equal(event.start.dateTime,'2026-10-17T08:00:00.000Z');
  assert.equal(event.end.dateTime,'2026-10-17T09:15:00.000Z');assert.equal(event.location,'Pabellón');
  for(const text of ['Categoría: Júnior','Competición: Oro','Función arbitral: Primer árbitro','Segundo árbitro: Alba Jiménez','Anotador: Lucía Rojas'])assert(event.description.includes(text));
  assert.equal(event.extendedProperties.private.voleyId,await assignmentId(g));
  assert.match(event.id,/^[0-9a-v]+$/);assert.equal(event.reminders.overrides[0].minutes,60);
});

test('calendarios editables y preferencia por identificador',()=>{
  const calendars=writableCalendars([{id:'r',accessRole:'reader'},{id:'o',accessRole:'owner',primary:true},{id:'w',accessRole:'writer',description:'Club'},{id:'p',accessRole:'writerWithoutPrivateAccess'},{id:'d',accessRole:'owner',deleted:true}]);
  assert.deepEqual(calendars.map(c=>c.id),['o','w','p']);
  assert.equal(preferredCalendar(calendars,'w'),'w');assert.equal(preferredCalendar(calendars,'removed'),'o');assert.equal(preferredCalendar([],'w'),'');
});

test('clasifica existentes, cambios pendientes y coincidencias antiguas dudosas',async()=>{
  const g=game(),payload=await googleEvent(g);
  assert.equal(classifyExisting([payload],payload,g).status,'existing');
  assert.equal(classifyExisting([{...payload,location:'Otro'}],payload,g).status,'pending');
  const legacy={summary:'🏐 Local vs Visitante (Primer árbitro)',start:{dateTime:'2026-10-17T12:00:00+02:00'}};
  assert.equal(classifyExisting([legacy],payload,g).status,'review');
  assert.equal(legacyMatch({...legacy,start:{date:'2026-10-18'}},g),false);
  assert.equal(legacyMatch({...legacy,summary:'🏐 Otro vs Visitante (Primer árbitro)'},g),false);
  assert.equal(legacyMatch({...legacy,summary:'🏐 Local vs Visitante (Anotador)'},g),false);
});

test('conecta, caduca, reconecta y desconecta sin persistir el token',async()=>{
  const h=harness();
  const calendars=await h.service.connect('public-client-id');assert.equal(calendars.length,1);assert.equal(calendars[0].description,'Descripción');assert(h.service.isConnected());
  h.setTime(3600000);assert(!h.service.isConnected());
  await h.service.connect('public-client-id');assert(h.service.isConnected());h.service.disconnect();assert(!h.service.isConnected());
  assert(h.states.every(state=>!('token' in state)));
});

test('permisos denegados o parciales no dejan sesión utilizable',async()=>{
  const h=harness();h.setOAuth({error:'access_denied'});await assert.rejects(h.service.connect('id'),/denegados/);assert(!h.service.isConnected());
  h.setOAuth({access_token:'partial',expires_in:3600,scope:scopes[0]});await assert.rejects(h.service.connect('id'),/Faltan permisos/);assert(!h.service.isConnected());
});

test('importa y repetir el mismo PDF no crea eventos, cambios quedan pendientes',async()=>{
  const h=harness(),g=game();await h.service.connect('id');
  const progress=[];
  assert.equal((await h.service.importGames([g],'target/calendar',120,60,r=>progress.push(r.status)))[0].status,'created');
  assert.deepEqual(progress,['checking','creating','created']);
  assert.equal((await h.service.importGames([game()],'target/calendar',120,60))[0].status,'existing');
  g.time='16:00';assert.equal((await h.service.importGames([g],'target/calendar',120,60))[0].status,'pending');
  assert.equal(h.calls.filter(c=>c.init.method==='POST').length,1);
  assert(h.calls.some(c=>c.url.includes('target%2Fcalendar')));
});

test('consulta paginada y búsqueda de identidad fuera del intervalo actual',async()=>{
  let identityLookups=0;const g=game(),payload=await googleEvent(g);
  const h=harness({handler:async(url,init)=>{
    if(init.method)return;
    const u=new URL(url);
    if(u.pathname.endsWith('/events')){
      if(u.searchParams.has('privateExtendedProperty')){identityLookups++;return response({items:[{...payload,start:{dateTime:'2027-01-01T09:00:00Z'}}]});}
      return u.searchParams.get('pageToken')?response({items:[]}):response({items:[],nextPageToken:'second'});
    }
  }});
  await h.service.connect('id');assert.equal((await h.service.importGames([g],'target/calendar',120,0))[0].status,'pending');
  assert.equal(identityLookups,1);assert(h.calls.some(c=>c.url.includes('pageToken=second')));assert(!h.calls.some(c=>c.init.method==='POST'));
});

test('401 caduca la sesión; 403 identifica error y permite reintentar solo los fallidos',async()=>{
  let denied=true;
  const h=harness({handler:async(url,init)=>{if(init.method==='POST' && denied && JSON.parse(init.body).summary.includes('Fallido'))return response({},403);}});
  await h.service.connect('id');const good=game(),bad=game({home:'Fallido'});
  const results=await h.service.importGames([good,bad],'target/calendar',120,0);assert.deepEqual(results.map(r=>r.status),['created','error']);
  denied=false;const retry=await h.service.importGames(results.filter(r=>r.status==='error').map(r=>r.game),'target/calendar',120,0);assert.equal(retry.length,1);assert.equal(retry[0].status,'created');
  const expired=harness({handler:async url=>url.includes('/events')?response({},401):undefined});await expired.service.connect('id');
  assert.equal((await expired.service.importGames([game()],'target/calendar',120,0))[0].status,'error');assert(!expired.service.isConnected());
});

test('429, 503 y errores de red reintentan con espera; 409 confirma antes de declarar existente',async()=>{
  for(const failure of [429,503,'network']){
    let attempts=0;const h=harness({handler:async(url,init)=>{if(init.method==='POST' && attempts++===0){if(failure==='network')throw TypeError('offline');return response({},failure);}}});
    await h.service.connect('id');assert.equal((await h.service.importGames([game()],'target/calendar',120,0))[0].status,'created');assert.deepEqual(h.waits,[500]);
  }
  const h=harness({handler:async(_url,init,events)=>{if(init.method==='POST'){events.push(JSON.parse(init.body));return response({},409);}}});
  await h.service.connect('id');assert.equal((await h.service.importGames([game()],'target/calendar',120,0))[0].status,'existing');
  assert(h.calls.some(c=>/\/events\/v2/.test(c.url)));
});

test('error de red persistente no anuncia éxito y no crea solicitudes simultáneas por doble clic',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve);
  const h=harness({handler:async(url,init)=>{if(init.method==='POST'){await gate;throw TypeError('offline');}}});
  await h.service.connect('id');const statuses=[];
  const active=h.service.importGames([game()],'target/calendar',120,0,r=>statuses.push(r.status));
  await assert.rejects(h.service.importGames([game()],'target/calendar',120,0),/en curso/);
  release();assert.equal((await active)[0].status,'error');assert(!statuses.includes('created'));
});

test('respuesta de consulta incompleta no permite crear sin comprobar duplicados',async()=>{
  const h=harness({handler:async(url,init)=>!init.method && url.includes('/events')?{ok:true,status:200,json:async()=>{throw Error('truncated');}}:undefined});
  await h.service.connect('id');
  const results=await h.service.importGames([game()],'target/calendar',120,0);
  assert.equal(results[0].status,'error');assert.match(results[0].detail,/incompleta/);
  assert(!h.calls.some(c=>c.init.method==='POST'));assert.equal(h.waits.length,2);
});
