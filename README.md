# Voley Calendar

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
- `src/extract.js`: reconstrucción por coordenadas y fechas que anclan las filas; no se dividen nombres por espacios. Las columnas están calibradas para el documento de la Delegación Granadina incluido en `fixtures/`. Se conservan huecos entre primer árbitro, segundo árbitro y anotador. Un formato desconocido exige completar los campos y verificar las funciones. Cambios de plantilla requieren ajustar `granadaLayout` y añadir ejemplos a las pruebas.
- `src/model.js`: normalización, nombres únicos, filtrado y funciones arbitrales.
- `src/prepare.js`: orden cronológico, preparación de eventos para revisión y detección de duplicados dentro de la selección, separado de la extracción PDF.
- `src/calendar.js`: fechas de Madrid, duración, identificadores SHA-256 estables y archivo ICS con escape y plegado UTF-8. Los instantes se exportan en UTC después de convertir desde Europe/Madrid, evitando depender de la zona del dispositivo. Las horas inexistentes en marzo se rechazan; las horas repetidas en octubre requieren elegir una ocurrencia.
- `src/google.js`: OAuth, calendarios editables, consulta paginada de duplicados, IDs deterministas y resultados por evento. Los tokens permanecen en memoria.
- `src/google-identity.js`: copia de datos originales después de la extracción e identidad de designación independiente de las ediciones posteriores. No modifica el parser.

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

El ID se utiliza como ID determinista de evento y como `extendedProperties.private.voleyId`, con `voleyVersion=2`. Se consultan todas las páginas del intervalo de fechas y también se busca cada identidad sin restricción de fecha para encontrar eventos movidos. Los eventos antiguos sin la identidad nueva se comparan conservadoramente por fecha, equipos y función, y se muestran para revisión. Si un evento identificado difiere del preparado se marca pendiente de actualización; esta versión no realiza actualizaciones automáticas.

La importación informa de creados, existentes, pendientes de actualización, coincidencias dudosas y errores. Solo se muestra «creado» tras la confirmación de Google. El servicio evita importaciones simultáneas, utiliza reintentos limitados con espera para errores temporales y resuelve conflictos 409 leyendo el evento antes de clasificarlo. Un error 401 obliga a conectar de nuevo; los errores de permisos 403 se muestran sin repetirlos indiscriminadamente. Las solicitudes de renovación de sesión son explícitas, desde el botón de conexión.

El token permanece únicamente en memoria, caduca y se elimina al desconectar. Se solicita la revocación a Google al desconectar. Recargar requiere volver a conectar, pero conserva la preferencia de calendario por su ID. La exportación ICS anterior se conserva sin ampliarla; sus reglas de UID siguen siendo independientes de las de Google.

Referencias: [modelo de tokens](https://developers.google.com/identity/oauth2/web/guides/use-token-model), [lista de calendarios](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list), [creación de eventos](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert) y [errores de Calendar API](https://developers.google.com/workspace/calendar/api/guides/errors).

## Validación

Las pruebas leen el PDF real incluido: 27 partidos, 13 nombres únicos y correspondencia exacta de las tres columnas en todas las filas. También cubren fechas cortas, huecos, grafías originales, normalización, cambios de horario, UID estable y plegado ICS. Las pruebas de Google utilizan respuestas simuladas para comprobar conversión, identidad original tras editar, calendarios editables, preferencias, permisos denegados, caducidad, reconexión, paginación, duplicados, coincidencias antiguas, cambios pendientes, reintentos, errores 401/403/409/429/503, fallos de red y bloqueo de importaciones simultáneas.

El inicio de sesión y la creación real de eventos requieren configurar OAuth y verificarlos con una cuenta autorizada. El OCR y el comportamiento visual en iPhone/iPad requieren comprobación en esos dispositivos.
