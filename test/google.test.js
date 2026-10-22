import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connect,exportGoogle} from '../src/google.js';
import {stableId} from '../src/calendar.js';
test('Google: calendarios, paginación, duplicados y resultados individuales',async()=>{
  const originalFetch=globalThis.fetch,originalWindow=globalThis.window;
  const calls=[],reports=[];
  const a={date:'2026-10-17',time:'10:00',home:'A',away:'B',role:'Anotador',referee:'Uno'};
  const b={...a,time:'12:00'},c={...a,time:'14:00'},d={...a,time:'16:00'};
  const duplicateId=await stableId(a);
  globalThis.window={google:{accounts:{oauth2:{initTokenClient:options=>({requestAccessToken:()=>options.callback({access_token:'test',expires_in:3600})})}}}};
  globalThis.fetch=async(url,options)=>{
    calls.push({url,options});
    if(url.includes('calendarList'))return {ok:true,json:async()=>({items:[{id:'target/calendar',summary:'Destino'}]})};
    if(!options.method){const second=new URL(url).searchParams.get('pageToken');return {ok:true,json:async()=>second?{items:[{id:duplicateId}]}:{items:[],nextPageToken:'second'}};}
    const body=JSON.parse(options.body);
    if(body.start.dateTime.includes('12:00:00'))return {ok:false,status:403}; // 14:00 Madrid
    return {ok:true,json:async()=>body};
  };
  try{
    assert.equal((await connect('public-client-id'))[0].id,'target/calendar');
    await exportGoogle([a,b,c,d],'target/calendar',120,60,(g,result)=>reports.push(result));
    assert.deepEqual(reports,['Duplicado omitido','Creado','Error: Google Calendar: HTTP 403','Creado']);
    assert.equal(calls.filter(c=>c.options.method==='POST').length,3);
    assert(calls.some(c=>c.url.includes('target%2Fcalendar')));
    assert(calls.some(c=>c.url.includes('pageToken=second')));
  }finally{globalThis.fetch=originalFetch;globalThis.window=originalWindow;}
});
