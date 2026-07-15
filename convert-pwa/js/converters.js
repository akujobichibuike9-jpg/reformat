/* converters.js — the conversion engine.
 *
 * Everything here runs 100% in the browser. That means some conversions are
 * exact (images, text, spreadsheets) and some are best-effort (PDF <-> Word),
 * because faithful PDF/Word conversion normally needs a heavy engine like
 * LibreOffice on a server. Best-effort routes are flagged with `lossy: true`
 * so the UI can warn the user.
 */

// --- format metadata -------------------------------------------------------

const FAMILY = {
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', bmp: 'image', gif: 'image',
  pdf: 'document',
  docx: 'document',
  txt: 'text', md: 'text', html: 'text',
  csv: 'data', json: 'data', xlsx: 'data', xls: 'data',
};

// mime types used when building output blobs / canvas.toBlob
const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', bmp: 'image/bmp',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain', md: 'text/markdown', html: 'text/html',
  csv: 'text/csv', json: 'application/json',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
};

/* The conversion table. Keys are the *input* extension. Each entry lists the
 * targets you can produce from it, and the handler that does the work.
 * `lossy` marks conversions where formatting/layout can be lost.            */
const ROUTES = {
  // ---- images ----
  png:  imageRoutes(['jpg', 'webp', 'bmp', 'pdf']),
  jpg:  imageRoutes(['png', 'webp', 'bmp', 'pdf']),
  jpeg: imageRoutes(['png', 'webp', 'bmp', 'pdf']),
  webp: imageRoutes(['png', 'jpg', 'bmp', 'pdf']),
  bmp:  imageRoutes(['png', 'jpg', 'webp', 'pdf']),
  gif:  imageRoutes(['png', 'jpg', 'webp', 'pdf']),

  // ---- pdf ----
  pdf: {
    png:  { fn: pdfToImages.bind(null, 'image/png'),  label: 'PNG (one per page)' },
    jpg:  { fn: pdfToImages.bind(null, 'image/jpeg'), label: 'JPG (one per page)' },
    txt:  { fn: pdfToText,  label: 'Plain text' },
    docx: { fn: pdfToDocx,  label: 'Word (.docx)', lossy: true },
  },

  // ---- word ----
  docx: {
    pdf:  { fn: docxToPdf,  label: 'PDF',        lossy: true },
    html: { fn: docxToHtml, label: 'HTML' },
    txt:  { fn: docxToText, label: 'Plain text' },
  },

  // ---- text-ish ----
  txt: {
    pdf:  { fn: textToPdf,  label: 'PDF' },
    docx: { fn: textToDocx, label: 'Word (.docx)' },
    html: { fn: textToHtml, label: 'HTML' },
  },
  md: {
    html: { fn: mdToHtml, label: 'HTML' },
    pdf:  { fn: mdToPdf,  label: 'PDF', lossy: true },
    txt:  { fn: passThroughText('md'), label: 'Plain text' },
  },
  html: {
    pdf: { fn: htmlToPdf,  label: 'PDF', lossy: true },
    txt: { fn: htmlToText, label: 'Plain text' },
  },

  // ---- data / spreadsheets ----
  csv: {
    json: { fn: sheetTo.bind(null, 'json'), label: 'JSON' },
    xlsx: { fn: sheetTo.bind(null, 'xlsx'), label: 'Excel (.xlsx)' },
    html: { fn: sheetTo.bind(null, 'html'), label: 'HTML table' },
  },
  xlsx: {
    csv:  { fn: sheetTo.bind(null, 'csv'),  label: 'CSV' },
    json: { fn: sheetTo.bind(null, 'json'), label: 'JSON' },
    html: { fn: sheetTo.bind(null, 'html'), label: 'HTML table' },
  },
  xls: {
    csv:  { fn: sheetTo.bind(null, 'csv'),  label: 'CSV' },
    xlsx: { fn: sheetTo.bind(null, 'xlsx'), label: 'Excel (.xlsx)' },
    json: { fn: sheetTo.bind(null, 'json'), label: 'JSON' },
  },
  json: {
    csv:  { fn: jsonToSheet.bind(null, 'csv'),  label: 'CSV' },
    xlsx: { fn: jsonToSheet.bind(null, 'xlsx'), label: 'Excel (.xlsx)' },
  },
};

