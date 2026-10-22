# Voley Calendar

## Páginas y navegación

Ejecuta `npm run dev` y abre la dirección que indique Vite (por defecto `http://localhost:5173`):

- `/`: inicio con las opciones **Nueva designación** y **Revisar cambios**.
- `/nueva`: PDF, árbitro, edición y selección de partidos, importación a Google y exportación ICS.
- `/revision`: PDF actualizado, calendario, jornada, comparación, resolución manual, confirmación de eliminaciones y reintentos.

La navegación utiliza History API, admite atrás/adelante y mantiene los mismos controles, documento, ediciones, resultados y sesión de Google en memoria. Al cambiar de página se informa de que el trabajo se conserva; al recargar o abandonar con documentos cargados u operaciones en curso, el navegador solicita confirmación. Recargar sí reinicia el trabajo y la conexión: no se guardan tokens ni documentos en almacenamiento persistente.

`vercel.json` dirige las solicitudes directas a `/nueva` y `/revision` a `index.html`; los recursos usan rutas absolutas. Esta configuración se aplicará en el próximo despliegue. No es necesario añadir una biblioteca de rutas.

Importa designaciones arbitrales PDF o imágenes, filtra por árbitro, revisa los datos y exporta a Apple Calendar o Google Calendar. El repositorio original era JavaScript y HTML estático, sin React: se conserva esa interfaz y se utiliza Vite para empaquetar PDF.js y su worker local.

## Desarrollo

Requiere Node.js 22.13+ (probado con Node 24).

```sh
npm ci
npm run dev
npm test
npm run build
```

Publica `dist/` en un hosting HTTPS. No abras `index.html` directamente: los módulos y el worker requieren un servidor. En entornos que bloquean subprocesos se pueden ejecutar las pruebas con `node --test --test-isolation=none`.

## Uso

1. Selecciona uno o varios PDF, PNG, JPG o WEBP y pulsa **Analizar documentos**. Se leen todas las páginas de cada PDF. Los errores identifican el archivo afectado.
2. Si hay páginas sin texto seleccionable, pulsa **Procesar con OCR**. Las imágenes utilizan OCR directamente. Tesseract y sus idiomas requieren conexión; los documentos se procesan en el navegador.
3. Selecciona uno de los árbitros encontrados en las tres columnas arbitrales. La comparación ignora espacios repetidos, tildes y mayúsculas. La lista conserva la primera grafía original y distingue erratas diferentes: «PAULA PERZ» no se convierte automáticamente en «PAULA PEREZ».
4. Revisa y edita los partidos. Puedes cambiar de árbitro sin procesar nuevamente el archivo y conservando las ediciones. La función se deriva de su columna; cualquier corrección de función se conserva por árbitro y partido. Los partidos manuales y las filas de formato desconocido siguen visibles para completar sus datos.
5. Ajusta la duración general (120 minutos inicialmente) o la duración de cada partido, y selecciona los eventos que quieras exportar. Las advertencias del OCR o de columnas requieren revisión explícita. Los datos esenciales incompletos bloquean la exportación.
6. Descarga `.ics` o inicia sesión con Google, selecciona el calendario de destino y crea los eventos. Cada resultado de Google se muestra individualmente, incluso si falla un evento.

Volver a analizar documentos sustituye los resultados actuales. No hay persistencia de partidos al recargar la página.

## Revisión de eventos

Los partidos del árbitro se ordenan cronológicamente; las fechas u horas inválidas quedan al final para su revisión. Las tarjetas muestran la finalización calculada y una vista previa del título, ubicación y descripción. El título exportado sigue el formato `🏐 Función arbitral | Equipo local vs Equipo visitante`. La descripción incluye categoría, función y los demás árbitros disponibles, con sus funciones originales.

La duración inicial es de 120 minutos. El campo de duración propia permite cambiarla por partido; dejarlo vacío utiliza la duración general. Se conservan los campos editados y la selección al cambiar de árbitro, además de las correcciones de función guardadas para cada árbitro.

