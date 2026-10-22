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

Antes de exportar se muestra el total seleccionado y se buscan posibles duplicados con el mismo instante de inicio, equipos y árbitro, ignorando tildes, mayúsculas y espacios repetidos. Las diferencias de función o pabellón no ocultan una posible repetición. Los grupos se resaltan en las tarjetas y deben corregirse o deseleccionarse antes de exportar; no se eliminan automáticamente. Este cambio conserva la integración OAuth existente sin añadir nuevas integraciones.

## Extracción y límites

- `src/pdf.js`: PDF.js y worker empaquetados, lectura de todas las páginas, progreso y renderizado para OCR opcional.
- `src/extract.js`: reconstrucción por coordenadas y fechas que anclan las filas; no se dividen nombres por espacios. Las columnas están calibradas para el documento de la Delegación Granadina incluido en `fixtures/`. Se conservan huecos entre primer árbitro, segundo árbitro y anotador. Un formato desconocido exige completar los campos y verificar las funciones. Cambios de plantilla requieren ajustar `granadaLayout` y añadir ejemplos a las pruebas.
- `src/model.js`: normalización, nombres únicos, filtrado y funciones arbitrales.
- `src/prepare.js`: orden cronológico, preparación de eventos para revisión y detección de duplicados dentro de la selección, separado de la extracción PDF.
- `src/calendar.js`: fechas de Madrid, duración, identificadores SHA-256 estables y archivo ICS con escape y plegado UTF-8. Los instantes se exportan en UTC después de convertir desde Europe/Madrid, evitando depender de la zona del dispositivo. Las horas inexistentes en marzo se rechazan; las horas repetidas en octubre requieren elegir una ocurrencia.
- `src/google.js`: OAuth, calendarios editables, consulta paginada de duplicados, IDs deterministas y resultados por evento. Los tokens permanecen en memoria.

La extracción automática está validada para el PDF incluido, no para cualquier diseño de tabla. Las filas multilínea, tablas desplazadas, recortes y escaneos pueden necesitar corrección manual. El texto que atraviesa límites de columna genera advertencias. El OCR siempre requiere revisión y, si no reconstruye una tabla, conserva el texto para completar el partido manualmente. No se inventan equipos, nombres ni funciones ausentes.

## Google Calendar

En Google Cloud habilita Google Calendar API y crea un OAuth Client ID de tipo aplicación web. Autoriza el origen exacto, incluido el puerto local, y configura los usuarios de prueba cuando corresponda. Introduce el ID público en la interfaz; no necesitas un client secret. Se solicitan permisos de eventos y lectura de la lista de calendarios.

La deduplicación consulta todas las páginas de eventos del intervalo y compara el identificador estable o título e instante. Google también rechaza un ID repetido. Cambiar los datos que forman la identidad (fecha, hora, equipos, árbitro o función) genera un identificador nuevo; no es una sincronización ni una actualización de eventos anteriores. La reimportación de ICS depende del comportamiento del cliente de calendario.

## Validación

Las pruebas leen el PDF real incluido: 27 partidos, 13 nombres únicos y correspondencia exacta de las tres columnas en todas las filas. También cubren fechas cortas, huecos, grafías originales, normalización, formato desconocido, cambios de horario, UID estable, plegado ICS y Google con respuestas simuladas (paginación, duplicados y errores individuales).

El inicio de sesión y la creación real de eventos requieren configurar OAuth y verificarlos con una cuenta autorizada. El OCR y el comportamiento visual en iPhone/iPad requieren comprobación en esos dispositivos.
