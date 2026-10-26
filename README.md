# Voley Calendar

Aplicación local en el navegador para sincronizar una jornada completa de designaciones arbitrales con Google Calendar o exportarla como ICS.

## Uso

1. Ejecuta `npm install` y `npm run dev`.
2. Configura `VITE_GOOGLE_CLIENT_ID` en `.env.local` y autoriza el origen local en Google Cloud. La autorización de Calendar se mantiene únicamente en memoria.
3. Conecta Google, selecciona un PDF completo, tu nombre y el calendario de destino.
4. La cabecera y las fechas del PDF identifican la jornada. La consulta automática muestra cuántos eventos anteriores se sustituirán, cuántos partidos nuevos se crearán y cuántos ya coinciden.
5. Pulsa **Sincronizar jornada** y confirma una sola vez que el documento contiene la jornada completa. No hay revisión individual de modificaciones.

La exportación **Apple Calendar (ICS)** es independiente de la conexión con Google. Utiliza el formato de eventos existente, Europe/Madrid, duración de 120 minutos y recordatorio de cero minutos. Las rutas antiguas `/nueva` y `/revision` sirven la misma pantalla simplificada.

## Seguridad de la sustitución

- Solo se eliminan eventos identificados como gestionados por Voley Calendar, del mismo árbitro y con metadatos de la misma jornada y origen. No basta con una fecha o un título.
- Una importación antigua sin intervalo solo se puede sustituir si existe una correspondencia única en ambas direcciones con un partido del PDF. Los antiguos retirados sin identificación suficiente se conservan y se avisa.
- Los eventos personales, otros árbitros y otras jornadas se conservan. Los eventos dudosos no se adoptan ni eliminan.
- PDF con incidencias, páginas sin extracción, fechas contradictorias o sin cabecera inequívoca bloquean la sincronización. No puede demostrarse automáticamente la integridad de un PDF recortado que conserva una cabecera válida: la confirmación del usuario sigue siendo necesaria.
- Se conserva cada evento que ya coincide exactamente. Los demás partidos se crean con identidades deterministas y se vuelven a leer. Solo después de verificar **todos** los partidos deseados comienza el borrado de los anteriores.
- Si falla una creación o verificación, no se borra ningún evento anterior. Las creaciones parciales permanecen y se reutilizan al reintentar; puede haber duplicados temporales hasta completar el reintento.
- Los ETags de los eventos anteriores se verifican antes de borrar; DELETE utiliza `If-Match`. Un fallo durante el borrado se informa y se puede reintentar sin volver a crear lo ya guardado. Google Calendar no ofrece una transacción atómica para la jornada completa.
- Se bloquean operaciones concurrentes en la aplicación y entre pestañas del mismo navegador mediante Web Locks cuando está disponible. Las identidades deterministas evitan duplicar creaciones concurrentes; no existe un bloqueo de servidor entre dispositivos distintos.

## Validación y despliegue

`npm test` ejecuta las regresiones del parser con los PDF reales, Google simulado, sincronización repetida, cambios de pabellón/hora/función, retiradas, creación parcial, errores de verificación/borrado, ETags y conservación de eventos ajenos. `npm run build` compila con Vite. Los módulos de revisión anteriores conservan sus pruebas de compatibilidad, pero ya no se cargan en la interfaz.

La verificación con una cuenta real requiere OAuth y una comprobación visual local. Nunca se escriben eventos reales durante los tests. El parser PDF corregido no se modifica para este flujo.

Vercel utiliza `VITE_GOOGLE_CLIENT_ID` y el origen configurado en Google Cloud. Antes de desplegar hay que superar todas las pruebas y la compilación; el despliegue necesita una sesión de Vercel y acceso al proyecto correspondiente.

## Diagnóstico y alcance de las incidencias

El diagnóstico de extracción muestra severidad, página, partido y campo. Un desbordamiento se considera advertencia únicamente cuando el valor completo de la celda se conserva en el texto original y no hay errores de validación. Los indicadores originales del parser se conservan; la clasificación se realiza en `src/extraction-diagnostics.js`.

La validez del árbitro seleccionado se evalúa independientemente de los campos de otros árbitros. La integridad documental se comprueba con todas las fechas, una única cabecera, páginas leídas, ausencia de duplicados y asignaciones arbitrales seguras. Una asignación desconocida en otra fila puede ocultar una designación del árbitro y bloquea las retiradas. Los errores críticos ajenos que no afectan a la identificación ni a la integridad permanecen visibles en el diagnóstico.

El PDF real del 19–25 de octubre contiene dos avisos de desbordamiento del anotador DANIEL SANCHEZ-HOLGADO, ambos en la página 1. Sus 39 filas y los cinco partidos de GERMAN RUIZ se validan sin convertir esas advertencias en un bloqueo global. La confirmación del usuario de que el PDF representa la jornada completa sigue siendo obligatoria antes de sincronizar; una cabecera válida no demuestra por sí sola que no se hayan recortado filas.