Antes de exportar se muestra el total seleccionado y se buscan posibles duplicados con el mismo instante de inicio, equipos y árbitro, ignorando tildes, mayúsculas y espacios repetidos. Las diferencias de función o pabellón no ocultan una posible repetición. Los grupos se resaltan en las tarjetas y deben corregirse o deseleccionarse antes de exportar; no se eliminan automáticamente.

## Extracción y límites

- `src/pdf.js`: PDF.js y worker empaquetados, lectura de todas las páginas, progreso y renderizado para OCR opcional.
- `src/round.js`: intervalos de cabecera, alternativa por fechas originales, confirmación de casos ambiguos y claves automáticas de jornada. La extracción de las filas no cambia.
- `src/extract.js`: reconstrucción por coordenadas y fechas que anclan las filas; no se dividen nombres por espacios. Las columnas están calibradas para el documento de la Delegación Granadina incluido en `fixtures/`. Se conservan huecos entre primer árbitro, segundo árbitro y anotador. Un formato desconocido exige completar los campos y verificar las funciones. Cambios de plantilla requieren ajustar `granadaLayout` y añadir ejemplos a las pruebas.
- `src/model.js`: normalización, nombres únicos, filtrado y funciones arbitrales.
- `src/prepare.js`: orden cronológico, preparación de eventos para revisión y detección de duplicados dentro de la selección, separado de la extracción PDF.
- `src/calendar.js`: fechas de Madrid, duración y utilidades de calendario. Las horas inexistentes en marzo se rechazan; las horas repetidas en octubre requieren elegir una ocurrencia.
- `src/ics.js`: exportación a Apple Calendar con la preparación común de eventos, formato iCalendar y descarga mediante un enlace persistente. No requiere dependencias adicionales.
- `src/google.js`: OAuth, calendarios editables, consulta paginada de duplicados, IDs deterministas y resultados por evento. Los tokens permanecen en memoria.
- `src/google-identity.js`: copia de datos originales después de la extracción e identidad de designación independiente de las ediciones posteriores. No modifica el parser.
- `src/sync.js`: metadatos persistentes, correspondencias, diferencias y operaciones de sincronización controladas con ETags.
- `src/sync-ui.js`: vista previa, selección de cambios, resolución manual y confirmación de eliminaciones.

La extracción automática está validada para el PDF incluido, no para cualquier diseño de tabla. Las filas multilínea, tablas desplazadas, recortes y escaneos pueden necesitar corrección manual. El texto que atraviesa límites de columna genera advertencias. El OCR siempre requiere revisión y, si no reconstruye una tabla, conserva el texto para completar el partido manualmente. No se inventan equipos, nombres ni funciones ausentes.

## Google Calendar

