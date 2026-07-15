/* app.js — UI wiring. Depends on window.Converter from converters.js */

const $ = sel => document.querySelector(sel);

const state = {
  file: null,
  ext: null,
  target: null,
};

const els = {
  drop: $('#drop'),
  input: $('#file-input'),
  pickBtn: $('#pick-btn'),
  panel: $('#panel'),
  fileName: $('#file-name'),
  fileMeta: $('#file-meta'),
  fromTag: $('#from-tag'),
  toTag: $('#to-tag'),
  targets: $('#targets'),
  convertBtn: $('#convert-btn'),
  status: $('#status'),
  result: $('#result'),
  reset: $('#reset-btn'),
};

// ---- drag & drop + picker -------------------------------------------------

['dragenter', 'dragover'].forEach(ev =>
  els.drop.addEventListener(ev, e => {
    e.preventDefault();
    els.drop.classList.add('is-hover');
  })
);
['dragleave', 'drop'].forEach(ev =>
  els.drop.addEventListener(ev, e => {
    e.preventDefault();
    els.drop.classList.remove('is-hover');
  })
);
els.drop.addEventListener('drop', e => {
  const f = e.dataTransfer.files[0];
  if (f) loadFile(f);
});
els.pickBtn.addEventListener('click', () => els.input.click());
els.drop.addEventListener('click', e => {
  if (e.target === els.pickBtn) return;
  els.input.click();
});
els.input.addEventListener('change', e => {
  const f = e.target.files[0];
  if (f) loadFile(f);
});
els.reset.addEventListener('click', resetAll);

// ---- load a file ----------------------------------------------------------

function loadFile(file) {
  const ext = Converter.getExt(file.name).toLowerCase();
  const targets = Converter.targetsFor(ext);

  state.file = file;
  state.ext = ext;
  state.target = null;

  els.fileName.textContent = file.name;
  els.fileMeta.textContent = `${prettySize(file.size)} · .${ext || '?'}`;
  els.fromTag.textContent = (ext || '?').toUpperCase();
  els.fromTag.dataset.family = Converter.FAMILY[ext] || 'other';
  els.toTag.textContent = '—';
  els.toTag.dataset.family = 'other';

  els.result.hidden = true;
  els.result.innerHTML = '';
  setStatus('');

  if (!targets.length) {
    els.targets.innerHTML = '';
    els.panel.hidden = false;
    setStatus(`Sorry — .${ext} isn't a supported input format yet.`, 'error');
    els.convertBtn.disabled = true;
    return;
  }

  renderTargets(targets);
  els.panel.hidden = false;
  els.convertBtn.disabled = true;
}

function renderTargets(targets) {
  els.targets.innerHTML = '';
  for (const t of targets) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'target';
    btn.dataset.to = t.to;
    btn.innerHTML =
      `<span class="target__ext">${t.to.toUpperCase()}</span>` +
      `<span class="target__label">${t.label}</span>` +
      (t.lossy ? `<span class="target__flag" title="Formatting may change">approx</span>` : '');
    btn.addEventListener('click', () => selectTarget(t, btn));
    els.targets.appendChild(btn);
  }
}

function selectTarget(t, btn) {
  state.target = t.to;
  document.querySelectorAll('.target').forEach(b => b.classList.remove('is-active'));
  btn.classList.add('is-active');
  els.toTag.textContent = t.to.toUpperCase();
  els.toTag.dataset.family = Converter.FAMILY[t.to] || 'other';
  els.convertBtn.disabled = false;
  setStatus(t.lossy
    ? 'Heads up: this route is best-effort — text comes across, exact layout may not.'
    : '');
}

// ---- convert --------------------------------------------------------------

els.convertBtn.addEventListener('click', async () => {
  if (!state.file || !state.target) return;
  els.convertBtn.disabled = true;
  setStatus('Converting…', 'busy');
  els.result.hidden = true;

  try {
    const { blob, filename } = await Converter.convertFile(state.file, state.target);
    showResult(blob, filename);
    setStatus('Done.', 'ok');
  } catch (err) {
    console.error(err);
    setStatus(`Conversion failed: ${err.message || err}`, 'error');
  } finally {
    els.convertBtn.disabled = false;
  }
});

function showResult(blob, filename) {
  const url = URL.createObjectURL(blob);
  els.result.innerHTML = '';

  const a = document.createElement('a');
  a.className = 'download';
  a.href = url;
  a.download = filename;
  a.innerHTML =
    `<span class="download__icon" aria-hidden="true">↓</span>` +
    `<span class="download__text"><strong>${filename}</strong>` +
    `<small>${prettySize(blob.size)} · tap to save</small></span>`;
  els.result.appendChild(a);
  els.result.hidden = false;

  // revoke after the click has a chance to use it
  a.addEventListener('click', () => setTimeout(() => URL.revokeObjectURL(url), 4000));
}

// ---- misc -----------------------------------------------------------------

function resetAll() {
  state.file = state.ext = state.target = null;
  els.input.value = '';
  els.panel.hidden = true;
  els.result.hidden = true;
  setStatus('');
}

function setStatus(msg, kind) {
  els.status.textContent = msg || '';
  els.status.className = 'status' + (kind ? ` status--${kind}` : '');
}

function prettySize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ---- service worker (PWA) -------------------------------------------------

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err =>
      console.warn('SW registration failed:', err)
    );
  });
}
