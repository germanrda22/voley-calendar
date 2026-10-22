import {prepareEvent,duplicateGroups} from './prepare.js';

export function importSummary(plan) {
  const rows=plan?.rows.filter(r=>r.payload)||[];
  return {new:rows.filter(r=>r.status==='new'&&r.action==='create').length,
    existing:rows.filter(r=>r.status==='unchanged').length,
    modified:rows.filter(r=>r.status==='modified').length,
    ambiguous:rows.filter(r=>r.status==='doubtful'||r.result?.status==='error').length};
}
export function validateDirectImport(games,scope,duration=120) {
  if(!scope.extractionReliable)throw Error('Importación directa bloqueada: hay errores o ambigüedades de extracción. Revisa los cambios.');
  if(!scope.calendar||!scope.referee)throw Error('Selecciona árbitro y calendario de Google.');
  if(!games.length)throw Error('No hay partidos del árbitro seleccionado.');
  for(const g of games){
    if(g.ambiguous||g.manual||g.issues?.length)throw Error('Importación directa bloqueada: hay partidos ambiguos o con errores.');
    for(const key of ['date','time','home','away','venue','category','role'])if(!g[key]?.trim())throw Error(`Importación directa bloqueada: falta ${key}.`);
    prepareEvent(g,g.referee,duration);
  }
  if(duplicateGroups(games,duration).length)throw Error('Importación directa bloqueada: hay partidos duplicados.');
}
// Uses the existing creation-only importer, which checks Calendar again for
// each game and uses deterministic IDs. Never applies a review plan.
export function createDirectImport({service,getSnapshot,isCurrent=()=>true}) {
  let running=false;
  return async function importDirectly(){
    if(running)throw Error('Ya hay una importación directa en curso.');
    running=true;
    try {
      const snapshot=structuredClone(getSnapshot()),{games,scope,duration=120,reminder=0}=snapshot;
      validateDirectImport(games,scope,duration);
      if(!Number.isInteger(reminder)||reminder<0||reminder>10080)throw Error('Revisa el recordatorio.');
      const plan=await service.checkChanges(games,scope,duration,reminder);
      if(!isCurrent(snapshot))throw Error('Los datos cambiaron durante la comprobación. Vuelve a importar.');
      if(!plan.scope.extractionReliable)throw Error('La comprobación no permite una importación directa fiable.');
      const eligible=plan.rows.filter(r=>r.status==='new'&&r.action==='create');
      const omitted=plan.rows.filter(r=>r.payload&&!eligible.includes(r)).map(r=>({game:r.game,status:r.status==='unchanged'?'existing':'review',detail:r.status==='unchanged'?'Ya existe en Google Calendar':'Requiere revisar los cambios'}));
      const results=eligible.length?await service.importGames(eligible.map(r=>r.game),scope.calendar,duration,reminder):[];
      return {plan,results:[...omitted,...results]};
    }finally{running=false;}
  };
}