// Routes that become *exact* (not lossy) when a conversion server is configured.
const SERVER_ROUTES = new Set(['docx->pdf']);

function serverUrl() {
  const u = window.APP_CONFIG && window.APP_CONFIG.convertApi;
  return u ? u.replace(/\/$/, '') : '';
}

/** POST a file to the LibreOffice API and return the converted blob. */
async function serverConvert(file, to, baseName) {
  const api = serverUrl();
  const fd = new FormData();
  fd.append('file', file, file.name);
  const res = await fetch(`${api}/convert?to=${encodeURIComponent(to)}`, {
    method: 'POST',
    body: fd,
  });
  if (!res.ok) {
    let msg = `server responded ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch (_) {}
    throw new Error(msg);
  }
  const blob = await res.blob();
  return { blob, filename: `${baseName}.${to}` };
}

function imageRoutes(targets) {
  const out = {};
  for (const t of targets) {
    out[t] = t === 'pdf'
      ? { fn: imageToPdf, label: 'PDF' }
      : { fn: imageToImage.bind(null, MIME[t]), label: t.toUpperCase() };
  }
  return out;
}

// --- public API ------------------------------------------------------------

/** List valid target formats for a given input extension. */
function targetsFor(ext) {
  const e = normalizeExt(ext);
  const table = ROUTES[e];
  if (!table) return [];
  const hasServer = !!serverUrl();
  return Object.entries(table).map(([to, r]) => {
    let lossy = !!r.lossy;
    if (hasServer && lossy && SERVER_ROUTES.has(`${e}->${to}`)) lossy = false;
    return { to, label: r.label, lossy };
  });
}

/** Run a conversion. Returns { blob, filename }. Throws on failure. */
async function convertFile(file, toFormat) {
  const ext = normalizeExt(getExt(file.name));
  const table = ROUTES[ext];
  if (!table || !table[toFormat]) {
    throw new Error(`Can't convert .${ext} to ${toFormat}.`);
  }
  const baseName = file.name.replace(/\.[^.]+$/, '');
  const result = await table[toFormat].fn(file, baseName);
  return result; // { blob, filename }
}

function getExt(name) {
  const m = /\.([^.]+)$/.exec(name || '');
  return m ? m[1] : '';
}
function normalizeExt(e) {
  e = (e || '').toLowerCase();
  return e === 'jpeg' ? 'jpg' : e; // treat jpeg like jpg for routing display, but ROUTES has both
}

// ==========================================================================
// HANDLERS
// ==========================================================================

// ---- images ----

async function loadBitmap(file) {
  return await createImageBitmap(file);
}

async function imageToImage(mime, file, baseName) {
  const bmp = await loadBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext('2d');
  if (mime === 'image/jpeg' || mime === 'image/bmp') {
    ctx.fillStyle = '#ffffff'; // formats without alpha need a background
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(bmp, 0, 0);
  const blob = await canvasToBlob(canvas, mime, 0.92);
  const ext = extFromMime(mime);
  return { blob, filename: `${baseName}.${ext}` };
}

async function imageToPdf(file, baseName) {
  const { jsPDF } = window.jspdf;
  const bmp = await loadBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext('2d').drawImage(bmp, 0, 0);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.92);

  const orientation = bmp.width >= bmp.height ? 'landscape' : 'portrait';
  const pdf = new jsPDF({ orientation, unit: 'pt', format: [bmp.width, bmp.height] });
  pdf.addImage(dataUrl, 'JPEG', 0, 0, bmp.width, bmp.height);
  return { blob: pdf.output('blob'), filename: `${baseName}.pdf` };
}

// ---- pdf in ----

async function getPdf(file) {
  const data = await file.arrayBuffer();
  return await pdfjsLib.getDocument({ data }).promise;
}

