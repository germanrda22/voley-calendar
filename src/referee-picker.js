import {normalize,referees} from './model.js';
export function refereeChoices(games,query=''){
  const search=normalize(query);
  return referees(games).filter(([key])=>key.includes(search));
}
export function setupRefereePicker({document:doc=document,onChange=()=>{}}={}){
  const $=id=>doc.getElementById(id);let games=[],locked=false;
  function render(){
    const all=refereeChoices(games),found=refereeChoices(games,$('refereeSearch').value),selected=$('refereeSelect').value;
    const options=[...found];
    if(selected&&!options.some(([key])=>key===selected)){
      const current=all.find(([key])=>key===selected);if(current)options.unshift(current);
    }
    $('refereeSelect').replaceChildren(new Option('Selecciona un árbitro',''),...options.map(([key,name])=>new Option(name,key)));
    $('refereeSelect').value=all.some(([key])=>key===selected)?selected:'';
    $('refereeSelect').disabled=locked||!all.length;
    $('refereeSearch').disabled=locked||!all.length;
    $('referee').disabled=locked;
    $('refereeHelp').textContent=!all.length?'No se han detectado árbitros en el PDF. Puedes introducir el nombre manualmente.':!found.length?'No hay nombres que coincidan con la búsqueda.':`${all.length} árbitros detectados · ${found.length} resultado(s).`;
  }
  $('refereeSearch').oninput=render;
  $('refereeSelect').onchange=()=>{$('referee').value='';onChange();};
  $('referee').oninput=()=>{$('refereeSelect').value='';onChange();};
  return {setGames(value){games=value;render();},setDisabled(value){locked=value;render();},
    setName(value){$('refereeSearch').value='';$('referee').value='';$('refereeSelect').value='';render();const match=refereeChoices(games).find(([key])=>key===normalize(value));if(match)$('refereeSelect').value=match[0];else $('referee').value=value||'';$('manualReferee').open=!!value&&!match;},
    getName(){return $('referee').value.trim()||refereeChoices(games).find(([key])=>key===$('refereeSelect').value)?.[1]||'';}};
}
