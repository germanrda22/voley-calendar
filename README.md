# Voley Calendar — MVP

Web estática sin build, preparada para alojar en Vercel, Netlify o cualquier hosting HTTPS.

## Uso

1. Publica los archivos de esta carpeta en un hosting HTTPS o sírvelos localmente con `python -m http.server 8080`.
2. Sube capturas PNG/JPG/WEBP y pulsa **Analizar capturas**. El OCR utiliza Tesseract.js descargado desde CDN y procesa imágenes en el navegador.
3. Revisa manualmente cada campo detectado; el OCR inicial **solo localiza líneas que contienen el nombre y extrae fecha/hora**. La interpretación automática de equipos, pabellón y puesto queda para una segunda iteración adaptada a capturas reales.
4. Descarga el archivo ICS para Apple Calendar o configura OAuth de Google para crear eventos en el calendario principal.

## Google Calendar

Crea un OAuth Client ID de tipo **Web application** en Google Cloud, activa **Google Calendar API**, configura los orígenes JavaScript autorizados (incluye tu dominio HTTPS y localhost si lo usas) y añade usuarios de prueba cuando corresponda. Introduce el Client ID en la sección de configuración. El token solo permanece en memoria; el ID se guarda en localStorage.

## Límites conocidos

- OCR orientado a capturas; no hay importación de PDF.
- La detección de nombres es heurística: en capturas con columnas pegadas o baja resolución puede omitir o confundir nombres. El OCR no asigna automáticamente las columnas de árbitro ni deduce equipos y pabellones. Se requiere revisión humana.
- La deduplicación de Google compara título y fecha/hora entre hasta 250 eventos recuperados, por lo que no garantiza exhaustividad en calendarios grandes.
- El archivo ICS es una importación, no sincronización bidireccional.
- Las horas se interpretan en Europe/Madrid; conviene verificar cambios de horario de verano.
- No se almacena información en un servidor propio.
