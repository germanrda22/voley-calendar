import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateICS,escapeText,offerICSDownload} from '../src/ics.js';
import {captureOriginal} from '../src/google-identity.js';
import {prepareEvent} from '../src/prepare.js';

const game = (overrides={}) => ({id:crypto.randomUUID(),date:'2026-10-17',time:'10:00',home:'Local',away:'Visitante',category:'Júnior',competition:'Oro',venue:'Pabellón municipal',first:'Germán Ruiz',second:'Alba Jiménez',scorer:'Lucía Rojas',referee:'Germán Ruiz',role:'Primer árbitro',selected:true,...overrides});
function events(content) {
  return content.replace(/\r\n[ \t]/g,'').split('BEGIN:VEVENT\r\n').slice(1).map(block=>Object.fromEntries(block.split('END:VEVENT')[0].trimEnd().split('\r\n').map(line=>{const colon=line.indexOf(':');return [line.slice(0,colon),line.slice(colon+1)];})));
}
const decode=value=>value.replace(/\\([nN,;\\])/g,(_match,c)=>c.toLowerCase()==='n'?'\n':c);

test('ICS único contiene solo los seleccionados con datos editados y duración propia',async()=>{
  const edited=captureOriginal(game());
  Object.assign(edited,{home:'Local revisado',away:'Visitante revisado',date:'2026-11-01',time:'23:30',category:'Sénior',competition:'Plata',venue:'Pabellón revisado',role:'Anotador',duration:90,second:'Árbitra revisada'});
  const other=game({date:'2026-07-10',time:'10:00'});
  const content=await generateICS([edited,game({selected:false,home:'No exportar'}),other]);
  const result=events(content);assert.equal(result.length,2);
  assert(content.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));assert(content.endsWith('END:VCALENDAR\r\n'));
  const prepared=prepareEvent({...edited,roleOverrides:{'GERMAN RUIZ':'Anotador'}},edited.referee);
  assert.equal(decode(result[0].SUMMARY),prepared.summary);
  assert.equal(result[0].DTSTART,'20261101T223000Z');assert.equal(result[0].DTEND,'20261102T000000Z');
  assert.equal(result[0].LOCATION,'Pabellón revisado');
  assert.equal(decode(result[0].DESCRIPTION),prepared.description);
  assert.match(decode(result[0].DESCRIPTION),/Categoría: Sénior\nCompetición: Plata/);
  assert.match(decode(result[0].DESCRIPTION),/Segundo árbitro: Árbitra revisada/);
  assert.equal(result[1].DTSTART,'20260710T080000Z');assert.equal(result[1].DTEND,'20260710T100000Z');
  assert(!content.includes('No exportar'));
});

test('ICS representa Madrid en invierno, verano y al atravesar los cambios de hora',async()=>{
  const result=events(await generateICS([
    game({date:'2026-01-10'}),game({date:'2026-07-10'}),
    game({date:'2026-03-29',time:'01:30'}),game({date:'2026-10-25',time:'01:30'}),
    game({date:'2026-10-25',time:'02:30',dstChoice:'second'})
  ]));
  assert.equal(result[0].DTSTART,'20260110T090000Z');assert.equal(result[0].DTEND,'20260110T110000Z');
  assert.equal(result[1].DTSTART,'20260710T080000Z');assert.equal(result[1].DTEND,'20260710T100000Z');
  assert.equal(result[2].DTSTART,'20260329T003000Z');assert.equal(result[2].DTEND,'20260329T023000Z');
  assert.equal(result[3].DTSTART,'20261024T233000Z');assert.equal(result[3].DTEND,'20261025T013000Z');
  assert.equal(result[4].DTSTART,'20261025T013000Z');assert.equal(result[4].DTEND,'20261025T033000Z');
  await assert.rejects(generateICS([game({date:'2026-03-29',time:'02:30'})]),/inexistente/);
  await assert.rejects(generateICS([game({date:'2026-10-25',time:'02:30'})]),/ambigua/);
  await assert.rejects(generateICS([game({date:'2026-02-30'})]),/Fecha/);
});

