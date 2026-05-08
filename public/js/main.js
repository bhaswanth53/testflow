/* ── Modal ── */
function openModal(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.add('open'); el.querySelector('.modal')?.focus(); }
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('open');
  if (e.target.dataset.modal) openModal(e.target.dataset.modal);
  if (e.target.dataset.closeModal) closeModal(e.target.dataset.closeModal);
  if (e.target.closest('[data-modal]')) openModal(e.target.closest('[data-modal]').dataset.modal);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
});

/* ── Tabs ── */
document.addEventListener('click', e => {
  const btn = e.target.closest('.tab-btn');
  if (!btn) return;
  const tabSet = btn.closest('.tab-set');
  if (!tabSet) return;
  tabSet.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const target = btn.dataset.tab;
  tabSet.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.toggle('active', p.id === target);
  });
});

/* ── Color swatches ── */
document.querySelectorAll('.color-swatch').forEach(sw => {
  sw.addEventListener('click', () => {
    sw.closest('.color-swatches').querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
    sw.classList.add('selected');
    const inp = document.getElementById(sw.dataset.target);
    if (inp) inp.value = sw.dataset.color;
  });
});

/* ── Collapsible result rows ── */
document.addEventListener('click', e => {
  const hdr = e.target.closest('.run-result-header');
  if (!hdr) return;
  const body = hdr.nextElementSibling;
  if (body?.classList.contains('run-result-body')) {
    body.classList.toggle('open');
    const arrow = hdr.querySelector('.result-arrow');
    if (arrow) arrow.textContent = body.classList.contains('open') ? '▲' : '▼';
  }
});

/* ── Status update (AJAX) ── */
document.addEventListener('change', async e => {
  const sel = e.target.closest('.result-status-select');
  if (!sel) return;
  const url = sel.dataset.url;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: sel.value })
    });
    if (r.ok) {
      showToast('Status updated', 'success');
      const badge = sel.closest('.run-result-header')?.querySelector('.result-status-badge');
      if (badge) {
        badge.textContent = sel.value.replace('_', ' ');
        badge.className = 'status-badge result-status-badge ' + sel.value;
      }
      // update progress counts
      updateProgress();
    }
  } catch {}
});

function updateProgress() {
  const selects = document.querySelectorAll('.result-status-select');
  const counts = { passed: 0, failed: 0, blocked: 0, skipped: 0, pending: 0 };
  let total = selects.length;
  selects.forEach(s => { if (counts[s.value] !== undefined) counts[s.value]++; });

  const bar = document.querySelector('.progress-stacked');
  if (bar && total > 0) {
    ['passed','failed','blocked','skipped','pending'].forEach(st => {
      const seg = bar.querySelector(`.seg-${st}`);
      if (seg) seg.style.width = ((counts[st] / total) * 100) + '%';
    });
  }
  Object.keys(counts).forEach(st => {
    const el = document.querySelector(`.count-${st}`);
    if (el) el.textContent = counts[st];
  });
}

/* ── Toast ── */
let toastContainer;
function showToast(msg, type = '') {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  toastContainer.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 200); }, 2500);
}

/* ── Rich Text Editor ── */
function initRichEditor(wrap) {
  const toolbar = wrap.querySelector('.rich-editor-toolbar');
  const editor = wrap.querySelector('.rich-editor');
  const hidden = wrap.querySelector('input[type=hidden]');

  if (!toolbar || !editor) return;

  toolbar.addEventListener('mousedown', e => {
    e.preventDefault();
    const btn = e.target.closest('.toolbar-btn');
    if (!btn) return;
    const cmd = btn.dataset.cmd;
    const val = btn.dataset.val;
    if (cmd === 'insertImage') {
      triggerImageUpload(editor);
    } else if (cmd === 'createLink') {
      const url = prompt('URL:');
      if (url) document.execCommand('createLink', false, url);
    } else {
      document.execCommand(cmd, false, val || null);
    }
    editor.focus();
    syncHidden(editor, hidden);
    updateToolbarState(toolbar, editor);
  });

  editor.addEventListener('input', () => { syncHidden(editor, hidden); });
  editor.addEventListener('keyup', () => updateToolbarState(toolbar, editor));
  editor.addEventListener('mouseup', () => updateToolbarState(toolbar, editor));

  // Paste images
  editor.addEventListener('paste', e => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        e.stopPropagation();
        uploadImage(item.getAsFile()).then(url => {
          if (url) {
            editor.focus();
            document.execCommand('insertImage', false, url);
            syncHidden(editor, hidden);
          }
        });
        return;
      }
    }
  });

  // Drag-drop images
  editor.addEventListener('drop', async e => {
    const files = e.dataTransfer?.files;
    if (!files?.length) return;
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        e.preventDefault();
        const url = await uploadImage(file);
        if (url) document.execCommand('insertImage', false, url);
        syncHidden(editor, hidden);
      }
    }
  });
}

