import {getDocument, GlobalWorkerOptions} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {extractPage} from './extract.js';
import {findHeaderIntervals} from './round.js';
GlobalWorkerOptions.workerSrc = workerUrl;
export async function readPDF(file, progress, ocrPage) {
  const task = getDocument({data:new Uint8Array(await file.arrayBuffer())});
  let doc;
  const games = [], scannedPages = [], headers=[];
  try {
    doc = await task.promise;
    for (let n=1;n<=doc.numPages;n++) {
      progress(`Leyendo ${file.name}: página ${n} de ${doc.numPages}…`);
      const page = await doc.getPage(n), text = await page.getTextContent();
      headers.push(...findHeaderIntervals(text.items.map(item=>item.str||'').join(' ')));
      if (!text.items.some(i => i.str?.trim())) {
        if (!ocrPage) { scannedPages.push(n); continue; }
        const viewport = page.getViewport({scale:3}), canvas = document.createElement('canvas');
        canvas.width = viewport.width; canvas.height = viewport.height;
        await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
        games.push(...await ocrPage(canvas, n)); canvas.width = canvas.height = 0;
      } else games.push(...extractPage(text.items, page.getViewport({scale:1}).width, n));
      page.cleanup();
    }
    return {games, scannedPages, headers};
  } finally { await task.destroy(); }
}