test('RFC 5545: caracteres especiales, CRLF y plegado UTF-8 sin cortar emojis',async()=>{
  const notes='Tildes áéíóú, punto; barra\\\nLínea LF\r\nLínea CRLF\rLínea CR\rBEGIN:VEVENT\rUID:injection';
  const g=game({home:'🏐'.repeat(50)+' Ávila, A; B\\C',venue:'Pabellón, norte; pista\\1',notes});
  const content=await generateICS([g]);
  assert(!/(?<!\r)\n|\r(?!\n)/.test(content));
  for(const line of content.split('\r\n'))assert(Buffer.byteLength(line,'utf8')<=75);
  assert(!content.includes('\uFFFD'));assert.equal(events(content).length,1);
  const event=events(content)[0];assert.equal(decode(event.SUMMARY),`🏐 Primer árbitro | ${g.home} vs Visitante`);
  assert.equal(decode(event.LOCATION),g.venue);
  assert(decode(event.DESCRIPTION).endsWith(notes.replace(/\r\n|\r/g,'\n')));
  assert.equal(escapeText('a,b;c\\d\r\ne\rf\ng'),'a\\,b\\;c\\\\d\\ne\\nf\\ng');
});

test('UID estable: exportaciones, UUID aleatorios, recarga del PDF y ediciones',async()=>{
  const g=captureOriginal(game());const first=events(await generateICS([g]))[0].UID;
  assert.equal(events(await generateICS([g]))[0].UID,first);
  assert.equal(events(await generateICS([captureOriginal(game())]))[0].UID,first);
  Object.assign(g,{date:'2026-11-01',time:'18:00',home:'Nombre corregido',venue:'Otro',duration:75,role:'Anotador'});
  assert.equal(events(await generateICS([g]))[0].UID,first);
  const [a,b]=events(await generateICS([g,game({date:'2026-10-18'})]));assert.notEqual(a.UID,b.UID);
  assert.notEqual(events(await generateICS([game({referee:'Alba Jiménez',role:'Segundo árbitro'})]))[0].UID,first);
});

test('sin seleccionados o con datos inválidos se avisa; recordatorios válidos conservados',async()=>{
  await assert.rejects(generateICS([]),/Selecciona al menos un partido/);
  await assert.rejects(generateICS([game({selected:false})]),/Selecciona al menos un partido/);
  await assert.rejects(generateICS([game({home:''})]),/Completa/);
  await assert.rejects(generateICS([game({duration:0})]),/Duración/);
  await assert.rejects(generateICS([game()],120,1.5),/Recordatorio/);
  assert(!(await generateICS([game()])).includes('BEGIN:VALARM'));
  const content=await generateICS([game()],120,60);assert(content.includes('BEGIN:VALARM\r\nACTION:DISPLAY\r\n'));assert(content.includes('TRIGGER:-PT60M\r\n'));
});

test('descarga usa archivo UTF-8 y enlace persistente, también cuando el navegador impide clic automático',async()=>{
  const calls=[],blobs=[],link={click(){calls.push('click');}};
  const urlApi={createObjectURL:blob=>{blobs.push(blob);return 'blob:test';},revokeObjectURL:url=>calls.push(url)};
  const content=await generateICS([game()]);
  const download=offerICSDownload(content,link,{urlApi});
  assert.equal(link.download,'voley-calendar.ics');assert.equal(link.href,'blob:test');assert.equal(link.hidden,false);
  assert.equal(blobs[0].type,'text/calendar;charset=utf-8');assert.equal(await blobs[0].text(),content);
  assert.deepEqual(calls,['click']);download.revoke();assert.deepEqual(calls,['click','blob:test']);
  const blocked={click(){throw Error('User activation required');}};
  assert.equal(offerICSDownload(content,blocked,{urlApi}).automaticDownloadStarted,false);
  assert.equal(blocked.hidden,false);assert.equal(blocked.href,'blob:test');
});
