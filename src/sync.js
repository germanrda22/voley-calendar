import {normalize} from './model.js';
import {automaticRoundKey} from './round.js';

export const origin='granada-designaciones';
export const privateData=event=>event?.extendedProperties?.private||{};
export const managed=event=>{
  const p=privateData(event);
  return p.voleyApp==='voley-calendar' && !!p.voleyId || /^v2[0-9a-f]{64}$/.test(p.voleyId||'') || /^[0-9a-f]{64}$/.test(p.voleyId||'');
};
export const aliases=event=>{try{const value=JSON.parse(privateData(event).voleyAliases||'[]');return Array.isArray(value)?value:[];}catch{return [];}};
export const matchesSource=(event,id)=>!!id && (event.id===id || privateData(event).voleyId===id || privateData(event).voleySource===id || privateData(event).voleyLatestSource===id || aliases(event).includes(id));
export async function hash(value){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');}
const instant=value=>value?.dateTime?new Date(value.dateTime).toISOString():value?.date||'';
const madridDay=value=>value?.date|| (value?.dateTime?new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value.dateTime)):'');
const knownOrigin=event=>privateData(event).voleyOrigin===origin||!privateData(event).voleyOrigin&&managed(event)&&!privateData(event).voleyRoundFrom&&(!privateData(event).voleyApp||privateData(event).voleyApp==='voley-calendar');
export const content=event=>({summary:event.summary||'',start:instant(event.start),end:instant(event.end),location:event.location||'',description:event.description||''});
export const fingerprint=event=>hash(content(event));
export const differences=(oldEvent,newEvent)=>Object.keys(content(newEvent)).filter(key=>content(oldEvent)[key]!==content(newEvent)[key]).map(key=>({field:key,before:content(oldEvent)[key],after:content(newEvent)[key]}));
export function matchData(event){
  const p=privateData(event);let stored;
  try{stored=JSON.parse(p.voleyMatch||'null');}catch{/* Older versions have no structured match. */}
  if(stored)return stored;
  const summary=event.summary||'',modern=/^🏐\s*(.*?)\s*\|\s*(.*?)\s+vs\s+(.*)$/i.exec(summary),old=/^🏐\s*(.*?)\s+vs\s+(.*?)\s*\((.*?)\)$/.exec(summary);
  const field=name=>new RegExp(`^${name}:\\s*(.*)$`,'mi').exec(event.description||'')?.[1]||'';
  return {home:modern?.[2]||old?.[1]||'',away:modern?.[3]||old?.[2]||'',category:field('Categoría'),competition:field('Competición'),referee:p.voleyRef||field('Árbitro'),date:madridDay(event.start),role:modern?.[1]||old?.[3]||''};
}
export const sameRef=(event,referee)=>normalize(privateData(event).voleyRef||matchData(event).referee)===normalize(referee);
export async function metadata(game,payload,{round='',previous=null,sourceId=payload.id,scope=game.documentRound}={}) {
  const p=privateData(previous),source=sourceId;
  const data={home:game.home,away:game.away,category:game.category,competition:game.competition,date:game.original?.date||game.date,referee:game.referee,role:game.role};
  const history=[...new Set([...aliases(previous),p.voleySource,source].filter(Boolean))];
  if(JSON.stringify(history).length>1000 || JSON.stringify(data).length>1000)throw Error('Los metadatos superan el límite de Google. Revisa los datos antes de continuar.');
  const auto=scope?.automatic?{voleyVersion:'4',voleyRound:normalize(scope.round||automaticRoundKey(scope)),voleyRoundFrom:scope.from,voleyRoundTo:scope.to,voleyCompetitionScope:normalize(scope.competitionScope||'VOLEIBOL'),voleyRoundCompetition:await hash([scope.round||automaticRoundKey(scope),normalize(game.competition),normalize(game.category)])}:{};
  return {...p,voleyApp:'voley-calendar',voleyVersion:p.voleyVersion==='4'?'4':'3',voleyId:p.voleyId||payload.id,voleySource:p.voleySource||source,voleyLatestSource:source,voleyAliases:JSON.stringify(history),voleyOrigin:origin,voleyRound:normalize(round)||p.voleyRound||'',voleyRef:normalize(game.referee),voleyFingerprint:await fingerprint(payload),voleyMatch:JSON.stringify(data),...auto};
}
export function belongsToRound(event,scope){
  const p=privateData(event);
  if(!scope.automatic)return p.voleyRound===normalize(scope.round);
  if(p.voleyRoundFrom&&p.voleyRoundTo)return p.voleyRoundFrom===scope.from&&p.voleyRoundTo===scope.to&&p.voleyCompetitionScope===normalize(scope.competitionScope||'VOLEIBOL');
  const data=matchData(event),competition=JSON.stringify([normalize(data.competition),normalize(data.category)]);
  if(!p.voleyRound&&scope.legacyUnscoped&&knownOrigin(event)&&sameRef(event,scope.referee)&&scope.intervalSource==='header'&&(normalize(data.competition)||normalize(data.category))&&scope.competitionKeys?.includes(competition)&&data.date>=scope.from&&data.date<=scope.to)return true;
  return p.voleyRound===normalize(scope.round)||!!p.voleyRound&&scope.legacyRounds?.includes(p.voleyRound)&&matchData(event).date>=scope.from&&matchData(event).date<=scope.to;
}
function equalMatch(event,game){
  const data=matchData(event);
  return [game.original||game,game].some(source=>normalize(source.home)&&normalize(source.away)&&(normalize(source.category)||normalize(source.competition))&&['home','away','category','competition'].every(key=>normalize(source[key])===normalize(data[key])));
}
export function strongMatch(event,game,scope){
  if(!managed(event)||event.status==='cancelled'||!sameRef(event,scope.referee)||!equalMatch(event,game))return false;
  const p=privateData(event);
  if(p.voleyRoundFrom)return belongsToRound(event,scope);
  const date=matchData(event).date;
  return date>=scope.from&&date<=scope.to;
}
function candidateFor(event,game,scope){
  if(event.status==='cancelled')return false;
  const p=privateData(event),data=matchData(event),source=game.original||game;
  if(scope.automatic){
    if(!managed(event)||!sameRef(event,scope.referee))return false;
    if(p.voleyRoundFrom&&!belongsToRound(event,scope)&&!(p.voleyRoundFrom<=scope.to&&p.voleyRoundTo>=scope.from))return false;
  }
  if(p.voleyRef && !sameRef(event,scope.referee))return false;
  const teams=[game,source].some(g=>normalize(g.home)===normalize(data.home)&&normalize(g.away)===normalize(data.away)&&normalize(g.home));
  const oneTeam=[game.home,game.away,source.home,source.away].some(team=>normalize(team)&&[normalize(data.home),normalize(data.away)].includes(normalize(team)));
  const sameRound=p.voleyRound===normalize(scope.round),category=normalize(data.category)===normalize(source.category)&&normalize(data.category),competition=normalize(data.competition)===normalize(source.competition)&&normalize(data.competition);
  return !!teams || !!oneTeam && (sameRound||category||competition);
}
const safelyManaged=(event,game,scope)=>managed(event)&&(!privateData(event).voleyRef||sameRef(event,scope.referee))&&(sameRef(event,scope.referee)||matchesSource(event,game?.payload?.id));
export async function compareChanges(entries,events,scope) {
  if(scope.documentPartial)scope={...scope,complete:false};
  const rows=[],reserved=new Set(),sourceCounts=new Map(),queried=events.length;
  if(scope.automatic){
    events=events.filter(event=>managed(event)||event.status==='cancelled'&&entries.some(e=>matchesSource(event,e.payload.id)));
    const witnessed=events.filter(event=>!privateData(event).voleyRoundFrom&&managed(event)&&sameRef(event,scope.referee)&&entries.some(entry=>matchesSource(event,entry.payload.id)||strongMatch(event,entry.game,scope))).map(event=>privateData(event).voleyRound).filter(Boolean);
    const legacyUnscoped=events.some(event=>event.status!=='cancelled'&&!privateData(event).voleyRoundFrom&&!privateData(event).voleyRound&&knownOrigin(event)&&sameRef(event,scope.referee)&&entries.some(entry=>matchesSource(event,entry.payload.id)||strongMatch(event,entry.game,scope)));
    scope={...scope,legacyRounds:[...new Set(witnessed)],legacyUnscoped};
  }
  for(const entry of entries)sourceCounts.set(entry.payload.id,(sourceCounts.get(entry.payload.id)||0)+1);
  const exactOwners=new Map();
  for(const entry of entries){const exact=events.filter(e=>e.status!=='cancelled'&&managed(e)&&matchesSource(e,entry.payload.id));if(exact.length===1&&sourceCounts.get(entry.payload.id)===1)exactOwners.set(exact[0].id,entry.game.id);}
  const strongCandidates=entry=>events.filter(e=>strongMatch(e,entry.game,scope)&&(!exactOwners.has(e.id)||exactOwners.get(e.id)===entry.game.id));
  for(const entry of entries){
    const exact=events.filter(e=>e.status!=='cancelled'&&managed(e)&&matchesSource(e,entry.payload.id));
    const row={key:entry.game.id,game:entry.game,payload:entry.payload,sourceId:entry.payload.id,status:'new',action:'create',selected:false,candidates:[],differences:[]};
    if(exact.length===1&&sourceCounts.get(entry.payload.id)===1&&safelyManaged(exact[0],entry,scope)&&!reserved.has(exact[0].id)&&(!scope.automatic||!privateData(exact[0]).voleyRoundFrom||belongsToRound(exact[0],scope))){
      await bindRow(row,exact[0],scope);reserved.add(exact[0].id);
    }else{
      const strong=scope.automatic?strongCandidates(entry):[];
      if(strong.length===1&&sourceCounts.get(entry.payload.id)===1&&!reserved.has(strong[0].id)&&entries.filter(other=>strongCandidates(other).some(e=>e.id===strong[0].id)).length===1){
        await bindRow(row,strong[0],scope);row.reason=row.reason||'Mismo partido identificado por equipos, competición, categoría, árbitro y jornada; revisa los cambios antes de aplicar.';reserved.add(strong[0].id);rows.push(row);continue;
      }
      const candidates=events.filter(e=>matchesSource(e,entry.payload.id)||candidateFor(e,entry.game,scope));
      if(candidates.length||sourceCounts.get(entry.payload.id)>1){row.status='doubtful';row.action=null;row.candidates=candidates;row.reason=sourceCounts.get(entry.payload.id)>1?'Hay varios partidos con la misma identidad de origen. Resuelve cada correspondencia.':'La identidad no es inequívoca. Confirma la correspondencia o que es un partido distinto.';}
      for(const candidate of candidates)reserved.add(candidate.id);
      // With completely corrected team names no heuristic can establish identity.
      // Offer same-round managed events for an explicit manual link, while still
      // allowing the user to confirm a genuinely new match.
      if(row.status==='new')row.candidates=events.filter(e=>e.status!=='cancelled'&&managed(e)&&sameRef(e,scope.referee)&&belongsToRound(e,scope));
    }
    rows.push(row);
  }
  const diagnostics={queried,managed:events.filter(managed).length,forReferee:events.filter(e=>e.status!=='cancelled'&&managed(e)&&sameRef(e,scope.referee)).length,matched:rows.filter(r=>r.event).length,proposed:0,blocked:[],messages:[]};
  if(!scope.complete)diagnostics.messages.push(scope.documentPartial?'No se proponen eliminaciones: el documento está declarado parcial.':scope.completenessConfirmed&&scope.deletionsAllowed===false?'No se proponen eliminaciones: el intervalo es contradictorio, faltan fechas o hay partidos fuera de la cabecera.':'No se proponen eliminaciones: aún no has confirmado que el PDF contiene la jornada completa. Marca la casilla solo tras contrastarlo con el original.');
  if(!scope.extractionReliable)diagnostics.messages.push('No se proponen eliminaciones: la extracción no es fiable.'+(scope.extractionIssues?.length?' '+scope.extractionIssues.join(' · '):''));
  // Evaluate every fetched event, including those with no surviving PDF row.
  for(const event of events){
    if(event.status==='cancelled'||reserved.has(event.id)||!managed(event))continue;
    const p=privateData(event),data=matchData(event),referee=normalize(p.voleyRef||data.referee);
    if(referee&&referee!==normalize(scope.referee))continue;
    const inRange=data.date>=scope.from&&data.date<=scope.to;
    const reason=!referee?'No consta el árbitro en los metadatos ni en la descripción.':!knownOrigin(event)?'El origen del evento no pertenece a estas designaciones.':!belongsToRound(event,scope)?'No hay evidencia suficiente para vincular el evento a la jornada y competición.':!p.voleyRoundFrom&&!inRange?'La fecha del evento queda fuera de la jornada.':'';
    if(reason){
      diagnostics.blocked.push({eventId:event.id,reason});
      // Manual linking writes only metadata, never deletes or attributes another
      // known referee. A subsequent check is required to propose a withdrawal.
      if(scope.automatic&&knownOrigin(event)&&!p.voleyRoundFrom&&inRange&&data.home&&data.away){
        rows.push({key:'link:'+event.id,status:'doubtful',kind:'legacy-link',action:null,selected:false,event,game:data,candidates:[],differences:[],reason:`${reason} Puedes confirmar manualmente a qué árbitro y jornada pertenece; esto solo registrará su identificación.`});
      }
      continue;
    }
    if(scope.complete&&scope.extractionReliable){rows.push({key:'delete:'+event.id,status:'possible-delete',action:'delete',selected:false,event,game:data,differences:[],reason:'Ausente en la jornada declarada completa. Revisa el documento original antes de eliminar.'});diagnostics.proposed++;}
  }
  if(diagnostics.blocked.length)diagnostics.messages.push(`${diagnostics.blocked.length} evento(s) propio(s) sin correspondencia suficiente: revisa las vinculaciones manuales. No se eliminarán por ausencia.`);
  if(scope.complete&&scope.extractionReliable&&!diagnostics.proposed&&!diagnostics.blocked.length)diagnostics.messages.push('No hay eventos propios ausentes con pertenencia fiable a esta jornada. Comprueba que has seleccionado el mismo calendario de la importación original.');
  return {scope:structuredClone(scope),rows,diagnostics};
}
async function bindRow(row,event,scope){
  row.event=event;row.differences=differences(event,row.payload);
  row.manualConflict=!!privateData(event).voleyFingerprint && privateData(event).voleyFingerprint!==await fingerprint(event);
  row.status=row.differences.length?'modified':'unchanged';
  const p=privateData(event),versionOK=scope.automatic?p.voleyVersion==='4'&&belongsToRound(event,scope):['3','4'].includes(p.voleyVersion);
  row.action=row.differences.length?'update':p.voleyRound!==normalize(scope.round)||!versionOK||p.voleyOrigin!==origin||!matchesSource(event,row.sourceId)?'metadata':null;
  row.reason=row.manualConflict?'El contenido en Google cambió desde la última sincronización. Revisa ambos valores.':row.action==='metadata'?'Sin cambios de contenido. Puedes registrar esta jornada para futuras comprobaciones.':'';
}
export async function resolveRow(plan,key,choice) {
  const row=plan.rows.find(r=>r.key===key);if(!row||!['doubtful','new'].includes(row.status)||row.result?.status==='success')throw Error('La fila ya no admite resolución. Vuelve a comprobar los cambios.');
  if(row.kind==='legacy-link'){
    const data=matchData(row.event),evidence=normalize(privateData(row.event).voleyRef||data.referee);
    if(choice!=='link-unmatched'||!managed(row.event)||!knownOrigin(row.event)||evidence&&evidence!==normalize(plan.scope.referee)||data.date<plan.scope.from||data.date>plan.scope.to)throw Error('No se puede vincular este evento al árbitro y jornada seleccionados.');
    row.game={...data,referee:plan.scope.referee};row.payload={...row.event};row.sourceId=privateData(row.event).voleyId||row.event.id;
    row.action='metadata';row.status='unchanged';row.selected=false;row.reason='Vinculación confirmada manualmente. Solo se registrarán metadatos; después vuelve a comprobar los cambios.';return row;
  }
  if(choice==='new'){
    row.status='new';row.action='create';row.resolved=true;row.reason='Confirmado manualmente como partido nuevo.';
    // Never reuse an ID already occupied (including a cancelled event).
    if(row.candidates.some(e=>e.id===row.payload.id)||plan.rows.some(r=>r!==row&&r.payload?.id===row.payload.id))row.payload.id=await hash(['voley-restored',row.payload.id,key,...row.candidates.map(e=>[e.id,e.etag,e.updated])]);
  }else{
    const event=row.candidates.find(e=>e.id===choice);
    if(!event||event.status==='cancelled'||!safelyManaged(event,row,plan.scope))throw Error('Solo puedes vincular eventos gestionados por Voley Calendar y del mismo árbitro.');
    if(plan.rows.some(r=>r!==row&&r.event?.id===event.id&&r.action!=='delete'))throw Error('Este evento ya está vinculado a otro partido.');
    // Prevent a possible-delete row from targeting an explicitly bound event.
    plan.rows=plan.rows.filter(r=>!(r.action==='delete'&&r.event?.id===event.id));
    await bindRow(row,event,plan.scope);row.resolved=true;
  }
  row.selected=false;return row;
}

