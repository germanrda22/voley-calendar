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
