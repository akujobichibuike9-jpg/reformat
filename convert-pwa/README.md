# Reformat — a file-converter PWA

A small installable web app that converts files between formats **entirely in the
browser**. Nothing is uploaded — files never leave the device. Works offline once
installed.

## What it converts

| From | To |
|------|----|
| PNG / JPG / WEBP / BMP / GIF | any other image, or PDF |
| PDF | PNG or JPG (one per page, zipped), plain text, Word (.docx)* |
| Word (.docx) | PDF*, HTML, plain text |
| TXT | PDF, Word, HTML |
| Markdown | HTML, PDF* |
| HTML | PDF*, plain text |
| CSV | JSON, Excel (.xlsx), HTML table |
| Excel (.xlsx / .xls) | CSV, JSON, HTML table |
| JSON | CSV, Excel (.xlsx) |

\* **Best-effort routes** (marked *approx* in the UI). PDF↔Word carries the text
across but not exact layout, because faithful office-document conversion normally
needs a heavy engine like LibreOffice. See "Going further" below.

## Run it

It must be served over `http://localhost` or HTTPS for the service worker (and
therefore install/offline) to work. Opening `index.html` directly with `file://`
will load the UI but the PWA features won't register.

```bash
cd convert-pwa

# any static server works — pick one:
python3 -m http.server 8080
# or:  npx serve .
```

Then open <http://localhost:8080>. In Chrome/Edge you'll get an install icon in
the address bar; on iOS Safari use Share → Add to Home Screen.

## How it's built

- Plain HTML/CSS/JS — no build step.
- Conversion libraries loaded from jsDelivr and cached by the service worker:
  pdf.js, jsPDF, html2canvas, mammoth, docx, SheetJS (xlsx), marked, JSZip.
- `js/converters.js` — the conversion engine (a route table + handlers).
- `js/app.js` — UI wiring (drag & drop, target picker, download).
- `sw.js` — offline caching (app shell cache-first, CDN stale-while-revalidate).

## Add a new conversion

Open `js/converters.js`, find the `ROUTES` table, and add an entry under the input
extension pointing at a handler that returns `{ blob, filename }`. The UI picks it
up automatically.

## Going further — pixel-faithful PDF ↔ Word

Client-side JS can't perfectly reflow office documents. If you need that fidelity,
run a converter service and POST the file to it:

- **LibreOffice headless:** `soffice --headless --convert-to pdf file.docx`
  (or `--convert-to docx` for the reverse). Wrap it in a small API.
- Or use a hosted conversion API.

Then add a route in `converters.js` that `fetch()`es your endpoint instead of doing
the work locally. Everything else in the app stays the same.
