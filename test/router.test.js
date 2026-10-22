import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {setupRouter,resolveRoute} from '../src/router.js';

function ui(path='/',access=true){
  const events={},windowEvents={},history=[path];let index=0;
  const view=pages=>({dataset:{pages},hidden:false});
  const views=[view('/'),view('/nueva /revision'),view('/nueva'),view('/revision'),view('not-found')];
  const links=['/','/nueva','/revision'].map(path=>({href:'https://voley.test'+path,attributes:{},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];},hasAttribute(){return false;}}));
  const elements=Object.fromEntries(['pageTitle','pageDescription','navigationNotice'].map(id=>[id,{textContent:'',hidden:false,focus(){this.focused=true;}}]));
  const location={pathname:path,href:'https://voley.test'+path,origin:'https://voley.test'};
  const setPath=path=>{location.pathname=path;location.href=location.origin+path;};
  const doc={body:{dataset:{}},querySelectorAll:s=>s==='[data-pages]'?views:links,getElementById:id=>elements[id],addEventListener:(k,v)=>events[k]=v,removeEventListener:k=>delete events[k]};
  const win={location,scrollTo(){},history:{pushState(_s,_t,path){history.splice(++index);history.push(path);setPath(path);}},addEventListener:(k,v)=>windowEvents[k]=v,removeEventListener:k=>delete windowEvents[k]};
  let work=false,busy=false;
  const router=setupRouter({document:doc,window:win,hasAccess:()=>access,hasWork:()=>work,isBusy:()=>busy});
  return {router,doc,win,views,links,e:elements,events,windowEvents,setWork:v=>work=v,setBusy:v=>busy=v,back(){setPath(history[--index]);windowEvents.popstate();},forward(){setPath(history[++index]);windowEvents.popstate();}};
}

test('inicio, enlaces y rutas directas separan importación y revisión',()=>{
  const u=ui();assert(!u.views[0].hidden);assert(u.views[1].hidden);
  u.router.navigate('/nueva');assert(!u.views[1].hidden);assert(!u.views[2].hidden);assert(u.views[3].hidden);assert.equal(u.links[1].attributes['aria-current'],'page');
  u.router.navigate('/revision');assert(u.views[2].hidden);assert(!u.views[3].hidden);assert.equal(u.doc.title,'Revisión automática · Voley Calendar');assert(u.e.pageTitle.focused);
  for(const path of ['/nueva','/revision','/revision/']){const direct=ui(path);assert.equal(direct.doc.body.dataset.page,resolveRoute(path));assert(!direct.views[1].hidden);}
});

test('sin autorización ni modo ICS las rutas protegidas muestran el acceso',()=>{
  for(const path of ['/nueva','/revision']){const u=ui(path,false);assert.equal(u.doc.body.dataset.page,'/');assert(!u.views[0].hidden);assert(u.views[1].hidden);}
});

test('atrás y adelante conservan controles, trabajo y avisos sin reinicializar listeners',()=>{
  const u=ui('/nueva'),control=u.views[1];control.edited='Pabellón corregido';u.setWork(true);
  const handler=u.events.click;u.router.navigate('/revision');assert.match(u.e.navigationNotice.textContent,/se conservan/);
  u.back();assert.equal(u.doc.body.dataset.page,'/nueva');assert.equal(u.views[1],control);assert.equal(control.edited,'Pabellón corregido');
  u.forward();assert.equal(u.doc.body.dataset.page,'/revision');assert.equal(u.events.click,handler);
  let prevented=false;u.windowEvents.beforeunload({preventDefault(){prevented=true;}});assert(prevented);
  u.setBusy(true);u.router.navigate('/');assert.match(u.e.navigationNotice.textContent,/operación en curso/);
  u.router.destroy();assert.deepEqual(u.events,{});assert.deepEqual(u.windowEvents,{});
});

test('solo intercepta navegación local normal; respeta teclas, enlaces externos y misma ruta',()=>{
  const u=ui();let prevented=false;
  const click=(link,extra={})=>u.events.click({target:{closest:()=>link},button:0,preventDefault(){prevented=true;},...extra});
  click(u.links[1],{ctrlKey:true});assert(!prevented);assert.equal(u.win.location.pathname,'/');
  click({...u.links[1],href:'https://otro.test/nueva'});assert(!prevented);
  click(u.links[1]);assert(prevented);assert.equal(u.win.location.pathname,'/nueva');
  u.router.navigate('/nueva');u.back();assert.equal(u.win.location.pathname,'/');
  u.router.navigate('/desconocida');assert(!u.views[4].hidden);assert(u.views[1].hidden);
});

test('salir sin trabajo no avisa; recargar durante una operación sí',()=>{
  const u=ui('/revision');let prevented=false;
  const e={preventDefault(){prevented=true;}};u.windowEvents.beforeunload(e);assert(!prevented);
  u.setBusy(true);u.windowEvents.beforeunload(e);assert(prevented);assert.equal(e.returnValue,'');
});

test('Vercel conserva las rutas directas y la plantilla tiene IDs únicos y un solo arranque',()=>{
  const config=JSON.parse(fs.readFileSync('vercel.json','utf8'));
  for(const source of ['/nueva','/revision'])assert(config.rewrites.some(r=>r.source===source&&r.destination==='/index.html'));
  const html=fs.readFileSync('index.html','utf8'),ids=[...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);
  assert.equal((html.match(/src="\/app.js"/g)||[]).length,1);
  assert.match(html,/id="syncRound"/);
  assert(!html.includes('id="syncRows"'));
  assert.match(html,/href="\/style.css"/);
});
