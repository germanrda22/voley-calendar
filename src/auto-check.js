// Coordina solo lecturas. Las escrituras siguen requiriendo aplicar la vista previa.
export function createAutoCheck({getKey,check,onStart=()=>{},onError=()=>{},delay=450,setTimer=setTimeout,clearTimer=clearTimeout}){
  let timer=null,running=false,lastAttempt=null,disposed=false;
  function cancel(){if(timer!==null)clearTimer(timer);timer=null;}
  async function run(force){
    timer=null;
    if(disposed||running)return;
    const key=getKey({force});
    if(!key||!force&&key===lastAttempt)return;
    running=true;lastAttempt=key;
    try{onStart(key);await check();}
    catch(error){onError(error);}
    finally{running=false;if(!disposed)schedule();}
  }
  function schedule({force=false}={}){
    if(disposed)return;
    cancel();
    if(running)return;
    const key=getKey({force});
    if(!key||!force&&key===lastAttempt)return;
    timer=setTimer(()=>run(force),force?0:delay);
  }
  return {schedule,cancel,reset(){lastAttempt=null;cancel();},destroy(){disposed=true;cancel();}};
}