function syncHidden(editor, hidden) {
  if (hidden) hidden.value = editor.innerHTML;
}

function updateToolbarState(toolbar, editor) {
  toolbar.querySelectorAll('.toolbar-btn[data-cmd]').forEach(btn => {
    const cmd = btn.dataset.cmd;
    if (['bold','italic','underline','strikeThrough'].includes(cmd)) {
      btn.classList.toggle('active', document.queryCommandState(cmd));
    }
  });
}

async function uploadImage(file) {
  const fd = new FormData();
  fd.append('image', file);
  try {
    const r = await fetch('/upload/image', { method: 'POST', body: fd });
    const data = await r.json();
    return data.url;
  } catch { return null; }
}

function triggerImageUpload(editor) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = async () => {
    const url = await uploadImage(inp.files[0]);
    if (url) {
      editor.focus();
      document.execCommand('insertImage', false, url);
    }
  };
  inp.click();
}

document.querySelectorAll('.rich-editor-wrap').forEach(initRichEditor);

/* ── Note management ── */
document.addEventListener('submit', async e => {
  const form = e.target.closest('.add-note-form');
  if (!form) return;
  e.preventDefault();
  const content = form.querySelector('input[name=content]')?.value || '';
  if (!content.trim()) return;
  const url = form.dataset.url;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    const data = await r.json();
    if (data.ok) {
      const notesList = form.closest('.run-result-body').querySelector('.notes-list');
      const div = document.createElement('div');
      div.className = 'note-card';
      div.innerHTML = `<div class="note-card-header"><span class="note-time">Just now</span></div><div class="note-content">${data.note.content}</div>`;
      notesList.appendChild(div);
      // reset editor
      const editor = form.querySelector('.rich-editor');
      const hidden = form.querySelector('input[name=content]');
      if (editor) { editor.innerHTML = ''; }
      if (hidden) hidden.value = '';
      showToast('Note added', 'success');
    }
  } catch {}
});

/* ── Select all test cases ── */
document.addEventListener('change', e => {
  const master = e.target.closest('#select-all-cases');
  if (!master) return;
  document.querySelectorAll('.case-checkbox').forEach(c => c.checked = master.checked);
});

/* ── Case filter/search ── */
const caseSearch = document.getElementById('case-search');
if (caseSearch) {
  caseSearch.addEventListener('input', () => {
    const q = caseSearch.value.toLowerCase();
    document.querySelectorAll('.tc-card').forEach(card => {
      const text = card.textContent.toLowerCase();
      card.style.display = text.includes(q) ? '' : 'none';
    });
  });
}

/* ── Test plan source toggle (plan vs manual) ── */
const runSourceSelect = document.getElementById('run-source');
if (runSourceSelect) {
  function toggleRunSource() {
    const v = runSourceSelect.value;
    document.getElementById('run-plan-section')?.classList.toggle('hidden', v !== 'plan');
    document.getElementById('run-manual-section')?.classList.toggle('hidden', v !== 'manual');
  }
  runSourceSelect.addEventListener('change', toggleRunSource);
  toggleRunSource();
}

/* ── Confirm delete ── */
document.querySelectorAll('[data-confirm]').forEach(btn => {
  btn.addEventListener('click', e => {
    if (!confirm(btn.dataset.confirm || 'Are you sure?')) e.preventDefault();
  });
});

/* small helpers */
function $(s) { return document.querySelector(s); }
function $$(s) { return document.querySelectorAll(s); }