export function createSyncService({request,list,buildEvent}) {
  const plans=new WeakSet();
  async function checkChanges(games,scope,duration=120,reminder=0){
    if(!scope.calendar||!normalize(scope.referee)||!normalize(scope.round))throw Error('Selecciona calendario, árbitro e identificador de jornada.');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(scope.from)||!/^\d{4}-\d{2}-\d{2}$/.test(scope.to)||scope.from>scope.to)throw Error('Introduce un intervalo de jornada válido.');
    const base=`calendars/${encodeURIComponent(scope.calendar)}/events`,entries=[];
    for(const game of games)entries.push({game:structuredClone(game),payload:await buildEvent(game,duration,reminder)});
    const begin=Date.parse(scope.from+'T00:00:00Z')-14*86400000,end=Date.parse(scope.to+'T00:00:00Z')+15*86400000;
    if(!Number.isFinite(begin)||!Number.isFinite(end)||new Date(begin+14*86400000).toISOString().slice(0,10)!==scope.from||new Date(end-15*86400000).toISOString().slice(0,10)!==scope.to||end-begin>400*86400000)throw Error('El intervalo debe ser válido y no superar un año.');
    let events=await list(base,{singleEvents:'true',showDeleted:'true',maxResults:'2500',timeMin:new Date(begin).toISOString(),timeMax:new Date(end).toISOString()});
    events.push(...await list(base,{privateExtendedProperty:`voleyRound=${normalize(scope.round)}`,showDeleted:'true',maxResults:'2500'}));
    for(const {payload}of entries){
      for(const property of ['voleyId','voleySource','voleyLatestSource']){
        events.push(...await list(base,{privateExtendedProperty:`${property}=${payload.id}`,showDeleted:'true',maxResults:'2500'}));
      }
      if(!events.some(e=>matchesSource(e,payload.id))){
        try{events.push(await request(`${base}/${payload.id}`));}catch(e){if(e.status===410)events.push({id:payload.id,status:'cancelled'});else if(e.status!==404)throw e;}
      }
    }
    events=[...new Map(events.map(e=>[e.id,e])).values()];
    if(scope.automatic&&(scope.intervalSource==='matches'||scope.intervalSource==='confirmed'&&scope.confirmationBasedOnMatches)){
      const known=events.filter(event=>managed(event)&&sameRef(event,scope.referee)&&privateData(event).voleyRoundFrom<=scope.from&&privateData(event).voleyRoundTo>=scope.to&&privateData(event).voleyCompetitionScope===normalize(scope.competitionScope||'VOLEIBOL')&&entries.some(entry=>equalMatch(event,entry.game)));
      const ranges=[...new Map(known.map(event=>{const p=privateData(event);return [p.voleyRoundFrom+'/'+p.voleyRoundTo,{from:p.voleyRoundFrom,to:p.voleyRoundTo}];})).values()];
      if(ranges.length>1){const error=Error('Hay varias jornadas previas compatibles. Confirma el intervalo antes de comparar.');error.intervals=ranges;throw error;}
      if(ranges.length===1){scope={...scope,...ranges[0],reusedInterval:true};scope.round=automaticRoundKey(scope);}
    }
    const plan=await compareChanges(entries,events,scope);plan.diagnostics.queryFrom=new Date(begin).toISOString();plan.diagnostics.queryTo=new Date(end).toISOString();plans.add(plan);return plan;
  }
  async function applyChanges(plan,keys,{confirmDeletions=false,retryOnly=false,report=()=>{}}={}){
    if(!plans.has(plan))throw Error('Comprueba los cambios de nuevo antes de aplicar.');
    const selected=plan.rows.filter(row=>keys.includes(row.key));
    if(!selected.length)throw Error('Selecciona al menos un cambio.');
    if(selected.some(row=>!row.action||row.status==='doubtful'))throw Error('Resuelve las coincidencias dudosas antes de aplicar.');
    if(retryOnly&&selected.some(row=>row.result?.status!=='error'))throw Error('Solo se pueden reintentar operaciones fallidas.');
    if(selected.some(row=>row.action==='delete')&&!confirmDeletions)throw Error('Confirma explícitamente las eliminaciones seleccionadas.');
    const base=`calendars/${encodeURIComponent(plan.scope.calendar)}/events`,results=[];
    for(const row of selected){
      if(row.result?.status==='success'){results.push(row.result);continue;}
      report({row,status:'working'});
      try{
        let saved;
        if(row.action==='create'){
          const payload={...row.payload,extendedProperties:{private:await metadata(row.game,row.payload,{round:plan.scope.round,sourceId:row.sourceId,scope:plan.scope})}};
          // Idempotent insert ID is retained on every retry.
          try{saved=await request(base,{method:'POST',body:JSON.stringify(payload)});}catch(e){if(e.status!==409)throw e;saved=await request(`${base}/${payload.id}`);if(!managed(saved)||differences(saved,payload).length)throw Error('El evento ya existe con diferencias. Vuelve a comprobar los cambios.');}
          if(!saved.id||saved.status==='cancelled')throw Error('Google no confirmó la creación.');
        }else{
          const previous=row.event;if(!managed(previous)||!safelyManaged(previous,row,plan.scope))throw Error('El evento no está identificado de forma fiable como gestionado por Voley Calendar.');
          if(!previous.etag)throw Error('Google no devolvió un ETag. Comprueba de nuevo antes de modificar.');
          const path=`${base}/${encodeURIComponent(previous.id)}`;
          let current;
          try{current=await request(path);}catch(e){if(row.action==='delete'&&[404,410].includes(e.status)){row.result={rowKey:row.key,status:'success',detail:'Ya eliminado'};results.push(row.result);report({row,...row.result});continue;}throw e;}
          if(row.action==='delete'&&current.status==='cancelled'){row.result={rowKey:row.key,status:'success',detail:'Ya eliminado'};results.push(row.result);report({row,...row.result});continue;}
          if(current.status==='cancelled')throw Error('El evento fue eliminado. Comprueba de nuevo; no se recreará automáticamente.');
          const properties=row.action==='delete'?{}:await metadata(row.game,row.payload, {round:plan.scope.round,previous:current,sourceId:row.sourceId,scope:plan.scope});
          const expected={...(row.action==='update'?contentPatch(row.payload):{}),extendedProperties:{private:properties}};
          // Recover a lost successful PATCH response without writing again.
          const alreadyApplied=row.action!=='delete'&&!differences(current,row.payload).length&&privateData(current).voleyFingerprint===properties.voleyFingerprint&&privateData(current).voleyRound===properties.voleyRound&&privateData(current).voleyVersion===(plan.scope.automatic?'4':properties.voleyVersion)&&privateData(current).voleyOrigin===origin&&matchesSource(current,row.sourceId);
          if(alreadyApplied){saved=current;}
          else{
            if(current.etag!==previous.etag)throw Error('Conflicto 412: el evento cambió después de la vista previa. Comprueba de nuevo.');
            if(!managed(current))throw Error('El evento dejó de estar gestionado por Voley Calendar.');
            if(row.action==='delete'){
              if(!plan.scope.complete||!plan.scope.extractionReliable||!belongsToRound(current,plan.scope)||!knownOrigin(current)||!sameRef(current,plan.scope.referee))throw Error('No se cumplen las condiciones para eliminar este evento.');
              await request(path,{method:'DELETE',headers:{'If-Match':previous.etag}});saved={id:previous.id,status:'cancelled'};
            }else saved=await request(path,{method:'PATCH',headers:{'If-Match':previous.etag},body:JSON.stringify(expected)});
          }
          if(!saved?.id)throw Error('Google no confirmó la operación.');
        }
        row.result={rowKey:row.key,status:'success',detail:row.action==='create'?'Creado':row.action==='delete'?'Eliminado':row.action==='metadata'?'Identificación registrada':'Actualizado'};
      }catch(e){row.result={rowKey:row.key,status:'error',detail:e.message};}
      results.push(row.result);report({row,...row.result});
    }
    return results;
  }
  return {checkChanges,applyChanges,resolveRow:(plan,key,choice)=>{if(!plans.has(plan))throw Error('Vista previa no válida.');return resolveRow(plan,key,choice);}};
}
const contentPatch=payload=>({summary:payload.summary,start:payload.start,end:payload.end,location:payload.location,description:payload.description});
