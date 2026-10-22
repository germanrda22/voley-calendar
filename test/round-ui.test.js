import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';

test('pantalla única: PDF, árbitro, consulta automática, confirmación y resumen final sin revisión individual',async()=>{
  const originals=Object.fromEntries(['document','window','Option','localStorage','__roundUITest'].map(k=>[k,globalThis[k]]));
  const elements={};
  const node=()=>({value:'',disabled:false,textContent:'',hidden:false,children:[],replaceChildren(...children){this.children=children;this.value=children[0]?.value||'';},append(...children){this.children.push(...children);}});
  const html=fs.readFileSync('index.html','utf8');
  for(const [,id]of html.matchAll(/id="([^"]+)"/g))elements[id]=node();
  let connected=false,inspected=0,synced=0,confirmed=0,read;
  const inspectedSignal=new Promise(resolve=>read=resolve);
  const g={id:'one',date:'2026-10-24',time:'18:00',home:'Local',away:'Visitante',venue:'Pabellón',category:'Junior',competition:'Oro',scorer:'German Ruiz',first:'Otro árbitro',second:'',issues:[]};
  const service={isConnected:()=>connected,connect:async()=>{connected=true;return [{id:'target',summary:'Destino',primary:true}];},disconnect:()=>connected=false,
    inspectRound:async(games,scope)=>{inspected++;assert.equal(games.length,1);assert.equal(scope.from,'2026-10-19');queueMicrotask(read);return {replacing:1,new:1,unchanged:0,uncertain:[]};},
    synchronizeRound:async()=>{synced++;return {created:1,deleted:1,unchanged:0,preserved:0,errors:[],warnings:[]};}};
  try{
    globalThis.document={getElementById:id=>{assert(elements[id],id);return elements[id];}};
    globalThis.window={confirm:()=>{confirmed++;return true;},addEventListener(){}};
    globalThis.localStorage={getItem:()=>null,setItem(){}};
    globalThis.Option=class {constructor(text,value){this.text=text;this.value=value;}};
    globalThis.__roundUITest={service,readPDF:async()=>({games:[g],headers:[{from:'2026-10-19',to:'2026-10-25'}],scannedPages:[]})};
    let source=fs.readFileSync('app.js','utf8')
      .replace("import {readPDF} from './src/pdf.js';",'const {readPDF}=globalThis.__roundUITest;')
      .replace("import {createGoogleService,preferredCalendar} from './src/google.js';",'const createGoogleService=()=>globalThis.__roundUITest.service;const preferredCalendar=items=>items[0].id;')
      .replace('import.meta.env.VITE_GOOGLE_CLIENT_ID',"'test-client'");
    source=source.replace(/from '(\.\/[^']+)'/g,(_match,path)=>`from '${new URL(path,pathToFileURL(process.cwd()+'/')).href}'`);
    await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
    assert(elements.syncRound.disabled);
    assert.match(html,/<html lang="es">/);
    assert.match(html,/<label for="images">PDF de designaciones<\/label>/);
    assert.match(html,/id="selectPDF"[^>]*type="button"[^>]*>Seleccionar PDF<\/button>/);
    assert.match(html,/id="files"[^>]*aria-live="polite">Ningún archivo seleccionado/);
    let filePickerOpened=0;elements.images.click=()=>filePickerOpened++;
    elements.selectPDF.onclick();assert.equal(filePickerOpened,1);
    await elements.connect.onclick();
    const loading=elements.images.onchange({target:{files:[{name:'Jornada.pdf'}]}});
    assert(elements.selectPDF.disabled);elements.selectPDF.onclick();assert.equal(filePickerOpened,1);
    await loading;assert(!elements.selectPDF.disabled);
    assert.equal(elements.files.textContent,'Jornada.pdf');assert.equal(synced,0);
    elements.referee.value='German Ruiz';elements.referee.oninput();
    await inspectedSignal;
    // Allow the resolved inspection to update the DOM.
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(inspected,1);assert.equal(elements.existing.textContent,'1');assert(!elements.syncRound.disabled);
    await elements.syncRound.onclick();assert.equal(confirmed,1);assert.equal(synced,1);
    assert.match(elements.result.textContent,/Creados: 1 · Eliminados: 1/);
    assert(!html.includes('id="syncRows"'));assert(!html.includes('id="applySync"'));
    // Disconnect so the deferred post-sync refresh performs no further request.
    elements.disconnect.onclick();
  }finally{
    for(const [key,value]of Object.entries(originals)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
  }
});
