export const normalize = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
export const roles = ['Primer árbitro', 'Segundo árbitro', 'Anotador'];
export const refereeKeys = ['first', 'second', 'scorer'];
export function blank() { return { id: crypto.randomUUID(), date: '', time: '', home: '', away: '', category: '', competition: '', venue: '', first: '', second: '', scorer: '', notes: '', selected: true, reviewed: false, issues: [] }; }
export function referees(games) {
  const names = new Map();
  for (const g of games) for (const key of refereeKeys) if (normalize(g[key])) names.set(normalize(g[key]), names.get(normalize(g[key])) || g[key]);
  return [...names].sort((a,b) => a[1].localeCompare(b[1], 'es'));
}
export const functionsFor = (g, name) => refereeKeys.flatMap((key,i) => normalize(name) && normalize(g[key]) === normalize(name) ? [roles[i]] : []);
export const filterGames = (games, name) => name ? games.filter(g => functionsFor(g,name).length || g.manual) : games;
export function parseDate(text) {
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(text.trim());
  if (!m) return '';
  const year = m[3].length === 2 ? '20'+m[3] : m[3];
  const value = `${year}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  const date = new Date(value+'T12:00:00Z');
  return !isNaN(date) && date.toISOString().slice(0,10) === value ? value : '';
}
