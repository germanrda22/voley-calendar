import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {extractPage} from '../src/extract.js';
import {findHeaderIntervals,detectRound,confirmRound,automaticScope,automaticRoundKey} from '../src/round.js';

test('cabecera española y formatos cortos: intervalo exacto, sin redondeo semanal',()=>{
  assert.deepEqual(findHeaderIntervals('PARTIDOS FEDERADOS JORNADA DEL 12 DE OCTUBRE DE 2026 AL 18 DE OCTUBRE DE 2026'),[{from:'2026-10-12',to:'2026-10-18'}]);
  assert.deepEqual(findHeaderIntervals('Jornada del 14 de octubre de 2026 al 20 de octubre de 2026'),[{from:'2026-10-14',to:'2026-10-20'}]);
  assert.deepEqual(findHeaderIntervals('JORNADA DEL 30 DE DICIEMBRE DE 2026 AL 2 DE ENERO DE 2027'),[{from:'2026-12-30',to:'2027-01-02'}]);
  assert.deepEqual(findHeaderIntervals('Jornada del 12 al 18 de octubre de 2026'),[{from:'2026-10-12',to:'2026-10-18'}]);
  assert.deepEqual(findHeaderIntervals('Jornada del 12-10-26 al 18-10-26'),[{from:'2026-10-12',to:'2026-10-18'}]);
  assert.deepEqual(findHeaderIntervals('JORNADA DEL 31 DE FEBRERO DE 2026 AL 4 DE MARZO DE 2026'),[]);
});

test('sin cabecera utiliza todas las fechas originales y pide confirmar cuando son insuficientes',()=>{
  const games=[{date:'2026-10-17'},{date:'2026-10-18'}];
  const detection=detectRound(games);assert.equal(detection.from,'2026-10-17');assert.equal(detection.to,'2026-10-18');assert(!detection.needsConfirmation);
  assert.equal(detectRound([{date:'2026-10-17'}]).needsConfirmation,true);
  assert.equal(detectRound([{date:'2026-10-17'},{date:'2026-10-24'}]).needsConfirmation,true);
  assert.equal(detectRound([]).needsConfirmation,true);
  assert.equal(detectRound([...games,{date:''}]).needsConfirmation,true);
  assert.throws(()=>automaticScope(detectRound([]),{}),/Confirma/);
  assert.equal(confirmRound(detectRound([]),'2026-10-12','2026-10-18').needsConfirmation,false);
  assert.throws(()=>confirmRound(detectRound([]),'2026-02-30','2026-03-01'),/válido/);
  assert.equal(detectRound([{date:'2026-11-01',original:{date:'2026-10-17'}},{date:'2026-10-18'}]).from,'2026-10-17');
});

test('fechas fuera de cabecera y documentos de varias jornadas nunca amplían el intervalo silenciosamente',()=>{
  const first={from:'2026-10-12',to:'2026-10-18'},second={from:'2026-10-19',to:'2026-10-25'};
  const outside=detectRound([{date:'2026-10-19'}],[first]);
  assert.equal(outside.from,first.from);assert.equal(outside.to,first.to);assert(outside.needsConfirmation);assert(!outside.deletionsAllowed);
  const confirmed=confirmRound(outside,first.from,first.to);assert(!automaticScope(confirmed,{complete:true,extractionReliable:true}).complete);
  const merged=detectRound([{date:'2026-10-17'}],[first,second]);assert(merged.needsConfirmation);assert(!merged.deletionsAllowed);
});

test('PDF original y actualizado con una retirada conservan la clave de jornada',async()=>{
  const files=['DESIGNACION ARBITRAL DEL 12 AL 18 DE OCTUBRE DE 2026.pdf','designaciones_actualizadas_sin_monachil_albolote.pdf'];
  const detections=[],counts=[];
  for(const file of files){
    const pdf=await getDocument({data:new Uint8Array(fs.readFileSync('fixtures/'+file))}).promise;
    try{
      const games=[],headers=[];
      for(let n=1;n<=pdf.numPages;n++){const p=await pdf.getPage(n),text=await p.getTextContent();headers.push(...findHeaderIntervals(text.items.map(i=>i.str).join(' ')));games.push(...extractPage(text.items,p.getViewport({scale:1}).width,n));}
      detections.push(detectRound(games,headers));counts.push(games.length);
    }finally{await pdf.destroy();}
  }
  assert.equal(detections.length,2);assert.deepEqual(counts.sort((a,b)=>b-a),[27,26]);
  assert(detections.every(d=>d.source==='header'&&d.from==='2026-10-12'&&d.to==='2026-10-18'&&!d.needsConfirmation));
  assert.equal(automaticRoundKey(detections[0]),automaticRoundKey(detections[1]));
  assert.notEqual(automaticRoundKey(detections[0]),automaticRoundKey({...detections[0],from:'2026-10-19',to:'2026-10-25'}));
});
