import {normalize} from './model.js';
import {validDay} from './round.js';
import {managed,privateData,sameRef,origin,hash,fingerprint,metadata,strongMatch,differences} from './sync.js';
import {duplicateGroups,prepareEvent} from './prepare.js';

export function validateRound(games,scope,duration=120){
  if(!scope.calendar||!normalize(scope.referee))throw Error('Selecciona árbitro y calendario.');
  if(!scope.extractionReliable||scope.documentPartial||scope.needsConfirmation||scope.deletionsAllowed===false||!scope.complete)throw Error('Sustitución bloqueada: PDF incompleto, ambiguo o con errores de extracción.');
  if(!validDay(scope.from)||!validDay(scope.to)||scope.from>scope.to||!scope.round||!scope.automatic)throw Error('No se ha identificado una jornada inequívoca.');
  for(const g of games){
    if(g.ambiguous||g.manual||g.issues?.length)throw Error('El PDF contiene partidos ambiguos o con errores.');
    for(const key of ['date','time','home','away','venue','category','role'])if(!g[key]?.trim())throw Error(`Partido incompleto: falta ${key}.`);
    if(normalize(g.referee)!==normalize(scope.referee)||g.date<scope.from||g.date>scope.to)throw Error('Partido fuera de la jornada o de otro árbitro.');
    prepareEvent(g,g.referee,duration);
  }
  if(duplicateGroups(games,duration).length)throw Error('El PDF contiene partidos duplicados.');
}
const own=event=>managed(event)&&(!privateData(event).voleyApp||privateData(event).voleyApp==='voley-calendar')&&(!privateData(event).voleyOrigin||privateData(event).voleyOrigin===origin);
const scoped=(event,scope)=>{
  const p=privateData(event);
  return own(event)&&sameRef(event,scope.referee)&&p.voleyRoundFrom===scope.from&&p.voleyRoundTo===scope.to&&p.voleyCompetitionScope===normalize(scope.competitionScope||'VOLEIBOL');
};
const reminderData=event=>({useDefault:event.reminders?.useDefault??true,overrides:[...(event.reminders?.overrides||[])].map(({method,minutes})=>({method,minutes})).sort((a,b)=>a.minutes-b.minutes||a.method.localeCompare(b.method))});
const matches=(a,b)=>!differences(a,b).length&&JSON.stringify(reminderData(a))===JSON.stringify(reminderData(b));
export function createRoundSync({request,list,buildEvent}){
  let working=false;
  const base=scope=>`calendars/${encodeURIComponent(scope.calendar)}/events`;
  async function inspect(games,scope,duration=120,reminder=0){
    validateRound(games,scope,duration);
    if(!Number.isInteger(reminder)||reminder<0||reminder>10080)throw Error('Recordatorio inválido.');
    const entries=[];
    for(const game of games)entries.push({game,payload:await buildEvent(game,duration,reminder)});
    const path=base(scope);
    const events=[...new Map((await list(path,{singleEvents:'true',showDeleted:'false',maxResults:'2500',timeMin:new Date(Date.parse(scope.from+'T00:00:00Z')-86400000).toISOString(),timeMax:new Date(Date.parse(scope.to+'T00:00:00Z')+2*86400000).toISOString()}))
      .concat(await list(path,{privateExtendedProperty:`voleyRef=${normalize(scope.referee)}`,showDeleted:'false',maxResults:'2500'})).map(e=>[e.id,e])).values()].filter(e=>e.status!=='cancelled');
    // Old imports without a stored interval are replaceable only when both
    // directions of the match are unique. Removed unscoped games stay untouched.
    const safe=events.filter(e=>scoped(e,scope)||own(e)&&!privateData(e).voleyRoundFrom&&entries.filter(x=>strongMatch(e,x.game,scope)).length===1&&entries.some(x=>strongMatch(e,x.game,scope)&&events.filter(other=>strongMatch(other,x.game,scope)).length===1));
    const used=new Set();
    for(const entry of entries){
      const existing=safe.find(e=>!used.has(e.id)&&matches(e,entry.payload));
      if(existing){entry.existing=existing;used.add(existing.id);}
    }
    const remove=safe.filter(e=>!used.has(e.id));
    const uncertain=events.filter(e=>!safe.includes(e)&&(!privateData(e).voleyRoundFrom||privateData(e).voleyRoundFrom===scope.from&&privateData(e).voleyRoundTo===scope.to)&&(!privateData(e).voleyRef||sameRef(e,scope.referee))&&(managed(e)||/🏐|voleibol|voley/i.test(e.summary||'')));
    return {scope,entries,remove,uncertain,existing:safe.length,new:entries.filter(e=>!e.existing).length,replacing:remove.length,unchanged:entries.filter(e=>e.existing).length};
  }
  async function synchronize(games,scope,duration=120,reminder=0){
    if(working)throw Error('Ya hay una sincronización en curso.');
    working=true;
    const result={created:0,deleted:0,unchanged:0,preserved:0,errors:[],warnings:[]};
    try{
      const plan=await inspect(structuredClone(games),structuredClone(scope),duration,reminder),path=base(scope);
      result.unchanged=plan.unchanged;result.preserved=plan.uncertain.length;
      if(plan.uncertain.length)result.warnings.push(`${plan.uncertain.length} evento(s) sin identificación segura se conservan.`);
      const verified=[];
      try{
        for(const entry of plan.entries){
          if(entry.existing){verified.push({id:entry.existing.id,payload:entry.payload});continue;}
          const sourceId=entry.payload.id,signature=await fingerprint(entry.payload);
          let saved;
          for(let generation=0;generation<100;generation++){
            const id=await hash(['voley-round-replacement',scope.round,normalize(scope.referee),sourceId,signature,entry.payload.reminders,generation]);
            const payload={...entry.payload,id,extendedProperties:{private:await metadata(entry.game,{...entry.payload,id},{sourceId,scope,round:scope.round})}};
            let found;
            try{found=await request(`${path}/${id}`);}catch(e){if(![404,410].includes(e.status))throw e;if(e.status===410)continue;}
            if(found?.status==='cancelled')continue;
            if(found){if(!scoped(found,scope)||!matches(found,payload))throw Error('El identificador está ocupado por un evento distinto.');saved=found;}
            else{
              try{saved=await request(path,{method:'POST',body:JSON.stringify(payload)});result.created++;}
              catch(e){
                // Reconcile 409 and lost responses using the deterministic ID.
                try{saved=await request(`${path}/${id}`);}catch{throw e;}
                if(!scoped(saved,scope)||!matches(saved,payload))throw e;
              }
            }
            if(!saved?.id||saved.status==='cancelled'||!scoped(saved,scope)||!matches(saved,payload))throw Error('Google no confirmó el evento nuevo.');
            verified.push({id,payload});break;
          }
          if(!saved)throw Error('No se ha podido reservar una identidad para el partido.');
        }
        // Barrier: every desired event must be readable and exact before any delete.
        for(const entry of verified){const current=await request(`${path}/${entry.id}`);if(current.status==='cancelled'||!own(current)||!sameRef(current,scope.referee)||!matches(current,entry.payload))throw Error('La verificación de los partidos nuevos ha fallado.');}
        // Preflight all old ETags before the first deletion.
        for(const previous of plan.remove){
          let current;try{current=await request(`${path}/${encodeURIComponent(previous.id)}`);}catch(e){if([404,410].includes(e.status))continue;throw e;}
          if(current.status==='cancelled')continue;
          if(!previous.etag||current.etag!==previous.etag||!own(current)||!sameRef(current,scope.referee))throw Error('Un evento anterior cambió durante la sincronización. Se conservan los anteriores.');
        }
      }catch(e){result.errors.push(e.message);result.warnings.push('No se ha eliminado ningún evento anterior. Los nuevos ya guardados se reutilizarán al reintentar.');return result;}
      for(const previous of plan.remove){
        try{await request(`${path}/${encodeURIComponent(previous.id)}`,{method:'DELETE',headers:{'If-Match':previous.etag}});result.deleted++;}
        catch(e){if(![404,410].includes(e.status))result.errors.push(`No se pudo eliminar ${previous.summary||previous.id}: ${e.message}`);}
      }
      return result;
    }finally{working=false;}
  }
  return {inspect,synchronize};
}
