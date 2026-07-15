/* server.js — LibreOffice-backed conversion API.
 *
 * One endpoint: POST /convert?to=pdf   (multipart form field "file")
 * LibreOffice reads docx/doc/odt/xlsx/pptx/… and exports a faithful PDF.
 * This is the piece the browser can't do well on its own.
 */

const express = require('express');
const multer = require('multer');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const execFileP = promisify(execFile);
const app = express();
const upload = multer({ limits: { fileSize: 30 * 1024 * 1024 } }); // 30 MB

// --- CORS (the PWA lives on a different origin, e.g. Vercel) ---------------
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/health', (_req, res) => res.json({ ok: true }));

// LibreOffice --convert-to targets we allow. "pdf" is the reliable one.
const TARGETS = {
  pdf: 'pdf',
  docx: 'docx:MS Word 2007 XML',
};

app.post('/convert', upload.single('file'), async (req, res) => {
  const to = String(req.query.to || 'pdf').toLowerCase();
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  if (!TARGETS[to]) return res.status(400).json({ error: `Unsupported target "${to}".` });

  const id = crypto.randomUUID();
  const workdir = path.join(os.tmpdir(), `conv-${id}`);
  const profile = path.join(os.tmpdir(), `lo-${id}`); // per-request profile avoids lock clashes
  const origName = req.file.originalname || 'input';
  const inExt = path.extname(origName) || '.bin';
  const inPath = path.join(workdir, `input${inExt}`);

  try {
    await fs.mkdir(workdir, { recursive: true });
    await fs.writeFile(inPath, req.file.buffer);

    await execFileP('soffice', [
      '--headless', '--norestore', '--nolockcheck', '--nodefault',
      `-env:UserInstallation=file://${profile}`,
      '--convert-to', TARGETS[to],
      '--outdir', workdir,
      inPath,
    ], { timeout: 120000 });

    const outPath = path.join(workdir, `input.${to}`);
    const data = await fs.readFile(outPath);

    const outName = origName.replace(/\.[^.]+$/, '') + '.' + to;
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${outName}"`);
    res.send(data);
  } catch (err) {
    console.error('convert failed:', err);
    res.status(500).json({ error: 'Conversion failed.', detail: String(err.message || err) });
  } finally {
    fs.rm(workdir, { recursive: true, force: true }).catch(() => {});
    fs.rm(profile, { recursive: true, force: true }).catch(() => {});
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`conversion server listening on ${port}`));
