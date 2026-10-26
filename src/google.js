import {prepareEvent} from './prepare.js';
import {normalize,functionsFor} from './model.js';
import {assignmentId} from './google-identity.js';
import {createSyncService,metadata,matchesSource,strongMatch,hash} from './sync.js';
import {createRoundSync} from './round-sync.js';

export const scopes=['https://www.googleapis.com/auth/calendar.events','https://www.googleapis.com/auth/calendar.calendarlist.readonly'];
export const writableCalendars = calendars => calendars.filter(c=>!c.deleted && ['owner','writer','writerWithoutPrivateAccess'].includes(c.accessRole));
export const preferredCalendar = (calendars,id) => calendars.find(c=>c.id===id)?.id || calendars.find(c=>c.primary)?.id || calendars[0]?.id || '';
export class GoogleError extends Error {
  constructor(status,message){super(message);this.status=status;}
}
export async function googleEvent(game,duration=120,reminder=0) {
  // The shared preparation function also serves the review preview.
  const prepared=prepareEvent({...game,roleOverrides:{...game.roleOverrides,[normalize(game.referee)]:game.role}},game.referee,duration);
  const id=await assignmentId(game);
  const payload={...prepared,id,reminders:{useDefault:false,overrides:reminder>0?[{method:'popup',minutes:reminder}]:[]}};
  return {...payload,extendedProperties:{private:await metadata(game,payload)}};
}
const madridDay=value=>value?.date || (value?.dateTime ? new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value.dateTime)) : '');
export function legacyMatch(event,game) {
  if(event.status==='cancelled')return false;
  const summary=normalize(event.summary);
  const dates=[game.date,game.original?.date].filter(Boolean);
  const teams=[game,game.original].filter(Boolean);
  const roles=[game.role,...functionsFor(game.original||game,game.referee)].map(normalize).filter(Boolean);
  return dates.includes(madridDay(event.start)) && teams.some(team=>normalize(team.home) && normalize(team.away) && summary.includes(`${normalize(team.home)} VS ${normalize(team.away)}`)) && roles.some(role=>summary.includes(`${role} |`)||summary.includes(`(${role})`)||summary.startsWith(`${role}:`));
}
function sameContent(a,b) {
  const date=v=>v?.dateTime ? +new Date(v.dateTime) : v?.date;
  const reminders=v=>JSON.stringify({useDefault:v?.useDefault??true,overrides:[...(v?.overrides||[])].sort((a,b)=>a.minutes-b.minutes)});
  return ['summary','description','location'].every(key=>(a[key]||'')===(b[key]||'')) && date(a.start)===date(b.start) && date(a.end)===date(b.end) && reminders(a.reminders)===reminders(b.reminders);
}
export function classifyExisting(events,payload,game) {
  const matches=events.filter(e=>e.status!=='cancelled' && matchesSource(e,payload.id));
  if(matches.length)return {status:matches.length===1 && sameContent(matches[0],payload)?'existing':'pending',matches};
  if(game.documentRound?.automatic){
    const candidates=events.filter(e=>strongMatch(e,game,game.documentRound));
    if(candidates.length)return {status:candidates.length>1?'review':sameContent(candidates[0],payload)?'existing':'pending',matches:candidates};
  }
  const legacy=events.filter(e=>!['2','3','4'].includes(e.extendedProperties?.private?.voleyVersion) && legacyMatch(e,game));
  return legacy.length?{status:'review',matches:legacy}:null;
}

