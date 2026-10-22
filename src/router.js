// Las vistas comparten los mismos controles y estado: navegar no reinicia la aplicación.
export const routes={
  '/':{title:'Inicio',heading:'¿Qué quieres hacer hoy?',description:'Elige cómo preparar tu próxima jornada arbitral.'},
  '/nueva':{title:'Nueva designación',heading:'Nueva designación',description:'Sube el documento, revisa tus partidos y llévalos a tu calendario.'},
  '/revision':{title:'Revisar cambios',heading:'Revisar cambios',description:'Compara el PDF actualizado con Google Calendar y confirma cada operación.'}
};
export function resolveRoute(pathname){return pathname.replace(/\/+$/,'')||'/';}

export function setupRouter({document:doc=globalThis.document,window:win=globalThis.window,hasWork=()=>false,isBusy=()=>false}={}){
  const views=[...doc.querySelectorAll('[data-pages]')];
  const links=[...doc.querySelectorAll('a[data-route]')];
  let current;
  function render({focus=false}={}){
    current=resolveRoute(win.location.pathname);
    const route=routes[current];
    doc.body.dataset.page=route?current:'not-found';
    for(const view of views)view.hidden=!view.dataset.pages.split(' ').includes(route?current:'not-found');
    for(const link of links){
      if(resolveRoute(new URL(link.href,win.location.href).pathname)===current)link.setAttribute('aria-current','page');
      else link.removeAttribute('aria-current');
    }
    doc.title=`${route?.title||'Página no encontrada'} · Voley Calendar`;
    const heading=doc.getElementById('pageTitle');
    heading.textContent=route?.heading||'Esta página no existe';
    doc.getElementById('pageDescription').textContent=route?.description||'Vuelve al inicio para elegir una operación.';
    const notice=doc.getElementById('navigationNotice');
    notice.textContent=isBusy()?'Hay una operación en curso. Continúa en segundo plano; evita cerrar o recargar la página.':hasWork()?'Tu documento, ediciones y resultados se conservan al cambiar de página. El trabajo está en memoria: se perderá si cierras o recargas.':'';
    notice.hidden=!notice.textContent;
    if(focus){win.scrollTo({top:0});heading.focus({preventScroll:true});}
  }
  function navigate(path){
    const target=resolveRoute(path);
    if(current===target)return;
    win.history.pushState({},'',target);
    render({focus:true});
  }
  function click(event){
    const link=event.target.closest('a[data-route]');
    if(!link||event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||link.target||link.hasAttribute('download'))return;
    const url=new URL(link.href,win.location.href);
    if(url.origin!==win.location.origin)return;
    event.preventDefault();navigate(url.pathname);
  }
  const popstate=()=>render({focus:true});
  const beforeunload=event=>{if(hasWork()||isBusy()){event.preventDefault();event.returnValue='';}};
  doc.addEventListener('click',click);
  win.addEventListener('popstate',popstate);
  win.addEventListener('beforeunload',beforeunload);
  render();
  return {navigate,refresh:()=>render(),destroy(){doc.removeEventListener('click',click);win.removeEventListener('popstate',popstate);win.removeEventListener('beforeunload',beforeunload);}};
}