async function pdfToImages(mime, file, baseName) {
  const pdf = await getPdf(file);
  const ext = extFromMime(mime);
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2 }); // 2x for crisp output
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const blob = await canvasToBlob(canvas, mime, 0.92);
    pages.push({ name: `${baseName}-p${String(i).padStart(2, '0')}.${ext}`, blob });
  }
  if (pages.length === 1) {
    return { blob: pages[0].blob, filename: pages[0].name };
  }
  const zip = new JSZip();
  pages.forEach(p => zip.file(p.name, p.blob));
  const blob = await zip.generateAsync({ type: 'blob' });
  return { blob, filename: `${baseName}-${ext}-pages.zip` };
}

async function extractPdfLines(file) {
  const pdf = await getPdf(file);
  const lines = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    let lastY = null, current = '';
    for (const item of content.items) {
      const y = item.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 3) {
        lines.push(current.trimEnd());
        current = '';
      }
      current += item.str;
      lastY = y;
    }
    if (current.trim()) lines.push(current.trimEnd());
    lines.push(''); // blank line between pages
  }
  return lines;
}

async function pdfToText(file, baseName) {
  const lines = await extractPdfLines(file);
  const blob = new Blob([lines.join('\n')], { type: MIME.txt });
  return { blob, filename: `${baseName}.txt` };
}

async function pdfToDocx(file, baseName) {
  const lines = await extractPdfLines(file);
  return linesToDocx(lines, baseName);
}

// ---- word in ----

async function docxToHtml(file, baseName) {
  const arrayBuffer = await file.arrayBuffer();
  const { value } = await mammoth.convertToHtml({ arrayBuffer });
  const html = wrapHtml(baseName, value);
  return { blob: new Blob([html], { type: MIME.html }), filename: `${baseName}.html` };
}

async function docxToText(file, baseName) {
  const arrayBuffer = await file.arrayBuffer();
  const { value } = await mammoth.extractRawText({ arrayBuffer });
  return { blob: new Blob([value], { type: MIME.txt }), filename: `${baseName}.txt` };
}

async function docxToPdf(file, baseName) {
  // Prefer the LibreOffice server (faithful layout); fall back to in-browser.
  if (serverUrl()) {
    try {
      return await serverConvert(file, 'pdf', baseName);
    } catch (err) {
      console.warn('Server convert failed, using in-browser fallback:', err.message);
    }
  }
  const arrayBuffer = await file.arrayBuffer();
  const { value } = await mammoth.convertToHtml({ arrayBuffer });
  return htmlStringToPdf(value, baseName);
}

// ---- text-ish ----

async function readText(file) {
  return await file.text();
}

async function textToPdf(file, baseName) {
  const text = await readText(file);
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  const margin = 48;
  const width = pdf.internal.pageSize.getWidth() - margin * 2;
  const height = pdf.internal.pageSize.getHeight() - margin * 2;
  pdf.setFont('courier', 'normal').setFontSize(11);
  const wrapped = pdf.splitTextToSize(text.replace(/\t/g, '    '), width);
  const lineHeight = 15;
  let y = margin;
  for (const line of wrapped) {
    if (y + lineHeight > margin + height) {
      pdf.addPage();
      y = margin;
    }
    pdf.text(line, margin, y);
    y += lineHeight;
  }
  return { blob: pdf.output('blob'), filename: `${baseName}.pdf` };
}

async function textToDocx(file, baseName) {
  const text = await readText(file);
  return linesToDocx(text.split(/\r?\n/), baseName);
}

async function textToHtml(file, baseName) {
  const text = await readText(file);
  const body = `<pre>${escapeHtml(text)}</pre>`;
  return { blob: new Blob([wrapHtml(baseName, body)], { type: MIME.html }), filename: `${baseName}.html` };
}

function passThroughText(_kind) {
  return async (file, baseName) => {
    const text = await readText(file);
    return { blob: new Blob([text], { type: MIME.txt }), filename: `${baseName}.txt` };
  };
}

// ---- markdown / html ----

async function mdToHtml(file, baseName) {
  const md = await readText(file);
  const body = marked.parse(md);
  return { blob: new Blob([wrapHtml(baseName, body)], { type: MIME.html }), filename: `${baseName}.html` };
}