export function createGoogleService({fetcher=(...args)=>fetch(...args),oauth=()=>window.google?.accounts?.oauth2,now=()=>Date.now(),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),onState=()=>{}}={}) {
  let token='',expiresAt=0,epoch=0,connecting=false,importing=false;
  let accountKey='',allowedCalendars=new Set();
  const isConnected=()=>!!token && now()<expiresAt;
  const notify=()=>onState({connected:isConnected(),expiresAt,connecting,importing,accountKey});
  function clear(){token='';expiresAt=0;accountKey='';allowedCalendars.clear();epoch++;notify();}
  function disconnect(){const previous=token;clear();if(previous)try{oauth()?.revoke(previous,()=>{});}catch{/* Local disconnection already completed. */}}
  async function request(path,options={}) {
    const generation=epoch;
    for(let attempt=0;attempt<3;attempt++) {
      if(generation!==epoch)throw new GoogleError(401,'La cuenta ha cambiado. Vuelve a comprobar la jornada.');
      if(!isConnected()) {clear();throw new GoogleError(401,'La sesión ha caducado. Conecta Google de nuevo.');}
      const calendar=/^calendars\/([^/]+)\//.exec(path)?.[1];
      if(calendar&&!allowedCalendars.has(decodeURIComponent(calendar)))throw new GoogleError(403,'El calendario no pertenece a la lista autorizada de esta cuenta.');
      let response;
      try{response=await fetcher(`https://www.googleapis.com/calendar/v3/${path}`,{...options,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(30000)});}
      catch(e){if(generation!==epoch)throw new GoogleError(401,'Conexión cerrada.');if(attempt<2){await sleep(500*2**attempt);continue;}throw new GoogleError(0,'Error temporal de red. Puedes reintentar este partido.');}
      if(generation!==epoch)throw new GoogleError(401,'Conexión cerrada.');
      if(response.status===204)return {};
      let body;
      try{body=await response.json();}catch{
        if(response.ok){if(attempt<2){await sleep(500*2**attempt);continue;}throw new GoogleError(0,'Respuesta incompleta de Google. Reintenta para comprobar el resultado.');}
        body={};
      }
      if(generation!==epoch)throw new GoogleError(401,'La cuenta ha cambiado. Vuelve a comprobar la jornada.');
      if(response.ok)return body;
      if(response.status===401){clear();throw new GoogleError(401,'Google ha caducado o revocado la sesión. Vuelve a conectar.');}
      const reason=body.error?.errors?.[0]?.reason;
      const limited=response.status===429 || response.status===403 && ['rateLimitExceeded','userRateLimitExceeded'].includes(reason);
      if((limited||response.status>=500)&&attempt<2){const retry=Number(response.headers?.get('Retry-After'));await sleep(Math.min(10000,retry>0?retry*1000:500*2**attempt));continue;}
      const messages={403:limited?'Google ha limitado las solicitudes. Reintenta más tarde.':'Permisos insuficientes o API no habilitada. Vuelve a conectar para autorizar el acceso a eventos.',404:'El evento ya no existe o no es accesible. Comprueba de nuevo.',410:'El evento fue eliminado. Comprueba de nuevo.',409:'El identificador del evento ya existe. Es necesario comprobarlo.',412:'El evento cambió en Google (412). Comprueba los cambios de nuevo antes de aplicar.',429:'Google ha limitado las solicitudes. Reintenta más tarde.'};
      throw new GoogleError(response.status,messages[response.status]||`Google Calendar: HTTP ${response.status}. Puedes reintentar.`);
    }
  }
  async function list(path,params={}) {
    let pageToken='',items=[];
    do {const response=await request(path+'?'+new URLSearchParams({...params,pageToken}));items.push(...(response.items||[]));pageToken=response.nextPageToken||'';}while(pageToken);
    return items;
  }
  async function connect(clientId) {
    if(connecting||importing)throw Error('Espera a que termine la operación actual.');
    if(!clientId)throw Error('Configura VITE_GOOGLE_CLIENT_ID en .env.local y reinicia Vite.');
    const sdk=oauth();if(!sdk)throw Error('Google Identity Services no está disponible. Comprueba la conexión y recarga la página.');
    connecting=true;clear();const generation=epoch;notify();
    try {
      await new Promise((resolve,reject)=>{
        let settled=false;
        const timeout=setTimeout(()=>{settled=true;reject(Error('Google no ha respondido. Vuelve a conectar.'));},120000);
        const fail=message=>{settled=true;clearTimeout(timeout);reject(Error(message));};
        try{sdk.initTokenClient({client_id:clientId,scope:scopes.join(' '),include_granted_scopes:true,callback:response=>{
          if(settled)return;
          if(generation!==epoch){fail('Conexión cancelada.');return;}
          if(response.error){fail(response.error==='access_denied'?'Permisos denegados. Puedes volver a conectar.':`Error OAuth: ${response.error}`);return;}
          const granted=response.scope?.split(' ')||[];
          if(!response.access_token || !scopes.every(scope=>granted.includes(scope))){fail('Faltan permisos de calendario. Vuelve a conectar y autoriza ambos permisos.');return;}
          if(!Number.isFinite(Number(response.expires_in))||Number(response.expires_in)<=30){fail('Google devolvió una sesión no válida. Vuelve a conectar.');return;}
          settled=true;clearTimeout(timeout);token=response.access_token;expiresAt=now()+(Number(response.expires_in)-30)*1000;resolve();
        },error_callback:error=>fail(error.type==='popup_closed'?'Has cerrado la ventana de Google. Puedes volver a conectar.':'No se pudo abrir la autorización de Google. Permite las ventanas emergentes.')}).requestAccessToken({prompt:'select_account'});}catch(e){fail(e.message);}
      });
      const calendars=writableCalendars(await list('users/me/calendarList',{minAccessRole:'writer',maxResults:'250'}));
      if(generation!==epoch)throw new GoogleError(401,'Conexión cancelada.');
      const primary=calendars.find(c=>c.primary);
      const key=primary?.id?await hash(['voley-account-preferences',primary.id]):'';
      if(generation!==epoch)throw new GoogleError(401,'Conexión cancelada.');
      allowedCalendars=new Set(calendars.map(c=>c.id));accountKey=key;
      notify();return calendars;
    }catch(e){clear();throw e;}finally{connecting=false;notify();}
  }
  async function importGames(games,calendar,duration,reminder,report=()=>{}) {
    if(importing)throw Error('Ya hay una importación en curso.');
    if(!calendar)throw Error('Selecciona un calendario de destino.');
    importing=true;notify();const results=[];
    const emit=(game,status,detail='',matches=[])=>{const result={game,status,detail,matches};if(!['checking','creating','retrying'].includes(status))results.push(result);report(result);return result;};
    const base=`calendars/${encodeURIComponent(calendar)}/events`;
    try {
      const payloads=[];
      for(const game of games){try{payloads.push({game,payload:await googleEvent(game,duration,reminder)});}catch(e){emit(game,'error',e.message);}}
      if(!payloads.length)return results;
      let existing;
      try{
        const times=payloads.flatMap(({game,payload})=>[+new Date(payload.start.dateTime),+new Date(payload.end.dateTime),...(game.original?.date?[Date.parse(game.original.date+'T00:00:00Z')]:[])]).filter(Number.isFinite);
        existing=await list(base,{singleEvents:'true',maxResults:'2500',timeMin:new Date(Math.min(...times)-86400000).toISOString(),timeMax:new Date(Math.max(...times)+86400000).toISOString()});
      }catch(e){for(const {game}of payloads)emit(game,'error',e.message);return results;}
      for(const {game,payload}of payloads) {
        emit(game,'checking');
        try {
          // Identity lookup has no date restriction: detects manually moved events too.
          const exact=await list(base,{privateExtendedProperty:`voleyId=${payload.id}`,maxResults:'2500'});
          const source=await list(base,{privateExtendedProperty:`voleyLatestSource=${payload.id}`,maxResults:'2500'});
          const round=game.documentRound?.round?await list(base,{privateExtendedProperty:`voleyRound=${normalize(game.documentRound.round)}`,maxResults:'2500'}):[];
          const combined=[...existing,...exact,...source,...round].filter((e,i,all)=>all.findIndex(x=>x.id===e.id)===i);
          let match=classifyExisting(combined,payload,game);
          if(match){emit(game,match.status,'',match.matches);continue;}
          emit(game,'creating');
          let created;
          try{created=await request(base,{method:'POST',body:JSON.stringify(payload)});}
          catch(e){
            if(e.status!==409)throw e;
            // A previous response may have been lost after Google saved the event.
            const found=await request(`${base}/${payload.id}`);
            match=classifyExisting([found],payload,game);
            if(!match)throw Error('Conflicto de identificador. Revisa el calendario antes de reintentar.');
            existing.push(found);emit(game,match.status,'',match.matches);continue;
          }
          if(!created.id || created.status==='cancelled')throw Error('Google no confirmó la creación del evento. Reintenta para comprobar su estado.');
          existing.push(created);emit(game,'created','',[created]);
        }catch(e){emit(game,'error',e.message);}
      }
      return results;
    }finally{importing=false;notify();}
  }
  const sync=createSyncService({request,list,buildEvent:googleEvent});
  const roundSync=createRoundSync({request,list,buildEvent:googleEvent});
  const planSessions=new WeakMap();
  const requirePlanSession=plan=>{if(planSessions.get(plan)!==epoch)throw Error('La cuenta o sesión ha cambiado. Comprueba la jornada de nuevo.');};
  async function exclusive(operation){
    if(importing||connecting)throw Error('Ya hay una operación de Google en curso.');
    if(!isConnected())throw new GoogleError(401,'Conecta Google para comprobar o aplicar cambios.');
    importing=true;notify();try{return await operation();}finally{importing=false;notify();}
  }
  return {connect,disconnect,isConnected,importGames,getAccountKey:()=>isConnected()?accountKey:'',
    inspectRound:(...args)=>exclusive(()=>roundSync.inspect(...args)),
    synchronizeRound:(...args)=>exclusive(()=>roundSync.synchronize(...args)),
    checkChanges:(...args)=>exclusive(async()=>{const generation=epoch,plan=await sync.checkChanges(...args);if(generation!==epoch)throw new GoogleError(401,'La cuenta ha cambiado.');planSessions.set(plan,generation);return plan;}),
    applyChanges:(plan,...args)=>exclusive(()=>{requirePlanSession(plan);return sync.applyChanges(plan,...args);}),
    resolveChange:(plan,...args)=>{requirePlanSession(plan);return sync.resolveRow(plan,...args);}};
}
