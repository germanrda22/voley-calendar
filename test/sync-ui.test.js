import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setupSyncUI,formatSyncDiagnostics} from '../src/sync-ui.js';

function ui(games,serviceOverrides={}){
  const ids=['duration','reminder','syncComplete','syncIntervalInfo','syncIntervalWarning','syncIntervalConfirmation','syncConfirmFrom','syncConfirmTo','confirmSyncInterval','checkSync','applySync','retrySync','syncRows','syncStatus','syncSummary','syncDiagnostics'];
  const node=()=>({dataset:{},children:[],value:'',checked:false,hidden:false,textContent:'',replaceChildren(...children){this.children=children;},append(...children){this.children.push(...children);}});
  const elements=Object.fromEntries(ids.map(id=>[id,node()]));
  elements.duration.value='120';elements.reminder.value='0';const scopes=[];
  const controller=setupSyncUI({document:{createElement:node,createTextNode:text=>({textContent:text}),getElementById:id=>{assert(id in elements,`Campo inesperado: ${id}`);return elements[id];}},getGames:()=>games,getContext:()=>({calendar:'test',referee:'Germán Ruiz',extractionReliable:true}),setBusy:()=>{},canUse:()=>true,service:{checkChanges:async(_games,scope)=>{scopes.push(scope);return {scope,rows:[]};},...serviceOverrides}});
  return {controller,e:elements,scopes};
}
test('interfaz sin códigos ni fechas visibles cuando la cabecera es válida',async()=>{
  const {controller,e,scopes}=ui([{date:'2026-10-17'}]);
  controller.suggest([]);assert(e.syncIntervalConfirmation.hidden);
  controller.setDocument([{date:'2026-10-17'}],[{from:'2026-10-12',to:'2026-10-18'}]);
  assert(e.syncIntervalConfirmation.hidden);assert.match(e.syncIntervalInfo.textContent,/2026-10-12 al 2026-10-18/);
  await e.checkSync.onclick();assert.equal(scopes.length,1);assert(scopes[0].automatic);assert.equal(scopes[0].from,'2026-10-12');
});

test('una reconexión con los mismos datos conserva resultados y reintenta solo fallidos',async()=>{
  const games=[{date:'2026-10-17'}];let plan,applied;
  const {controller,e}=ui(games,{checkChanges:async(_games,scope)=>{
    plan={scope,rows:[
      {key:'created',status:'new',action:'create',selected:false,game:games[0],candidates:[],result:{status:'success',detail:'Creado'}},
      {key:'failed',status:'new',action:'create',selected:false,game:games[0],candidates:[],result:{status:'error',detail:'401: reconecta'}}
    ]};return plan;
  },applyChanges:async(_plan,keys,options)=>{applied={keys,options};}});
  controller.setDocument(games,[{from:'2026-10-12',to:'2026-10-18'}]);await controller.check();
  const checked=controller.checkedSignature();controller.invalidate();controller.refresh();
  assert(controller.hasResults());assert.equal(controller.signature(),checked);assert(!e.retrySync.hidden);
  await e.retrySync.onclick();assert.deepEqual(applied.keys,['failed']);assert(applied.options.retryOnly);
  assert.equal(plan.rows[0].result.status,'success');
});

test('selección ICS y renderizados no invalidan una vista previa ya comprobada',async()=>{
  const games=[{date:'2026-10-17',selected:true,reviewed:false}];const {controller,e,scopes}=ui(games);
  controller.setDocument(games,[{from:'2026-10-12',to:'2026-10-18'}]);await controller.check();
  const signature=controller.signature(),status=e.syncStatus.textContent;
  games[0].selected=false;games[0].reviewed=true;controller.invalidate();
  assert.equal(controller.signature(),signature);assert.equal(e.syncStatus.textContent,status);assert.equal(scopes.length,1);
  games[0].venue='Pabellón corregido';controller.invalidate();assert.match(e.syncStatus.textContent,/datos han cambiado/);
});

test('descarta una respuesta si se edita el partido mientras se consulta',async()=>{
  let release,scope;const games=[{date:'2026-10-17',venue:'Original'}];
  const {controller,e}=ui(games,{checkChanges:(_games,context)=>{scope=context;return new Promise(resolve=>release=resolve);}});
  controller.setDocument(games,[{from:'2026-10-12',to:'2026-10-18'}]);const request=controller.check();games[0].venue='Corregido';release({scope,rows:[]});await request;
  assert.match(e.syncStatus.textContent,/cambiaron durante la consulta/);assert.equal(e.syncSummary.textContent,'');assert(e.applySync.disabled);
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
