import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {extractPage} from '../src/extract.js';
import {findHeaderIntervals,automaticScope} from '../src/round.js';
import {assessExtraction,gameDiagnostics,formatDiagnostic} from '../src/extraction-diagnostics.js';
import {eventGame} from '../src/prepare.js';
import {filterGames} from '../src/model.js';
import {validateRound} from '../src/round-sync.js';
const headers=[{from:'2026-10-19',to:'2026-10-25'}];
const game=(id='one',extra={})=>({id,date:'2026-10-24',time:'18:00',home:'Local '+id,away:'Visitante',venue:'Pabellón',category:'Junior',first:'German Ruiz',second:'',scorer:'Otro',issues:[],notes:'Página 2: Local '+id+' | Visitante | Pabellón | German Ruiz | Otro',...extra});

test('clasifica desbordamientos íntegros como advertencias sin borrar los indicadores originales',()=>{
  const g=game('one',{ambiguous:true,issues:['Texto que cruza columnas: first']});
  const a=assessExtraction([g],headers,{referee:'GERMAN RUIZ'});
  assert(a.selectedValid);assert(a.documentComplete);assert.equal(a.diagnostics[0].severity,'warning');
  assert.equal(a.diagnostics[0].page,2);assert.equal(a.diagnostics[0].field,'first');assert(g.ambiguous);assert.equal(g.issues.length,1);
  const scope=automaticScope(a.detection,{referee:'GERMAN RUIZ',calendar:'VOLEY',complete:true,documentIntegrity:a.documentComplete,extractionReliable:a.selectedValid});
  assert.doesNotThrow(()=>validateRound([eventGame(g,'GERMAN RUIZ')],scope));
});

test('valor cruzado truncado, identidad insegura y funciones desconocidas siguen siendo críticos para toda la jornada',()=>{
  for(const patch of [{first:'German',ambiguous:true,issues:['Texto que cruza columnas: first']},{manual:true},{first:'',scorer:'',issues:['Funciones arbitrales sin identificar']}]){
    const a=assessExtraction([game('other',{first:'Otra persona',...patch})],headers,{referee:'GERMAN RUIZ'});
    assert(!a.documentComplete);assert(a.documentErrors.length);
  }
});

test('error de otro árbitro con identidad conocida no invalida los partidos seleccionados ni oculta el diagnóstico',()=>{
  const a=assessExtraction([game(),game('other',{first:'Otra persona',scorer:'Tercera persona',venue:'',issues:['Dato esencial sin identificar: venue']})],headers,{referee:'GERMAN RUIZ'});
  assert(a.selectedValid);assert(a.documentComplete);assert(a.diagnostics.some(d=>d.field==='venue'&&d.severity==='error'));
});

test('errores seleccionados detallan página, partido y campo; horario, equipos y duplicados bloquean',()=>{
  for(const patch of [{time:'25:00'},{home:''},{away:''}]){
    const a=assessExtraction([game('one',patch)],headers,{referee:'GERMAN RUIZ'});
    assert(!a.selectedValid);const text=a.selectedErrors.map(formatDiagnostic).join('\n');
    assert.match(text,/Página 2/);assert.match(text,/Visitante/);assert.match(text,/hora|equipo/);
  }
  const duplicated=assessExtraction([game(),game('copy',{home:'Local one'})],headers,{referee:'GERMAN RUIZ'});
  assert(!duplicated.documentComplete);assert(duplicated.documentErrors.some(d=>d.field==='duplicate'));
});

test('integridad independiente: páginas sin leer, documento parcial, fecha ausente y cabeceras contradictorias bloquean',()=>{
  for(const options of [{scannedPages:[3]},{documentPartial:true}])assert(!assessExtraction([game()],headers,{referee:'GERMAN RUIZ',...options}).documentComplete);
  assert(!assessExtraction([game(),game('other',{first:'Otro',date:''})],headers,{referee:'GERMAN RUIZ'}).documentComplete);
  assert(!assessExtraction([game()],[...headers,{from:'2026-10-26',to:'2026-11-01'}],{referee:'GERMAN RUIZ'}).documentComplete);
  assert.equal(assessExtraction([game()],headers,{scannedPages:[3]}).documentErrors.find(d=>d.page===3).field,'document');
});

test('PDF real 19–25: dos advertencias de anotador, cinco partidos válidos y jornada apta para Google',async()=>{
  const pdf=await getDocument({data:new Uint8Array(fs.readFileSync('fixtures/DESIGNACION ARBITRAL DEL 19 AL 25 DE OCTUBRE DE 2026.pdf'))}).promise;
  const games=[],headers=[];
  try{for(let n=1;n<=pdf.numPages;n++){const page=await pdf.getPage(n),text=await page.getTextContent();games.push(...extractPage(text.items,page.getViewport({scale:1}).width,n));headers.push(...findHeaderIntervals(text.items.map(i=>i.str).join(' ')));}}
  finally{await pdf.destroy();}
  const a=assessExtraction(games,headers,{referee:'GERMAN RUIZ'});
  assert.equal(games.length,39);assert(a.documentComplete);assert(a.selectedValid);assert.equal(a.documentErrors.length,0);
  assert.equal(a.diagnostics.length,2);assert(a.diagnostics.every(d=>d.severity==='warning'&&d.page===1&&d.field==='scorer'));
  const selected=filterGames(games,'GERMAN RUIZ').map(g=>eventGame(g,'GERMAN RUIZ'));
  assert.equal(selected.length,5);
  const scope=automaticScope(a.detection,{calendar:'VOLEY',referee:'GERMAN RUIZ',extractionReliable:a.selectedValid,documentIntegrity:a.documentComplete,complete:a.documentComplete});
  assert(scope.complete);assert(scope.deletionsAllowed);assert.doesNotThrow(()=>validateRound(selected,scope));
  // The same evidence also permits the correctly reconstructed long names when selected.
  const daniel=filterGames(games,'DANIEL SANCHEZ-HOLGADO').map(g=>eventGame(g,'DANIEL SANCHEZ-HOLGADO'));
  assert(daniel.some(g=>g.issues.length));assert.doesNotThrow(()=>validateRound(daniel,{...scope,referee:'DANIEL SANCHEZ-HOLGADO'}));
});
