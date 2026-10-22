import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAutoCheck} from '../src/auto-check.js';

function clock(){
  let next=0;const tasks=new Map();
  return {setTimer(fn){tasks.set(++next,fn);return next;},clearTimer(id){tasks.delete(id);},get size(){return tasks.size;},async tick(){const task=tasks.entries().next().value;if(!task)return;tasks.delete(task[0]);await task[1]();}};
}
test('no consulta sin PDF, árbitro, autorización y calendario válidos',async()=>{
  const time=clock();let key=null,calls=0;
  const auto=createAutoCheck({...time,getKey:()=>key,check:async()=>calls++});
  auto.schedule();await time.tick();assert.equal(calls,0);
  key='documento|german|calendario|sesion';auto.schedule();await time.tick();assert.equal(calls,1);
  key=null;auto.schedule();await time.tick();assert.equal(calls,1);
});
test('agrupa cambios, renderizados y navegación sin repetir consultas',async()=>{
  const time=clock();let calls=0,key='A';
  const auto=createAutoCheck({...time,getKey:()=>key,check:async()=>calls++});
  for(let i=0;i<20;i++)auto.schedule();assert.equal(time.size,1);
  await time.tick();assert.equal(calls,1);assert.equal(time.size,0);
  for(let i=0;i<20;i++)auto.schedule();await time.tick();assert.equal(calls,1);
  key='B';auto.schedule();key='C';auto.schedule();await time.tick();assert.equal(calls,2);
  auto.schedule({force:true});await time.tick();assert.equal(calls,3);
});
test('serializa consultas y procesa solo la última edición pendiente',async()=>{
  const time=clock();let key='A',release;const calls=[];
  const auto=createAutoCheck({...time,getKey:()=>key,check:()=>{calls.push(key);return calls.length===1?new Promise(resolve=>release=resolve):Promise.resolve();}});
  auto.schedule();const running=time.tick();key='B';auto.schedule();key='C';auto.schedule();
  assert.deepEqual(calls,['A']);assert.equal(time.size,0);release();await running;await time.tick();assert.deepEqual(calls,['A','C']);
});
test('errores no provocan bucles; permite reintentar y reconectar',async()=>{
  const time=clock();let key='sesion1',calls=0,errors=0;
  const auto=createAutoCheck({...time,getKey:()=>key,check:async()=>{calls++;throw Error('401');},onError:()=>errors++});
  auto.schedule();await time.tick();auto.schedule();await time.tick();assert.equal(calls,1);assert.equal(errors,1);
  auto.schedule({force:true});await time.tick();assert.equal(calls,2);
  key='sesion2';auto.schedule();await time.tick();assert.equal(calls,3);
  auto.reset();auto.schedule();await time.tick();assert.equal(calls,4);
});
test('cancelar o cambiar al modo ICS impide ejecutar una consulta pendiente',async()=>{
  const time=clock();let key='google',calls=0;
  const auto=createAutoCheck({...time,getKey:()=>key,check:async()=>calls++});
  auto.schedule();key=null;await time.tick();assert.equal(calls,0);
  key='google';auto.schedule();auto.cancel();await time.tick();assert.equal(calls,0);
  auto.schedule();auto.destroy();await time.tick();assert.equal(calls,0);
});

test('preserva resultados al reconectar y permite una nueva comprobación explícita',async()=>{
  const time=clock();let calls=0,hasResults=false,session=1;
  const auto=createAutoCheck({...time,getKey:({force}={})=>hasResults&&!force?null:'datos|'+session,check:async()=>calls++});
  auto.schedule();await time.tick();assert.equal(calls,1);
  hasResults=true;session++;auto.schedule();await time.tick();assert.equal(calls,1);
  auto.schedule({force:true});await time.tick();assert.equal(calls,2);
});
