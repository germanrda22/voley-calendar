import {filterGames, functionsFor, normalize} from './model.js';
import {getDates, title, description, timezone} from './calendar.js';

export function orderedGames(games, referee, duration=120) {
  const start = g => { try { return +getDates(g,duration).start; } catch { return Infinity; } };
  return [...filterGames(games,referee)].sort((a,b)=>start(a)-start(b) || `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
}

export function eventGame(game, referee) {
  return {...game, referee, role:game.roleOverrides?.[normalize(referee)] || functionsFor(game,referee).join(' / ')};
}

export function prepareEvent(game, referee, duration=120) {
  const value=eventGame(game,referee), {start,end}=getDates(value,duration);
  return {summary:title(value), description:description(value), location:value.venue || '',
    start:{dateTime:start.toISOString(),timeZone:timezone}, end:{dateTime:end.toISOString(),timeZone:timezone}};
}

// A differing role or venue may be an editing discrepancy in the same match.
// Warn conservatively and let the user resolve it, rather than silently dropping it.
export function duplicateGroups(games, duration=120) {
  const groups=new Map();
  for(const game of games) {
    if(!game.home?.trim() || !game.away?.trim())continue;
    let start;try{start=getDates(game,duration).start.toISOString();}catch{continue;}
    const key=JSON.stringify([start,normalize(game.home),normalize(game.away),normalize(game.referee)]);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(game);
  }
  return [...groups.values()].filter(group=>group.length>1);
}
