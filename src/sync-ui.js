import {managed,matchData} from './sync.js';
import {detectRound,confirmRound,automaticScope} from './round.js';

const labels={new:'Nuevo',unchanged:'Sin cambios',modified:'Modificado','possible-delete':'Posible retirada',doubtful:'Coincidencia dudosa'};
const fieldLabels={summary:'Equipos y función',start:'Inicio',end:'Finalización',location:'Pabellón',description:'Categoría, competición y árbitros'};
const formatDate=value=>{if(!value)return '—';try{return new Intl.DateTimeFormat('es-ES',{timeZone:'Europe/Madrid',dateStyle:'short',timeStyle:'short'}).format(new Date(value));}catch{return value;}};
export function formatSyncDiagnostics(plan){
  const d=plan?.diagnostics;if(!d)return '';
  return [`Jornada: ${plan.scope.from} al ${plan.scope.to}.`,`${d.queried} eventos consultados · ${d.managed} de Voley Calendar · ${d.forReferee} del árbitro · ${d.matched} vinculados al PDF · ${d.proposed} posibles eliminaciones.`,d.queryFrom&&`Consulta por intervalo: ${d.queryFrom} — ${d.queryTo} (incluye margen y búsquedas por metadatos).`,...d.messages].filter(Boolean).join('\n');
}
export function setupSyncUI({service,getGames,getContext,setBusy,canUse,onChange=()=>{},onUpdate=()=>{},document:doc=document}){
  const $=id=>doc.getElementById(id);let plan=null,working=false,signature='',detected=detectRound([]),confirmed=null,hasDocument=false;
  const currentSignature=()=>JSON.stringify({games:getGames().map(({selected,reviewed,...game})=>game),scope:scope(),duration:$('duration').value,reminder:$('reminder').value});
  const scope=()=>automaticScope(confirmed||detected,{...getContext(),complete:$('syncComplete').checked});
  function intervalInfo(range=confirmed||detected){
    if(!hasDocument){$('syncIntervalInfo').textContent='Sube un PDF para detectar la jornada.';$('syncIntervalWarning').textContent='';$('syncIntervalConfirmation').hidden=true;return;}
    $('syncIntervalInfo').textContent=range.from&&range.to?`Jornada: ${range.from} al ${range.to} · ${range.reusedInterval?'Intervalo conservado de Google':range.source==='header'?'Cabecera del PDF':range.source==='confirmed'?'Intervalo confirmado':'Fechas de los partidos'}`:'No hay un intervalo de jornada identificable.';
    $('syncIntervalWarning').textContent=range.warnings.join(' ');
    $('syncIntervalConfirmation').hidden=!hasDocument||!detected.needsConfirmation||!!confirmed;
  }
  function invalidate({force=false}={}){
    if(!working&&plan){
      let same=false;try{same=!force&&signature===currentSignature();}catch{/* Datos pendientes de revisión. */}
      if(!same){plan=null;$('syncRows').replaceChildren();$('syncSummary').textContent='';$('syncDiagnostics').textContent='';$('syncStatus').textContent='Los datos han cambiado. La comparación se actualizará cuando los datos sean válidos.';}
    }
    refresh();onChange();
  }
  function refresh(){
    $('checkSync').disabled=working||!canUse();
    $('applySync').disabled=working||!canUse()||!plan||!plan.rows.some(r=>r.selected&&r.action&&r.result?.status!=='success');
    $('retrySync').disabled=working||!canUse()||!plan||!plan.rows.some(r=>r.result?.status==='error');
    $('retrySync').hidden=!plan?.rows.some(r=>r.result?.status==='error');
    for(const id of ['syncConfirmFrom','syncConfirmTo','confirmSyncInterval','syncComplete'])$(id).disabled=working;
    onUpdate();
  }
  function summary(){
    if(!plan)return;
    const counts=Object.fromEntries(Object.keys(labels).map(key=>[key,plan.rows.filter(r=>r.status===key).length]));
    const success=plan.rows.filter(r=>r.result?.status==='success').length,errors=plan.rows.filter(r=>r.result?.status==='error').length;
    $('syncSummary').textContent=Object.entries(counts).map(([key,n])=>`${labels[key]}: ${n}`).join(' · ')+` · Aplicadas: ${success} · Errores: ${errors}`;
  }
  function render(){
    $('syncRows').replaceChildren();$('syncDiagnostics').textContent=formatSyncDiagnostics(plan);if(!plan){$('syncSummary').textContent='';return;}
    for(const row of plan.rows){
      const article=doc.createElement('article');article.className='game sync-row';article.dataset.status=row.status;
      const label=doc.createElement('label'),checkbox=doc.createElement('input');checkbox.type='checkbox';checkbox.className='inline-check';checkbox.checked=!!row.selected;checkbox.disabled=working||!row.action||row.status==='doubtful'||row.result?.status==='success';
      checkbox.onchange=()=>{row.selected=checkbox.checked;refresh();};
      label.className='sync-status';label.append(checkbox,doc.createTextNode(` ${labels[row.status]}${row.action==='metadata'?' · Registrar identificación de jornada':''}`));article.append(label);
      const info=doc.createElement('p'),data=row.game||matchData(row.event);info.textContent=`${data.home||'—'} vs ${data.away||'—'} · ${data.category||'Sin categoría'} · ${data.role||'Sin función'} · ${data.date||''} ${data.time||''} · ${data.venue||row.event?.location||''}`;article.append(info);
      if(row.reason){const note=doc.createElement('p');note.className='warning';note.textContent=row.reason;article.append(note);}
      const before=row.event,after=row.payload;
      const table=doc.createElement('div');table.className='sync-comparison';
      const values={summary:after?.summary,start:after?.start?.dateTime,end:after?.end?.dateTime,location:after?.location,description:after?.description};
      for(const field of Object.keys(fieldLabels)){
        const block=doc.createElement('div');if(row.differences?.some(d=>d.field===field))block.className='sync-difference';
        const name=doc.createElement('strong');name.textContent=fieldLabels[field];
        const oldValue=field==='start'||field==='end'?before?.[field]?.dateTime||before?.[field]?.date:before?.[field];
        const oldText=doc.createElement('p'),newText=doc.createElement('p');
        oldText.textContent='Anterior: '+(field==='start'||field==='end'?formatDate(oldValue):oldValue||'—');
        newText.textContent='Nuevo: '+(field==='start'||field==='end'?formatDate(values[field]):values[field]||'—');block.append(name,oldText,newText);table.append(block);
      }
      const comparison=doc.createElement('details'),comparisonTitle=doc.createElement('summary');comparisonTitle.textContent='Ver comparación del evento';comparison.open=row.status==='modified'||row.status==='possible-delete';comparison.append(comparisonTitle,table);article.append(comparison);
      if(row.kind==='legacy-link'&&row.action===null){
        const link=doc.createElement('button');link.className='secondary';link.textContent='Vincular manualmente este evento a la jornada';link.disabled=working;
        link.onclick=async()=>{
          if(!window.confirm(`¿Confirmas que «${row.event.summary}» pertenece a ${plan.scope.referee} y a la jornada ${plan.scope.from} al ${plan.scope.to}? Solo se preparará el registro de metadatos, sin eliminar el evento.`))return;
          try{await service.resolveChange(plan,row.key,'link-unmatched');render();}catch(e){$('syncStatus').textContent=e.message;}
        };article.append(link);
      }else if(row.status==='doubtful'||row.status==='new'&&row.candidates.length){
        const select=doc.createElement('select');select.add(new Option('Selecciona una resolución manual',''));
        for(const candidate of row.candidates){const option=new Option(`${candidate.status==='cancelled'?'Eliminado':managed(candidate)?'Voley Calendar':'Evento ajeno / sin identificación'}: ${candidate.summary||candidate.id} · ${formatDate(candidate.start?.dateTime)} · ${candidate.location||''}`,candidate.id);option.disabled=!managed(candidate)||candidate.status==='cancelled';select.add(option);}
        select.add(new Option('Confirmo que es un partido nuevo / deseo recrearlo','new'));
        const resolve=doc.createElement('button');resolve.className='secondary';resolve.textContent='Confirmar correspondencia';resolve.disabled=working;
        resolve.onclick=async()=>{
          if(!select.value)return;
          if(select.value==='new'&&!window.confirm('¿Confirmas que es un partido distinto o que deseas recrearlo? Se podrá crear un evento nuevo tras seleccionarlo y aplicar los cambios.'))return;
          try{await service.resolveChange(plan,row.key,select.value);render();}catch(e){$('syncStatus').textContent=e.message;}
        };article.append(select,resolve);
      }
      if(row.result){const result=doc.createElement('p');result.className=row.result.status==='error'?'warning':'ok';result.textContent=row.result.detail;article.append(result);}
      $('syncRows').append(article);
    }
    summary();refresh();
  }
  async function check(){
    if(working)return;
    try{
      const games=structuredClone(getGames()),context=scope(),duration=Number($('duration').value),reminder=Number($('reminder').value);
      if(!Number.isInteger(reminder)||reminder<0||reminder>10080)throw Error('Revisa el recordatorio antes de comprobar los cambios.');
      signature=currentSignature();working=true;setBusy(true);refresh();$('syncStatus').textContent='Consultando Google. Esta comprobación no modifica eventos…';
      const result=await service.checkChanges(games,context,duration,reminder);
      let same=false;try{same=signature===currentSignature();}catch{/* El documento o las ediciones cambiaron durante la consulta. */}
      if(!same){plan=null;$('syncStatus').textContent='Los datos cambiaron durante la consulta. Se preparará otra comparación cuando sean válidos.';return;}
      plan=result;
      intervalInfo(plan.scope);
      $('syncStatus').textContent='Vista previa preparada. Consulta el diagnóstico y revisa las operaciones. No se ha modificado Google.';
    }catch(e){plan=null;$('syncStatus').textContent=e.message;if(e.intervals){detected={...detected,needsConfirmation:true,warnings:[e.message]};confirmed=null;$('syncConfirmFrom').value=e.intervals[0].from;$('syncConfirmTo').value=e.intervals[0].to;intervalInfo();}}
    finally{working=false;setBusy(false);render();refresh();}
  }
  async function apply(retryOnly=false){
    if(working||!plan)return;
    try{
      if(currentSignature()!==signature){invalidate();throw Error('Los datos han cambiado. Comprueba los cambios otra vez.');}
      const rows=plan.rows.filter(row=>retryOnly?row.result?.status==='error':row.selected&&row.result?.status!=='success');
      if(!rows.length)throw Error('Selecciona al menos una operación.');
      const deletions=rows.filter(row=>row.action==='delete');
      const confirmed=!deletions.length||window.confirm(`Vas a eliminar ${deletions.length} evento(s) de Google Calendar:\n${deletions.map(r=>`${r.event.summary} · ${formatDate(r.event.start?.dateTime)}`).join('\n')}\n¿Confirmas estas eliminaciones?`);
      if(!confirmed)return;
      working=true;setBusy(true);render();$('syncStatus').textContent='Aplicando únicamente las operaciones confirmadas…';
      await service.applyChanges(plan,rows.map(row=>row.key),{confirmDeletions:!!deletions.length,retryOnly,report:result=>{$('syncStatus').textContent=result.status==='working'?`Procesando: ${result.row.game?.home||result.row.event?.summary||''}`:result.detail;}});
      $('syncStatus').textContent='Proceso terminado. Revisa los resultados. Los conflictos requieren volver a comprobar los cambios.';
    }catch(e){$('syncStatus').textContent=e.message;}
    finally{working=false;setBusy(false);render();refresh();}
  }
  $('checkSync').onclick=check;$('applySync').onclick=()=>apply();$('retrySync').onclick=()=>apply(true);
  $('syncComplete').onchange=invalidate;
  $('confirmSyncInterval').onclick=()=>{try{confirmed=confirmRound(detected,$('syncConfirmFrom').value,$('syncConfirmTo').value);invalidate();intervalInfo();$('syncStatus').textContent='Intervalo confirmado. Se puede preparar la comparación.';}catch(e){$('syncStatus').textContent=e.message;}};
  for(const id of ['syncConfirmFrom','syncConfirmTo'])$(id).oninput=()=>{confirmed=null;invalidate();};
  return {invalidate,refresh,check,getPlan:()=>plan,getScope:scope,signature:currentSignature,checkedSignature:()=>signature,hasResults:()=>!!plan?.rows.some(row=>row.result),setDocument(games,headers){hasDocument=true;detected=detectRound(games,headers);confirmed=null;$('syncConfirmFrom').value=detected.from;$('syncConfirmTo').value=detected.to;invalidate({force:true});intervalInfo();},suggest(games=[]){
    if(games.length&&!confirmed&&!detected.headers.length){const next=detectRound(games);if(!hasDocument||next.from!==detected.from||next.to!==detected.to||next.needsConfirmation!==detected.needsConfirmation){hasDocument=true;detected=next;$('syncConfirmFrom').value=next.from;$('syncConfirmTo').value=next.to;}}
    intervalInfo();
  }};
}
