import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setupSyncUI,formatSyncDiagnostics} from '../src/sync-ui.js';

function ui(games){
  const ids=['duration','reminder','syncComplete','syncIntervalInfo','syncIntervalWarning','syncIntervalConfirmation','syncConfirmFrom','syncConfirmTo','confirmSyncInterval','checkSync','applySync','retrySync','syncRows','syncStatus','syncSummary','syncDiagnostics'];
  const elements=Object.fromEntries(ids.map(id=>[id,{value:'',checked:false,hidden:false,textContent:'',replaceChildren(){}}]));
  elements.duration.value='120';elements.reminder.value='0';const scopes=[];
  const controller=setupSyncUI({document:{getElementById:id=>{assert(id in elements,`Campo inesperado: ${id}`);return elements[id];}},getGames:()=>games,getContext:()=>({calendar:'test',referee:'Germán Ruiz',extractionReliable:true}),setBusy:()=>{},canUse:()=>true,service:{checkChanges:async(_games,scope)=>{scopes.push(scope);return {scope,rows:[]};}}});
  return {controller,e:elements,scopes};
}
test('interfaz sin códigos ni fechas visibles cuando la cabecera es válida',async()=>{
  const {controller,e,scopes}=ui([{date:'2026-10-17'}]);
  controller.suggest([]);assert(e.syncIntervalConfirmation.hidden);
  controller.setDocument([{date:'2026-10-17'}],[{from:'2026-10-12',to:'2026-10-18'}]);
  assert(e.syncIntervalConfirmation.hidden);assert.match(e.syncIntervalInfo.textContent,/2026-10-12 al 2026-10-18/);
  await e.checkSync.onclick();assert.equal(scopes.length,1);assert(scopes[0].automatic);assert.equal(scopes[0].from,'2026-10-12');
});
test('interfaz solicita solo confirmar el intervalo ambiguo y lo reinicia con otro PDF',async()=>{
  const games=[{date:'2026-10-17'}],{controller,e,scopes}=ui(games);
  controller.setDocument(games,[]);assert(!e.syncIntervalConfirmation.hidden);
  await e.checkSync.onclick();assert.equal(scopes.length,0);assert.match(e.syncStatus.textContent,/Confirma/);
  e.syncConfirmFrom.value='2026-10-15';e.syncConfirmTo.value='2026-10-18';e.confirmSyncInterval.onclick();assert(e.syncIntervalConfirmation.hidden);
  await e.checkSync.onclick();assert.equal(scopes[0].from,'2026-10-15');
  controller.setDocument([{date:'2026-10-24'}],[{from:'2026-10-19',to:'2026-10-25'}]);assert.match(e.syncIntervalInfo.textContent,/2026-10-19 al 2026-10-25/);assert(e.syncIntervalConfirmation.hidden);
});
test('diagnóstico visible muestra intervalo, conteos y motivo para no ofrecer retiradas',()=>{
  const text=formatSyncDiagnostics({scope:{from:'2026-10-12',to:'2026-10-18'},diagnostics:{queried:6,managed:6,forReferee:6,matched:5,proposed:0,messages:['No se ha confirmado la integridad del documento.']}});
  assert.match(text,/2026-10-12 al 2026-10-18/);assert.match(text,/6 eventos consultados/);assert.match(text,/5 vinculados al PDF/);assert.match(text,/No se ha confirmado/);
});