1. Crea o selecciona un proyecto de Google Cloud y habilita **Google Calendar API**.
2. En **Google Auth Platform**, configura el nombre de la aplicación, audiencia y correo de contacto. Si la aplicación es externa y está en modo de prueba, añade tu cuenta en los usuarios de prueba.
3. Declara los permisos `https://www.googleapis.com/auth/calendar.events` y `https://www.googleapis.com/auth/calendar.calendarlist.readonly`. Permiten consultar/crear eventos en el calendario elegido y leer la lista de calendarios sin solicitar acceso completo a Calendar.
4. Crea un cliente OAuth de tipo **Aplicación web**. Añade `http://localhost:5173` a **Orígenes JavaScript autorizados**. El puerto debe coincidir exactamente con el servidor. Para producción añade el origen HTTPS publicado y configura/verifica la pantalla de consentimiento según el estado de la aplicación.
5. No se necesita URI de redirección para este flujo de tokens con ventana emergente ni client secret en el frontend. Se utiliza el [modelo de tokens de Google Identity Services](https://developers.google.com/identity/oauth2/web/guides/use-token-model).

### Configuración local

Copia `.env.example` a `.env.local` e introduce tu ID público:

```dotenv
VITE_GOOGLE_CLIENT_ID=tu-id.apps.googleusercontent.com
```

Reinicia Vite tras cambiar la variable. `.env.local` está excluido de Git. El Client ID es público y Vite lo incluye en el navegador; nunca añadas un client secret a variables `VITE_`. El único dato de Google que la aplicación guarda en localStorage es el identificador del calendario preferido. No se guardan tokens ni contraseñas.

```sh
npm run dev -- --port 5173 --strictPort
```

Abre `http://localhost:5173` (autoriza por separado otro origen si usas 127.0.0.1). Permite ventanas emergentes y comprueba que Google Identity Services no esté bloqueado por extensiones.

### Comprobación manual en localhost

1. Sube el PDF de `fixtures/`, elige árbitro, revisa los campos y selecciona uno o dos partidos.
2. Pulsa **Conectar Google Calendar**, autoriza ambos permisos y elige un calendario de prueba con permiso de escritura. Comprueba su nombre y descripción. No se crea ningún evento al conectar.
3. Pulsa **Importar a Google Calendar**. Comprueba el resultado individual y abre los eventos en Google para verificar título, horario, duración, descripción y ubicación.
4. Repite la importación: deben aparecer como existentes. Recarga y vuelve a cargar el mismo PDF: la identidad debe mantenerse. Cambia después la hora o el pabellón: el evento debe aparecer como **pendiente de actualización**, sin ser modificado ni duplicado.
5. Para comprobar la migración, crea un evento antiguo sin metadatos con los mismos equipos, función y fecha: debe mostrarse como coincidencia dudosa para revisión, sin crear otro automáticamente.
6. Prueba cancelar la ventana de autorización, denegar un permiso, desconectar y reconectar. Para probar errores de red, desconecta la red durante una importación. El botón **Reintentar solo los fallidos** utiliza los datos y el calendario de la importación anterior y conserva los resultados correctos. Una nueva importación normal utiliza tus últimas ediciones.

### Identidad y resultados

Se captura una copia de los datos originales justo después de extraer el documento. El ID SHA-256 de Google se calcula con fecha, equipos, categoría y competición originales, junto con el árbitro seleccionado. La hora y el pabellón no forman parte de la identidad; editar los datos de un partido importado tampoco cambia su copia original. Los partidos manuales fijan su identidad la primera vez que se preparan para exportar. Dos partidos sin otro identificador y con todos esos datos originales iguales se consideran la misma designación y requieren revisión; no se utiliza la hora para desambiguarlos.

El ID se utiliza como ID determinista de evento y como `extendedProperties.private.voleyId`. Los eventos con jornada automática usan metadatos de versión 4: marcador de Voley Calendar, identidad de origen, árbitro, intervalo, competición y huella del contenido revisado. Se siguen admitiendo las versiones anteriores. Se consultan todas las páginas del intervalo y también se busca la identidad sin restricción de fecha para encontrar eventos movidos. La importación normal sigue siendo una operación de creación: si un evento identificado difiere del preparado se marca pendiente de actualización y no se modifica automáticamente. La sección de sincronización permite revisar y aplicar esas actualizaciones de forma explícita.

La importación informa de creados, existentes, pendientes de actualización, coincidencias dudosas y errores. Solo se muestra «creado» tras la confirmación de Google. El servicio evita importaciones simultáneas, utiliza reintentos limitados con espera para errores temporales y resuelve conflictos 409 leyendo el evento antes de clasificarlo. Un error 401 obliga a conectar de nuevo; los errores de permisos 403 se muestran sin repetirlos indiscriminadamente. Las solicitudes de renovación de sesión son explícitas, desde el botón de conexión.

El token permanece únicamente en memoria, caduca y se elimina al desconectar. Se solicita la revocación a Google al desconectar. Recargar requiere volver a conectar, pero conserva la preferencia de calendario por su ID.

Referencias: [modelo de tokens](https://developers.google.com/identity/oauth2/web/guides/use-token-model), [lista de calendarios](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list), [creación de eventos](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert) y [errores de Calendar API](https://developers.google.com/workspace/calendar/api/guides/errors).

## Sincronizar una jornada con Google Calendar

1. Carga el PDF actualizado y selecciona al árbitro. Revisa **todos** sus partidos, incluidos los que estén deseleccionados para la importación normal. Una selección parcial para exportar nunca se interpreta como retirada de partidos.
2. Conecta Google y elige el calendario de destino habitual.
3. La sección **Sincronizar una jornada con Google** muestra el intervalo detectado, sin pedir identificadores ni fechas. Se usa la cabecera del PDF cuando es válida; por ejemplo, `JORNADA DEL 12 DE OCTUBRE DE 2026 AL 18 DE OCTUBRE DE 2026` produce exactamente ese intervalo, sin asumir lunes-domingo. En ausencia de cabecera se usan las fechas originales de todos los partidos, antes del filtro por árbitro. Solo si falta información, hay fechas dispersas/cabeceras contradictorias o partidos fuera de la cabecera aparece un panel para confirmar el intervalo.
4. Deja desmarcada la casilla de jornada completa para PDF parciales. Márcala únicamente después de contrastar todas las filas del PDF original. La casilla se desmarca al volver a procesar un documento. Si hubo incidencias de lectura/OCR, no se ofrecerán eliminaciones aunque la marques.
5. Pulsa **Comprobar cambios**. Esta consulta no modifica Google y compara únicamente eventos identificados como gestionados por Voley Calendar, además de reconocer tombstones de sus identidades conocidas. Se clasifican las filas como **Nuevo**, **Sin cambios**, **Modificado**, **Posible eliminación** o **Coincidencia dudosa**, con valores anteriores/nuevos. Ninguna operación está seleccionada inicialmente.
6. Resuelve las coincidencias dudosas mediante **Confirmar correspondencia**. Vincular un evento solo está permitido si se identifica como gestionado por Voley Calendar y corresponde al mismo árbitro. Una confirmación de partido nuevo permite crear una designación distinta o recrear un evento eliminado, sin reutilizar su ID ocupado. Si ambos equipos/categoría han sido corregidos sin semejanza reconocible, un partido clasificado como nuevo también ofrece vinculación manual a los eventos gestionados de esa jornada.
7. Selecciona individualmente las operaciones y pulsa **Aplicar cambios seleccionados**. Las posibles eliminaciones muestran un diálogo adicional con los títulos y fechas concretos. Cancelarlo no modifica Google. Las filas sin cambios no provocan escrituras, salvo que selecciones expresamente **Registrar identificación de jornada** para migrar o completar metadatos.
8. Consulta el resultado de cada fila. **Reintentar operaciones fallidas** conserva los datos de la vista previa y excluye operaciones ya completadas. Una reconexión al mismo calendario conserva esa posibilidad. Si hay un conflicto de versión, comprueba de nuevo y revisa los valores actuales; no se sobrescribe la edición concurrente.

### Identidad, migración y límites de seguridad

La raíz persistente es `voleyId`, que se conserva al actualizar el mismo evento de Google. `voleySource` identifica el origen original; `voleyLatestSource` y `voleyAliases` registran las identidades posteriores reconocidas, sin usar el UUID aleatorio de la tarjeta. `voleyFingerprint` representa el contenido revisado. `voleyMatch` guarda equipos, competición, categoría, fecha de origen y árbitro. `voleyRound` es una clave interna automática del ámbito de designaciones, la competición global de voleibol y el intervalo; `voleyRoundCompetition` identifica la competición/categoría concreta dentro de esa jornada. `voleyRoundFrom`, `voleyRoundTo`, `voleyCompetitionScope`, `voleyRef` y `voleyOrigin` conservan sus límites y ámbito. La clave no depende del conjunto cambiante de equipos ni de los horarios de las filas.

Al carecer estos PDF de un ID externo de partido fiable, los encuentros no se identifican solo por su fecha. Un partido movido de sábado a domingo se clasifica como modificado si hay una correspondencia única de equipos, competición, categoría y árbitro dentro de la misma jornada. Un cambio de pabellón u hora tampoco crea otra identidad. Toda operación requiere selección y aplicación explícitas. Si hay varios candidatos, cambian equipos/categoría o la evidencia es insuficiente, se pide vinculación manual; las coincidencias débiles nunca autorizan una actualización. Los alias confirmados quedan en Google para las siguientes versiones. Los metadatos tienen un límite de tamaño: si el historial lo supera se pide revisión, sin truncarlo silenciosamente.

Cuando no hay cabecera y desaparece una fecha extrema del PDF actualizado, se reutiliza el intervalo previo de Google si contiene las fechas detectadas y existe evidencia única del mismo ámbito, árbitro y partidos. Esto mantiene la clave al retirar una designación. Si varios intervalos previos son compatibles se pide confirmación. Un solo día sin cabecera también requiere confirmar; si se confirma la propuesta y hay un intervalo anterior inequívoco, se conserva ese intervalo. No se utiliza localStorage para inventar una semana ni se redondea a lunes-domingo.

La consulta lee el intervalo con 14 días de margen a cada lado, las identidades conocidas y los eventos de la jornada registrada. Dos jornadas próximas conservan intervalos y claves diferentes; sus encuentros no se vinculan automáticamente por compartir equipos. Los eventos fuera del margen y sin identidad/jornada reconocible pueden no aparecer como candidatos. Un evento personal sin metadatos fiables nunca se actualiza, adopta ni elimina. Los eventos antiguos con `voleyId` válido y árbitro/competición verificables pueden reconocerse y migrarse sin introducir el código antiguo; los casos insuficientes siguen requiriendo revisión.

Las posibles eliminaciones se limitan a eventos activos de Voley Calendar del mismo árbitro, origen y jornada. Se requiere confirmar que el PDF está completo y que la extracción sea fiable. No se ofrecen para PDF parciales, con incidencias, cabeceras contradictorias o fechas fuera de la cabecera. En versiones antiguas se exige evidencia adicional: pertenencia a la misma jornada antigua respaldada por coincidencias fiables, o cabecera válida, misma competición, fecha dentro del intervalo y una cohorte de importación reconocida. Sin esa evidencia no se propone retirar un evento antiguo. La aplicación no puede demostrar por sí sola que el documento esté completo: requiere contrastarlo con el original. Si el árbitro ya no aparece en la lista, puedes escribir su nombre exacto para comparar una jornada sin partidos actuales.

Las actualizaciones usan PATCH solo para los campos de designación y los metadatos privados, conservando recordatorios, invitados, colores y otros ajustes de Google. Se conservan los ID de Google. Se vuelve a leer el evento y se usa `If-Match` con su ETag; un cambio concurrente produce un conflicto 412. Un evento eliminado no se recrea automáticamente. Las respuestas perdidas se reconcilian al reintentar y las creaciones usan ID determinista. No se ejecutan sincronizaciones al cargar PDF ni hay tareas en segundo plano, backend o base de datos.

Se reutilizan OAuth y los permisos existentes: `calendar.events` permite también actualizar/eliminar, sin pedir acceso completo a Calendar. Ante 401 o permisos insuficientes, vuelve a conectar; no se guardan tokens. Vercel continúa usando `VITE_GOOGLE_CLIENT_ID` y el origen autorizado `https://voley-calendar.vercel.app` debe seguir configurado en Google Cloud. Este desarrollo no despliega automáticamente cambios a producción.

Referencias: [PATCH de eventos](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch), [eliminación de eventos](https://developers.google.com/workspace/calendar/api/v3/reference/events/delete) y [ETags y modificaciones condicionales](https://developers.google.com/workspace/calendar/api/guides/version-resources).

## Apple Calendar mediante archivo ICS

Selecciona el árbitro y los partidos, revisa los datos y pulsa **Exportar a Apple Calendar**, junto al botón de Google. No requiere conexión con Google, Apple ID ni acceso a iCloud. Si no hay partidos seleccionados se muestra un aviso. Los campos incompletos, horas inválidas y duplicados seleccionados deben revisarse antes de exportar.

Se genera un único `voley-calendar.ics` con los partidos seleccionados. Todos los datos visibles se obtienen de la preparación común de eventos y reflejan las últimas ediciones: título, categoría, competición, función, demás árbitros, pabellón, inicio y finalización. La duración es de 120 minutos por defecto y respeta la duración general y la propia de cada partido. Los recordatorios configurados se conservan.

El archivo utiliza UTF-8, líneas CRLF, escape de barras, comas, punto y coma y saltos de línea, y plegado de líneas a un máximo de 75 octetos sin cortar caracteres Unicode. Los instantes se convierten desde Europe/Madrid a UTC, incluyendo los cambios estacionales; no son horas flotantes que dependan de la zona del dispositivo. Los UID reutilizan la identidad original de designación ya existente en la aplicación, con el sufijo `@voley-calendar.local`, y no dependen del UUID aleatorio de la tarjeta ni cambian al corregir los datos revisados del partido. Solo la identidad se obtiene de la copia original; el contenido del evento utiliza los datos editados.

En ordenador se descarga el archivo. Si no comienza la descarga automática, pulsa el enlace **Descargar archivo .ics**, que permanece disponible hasta sustituirlo por otra exportación o cerrar la página. En Safari de iPhone/iPad se usa el mismo archivo y enlace; puedes guardarlo en Archivos o abrirlo según las opciones de la versión de iOS/iPadOS. La aplicación prepara el archivo, pero no añade eventos automáticamente al calendario.

Para comprobarlo en Mac, abre Calendario y utiliza **Archivo > Importar**, selecciona el `.ics` y el calendario de destino. Prueba también la descarga en Safari en un iPhone/iPad real y comprueba el flujo de apertura/importación disponible en ese dispositivo. La importación de archivos no es sincronización: un UID estable ayuda a identificar un evento, pero el comportamiento al reimportar o actualizar depende del cliente de calendario y no garantiza evitar todas las copias.

Referencias: [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545) e [importación de calendarios en Mac](https://support.apple.com/guide/calendar/import-or-export-calendars-icl1023/mac).

## Validación

Las pruebas leen el PDF real incluido: 27 partidos, 13 nombres únicos y correspondencia exacta de las tres columnas en todas las filas. También cubren fechas cortas, huecos, grafías originales, normalización, cambios de horario, UID estable y plegado ICS. Las pruebas de Google utilizan respuestas simuladas para comprobar conversión, identidad original tras editar, calendarios editables, preferencias, permisos denegados, caducidad, reconexión, paginación, duplicados, coincidencias antiguas, cambios pendientes, reintentos, errores 401/403/409/429/503, fallos de red y bloqueo de importaciones simultáneas.

Las pruebas de Apple cubren selección y varios eventos en un solo archivo, datos editados, duración propia y predeterminada, medianoche, verano/invierno y cambios de hora de Madrid, caracteres especiales y saltos de línea, plegado UTF-8, UID estable al repetir/corregir exportaciones, recordatorios, avisos de validación y enlace de descarga persistente con el clic automático bloqueado. La importación real en dispositivos Apple requiere verificación manual.

Las pruebas de sincronización procesan el PDF real dos veces y simulan Calendar API para comprobar creación/sin cambios, cambios de hora/pabellón/función, cambios ambiguos de fecha/equipos/categoría, registro y alias persistentes, partidos nuevos, retiradas de jornada completa, PDF parcial, incidentes de extracción, otro árbitro, eventos personales, duplicados de equipos, migración de versiones antiguas, cambios manuales en Google, ETags/412, eliminaciones previas, DELETE 204 y errores/reintentos de red con respuesta de actualización perdida. No se realizan escrituras en cuentas reales durante las pruebas.

Las pruebas de jornada automática comprueban cabeceras españolas y numéricas, cambios de año, intervalos no semanales, alternativa por fechas, confirmación condicional en la interfaz, cabeceras contradictorias, fechas fuera del intervalo, dos jornadas próximas, cambio de sábado a domingo, cambio de pabellón, migración de importaciones anteriores y conservación del intervalo sin cabecera al desaparecer fechas extremas. Los dos PDF de `fixtures/` (original con 27 partidos y actualizado con 26) mantienen el 12–18 de octubre de 2026 y permiten detectar Monachil–Albolote como posible retirada sin eliminarlo automáticamente.

### Diagnóstico de retiradas e importaciones antiguas

La vista previa muestra el intervalo de jornada, los límites de la consulta con margen, los eventos consultados, los eventos de Voley Calendar, los del árbitro seleccionado, las coincidencias con el PDF y las posibles eliminaciones. Si no pueden ofrecerse retiradas, muestra el motivo: integridad sin confirmar, documento declarado parcial, incidencias de extracción, intervalo contradictorio, metadatos insuficientes o ausencia de eventos identificables en el calendario elegido.

La casilla de jornada completa se reinicia al cargar otro documento. Estar desmarcada significa **integridad no confirmada**, no que el PDF haya sido detectado como parcial. Tras contrastar la jornada completa con el original, márcala y vuelve a comprobar. Los errores de extracción siguen bloqueando retiradas incluso cuando se confirma la integridad. No se deducen eliminaciones de una selección parcial de partidos.

Se corrigió una incompatibilidad con la versión 2: esos eventos pueden tener `voleyId` y `voleyVersion=2` pero carecer de `voleyOrigin` y de intervalo registrado. Antes se reconocían para los partidos presentes, pero se descartaban al buscar retiradas. Ahora se admite ese formato antiguo únicamente con evidencia fiable: marcador privado de la aplicación, árbitro verificable, cabecera de jornada válida, competición compatible y coincidencias reconocidas del mismo grupo de importación. Un origen explícitamente ajeno nunca se considera equivalente.

Si a un evento antiguo propio le falta la evidencia necesaria, aparece como coincidencia dudosa con motivo concreto. **Vincular manualmente este evento a la jornada** exige confirmar evento, árbitro e intervalo; después debes seleccionar y aplicar el registro de identificación. Esa operación modifica únicamente metadatos privados. Vuelve a comprobar para que una ausencia pueda clasificarse como posible eliminación. No se atribuyen eventos de otro árbitro conocido ni eventos personales sin marcador de la aplicación, ni se elimina nada al vincular.

La regresión reproduce los PDF reales y seis eventos antiguos de GERMAN RUIZ frente a cinco partidos actualizados: devuelve cinco coincidencias y una posible retirada, **Academia Voleibol Monachil vs Radiokable Albolote Rojo, 17/10/2026 a las 10:00 de Madrid**. El test fallaba con cero retiradas antes de la corrección. También se comprueba la retirada en el primer/último día, incluyendo horas próximas a medianoche interpretadas en Europe/Madrid, y la protección de PDF parciales, errores, otros árbitros y eventos personales. Las consultas no se limitan a los ID de los cinco partidos presentes: se lee la jornada completa con margen.

El inicio de sesión y la creación real de eventos requieren configurar OAuth y verificarlos con una cuenta autorizada. El OCR y el comportamiento visual en iPhone/iPad requieren comprobación en esos dispositivos.
