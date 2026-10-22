import {blank, normalize, parseDate} from './model.js';

// Supported Granada template. Coordinates alone are insufficient: each row must
// also contain date/time evidence in these columns and text must fit its cell.
export const granadaLayout = [82,130,220,300,406,426,440,480,520,565].map(x => x/612);
const october19Layout = [78,124,212,290,391,410,430,472,512,554].map(x=>x/612);
const keys = ['category','home','away','venue','date','time','first','second','scorer'];
const isDate = text => /^\d{1,2}[-/.]\d{1,2}[-/.](?:\d{4}|\d{2})$/.test(text);
const isTime = text => /^\d{1,2}[:;]\d{2}$/.test(text);
const inColumn = (t, layout, i) => t.x+t.width/2 >= layout[i] && t.x+t.width/2 < layout[i+1];
export function deduplicateGames(games) {
  const seen = new Map(), result = [];
  for (const game of games) {
    const identity = ['date','time','home','away','category','competition'];
    if (!game.date || !game.time || !game.home || !game.away) { result.push(game); continue; }
    const key = JSON.stringify(identity.map(k=>normalize(game[k]))), previous = seen.get(key);
    if (!previous) { seen.set(key,game); result.push(game); continue; }
    previous.issues = [...new Set([...previous.issues,...game.issues])];
    if (['venue','first','second','scorer'].some(k=>normalize(previous[k])!==normalize(game[k]))) {
      previous.issues.push('Duplicado con datos contradictorios: contrasta las columnas con el PDF');
      previous.ambiguous = true;
    }
    previous.notes += '\nDuplicado: '+game.notes;
  }
  return result;
}
export function extractPage(items, width, pageNumber = 1, layout = granadaLayout) {
  if (!(width > 0) || layout.length !== 10 || layout.some((x,i)=>!Number.isFinite(x)||x<0||x>1||i>0&&x<=layout[i-1])) throw Error('Límites de columnas inválidos');
  const tokens = items.filter(i => i.str?.trim()).map(i => ({text:i.str.trim(),x:i.transform[4]/width,y:i.transform[5],height:Math.abs(i.transform[3])||1,width:(i.width||0)/width}));
  const evidence = tokens.filter(t=>isDate(t.text)||isTime(t.text)).sort((a,b)=>b.y-a.y);
  const anchors = [];
  for (const t of evidence) {
    // A date and a time can have slightly different baselines, but two dates
    // (or two times) never establish the same row unless they overlap exactly.
    const row = anchors.find(a=>Math.abs(a.y-t.y)<=Math.max(.1,Math.min(a.height,t.height)*1.2) &&
      a.tokens.every(other=>isDate(other.text)!==isDate(t.text)||Math.abs(other.y-t.y)<.1));
    if (row) { row.tokens.push(t); row.top=Math.max(row.top,t.y); row.bottom=Math.min(row.bottom,t.y); }
    else anchors.push({y:t.y,top:t.y,bottom:t.y,height:t.height,tokens:[t]});
  }
  anchors.sort((a,b)=>b.y-a.y);
  // Dates are centred even when the year has two digits. The distance between
  // date/time centres validates the scale and translation of this template.
  if(layout===granadaLayout){
    const pairs=anchors.map(a=>[a.tokens.find(t=>isDate(t.text)),a.tokens.find(t=>isTime(t.text))]).filter(([d,t])=>d&&t);
    if(pairs.length>=2){
      const centres=pairs.map(([d,t])=>[(d.x+d.width/2)*width,(t.x+t.width/2)*width]);
      const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
      const dc=median(centres.map(c=>c[0])),tc=median(centres.map(c=>c[1]));
      const updated=Math.abs(dc-400.8022452386978)<Math.abs(dc-416.3844914735028);
      const baseDate=updated?400.8022452386978:416.3844914735028,baseTime=updated?416.2116000336857:432.33293519844235;
      const scale=(tc-dc)/(baseTime-baseDate),offset=dc-scale*baseDate;
      if(scale>=.85&&scale<=1.15&&Math.abs(offset)<30&&centres.every(([d,t])=>Math.abs(d-dc)<1&&Math.abs(t-tc)<1)){
        layout=(updated?october19Layout:granadaLayout).map(x=>(x*612*scale+offset)/width);
      }
    }
  }
  const games = anchors.map((anchor,index)=>{
    const upper = Math.min(anchor.top+anchor.height*1.2,index?(anchors[index-1].bottom+anchor.top)/2:Infinity);
    const lower = Math.max(anchor.bottom-anchor.height*1.2,index+1<anchors.length?(anchor.bottom+anchors[index+1].top)/2:-Infinity);
    const row = tokens.filter(t=>t.y<=upper&&t.y>lower);
    const g = blank();
    g.notes = `Página ${pageNumber}: ${row.map(t=>t.text).join(' | ')}`;
    const known = anchor.tokens.every(t=>inColumn(t,layout,isDate(t.text)?4:5));
    if (!known) {
      g.date=parseDate(anchor.tokens.find(t=>isDate(t.text))?.text||'');g.manual=true;
      g.issues.push('Formato de columnas no reconocido. Completa los campos y las funciones manualmente.');
    } else {
      keys.forEach((key,i)=>{
        const cell=row.filter(t=>inColumn(t,layout,i)&&t.text!=='-').sort((a,b)=>Math.abs(a.y-b.y)>.1?b.y-a.y:a.x-b.x);
        g[key]=cell.map(t=>t.text).join(' ');
        if(cell.some(t=>t.x<layout[i]-.002||t.x+t.width>layout[i+1]+.002))g.issues.push(`Texto que cruza columnas: ${key}`);
      });
      g.date=parseDate(g.date);
      g.time=g.time.replace(';',':').replace(/^(\d):/,'0$1:');
      if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(g.time))g.time='';
      g.competition=row.filter(t=>t.x<layout[0]).sort((a,b)=>b.y-a.y||a.x-b.x).map(t=>t.text).join(' ');
    }
    for(const key of ['date','time','home','away','venue','category'])if(!g[key])g.issues.push(`Dato esencial sin identificar: ${key}`);
    if(!g.first&&!g.second&&!g.scorer)g.issues.push('Funciones arbitrales sin identificar');
    g.ambiguous=!!g.issues.length;
    return g;
  });
  return deduplicateGames(games);
}
