import {normalize,refereeKeys} from './model.js';

// Capture once after extraction, before any review edits. The parser stays unchanged.
export function captureOriginal(game) {
  if(!game.original)game.original=Object.freeze(Object.fromEntries(['date','home','away','category','competition',...refereeKeys].map(key=>[key,game[key]||''])));
  return game;
}
export async function assignmentId(game) {
  const source=game.original || captureOriginal(game).original;
  const data=['voley-assignment-v2',...['date','home','away','category','competition'].map(key=>normalize(source[key])),normalize(game.referee)];
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(data)));
  return 'v2'+[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');
}
