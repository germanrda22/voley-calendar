import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAccountPreferences} from '../src/account-preferences.js';
import {createGoogleService,scopes} from '../src/google.js';
import {refereeChoices} from '../src/referee-picker.js';
const response=body=>({ok:true,status:200,json:async()=>body,headers:{get:()=>null}});

test('preferencias separadas por cuenta; nunca recupera la clave compartida antigua ni tokens',()=>{
  const data=new Map([['voley_google_calendar','old-calendar']]);
  const prefs=createAccountPreferences({getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value)});
  const a='a'.repeat(64),b='b'.repeat(64);
  prefs.useAccount(a);assert.equal(prefs.load().calendar,'');prefs.save({referee:'Germán Ruiz',calendar:'calendar-a',token:'secret'});
  prefs.useAccount(b);assert.equal(prefs.load().referee,'');prefs.save({referee:'Alba Jiménez',calendar:'calendar-b'});
  prefs.useAccount(a);assert.deepEqual(prefs.load(),{referee:'Germán Ruiz',calendar:'calendar-a'});
  prefs.useAccount('');assert.deepEqual(prefs.load(),{});prefs.save({referee:'No guardar'});
  assert(![...data.values()].some(value=>value.includes('secret')||value.includes('No guardar')));
});

test('almacenamiento bloqueado o corrupto no rompe la sesión ni reutiliza otra cuenta',()=>{
  const prefs=createAccountPreferences({getItem:()=>{throw Error('blocked');},setItem:()=>{throw Error('blocked');}});
  prefs.useAccount('a'.repeat(64));assert.deepEqual(prefs.load(),{});assert.doesNotThrow(()=>prefs.save({referee:'Uno'}));
});

test('dos cuentas: OAuth select_account, calendarios propios y bloqueo de destinos de la otra cuenta',async()=>{
  let selected='A',config;const calls=[],prompts=[];
  const calendars={A:[{id:'primary-A',primary:true,accessRole:'owner'},{id:'shared',accessRole:'writer'}],B:[{id:'primary-B',primary:true,accessRole:'owner'},{id:'reader-B',accessRole:'reader'},{id:'shared',accessRole:'writer'}]};
  const service=createGoogleService({oauth:()=>({initTokenClient:c=>{config=c;return {requestAccessToken:options=>{prompts.push(options.prompt);c.callback({access_token:'token-'+selected,expires_in:3600,scope:scopes.join(' ')})}};},revoke:(_token,done)=>done()}),fetcher:async(url,init)=>{calls.push({url,auth:init.headers.Authorization});return response({items:url.includes('calendarList')?calendars[selected]:[]});}});
  assert.deepEqual((await service.connect('public-client')).map(c=>c.id),['primary-A','shared']);
  const a=service.getAccountKey();assert.match(a,/^[a-f0-9]{64}$/);assert(!a.includes('primary-A'));
  service.disconnect();assert.equal(service.getAccountKey(),'');selected='B';
  assert.deepEqual((await service.connect('public-client')).map(c=>c.id),['primary-B','shared']);
  assert.notEqual(service.getAccountKey(),a);assert.deepEqual(prompts,['select_account','select_account']);
  assert.deepEqual(config.scope.split(' '),scopes);assert(!config.scope.includes('email'));assert(!config.scope.includes('openid'));
  const result=await service.importGames([{date:'2026-10-24',time:'18:00',home:'Local',away:'Visitante',category:'Junior',venue:'Pabellón',referee:'German Ruiz',role:'Anotador',scorer:'German Ruiz'}],'primary-A',120,0);
  assert.equal(result[0].status,'error');assert.match(result[0].detail,/cuenta/);
  assert(!calls.some(c=>c.url.includes('/calendars/primary-A/')));
});

test('sin calendario principal no persiste preferencias basándose en un calendario compartido',async()=>{
  const service=createGoogleService({oauth:()=>({initTokenClient:c=>({requestAccessToken:()=>c.callback({access_token:'t',expires_in:3600,scope:scopes.join(' ')})})}),fetcher:async()=>response({items:[{id:'shared',accessRole:'writer'}]})});
  await service.connect('public');assert.equal(service.getAccountKey(),'');
});

test('selector normaliza los tres roles y busca ignorando tildes, espacios y mayúsculas',()=>{
  const games=[{first:'Germán Ruiz',second:'ALBA JIMENEZ',scorer:'Lucía Rojas'},{first:'  GERMAN   RUIZ ',second:'Alba Jiménez',scorer:'LUCIA ROJAS'}];
  assert.equal(refereeChoices(games).length,3);
  assert.deepEqual(refereeChoices(games,'  german  ruiz '),[['GERMAN RUIZ','Germán Ruiz']]);
  assert.equal(refereeChoices(games,'lucia')[0][1],'Lucía Rojas');assert.deepEqual(refereeChoices([],''),[]);
});

test('un plan de la cuenta anterior no puede aplicarse aunque ambas tengan el mismo calendario compartido',async()=>{
  let account='A';const service=createGoogleService({oauth:()=>({initTokenClient:c=>({requestAccessToken:()=>c.callback({access_token:'t-'+account,expires_in:3600,scope:scopes.join(' ')})}),revoke:(_token,done)=>done()}),fetcher:async url=>response({items:url.includes('calendarList')?[{id:'primary-'+account,primary:true,accessRole:'owner'},{id:'shared',accessRole:'writer'}]:[]})});
  const scope={calendar:'shared',referee:'German Ruiz',round:'week',from:'2026-10-19',to:'2026-10-25',complete:true,extractionReliable:true};
  await service.connect('public');const plan=await service.checkChanges([],scope);
  service.disconnect();account='B';await service.connect('public');
  await assert.rejects(()=>service.applyChanges(plan,[]),/sesión ha cambiado/);
  assert.throws(()=>service.resolveChange(plan,'row','new'),/sesión ha cambiado/);
});

test('una respuesta de la sesión revocada no puede continuar una importación con otro token',async()=>{
  let release,entered;const waiting=new Promise(resolve=>entered=resolve);const requests=[];
  const service=createGoogleService({oauth:()=>({initTokenClient:c=>({requestAccessToken:()=>c.callback({access_token:'token-A',expires_in:3600,scope:scopes.join(' ')})}),revoke:(_token,done)=>done()}),fetcher:async(url,init)=>{
    requests.push({url,method:init.method||'GET'});
    if(url.includes('calendarList'))return response({items:[{id:'target',primary:true,accessRole:'owner'}]});
    return {ok:true,status:200,headers:{get:()=>null},json:()=>new Promise(resolve=>{release=()=>resolve({items:[]});entered();})};
  }});
  await service.connect('public');
  const pending=service.importGames([{date:'2026-10-24',time:'18:00',home:'Local',away:'Visitante',category:'Junior',venue:'Pabellón',referee:'German Ruiz',role:'Anotador',scorer:'German Ruiz'}],'target',120,0);
  await waiting;service.disconnect();release();const result=await pending;
  assert.equal(result[0].status,'error');assert.match(result[0].detail,/cuenta ha cambiado/);assert(!requests.some(r=>r.method==='POST'));
});
