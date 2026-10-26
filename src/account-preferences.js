// Never read the old shared preference key: it may belong to another account.
export function createAccountPreferences(storage){
  let account='';
  const key=()=>`voley.preferences.v1.${account}`;
  return {
    useAccount(value){account=/^[0-9a-f]{64}$/.test(value||'')?value:'';},
    load(){if(!account)return {};try{const value=JSON.parse(storage.getItem(key())||'{}');return {referee:typeof value.referee==='string'?value.referee:'',calendar:typeof value.calendar==='string'?value.calendar:''};}catch{return {};}},
    save(value){if(!account)return;try{storage.setItem(key(),JSON.stringify({referee:value.referee||'',calendar:value.calendar||''}));}catch{/* Private browsing or full storage: session still works. */}}
  };
}
