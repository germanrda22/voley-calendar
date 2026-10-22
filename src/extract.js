import {blank, parseDate} from './model.js';

// Delegación Granadina: column boundaries as fractions of the supplied A4 PDF.
// Empty cells keep their column; names must never be compacted to the left.
export const granadaLayout = [82,130,220,300,406,426,440,480,520,565].map(x => x/612);
const keys = ['category','home','away','venue','date','time','first','second','scorer'];
export function extractPage(items, width, pageNumber = 1, layout = granadaLayout) {
  const tokens = items.filter(i => i.str?.trim()).map(i => ({ text:i.str.trim(), x:i.transform[4]/width, y:i.transform[5], height:Math.abs(i.transform[3]) || 1, width:i.width/width }));
  const dateAnchors = tokens.filter(t => /^\d{1,2}[-/.]\d{1,2}[-/.](?:\d{4}|\d{2})$/.test(t.text));
  const timeAnchors = tokens.filter(t => /^\d{1,2}:\d{2}$/.test(t.text) && t.x >= layout[5] && t.x < layout[6] && !dateAnchors.some(a => Math.abs(a.y-t.y) < Math.max(.1,a.height*.45)));
  const anchors = [...dateAnchors,...timeAnchors].sort((a,b)=>b.y-a.y);
  const games = [];
  for (const anchor of anchors) {
    const gaps = anchors.filter(a => a !== anchor).map(a => Math.abs(a.y-anchor.y)).filter(d => d > .05);
    const tolerance = Math.min(anchor.height*.45, gaps.length ? Math.min(...gaps)*.4 : anchor.height*.45);
    const row = tokens.filter(t => Math.abs(t.y-anchor.y) <= Math.max(.1,tolerance)).sort((a,b) => a.x-b.x);
    const g = blank(); g.notes = `Página ${pageNumber}: ${row.map(t=>t.text).join(' | ')}`;
    // Reject unknown layouts instead of assigning plausible but unverified roles.
    const known = (dateAnchors.includes(anchor) && anchor.x >= layout[4] && anchor.x < layout[5]) || timeAnchors.includes(anchor);
    if (!known) {
      g.date = parseDate(anchor.text); g.manual = true; g.issues.push('Formato de columnas no reconocido. Completa los campos y las funciones manualmente.'); games.push(g); continue;
    }
    keys.forEach((key,i) => {
      const cell = row.filter(t => t.x >= layout[i] && t.x < layout[i+1] && t.text !== '-');
      g[key] = cell.map(t=>t.text).join(' ');
      if (cell.some(t => t.x+t.width > layout[i+1]+.002)) g.issues.push(`Texto que cruza columnas: ${key}`);
    });
    g.date = parseDate(g.date);
    if (/^\d:\d{2}$/.test(g.time)) g.time = '0'+g.time;
    g.competition = row.filter(t => t.x < layout[0]).map(t=>t.text).join(' ');
    if (!g.date || !g.time) g.issues.push('Fecha u hora sin identificar');
    games.push(g);
  }
  return games;
}
