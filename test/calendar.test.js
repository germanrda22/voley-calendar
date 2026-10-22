import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {extractPage} from '../src/extract.js';
import {normalize,referees,filterGames,functionsFor,parseDate} from '../src/model.js';
import {getDates,createICS,stableId} from '../src/calendar.js';
test('PDF real: todas las filas, nombres y columnas sin desplazar huecos',async()=>{
  const file=fs.readdirSync('fixtures').find(f=>f.endsWith('.pdf'));
  const doc=await getDocument({data:new Uint8Array(fs.readFileSync('fixtures/'+file))}).promise;
  try{
    const games=[];
    for(let n=1;n<=doc.numPages;n++){const p=await doc.getPage(n);games.push(...extractPage((await p.getTextContent()).items,p.getViewport({scale:1}).width,n));}
    assert.equal(games.length,27);
    assert.deepEqual([games[0].first,games[0].second,games[0].scorer],['KIGAN','ALEJANDRO MORALES','NACHO MEDINA']);
    assert.deepEqual([games[3].first,games[3].second,games[3].scorer],['ALBA JIMENEZ','','CRISTINA LOPEZ']);
    assert.equal(games[5].date,'2026-10-18');
    assert.deepEqual([games[5].first,games[5].second,games[5].scorer],['JOSE NOGUERA','','']);
    assert.equal(games[0].home,"Fundación Carvajal Albolote CV'16");
    assert.equal(games[0].venue,'PABELLÓN MUNICIPAL DE ALBOLOTE');
    assert.equal(referees(games).length,13);
    const german=filterGames(games,'Germán Ruiz');
    assert.equal(german.length,6);
    assert.equal(german.filter(g=>functionsFor(g,'german ruiz').includes('Primer árbitro')).length,1);
    assert.equal(german.filter(g=>functionsFor(g,'german ruiz').includes('Anotador')).length,5);
    const expected=[['KIGAN','ALEJANDRO MORALES','NACHO MEDINA'],['CRISTINA LOPEZ','ALBA JIMENEZ','GERMAN RUIZ'],['KIGAN','JOSE NOGUERA','GERMAN RUIZ'],['ALBA JIMENEZ','','CRISTINA LOPEZ'],['PAULA PEREZ','','LUCIA ROJAS'],['JOSE NOGUERA','',''],['MARIA AGUAYO','','PAULA PEREZ'],['ALBA JIMENEZ','','CRISTINA LOPEZ'],['MIGUEL EXTREMERA','',''],['PAULA LAMA','',''],['KIGAN','','PAULA PERZ'],['GERMAN RUIZ','','MARIA AGUAYO'],['MARIA AGUAYO','','GERMAN RUIZ'],['JOSE NOGUERA','','GERMAN RUIZ'],['LUCIA ROJAS','','KIGAN'],['PAULA LAMA','','JOSE NOGUERA'],['JOSE NOGUERA','','PAULA LAMA'],['CRISTINA LOPEZ','',''],['ALBA JIMENEZ','','CRISTINA LOPEZ'],['CRISTINA LOPEZ','','ALBA JIMENEZ'],['ALEJANDRO MORALES','','MIGUEL EXTREMERA'],['ALEJANDRO MORALES','','KIGAN'],['ALBA JIMENEZ','','JOSE NOGUERA'],['LUCIA ROJAS','','ALEJANDRO MORALES'],['JOSE NOGUERA','','GERMAN RUIZ'],['ALEJANDRO MORALES','','LUCIA ROJAS'],['NACHO MEDINA','','']];
    assert.deepEqual(games.map(g=>[g.first,g.second,g.scorer]),expected);
    assert(games.every(g=>g.issues.length===0));
    games[0].home='Edición conservada';filterGames(games,'ALBA JIMENEZ');assert.equal(games[0].home,'Edición conservada');
  }finally{await doc.destroy();}
});
test('comparación de nombres y fechas válidas',()=>{
  assert.equal(normalize('  Germán  Ruíz '),'GERMAN RUIZ');
  assert.equal(parseDate('18-10-26'),'2026-10-18');
  assert.equal(parseDate('31-02-2026'),'');
  assert.equal(referees([{first:'Germán Ruiz',second:'GERMAN RUIZ',scorer:''}]).length,1);
});
test('formatos de tabla desconocidos exigen revisión y no inventan funciones',()=>{
  const result=extractPage([{str:'18-10-26',transform:[1,0,0,10,10,100],width:30}],612);
  assert.equal(result[0].first,'');assert(result[0].issues.length);
});
test('fecha u hora vacías conservan la fila y los huecos arbitrales',()=>{
  const item=(str,x,y)=>({str,transform:[1,0,0,2,x,y],width:5});
  const games=extractPage([item('18-10-26',410,100),item('Local con espacios',150,100),item('Anotador original',530,100),item('12:00',429,90),item('Otro local',150,90),item('Segundo original',490,90)],612);
  assert.equal(games.length,2);
  assert.equal(games[0].time,'');assert.equal(games[0].scorer,'Anotador original');
  assert.equal(games[1].date,'');assert.equal(games[1].second,'Segundo original');
  assert.equal(games[1].first,'');assert(games.every(g=>g.issues.length));
});
test('Europe/Madrid: invierno, verano, horas inexistentes y ambiguas',()=>{
  assert.equal(getDates({date:'2026-01-10',time:'10:00'}).start.toISOString(),'2026-01-10T09:00:00.000Z');
  assert.equal(getDates({date:'2026-07-10',time:'10:00'}).start.toISOString(),'2026-07-10T08:00:00.000Z');
  assert.throws(()=>getDates({date:'2026-03-29',time:'02:30'}),/inexistente/);
  assert.throws(()=>getDates({date:'2026-10-25',time:'02:30'}),/ambigua/);
  assert.equal(getDates({date:'2026-10-25',time:'02:30',dstChoice:'second'}).start.toISOString(),'2026-10-25T01:30:00.000Z');
});
test('ICS: UID estable, escape, plegado UTF-8, duración y cambio de día',async()=>{
  const g={date:'2026-10-17',time:'23:30',home:'Equipo, local',away:'Visitante',role:'Anotador',referee:'Germán Ruiz',category:'Categoría larga '.repeat(20),venue:'Pabellón; centro',duration:150};
  assert.equal(await stableId(g),await stableId({...g,id:'otro'}));
  const ics=await createICS([g],120,60);
  assert(ics.includes('DTEND:20261018T000000Z'));
  assert(ics.includes('LOCATION:Pabellón\\; centro'));
  assert(ics.includes('SUMMARY:🏐 Anotador | Equipo\\, local vs Visitante'));
  assert(ics.split('\r\n').every(line=>new TextEncoder().encode(line).length<=75));
});
