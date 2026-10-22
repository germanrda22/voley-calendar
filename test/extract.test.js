import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractPage,deduplicateGames} from '../src/extract.js';
import {detectRound,automaticScope} from '../src/round.js';
import {compareChanges,createSyncService} from '../src/sync.js';
import {normalize} from '../src/model.js';
const item=(str,x,y=100)=>({str,transform:[1,0,0,4,x,y],width:5});
const row=(y=100)=>[item('Junior',90,y),item('Local',150,y),item('Visitante',250,y),item('Pabellón',330,y),item('23/10/26',410,y),item('9;00',429,y),item('Primero',450,y),item('GERMAN RUIZ',530,y)];

test('une fecha y hora desalineadas y reconstruye celdas multilínea sin desplazar funciones',()=>{
  const tokens=row();tokens.find(t=>t.str==='9;00').transform[5]=98;
  tokens.push(item('CDU Atarfe',150,96),item('municipal',330,96),...row(80));
  const games=extractPage(tokens,612);
  assert.equal(games.length,2);
  assert.equal(games[0].home,'Local CDU Atarfe');
  assert.equal(games[0].venue,'Pabellón municipal');
  assert.equal(games[0].date,'2026-10-23');assert.equal(games[0].time,'09:00');
  assert.deepEqual([games[0].first,games[0].second,games[0].scorer],['Primero','','GERMAN RUIZ']);
});

test('deduplica partidos entre filas y páginas, conservando conflictos como ambiguos',()=>{
  const a=extractPage(row(),612)[0],b={...a,id:'other',scorer:'Otro',issues:[]};
  assert.equal(deduplicateGames([a,{...a}]).length,1);
  const games=deduplicateGames([a,b]);assert.equal(games.length,1);assert(games[0].ambiguous);
  assert.match(games[0].issues.join(' '),/contradictorios/);
});

test('valida límites, columnas desplazadas, campos esenciales y horas imposibles',()=>{
  assert.throws(()=>extractPage([],612,1,[.2,.1]),/inválidos/);
  const shifted=row().map(t=>({...t,transform:[...t.transform.slice(0,4),t.transform[4]+50,t.transform[5]]}));
  const unknown=extractPage(shifted,612)[0];assert(unknown.ambiguous);assert.equal(unknown.scorer,'');
  const missing=extractPage(row().filter(t=>t.str!=='Visitante'),612)[0];assert(missing.ambiguous);
  const tokens=row();tokens.find(t=>t.str==='9;00').str='25:00';
  assert.equal(extractPage(tokens,612)[0].time,'');
});

test('incidencias de cualquier fila impiden autorizar retiradas aunque se confirme integridad',async()=>{
  const games=extractPage(row().filter(t=>t.str!=='Visitante'),612);
  const detection=detectRound(games,[{from:'2026-10-19',to:'2026-10-25'}]);
  assert.equal(automaticScope(detection,{complete:true,extractionReliable:true}).complete,false);
  const plan=await compareChanges([{game:games[0],payload:{id:'x'}}],[],{complete:true,extractionReliable:true});
  assert.equal(plan.scope.extractionReliable,false);
  const service=createSyncService({});
  await assert.rejects(()=>service.checkChanges(games,{}),/ambiguos/);
});

// Original PDF: preserve source spelling and compare team names case-insensitively.
const reference='fixtures/DESIGNACION ARBITRAL DEL 19 AL 25 DE OCTUBRE DE 2026.pdf';
const fs=await import('node:fs');
test('PDF real 19–25 octubre: GERMAN RUIZ tiene exactamente los cinco partidos solicitados',async()=>{
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const {filterGames,functionsFor}=await import('../src/model.js');
  const pdf=await getDocument({data:new Uint8Array(fs.readFileSync(reference))}).promise;
  try {
    const all=[];
    for(let n=1;n<=pdf.numPages;n++){
      const p=await pdf.getPage(n);
      const games=extractPage((await p.getTextContent()).items,p.getViewport({scale:1}).width,n);
      assert(games.length,`Página ${n} sin partidos reconocidos`);all.push(...games);
    }
    const games=filterGames(deduplicateGames(all),'GERMAN RUIZ');
    assert(games.every(g=>!g.ambiguous),games.map(g=>g.issues).flat().join('; '));
    assert.deepEqual(games.map(g=>[g.date,g.time,normalize(g.home),normalize(g.away),functionsFor(g,'GERMAN RUIZ').join(' / ')])
      .sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),[
      ['2026-10-23','18:00','Cariño CDU Atarfe','Naranjas Jiménez CV Huétor Veg','Anotador'],
      ['2026-10-24','18:00','CDU Atarfe','Ahora Vóley Xátiva','Anotador'],
      ['2026-10-24','20:00','9 ¾ Academy CDU Atarfe','CDC Escolapios Granada','Primer árbitro'],
      ['2026-10-25','10:00','Granavoley','Demax Clinic. Descubre Fuentes','Anotador'],
      ['2026-10-25','12:30','Granavoley Espagruas','Fundación Cajasol Andalucía 1AF','Anotador']
    ].map(([date,time,home,away,role])=>[date,time,normalize(home),normalize(away),role]));
  }finally{await pdf.destroy();}
});
