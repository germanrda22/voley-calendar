import {getDates,stableId,title,description,timezone} from './calendar.js';
let token='',expires=0;
async function request(path,options={}) {
  if(Date.now()>=expires) throw Error('La sesión de Google ha caducado. Vuelve a iniciar sesión.');
  const res=await fetch(`https://www.googleapis.com/calendar/v3/${path}`,{...options,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}});
  if(!res.ok)throw Error(`Google Calendar: HTTP ${res.status}`);
  return res.json();
}
export async function connect(clientId) {
  if(!clientId)throw Error('Introduce el OAuth Client ID');
  if(!window.google?.accounts?.oauth2)throw Error('Google Identity Services no está disponible');
  await new Promise((resolve,reject)=>window.google.accounts.oauth2.initTokenClient({client_id:clientId,scope:'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly',callback:r=>{if(r.error){reject(Error(r.error));return;} token=r.access_token;expires=Date.now()+(r.expires_in-60)*1000;resolve();},error_callback:e=>reject(Error(e.type||'Autorización cancelada'))}).requestAccessToken());
  let pageToken='',calendars=[];
  do {const r=await request('users/me/calendarList?'+new URLSearchParams({minAccessRole:'writer',pageToken}));calendars.push(...(r.items||[]));pageToken=r.nextPageToken||'';}while(pageToken);
  return calendars;
}
export async function exportGoogle(games,calendar,duration,reminder,report) {
  if(!calendar)throw Error('Selecciona el calendario de destino');
  const base=`calendars/${encodeURIComponent(calendar)}/events`, dates=games.map(g=>getDates(g,duration));
  const params={singleEvents:'true',maxResults:'2500',timeMin:new Date(Math.min(...dates.map(d=>+d.start))-86400000).toISOString(),timeMax:new Date(Math.max(...dates.map(d=>+d.end))+86400000).toISOString()};
  let existing=[],pageToken='';
  do {const r=await request(base+'?'+new URLSearchParams({...params,pageToken}));existing.push(...(r.items||[]));pageToken=r.nextPageToken||'';}while(pageToken);
  for(let i=0;i<games.length;i++) {
    const g=games[i],{start,end}=dates[i],id=await stableId(g);
    try {
      if(existing.some(e=>e.id===id||e.extendedProperties?.private?.voleyId===id||(e.summary===title(g)&&e.start?.dateTime&&+new Date(e.start.dateTime)===+start))){report(g,'Duplicado omitido');continue;}
      const event={id,summary:title(g),description:description(g),location:g.venue,start:{dateTime:start.toISOString(),timeZone:timezone},end:{dateTime:end.toISOString(),timeZone:timezone},extendedProperties:{private:{voleyId:id}},reminders:{useDefault:false,overrides:reminder>0?[{method:'popup',minutes:reminder}]:[]}};
      const created=await request(base,{method:'POST',body:JSON.stringify(event)});existing.push(created);report(g,'Creado');
    }catch(e){report(g,e.message.includes('409')?'Duplicado omitido':`Error: ${e.message}`);}
  }
}