async function mdToPdf(file, baseName) {
  const md = await readText(file);
  return htmlStringToPdf(marked.parse(md), baseName);
}

async function htmlToPdf(file, baseName) {
  const html = await readText(file);
  return htmlStringToPdf(html, baseName);
}

async function htmlToText(file, baseName) {
  const html = await readText(file);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const text = doc.body ? doc.body.innerText || doc.body.textContent : '';
  return { blob: new Blob([text], { type: MIME.txt }), filename: `${baseName}.txt` };
}

// ---- spreadsheets / data ----

async function sheetTo(target, file, baseName) {
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: 'array' });
  const first = wb.SheetNames[0];
  const ws = wb.Sheets[first];

  if (target === 'csv') {
    const csv = XLSX.utils.sheet_to_csv(ws);
    return { blob: new Blob([csv], { type: MIME.csv }), filename: `${baseName}.csv` };
  }
  if (target === 'json') {
    const json = JSON.stringify(XLSX.utils.sheet_to_json(ws), null, 2);
    return { blob: new Blob([json], { type: MIME.json }), filename: `${baseName}.json` };
  }
  if (target === 'html') {
    const table = XLSX.utils.sheet_to_html(ws);
    return { blob: new Blob([wrapHtml(baseName, table)], { type: MIME.html }), filename: `${baseName}.html` };
  }
  if (target === 'xlsx') {
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    return { blob: new Blob([out], { type: MIME.xlsx }), filename: `${baseName}.xlsx` };
  }
  throw new Error('Unsupported spreadsheet target');
}

async function jsonToSheet(target, file, baseName) {
  const text = await readText(file);
  let rows = JSON.parse(text);
  if (!Array.isArray(rows)) rows = [rows];
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  if (target === 'csv') {
    const csv = XLSX.utils.sheet_to_csv(ws);
    return { blob: new Blob([csv], { type: MIME.csv }), filename: `${baseName}.csv` };
  }
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return { blob: new Blob([out], { type: MIME.xlsx }), filename: `${baseName}.xlsx` };
}

// ==========================================================================
// shared helpers
// ==========================================================================

function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Canvas export failed'))), mime, quality);
  });
}

async function linesToDocx(lines, baseName) {
  const { Document, Packer, Paragraph, TextRun } = window.docx;
  const paragraphs = lines.map(
    line => new Paragraph({ children: [new TextRun(line || '')] })
  );
  const doc = new Document({ sections: [{ children: paragraphs }] });
  const blob = await Packer.toBlob(doc);
  return { blob, filename: `${baseName}.docx` };
}

async function htmlStringToPdf(bodyHtml, baseName) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });

  // Render into an off-screen node jsPDF.html() can walk.
  const holder = document.createElement('div');
  holder.style.cssText =
    'position:fixed;left:-9999px;top:0;width:520px;font-family:Georgia,serif;' +
    'font-size:12px;line-height:1.5;color:#111;';
  holder.innerHTML = bodyHtml;
  document.body.appendChild(holder);

  try {
    await pdf.html(holder, {
      x: 40,
      y: 40,
      width: 515,
      windowWidth: 520,
      autoPaging: 'text',
      html2canvas: { scale: 0.75, useCORS: true, backgroundColor: '#ffffff' },
    });
  } finally {
    holder.remove();
  }
  return { blob: pdf.output('blob'), filename: `${baseName}.pdf` };
}

function wrapHtml(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body{font-family:Georgia,'Times New Roman',serif;max-width:52rem;margin:2rem auto;
       padding:0 1rem;line-height:1.6;color:#1a1a1a}
  table{border-collapse:collapse;width:100%}
  th,td{border:1px solid #ccc;padding:.4rem .6rem;text-align:left}
  pre{white-space:pre-wrap;font-family:ui-monospace,Menlo,Consolas,monospace}
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function extFromMime(mime) {
  const hit = Object.entries(MIME).find(([, m]) => m === mime);
  return hit ? hit[0] : 'bin';
}

// expose to app.js
window.Converter = { targetsFor, convertFile, FAMILY, getExt, normalizeExt };
