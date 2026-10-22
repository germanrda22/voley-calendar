import {test} from 'node:test';
import assert from 'node:assert/strict';
import {orderedGames,eventGame,prepareEvent,duplicateGroups} from '../src/prepare.js';
import {getDates} from '../src/calendar.js';
import {generateICS as createICS} from '../src/ics.js';

const game = overrides => ({id:crypto.randomUUID(),date:'2026-10-17',time:'10:00',home:'Equipo local',away:'Equipo visitante',venue:'Pabellón municipal',category:'Júnior',first:'Germán Ruiz',second:'Alba Jiménez',scorer:'Lucía Rojas',selected:true,...overrides});

test('ordena cronológicamente sin mutar los partidos y deja fechas inválidas al final',()=>{
  const later=game({date:'2026-10-18'}),early=game({time:'09:00'}),sameDay=game(),invalid=game({date:''}),other=game({first:'Otro árbitro'});
  const games=[later,invalid,sameDay,other,early];
  assert.deepEqual(orderedGames(games,'GERMAN RUIZ'),[early,sameDay,later,invalid]);
  assert.equal(games[0],later);
  early.time='13:00';assert.deepEqual(orderedGames(games,'Germán Ruiz'),[sameDay,early,later,invalid]);
});

test('prepara título, descripción, ubicación, zona horaria y duración predeterminada',async()=>{
  const g=game(),event=prepareEvent(g,'Germán Ruiz');
  assert.equal(event.summary,'🏐 Primer árbitro | Equipo local vs Equipo visitante');
  assert.equal(event.location,'Pabellón municipal');
  assert.equal(event.start.timeZone,'Europe/Madrid');
  assert.equal(event.start.dateTime,'2026-10-17T08:00:00.000Z');
  assert.equal(event.end.dateTime,'2026-10-17T10:00:00.000Z');
  assert.match(event.description,/Categoría: Júnior/);
  assert.match(event.description,/Función arbitral: Primer árbitro/);
  assert.match(event.description,/Segundo árbitro: Alba Jiménez/);
  assert.match(event.description,/Anotador: Lucía Rojas/);
  assert.doesNotMatch(event.description,/Primer árbitro: Germán Ruiz/);
  const ics=(await createICS([eventGame(g,'Germán Ruiz')],120)).replace(/\r\n /g,'');
  assert(ics.includes(`SUMMARY:${event.summary}`));assert(ics.includes(`LOCATION:${event.location}`));
  const missing=prepareEvent(game({second:'',scorer:''}),'Germán Ruiz');
  assert.doesNotMatch(missing.description,/Segundo árbitro:|Anotador:|undefined/);
});

test('duración propia, cambio de día y cambios estacionales usan minutos transcurridos',()=>{
  const g=game({time:'23:30',duration:150});
  assert.equal(prepareEvent(g,'Germán Ruiz',90).end.dateTime,'2026-10-18T00:00:00.000Z');
  assert.equal(+getDates(game({duration:''}),90).end-+getDates(game(),90).start,90*60000);
  const dst=getDates(game({date:'2026-10-25',time:'01:30',duration:120}));
  assert.equal(dst.end.toISOString(),'2026-10-25T01:30:00.000Z');
  for(const duration of [0,-1,1.5,'abc',1441])assert.throws(()=>prepareEvent(game({duration}),'Germán Ruiz'),/Duración/);
  assert.throws(()=>prepareEvent(game({date:'2026-02-30'}),'Germán Ruiz'),/Fecha/);
  assert.throws(()=>prepareEvent(game({time:'25:00'}),'Germán Ruiz'),/Fecha/);
});

test('duplicados entre seleccionados: normalización, horas, campos vacíos y grupos',()=>{
  const a=eventGame(game(),'Germán Ruiz'),b={...a,id:'second',home:'  EQUIPO  LOCAL ',referee:'GERMAN RUIZ',role:'Anotador',venue:'Otro pabellón'};
  assert.deepEqual(duplicateGroups([a,b]),[[a,b]]);
  assert.deepEqual(duplicateGroups([a,{...b,time:'11:00'}]),[]);
  assert.deepEqual(duplicateGroups([a,{...b,date:'2026-10-18'}]),[]);
  assert.deepEqual(duplicateGroups([a,{...b,referee:'Alba Jiménez'}]),[]);
  assert.deepEqual(duplicateGroups([{...a,home:''},{...b,home:''}]),[]);
  assert.deepEqual(duplicateGroups([a,{...b,selected:false}].filter(g=>g.selected)),[]);
  assert.deepEqual(duplicateGroups([a,{...b,date:''}]),[]);
});

test('conserva ediciones, duración, selección y funciones por árbitro al cambiar de filtro',()=>{
  const g=game();
  g.home='Local editado';g.duration=75;g.selected=false;
  g.roleOverrides={'GERMAN RUIZ':'Anotador','ALBA JIMENEZ':'Primer árbitro'};
  orderedGames([g],'Alba Jiménez');
  const restored=orderedGames([g],'Germán Ruiz')[0];
  assert.equal(restored,g);assert.equal(restored.home,'Local editado');assert.equal(restored.selected,false);
  assert.equal(prepareEvent(restored,'Germán Ruiz').summary,'🏐 Anotador | Local editado vs Equipo visitante');
  assert.match(prepareEvent(restored,'Alba Jiménez').summary,/Primer árbitro/);
  assert.equal(+getDates(restored).end-+getDates(restored).start,75*60000);
});