## Cuentas independientes y selector móvil

Cada conexión abre el selector de cuenta de Google. La lista de destinos contiene únicamente calendarios editables devueltos por `users/me/calendarList` para esa autorización. El servicio rechaza operaciones sobre destinos que no estén en esa lista. Los planes de comparación se vinculan a la sesión: un plan antiguo no se puede aplicar con otra cuenta, aunque ambas compartan un calendario.

Las preferencias de árbitro y calendario se guardan localmente bajo una clave SHA-256 derivada del identificador del calendario principal de la cuenta. No se solicitan permisos adicionales de perfil, correo ni OpenID. Si no se puede identificar un calendario principal, no se persisten preferencias. La antigua clave compartida no se lee ni se migra. Los tokens siguen únicamente en memoria. Al cambiar o desconectar una cuenta se limpian PDF, resultados, selecciones y enlaces de descarga; al reconectar la misma cuenta se recuperan únicamente sus preferencias. Estos datos locales no se transfieren entre dispositivos.

El selector anterior usaba `input list`/`datalist`; no había una lista propia con problemas de z-index. Su presentación de sugerencias depende del navegador, especialmente en móvil. Se sustituye por un `select` nativo, con búsqueda independiente que normaliza tildes, espacios y mayúsculas y obtiene los nombres de las tres funciones. La lista nativa se desplaza en el selector del sistema y no queda recortada por capas del documento. Existe un mensaje para PDF sin nombres y entrada manual accesible. Se mantienen controles de al menos 44 px y texto de 16 px para evitar zoom de formularios en iPhone.

### Comprobaciones en navegadores

- `npm test`: regresiones existentes y nuevas pruebas de aislamiento de cuentas, destinos y preferencias.
- `npm run build`: compilación de producción local, sin publicar.
- `npx playwright install chromium webkit`: instala los motores de prueba; el proyecto usa `.cache/playwright`. En PowerShell: `$env:PLAYWRIGHT_BROWSERS_PATH=Join-Path (Get-Location) '.cache/playwright'` antes de instalarlos.
- `npm run test:e2e`: navegador de escritorio, WebKit con dispositivo iPhone 13 y Chromium con Pixel 7. Procesa el PDF real 19–25, verifica 18 árbitros únicos y los cinco partidos de GERMAN RUIZ, búsqueda, selección táctil, ausencia de desbordamientos, cambio A→B→A y sincronización repetida en el calendario elegido. OAuth y Calendar se simulan; no se hacen escrituras reales.

La emulación no sustituye una comprobación final del popup OAuth en un iPhone y un Android físicos con una cuenta externa real. Para esa comprobación móvil utiliza un origen HTTPS autorizado, no la IP HTTP del ordenador en la red local.

### Configuración necesaria en Google Cloud y Vercel

No se puede deducir el estado actual de Google Auth Platform a partir de `.env.local`; estos ajustes se revisan en la consola del proyecto:

1. Habilitar Google Calendar API y utilizar un cliente OAuth de tipo aplicación web.
2. En Google Auth Platform → Audience, configurar la audiencia **External**. Para uso público, cambiar el estado a **In production**; **Testing** limita el acceso a usuarios de prueba y no cumple el objetivo de acceso abierto. Completar la verificación de Google que corresponda a los permisos de Calendar. Las políticas de una organización Workspace pueden imponer restricciones adicionales.
3. Mantener solo `calendar.events` y `calendar.calendarlist.readonly`. Son necesarios para gestionar eventos en destinos propios o compartidos y enumerar los destinos disponibles; no se solicita acceso completo a Calendar ni permisos de identidad.
4. Registrar el origen HTTPS exacto de producción y los orígenes de prueba que se vayan a usar en **Authorized JavaScript origins**. Para desarrollo, registrar localhost y su puerto. Las URLs variables de previews no se autorizan mediante comodines: usar un origen de pruebas estable autorizado.
5. Preparar página de inicio, política de privacidad y, cuando corresponda, términos, además de verificar el dominio para el proceso de aprobación. Esos datos identifican al responsable real y no deben inventarse.
6. En Vercel, configurar únicamente el identificador público `VITE_GOOGLE_CLIENT_ID` para el entorno correspondiente. No añadir secretos OAuth ni tokens a variables `VITE_*`, código, repositorio o almacenamiento del navegador. No se necesita un cliente por árbitro ni calendarios/correos fijos.

Fuentes oficiales: [audiencia y estado de publicación](https://support.google.com/cloud/answer/15549945?hl=en), [permisos de Calendar](https://developers.google.com/workspace/calendar/api/auth), [verificación de permisos sensibles](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification), [orígenes JavaScript de clientes web](https://support.google.com/cloud/answer/15549257?hl=en).
