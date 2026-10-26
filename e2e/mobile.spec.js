import {test,expect} from '@playwright/test';
import path from 'node:path';
const pdf=path.resolve('fixtures/DESIGNACION ARBITRAL DEL 19 AL 25 DE OCTUBRE DE 2026.pdf');
const expected=['ALBA JIMENEZ','ALEJANDRO MORALES','ANGEL BERTOS','ANGELA SIMON','DANIEL SANCHEZ-HOLGADO','GERMAN RUIZ','GRETA VARESI','IVAN LOPEZ RULL','JESUS MOYA','JOSE NOGUERA','KIGAN','LUCIA ROJAS','MARIA AGUAYO','MIRIAM MUNOZ','NACHO MEDINA','PAULA LAMA','PAULA PEREZ','VICTOR M. RUIZ'];
async function mockGoogle(page){
  const calls=[],events=new Map();let revision=0;
  await page.addInitScript(()=>window.testAccount='A');
  await page.route('https://accounts.google.com/gsi/client',route=>route.fulfill({contentType:'text/javascript',body:`window.google={accounts:{oauth2:{initTokenClient:config=>({requestAccessToken:()=>config.callback({access_token:'test-'+window.testAccount,expires_in:3600,scope:config.scope})}),revoke:(_token,callback)=>callback()}}};`}));
  await page.route('https://www.googleapis.com/calendar/v3/**',async route=>{
    const req=route.request(),url=new URL(req.url()),account=req.headers().authorization?.replace('Bearer test-','');
    if(url.pathname.endsWith('/calendarList'))return route.fulfill({json:{items:[{id:'primary-'+account,summary:'Principal '+account,primary:true,accessRole:'owner'},{id:'voley-'+account,summary:'VOLEY '+account,accessRole:'writer'},{id:'readonly-'+account,summary:'Solo lectura',accessRole:'reader'}]}});
    const [,calendar,tail]=/\/calendars\/([^/]+)\/(.*)/.exec(url.pathname)||[];
    calls.push({account,calendar:decodeURIComponent(calendar||''),method:req.method()});
    if(!['primary-'+account,'voley-'+account].includes(calendar))return route.fulfill({status:403,json:{error:{message:'Wrong account'}}});
    const storeKey=account+'|'+calendar;if(!events.has(storeKey))events.set(storeKey,new Map());const store=events.get(storeKey);
    if(req.method()==='POST'){
      const payload=req.postDataJSON();if(store.has(payload.id))return route.fulfill({status:409,json:{error:{}}});
      const event={...payload,etag:'e'+ ++revision,status:'confirmed'};store.set(event.id,event);return route.fulfill({json:event});
    }
    if(tail==='events'){
      let all=[...store.values()].filter(e=>e.status!=='cancelled');
      const property=url.searchParams.get('privateExtendedProperty');if(property){const [key,value]=property.split('=');all=all.filter(e=>e.extendedProperties?.private?.[key]===value);}
      return route.fulfill({json:{items:all}});
    }
    const event=store.get(tail?.split('/')[1]);if(!event)return route.fulfill({status:404,json:{error:{}}});
    if(req.method()==='DELETE'){event.status='cancelled';return route.fulfill({status:204});}
    return route.fulfill({json:event});
  });
  return {calls,events};
}
async function load(page){await page.locator('#images').setInputFiles(pdf);await expect(page.locator('#refereeHelp')).toContainText('18 árbitros');}

test('PDF real: 18 nombres, búsqueda normalizada, selección táctil y cinco partidos sin desbordamiento',async({page,isMobile})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await mockGoogle(page);await page.goto('/');
  await expect(page.locator('#refereeSelect')).toBeDisabled();await expect(page.locator('#refereeHelp')).toContainText('No se han detectado');
  await load(page);
  expect(await page.locator('#refereeSelect option').evaluateAll(options=>options.map(o=>o.value).filter(Boolean))).toEqual(expected);
  await page.locator('#refereeSearch').fill('gérman');
  await expect(page.locator('#refereeSelect option')).toHaveCount(2);
  if(isMobile)await page.locator('#refereeSelect').tap();else await page.locator('#refereeSelect').click();
  await page.locator('#refereeSelect').press('Escape');
  await page.locator('#refereeSelect').selectOption('GERMAN RUIZ');await expect(page.locator('#count')).toHaveText('5');
  await page.locator('#refereeSearch').fill('no existe');await expect(page.locator('#refereeHelp')).toContainText('No hay nombres');
  await page.getByText('Introducir el nombre manualmente').click();await page.locator('#referee').fill('Germán Ruiz');await expect(page.locator('#count')).toHaveText('5');
  await expect(page.locator('#referee')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  expect(await page.locator('#refereeSelect').evaluate(el=>getComputedStyle(el).fontSize)).toBe('16px');
  expect(await page.locator('#refereeSelect').evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  expect(errors).toEqual([]);
});

test('cuentas A→B→A: preferencias aisladas, limpieza de PDF y sincronización solo en el destino elegido',async({page})=>{
  const {calls,events}=await mockGoogle(page);await page.goto('/');
  await page.getByRole('button',{name:'Conectar Google Calendar',exact:true}).click();
  await expect(page.locator('#calendar option')).toHaveCount(2);
  await page.locator('#calendar').selectOption('voley-A');await load(page);
  await page.locator('#refereeSelect').selectOption('GERMAN RUIZ');
  await expect(page.locator('#syncRound')).toBeEnabled();
  page.on('dialog',dialog=>dialog.accept());await page.locator('#syncRound').click();
  await expect(page.locator('#result')).toContainText('Creados: 5');
  expect(calls.filter(c=>c.method==='POST')).toHaveLength(5);
  expect(calls.filter(c=>c.method!=='GET').every(c=>c.account==='A'&&c.calendar==='voley-A')).toBe(true);
  await expect(page.locator('#syncRound')).toBeEnabled();await page.locator('#syncRound').click();
  await expect(page.locator('#result')).toContainText('Creados: 0');expect(calls.filter(c=>c.method==='POST')).toHaveLength(5);
  await page.evaluate(()=>window.testAccount='B');await page.getByRole('button',{name:'Cambiar cuenta de Google'}).click();
  await expect(page.locator('#calendar')).toHaveValue('primary-B');await expect(page.locator('#referee')).toHaveValue('');await expect(page.locator('#refereeSelect')).toHaveValue('');
  await expect(page.locator('#files')).toHaveText('Ningún archivo seleccionado');await expect(page.locator('#result')).toBeEmpty();await expect(page.locator('#syncRound')).toBeDisabled();
  expect(await page.locator('#calendar option').evaluateAll(options=>options.map(o=>o.value))).toEqual(['primary-B','voley-B']);
  await page.locator('#calendar').selectOption('voley-B');await load(page);await page.locator('#refereeSelect').selectOption('ALBA JIMENEZ');
  await page.evaluate(()=>window.testAccount='A');await page.getByRole('button',{name:'Cambiar cuenta de Google'}).click();
  await expect(page.locator('#calendar')).toHaveValue('voley-A');await expect(page.locator('#referee')).toHaveValue('GERMAN RUIZ');await load(page);await expect(page.locator('#refereeSelect')).toHaveValue('GERMAN RUIZ');
  expect([...events.keys()].filter(key=>key.startsWith('B|')).every(key=>events.get(key).size===0)).toBe(true);
  const prefs=await page.evaluate(()=>Object.entries(localStorage).filter(([key])=>key.startsWith('voley.preferences.')));expect(prefs).toHaveLength(2);
  expect(prefs.every(([,value])=>!value.includes('test-A')&&!value.includes('test-B'))).toBe(true);
});
