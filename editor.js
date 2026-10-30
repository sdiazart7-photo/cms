// Editor del sitio: abre una página real del sitio, la muestra en un marco y
// deja editarla de dos maneras sobre el mismo documento:
//   · clic directo sobre textos y fotos de la página
//   · formularios por sección en el panel lateral
// El panel nunca ejecuta los scripts de la página: se guardan aparte como
// comentarios mientras se edita y se devuelven tal cual al guardar.
(function () {
'use strict';
const FE = window.FE;
if (!FE) return;
const { api, toast, busy, esc, state } = FE;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const XHTML = 'http://www.w3.org/1999/xhtml';
const INLINE = new Set(['A', 'ABBR', 'B', 'BDI', 'BDO', 'BR', 'CITE', 'CODE', 'DATA', 'DFN', 'EM', 'I', 'KBD', 'MARK', 'Q', 'S', 'SAMP', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP', 'TIME', 'U', 'VAR', 'WBR', 'DEL', 'INS']);
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'TITLE', 'IFRAME', 'OBJECT', 'EMBED', 'INPUT', 'SELECT', 'TEXTAREA', 'OPTION', 'CANVAS', 'VIDEO', 'AUDIO']);
const LABELS = { H1: 'Título principal', H2: 'Título', H3: 'Subtítulo', H4: 'Subtítulo', H5: 'Subtítulo', H6: 'Subtítulo', P: 'Párrafo', A: 'Botón o enlace', LI: 'Elemento de lista', BUTTON: 'Botón', LABEL: 'Etiqueta', BLOCKQUOTE: 'Cita', TD: 'Celda', TH: 'Encabezado de tabla', FIGCAPTION: 'Pie de foto', SPAN: 'Texto', DIV: 'Texto', SMALL: 'Texto pequeño' };
const SECTION_NAMES = { NAV: 'Menú superior', FOOTER: 'Pie de página', HEADER: 'Encabezado' };

const E = {
  path: '', label: '', origin: '', hash: '', raw: '',
  src: null, stash: [], prefix: '', suffix: '',
  nextId: 1, sel: null, editing: null, doc: null,
  undo: [], redo: [], lastInput: 0, tab: 'el', device: 'desktop', dirty: false, loaded: false,
};

// ───────────── Documento fuente ─────────────
function parseSource(raw) {
  const stash = [];
  const t = raw.replace(/<script\b[\s\S]*?<\/script\s*>|<noscript\b[\s\S]*?<\/noscript\s*>/gi, (m) => { stash.push(m); return `<!--FE:${stash.length - 1}-->`; });
  const open = /<html[\s>]/i.exec(t);
  E.prefix = open ? t.slice(0, open.index) : '';
  const close = /<\/html\s*>/i.exec(t);
  E.suffix = close ? t.slice(close.index + close[0].length) : '\n';
  E.stash = stash;
  E.src = new DOMParser().parseFromString(t, 'text/html');
  E.nextId = 1;
  $$('*', E.src.body).forEach((n) => n.setAttribute('data-fe', E.nextId++));
}

function serialize() {
  const clone = E.src.documentElement.cloneNode(true);
  clone.querySelectorAll('[data-fe]').forEach((n) => n.removeAttribute('data-fe'));
  const out = E.prefix + clone.outerHTML + E.suffix;
  return out.replace(/<!--FE:(\d+)-->/g, (m, i) => E.stash[+i]);
}

const srcEl = (id) => (id == null ? null : E.src.body.querySelector(`[data-fe="${id}"]`));
const liveEl = (id) => (E.doc && id != null ? E.doc.querySelector(`[data-fe="${id}"]`) : null);
const idOf = (el) => (el ? el.getAttribute('data-fe') : null);

function assignIds(root) {
  [root, ...$$('*', root)].forEach((n) => n.setAttribute('data-fe', E.nextId++));
}

// ───────────── Qué es editable ─────────────
function isHtmlEl(el) { return el.nodeType === 1 && el.namespaceURI === XHTML; }

function inlineOnly(el) {
  for (const c of el.childNodes) {
    if (c.nodeType === 8 || c.nodeType === 3) continue;
    if (c.nodeType !== 1 || !isHtmlEl(c) || !INLINE.has(c.tagName) || !inlineOnly(c)) return false;
  }
  return true;
}
function isTextBlock(el) {
  if (!isHtmlEl(el) || SKIP.has(el.tagName)) return false;
  if (!el.textContent.trim()) return false;
  return inlineOnly(el);
}

// A partir de lo que se tocó, decide qué elemento se edita.
function pickItem(t, body) {
  if (t && t.nodeType === 3) t = t.parentElement;
  if (!t || !isHtmlEl(t)) {
    const svgHost = t && t.closest ? t.closest('svg') : null;
    t = svgHost ? svgHost.parentElement : null;
    if (!t) return null;
  }
  const img = t.closest('img');
  if (img) return { kind: 'img', id: idOf(img) };
  let el = t, tb = null;
  while (el && el !== body && el.nodeType === 1) {
    if (isTextBlock(el)) { tb = el; break; }
    el = el.parentElement;
  }
  if (tb) {
    while (tb.parentElement && tb.parentElement !== body && isTextBlock(tb.parentElement)) tb = tb.parentElement;
    return { kind: 'text', id: idOf(tb) };
  }
  if (t === body || t.tagName === 'HTML') return null;
  return { kind: 'box', id: idOf(t) };
}

function labelFor(el) {
  if (!el) return '';
  if (el.tagName === 'IMG') return 'Foto';
  if (isTextBlock(el)) return LABELS[el.tagName] || 'Texto';
  const sec = el.closest('section,nav,footer,header');
  if (el.tagName === 'SECTION' || el.tagName === 'NAV' || el.tagName === 'FOOTER' || el.tagName === 'HEADER') return SECTION_NAMES[el.tagName] || 'Sección';
  return sec && sec !== el ? 'Bloque' : 'Bloque';
}

const BG_RE = /url\(\s*(['"]?)(.*?)\1\s*\)/i;
function findBg(el) {
  let n = el, hops = 0;
  while (n && n !== E.src.body && hops < 8) {
    const st = n.getAttribute && n.getAttribute('style');
    if (st && BG_RE.test(st)) return n;
    n = n.parentElement; hops++;
  }
  return null;
}

// ───────────── Historial ─────────────
const SEO_FIELDS = [
  { k: 'title', label: 'Título de la pestaña y de Google', get: () => E.src.title, set: (v) => { E.src.title = v; }, hint: 'Ideal entre 30 y 60 letras.', min: 30, max: 60 },
  { k: 'desc', label: 'Descripción para Google', area: true, sel: 'meta[name="description"]', attr: 'content', create: { name: 'description' }, hint: 'Ideal entre 120 y 160 letras.', min: 120, max: 160 },
  { k: 'ogt', label: 'Título al compartir (redes)', sel: 'meta[property="og:title"]', attr: 'content', create: { property: 'og:title' } },
  { k: 'ogd', label: 'Descripción al compartir (redes)', area: true, sel: 'meta[property="og:description"]', attr: 'content', create: { property: 'og:description' } },
  { k: 'ogi', label: 'Foto al compartir (dirección)', sel: 'meta[property="og:image"]', attr: 'content', create: { property: 'og:image' }, img: true },
  { k: 'can', label: 'Dirección oficial (canonical)', sel: 'link[rel="canonical"]', attr: 'href', hint: 'Cámbiala solo si sabes por qué.' },
];
function seoGet(f) {
  if (f.get) return f.get() || '';
  const el = E.src.head.querySelector(f.sel);
  return el ? el.getAttribute(f.attr) || '' : '';
}
function seoSet(f, v) {
  if (f.set) { f.set(v); return; }
  let el = E.src.head.querySelector(f.sel);
  if (!el) {
    if (!f.create) return;
    el = E.src.createElement('meta');
    Object.entries(f.create).forEach(([k, val]) => el.setAttribute(k, val));
    E.src.head.appendChild(el);
  }
  el.setAttribute(f.attr, v);
}
function robotsEl() { return E.src.head.querySelector('meta[name="robots"]'); }

function capture() {
  const seo = {};
  SEO_FIELDS.forEach((f) => { seo[f.k] = seoGet(f); });
  const r = robotsEl();
  return { body: E.src.body.innerHTML, seo, robots: r ? r.getAttribute('content') : null };
}
function restore(s) {
  E.src.body.innerHTML = s.body;
  SEO_FIELDS.forEach((f) => { if (seoGet(f) !== s.seo[f.k]) seoSet(f, s.seo[f.k]); });
  const r = robotsEl();
  if (r && s.robots != null) r.setAttribute('content', s.robots);
}
function pushUndo() {
  E.undo.push(capture());
  if (E.undo.length > 60) E.undo.shift();
  E.redo = [];
  updateBar();
}
function doUndo() {
  if (!E.undo.length) return;
  endEdit();
  E.redo.push(capture());
  restore(E.undo.pop());
  afterRestore();
}
function doRedo() {
  if (!E.redo.length) return;
  endEdit();
  E.undo.push(capture());
  restore(E.redo.pop());
  afterRestore();
}
function afterRestore() {
  markDirty();
  if (E.sel && !srcEl(E.sel.id)) E.sel = null;
  renderPreview();
  renderSections();
  renderPage();
  renderInspector();
}

function markDirty() {
  E.dirty = true; state.dirty = true;
  updateBar();
}
function updateBar() {
  $('#sSave').disabled = !E.dirty;
  $('#sUndo').disabled = !E.undo.length;
  $('#sRedo').disabled = !E.redo.length;
  $('#sStatus').textContent = E.dirty ? 'Cambios sin publicar' : 'Sin cambios';
}

// Aplica un cambio estructural: guarda el estado anterior y vuelve a pintar todo.
function op(fn) {
  endEdit();
  pushUndo();
  fn();
  markDirty();
  renderPreview();
  renderSections();
  renderInspector();
}

// ───────────── Vista previa ─────────────
const EDIT_CSS = `
html{scroll-behavior:auto!important}
*,*::before,*::after{animation:none!important;transition:none!important}
.reveal,.reveal-word,[data-split],[class*="reveal"]{opacity:1!important;transform:none!important;visibility:visible!important}
[data-fe-hover]{outline:1px dashed #1a73e8!important;outline-offset:2px;cursor:pointer}
[data-fe-sel]{outline:2px solid #1a73e8!important;outline-offset:3px}
[contenteditable="true"]{cursor:text;outline:2px solid #1a73e8!important;outline-offset:3px}
`;

function renderPreview() {
  const ifr = $('#siteFrame');
  let sy = 0;
  try { sy = ifr.contentWindow.scrollY || 0; } catch (e) {}
  const clone = E.src.documentElement.cloneNode(true);
  const dir = E.path.includes('/') ? E.path.replace(/[^/]*$/, '') : '';
  clone.querySelector('head').insertAdjacentHTML('afterbegin', `<base href="${esc(E.origin + '/' + dir)}"><style id="fe-ed">${EDIT_CSS}</style>`);
  ifr.onload = () => {
    E.doc = ifr.contentDocument;
    wire(E.doc);
    try { ifr.contentWindow.scrollTo(0, sy); } catch (e) {}
    E.editing = null;
    if (E.sel) hilite(E.sel.id);
  };
  ifr.srcdoc = '<!DOCTYPE html>' + clone.outerHTML;
}

function hilite(id) {
  if (!E.doc) return;
  $$('[data-fe-sel]', E.doc).forEach((n) => n.removeAttribute('data-fe-sel'));
  const el = liveEl(id);
  if (el) el.setAttribute('data-fe-sel', '');
}

function wire(doc) {
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('mouseover', onOver, true);
  doc.addEventListener('mouseout', clearHover, true);
  doc.addEventListener('keydown', onKey, true);
  doc.addEventListener('paste', onPaste, true);
  doc.addEventListener('input', onInput, true);
  ['dragstart', 'drop', 'submit'].forEach((ev) => doc.addEventListener(ev, (e) => e.preventDefault(), true));
}

function clearHover() { if (E.doc) $$('[data-fe-hover]', E.doc).forEach((n) => n.removeAttribute('data-fe-hover')); }
function onOver(e) {
  clearHover();
  if (E.editing && E.editing.contains(e.target)) return;
  const it = pickItem(e.target, E.doc.body);
  const el = it && liveEl(it.id);
  if (el) el.setAttribute('data-fe-hover', '');
}

function onClick(e) {
  e.preventDefault();
  const insideEditing = E.editing && E.editing.contains(e.target);
  if (insideEditing) return;
  const it = pickItem(e.target, E.doc.body);
  if (!it) { endEdit(); E.sel = null; hilite(null); renderInspector(); return; }
  choose(it, e);
}

function choose(it, ev) {
  endEdit();
  E.sel = it;
  hilite(it.id);
  if (it.kind === 'text') startEdit(it.id, ev);
  setTab('el');
  renderInspector();
}

function startEdit(id, ev) {
  const live = liveEl(id);
  if (!live) return;
  live.setAttribute('contenteditable', 'true');
  live.setAttribute('spellcheck', 'true');
  E.editing = live;
  live.focus();
  if (ev && typeof ev.clientX === 'number') {
    try {
      let range = null;
      if (E.doc.caretRangeFromPoint) range = E.doc.caretRangeFromPoint(ev.clientX, ev.clientY);
      else if (E.doc.caretPositionFromPoint) {
        const p = E.doc.caretPositionFromPoint(ev.clientX, ev.clientY);
        range = E.doc.createRange(); range.setStart(p.offsetNode, p.offset);
      }
      if (range) { const s = E.doc.getSelection(); s.removeAllRanges(); s.addRange(range); }
    } catch (err) {}
  }
}
function endEdit() {
  if (!E.editing) return;
  const el = E.editing;
  E.editing = null;
  try { el.removeAttribute('contenteditable'); el.removeAttribute('spellcheck'); } catch (e) {}
}

// Limpia lo que el navegador agrega al escribir (estilos sueltos, marcas del editor).
function cleanInner(el) {
  const c = el.cloneNode(true);
  [c, ...c.querySelectorAll('*')].forEach((n) => {
    ['data-fe-sel', 'data-fe-hover', 'contenteditable', 'spellcheck'].forEach((a) => n.removeAttribute(a));
  });
  c.querySelectorAll('*').forEach((n) => {
    if (n.hasAttribute('data-fe')) return;
    n.removeAttribute('style');
    if (n.tagName === 'SPAN' && !n.attributes.length) { n.replaceWith(...n.childNodes); }
  });
  c.querySelectorAll('div,p').forEach((n) => {
    if (!n.hasAttribute('data-fe')) { n.after(E.src.createElement('br')); n.replaceWith(...n.childNodes); }
  });
  return c.innerHTML;
}

function onInput(e) {
  if (!E.editing || !E.editing.contains(e.target)) return;
  const now = Date.now();
  if (now - E.lastInput > 1200) pushUndo();
  E.lastInput = now;
  const id = idOf(E.editing);
  const s = srcEl(id);
  if (!s) return;
  s.innerHTML = cleanInner(E.editing);
  markDirty();
  syncField(id, null);
}
function onKey(e) {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
  if (mod && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); doRedo(); return; }
  if (mod && (e.key === 's' || e.key === 'S')) { e.preventDefault(); save(); return; }
  if (e.key === 'Escape') { endEdit(); return; }
  if (e.key === 'Enter' && E.editing && !e.isComposing) {
    e.preventDefault();
    E.doc.execCommand('insertLineBreak');
  }
}
function onPaste(e) {
  if (!E.editing) return;
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData('text/plain');
  E.doc.execCommand('insertText', false, text);
}
document.addEventListener('keydown', (e) => {
  if ($('#v-site').hidden) return;
  const mod = e.ctrlKey || e.metaKey;
  const inField = e.target.closest && e.target.closest('.ce,input,textarea');
  if (mod && (e.key === 's' || e.key === 'S')) { e.preventDefault(); save(); }
  if (mod && (e.key === 'z' || e.key === 'Z') && !inField) { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); }
});

// ───────────── Operaciones sobre elementos ─────────────
function dup(id) {
  const el = srcEl(id); if (!el) return;
  op(() => { const c = el.cloneNode(true); assignIds(c); el.after(c); E.sel = { kind: kindOf(c), id: idOf(c) }; });
}
function del(id) {
  const el = srcEl(id); if (!el) return;
  op(() => { el.remove(); E.sel = null; });
}
function mv(id, dir) {
  const el = srcEl(id); if (!el) return;
  const other = dir < 0 ? el.previousElementSibling : el.nextElementSibling;
  if (!other) { toast(dir < 0 ? 'Ya es el primero de su grupo.' : 'Ya es el último de su grupo.'); return; }
  op(() => { dir < 0 ? other.before(el) : other.after(el); });
}
function parentOf(id) {
  const el = srcEl(id); if (!el) return;
  const p = el.parentElement;
  if (!p || p === E.src.body) { toast('Ya estás en el nivel más alto.'); return; }
  choose({ kind: 'box', id: idOf(p) });
  const live = liveEl(idOf(p));
  if (live && live.scrollIntoView) live.scrollIntoView({ block: 'center' });
}
function kindOf(el) {
  if (el.tagName === 'IMG') return 'img';
  return isTextBlock(el) ? 'text' : 'box';
}

// Botón de dos pasos para borrar.
function confirmButton(label, onYes) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'btn danger small'; b.textContent = label;
  let t;
  b.addEventListener('click', () => {
    if (b.dataset.armed) { clearTimeout(t); onYes(); return; }
    b.dataset.armed = '1'; b.textContent = '¿Seguro? Toca otra vez';
    t = setTimeout(() => { delete b.dataset.armed; b.textContent = label; }, 3000);
  });
  return b;
}
function actionsBar(id, { parent = true } = {}) {
  const d = document.createElement('div');
  d.className = 'sacts';
  const mk = (txt, title, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn ghost small'; b.textContent = txt; b.title = title; b.addEventListener('click', fn); return b; };
  if (parent) d.appendChild(mk('↑ Contenedor', 'Seleccionar el bloque que lo contiene', () => parentOf(id)));
  d.appendChild(mk('Duplicar', 'Crear una copia justo después', () => dup(id)));
  d.appendChild(mk('↑', 'Subir', () => mv(id, -1)));
  d.appendChild(mk('↓', 'Bajar', () => mv(id, 1)));
  d.appendChild(confirmButton('Eliminar', () => del(id)));
  return d;
}

// ───────────── Campos reutilizables ─────────────
function applyTx(oldSrc, url) {
  if (!/\/upload\//.test(url)) return url;
  const m = /\/upload\/((?:[a-z]{1,3}_[^/,]+,?)+)\//.exec(oldSrc || '');
  const tx = m ? m[1] : 'f_auto,q_auto,w_1200';
  return url.replace('/upload/', `/upload/${tx}/`);
}

function imgField(id) {
  const el = srcEl(id);
  const box = document.createElement('div');
  box.className = 'imgfield';
  box.innerHTML = `<div class="thumb"></div><div>
    <label>Foto (dirección)<input data-k="src" placeholder="https://res.cloudinary.com/..."></label>
    <label>Texto alternativo<input data-k="alt" placeholder="Describe lo que se ve"></label>
    <div class="acts">${state.cfg.cloud.enabled ? '<button type="button" class="btn ghost small" data-up>Subir foto nueva</button>' : ''}<input type="file" accept="image/*" hidden></div></div>`;
  const src = $('[data-k="src"]', box), alt = $('[data-k="alt"]', box), th = $('.thumb', box), file = $('input[type=file]', box);
  src.value = el.getAttribute('src') || '';
  alt.value = el.getAttribute('alt') || '';
  const paint = () => { th.style.backgroundImage = src.value ? `url("${src.value.replace(/"/g, '%22')}")` : ''; th.textContent = src.value ? '' : 'Sin foto'; };
  paint();
  const apply = (attr, val) => {
    const s = srcEl(id); if (!s) return;
    if (E.lastField !== id + attr) { pushUndo(); E.lastField = id + attr; }
    s.setAttribute(attr, val);
    const l = liveEl(id); if (l) { l.setAttribute(attr, val); if (attr === 'src') l.removeAttribute('srcset'); }
    markDirty();
  };
  src.addEventListener('input', () => { paint(); apply('src', src.value.trim()); });
  alt.addEventListener('input', () => apply('alt', alt.value));
  const up = $('[data-up]', box);
  if (up) {
    up.addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const f = file.files[0]; file.value = '';
      if (!f) return;
      busy(up, true, 'Subiendo');
      try {
        const url = applyTx(src.value, await FE.uploadImage(f, 'sitio'));
        src.value = url; paint(); E.lastField = null; apply('src', url);
        toast('Foto subida y puesta en la página.');
      } catch (err) { toast(err.message); }
      busy(up, false);
    });
  }
  return box;
}

function bgField(host) {
  const hid = idOf(host);
  const box = document.createElement('div');
  box.className = 'imgfield';
  const cls = (host.className || '').toString().split(/\s+/)[0];
  box.innerHTML = `<div class="thumb"></div><div>
    <label>Foto de fondo${cls ? ` de «.${esc(cls)}»` : ''} (dirección)<input data-k="bg"></label>
    <div class="acts">${state.cfg.cloud.enabled ? '<button type="button" class="btn ghost small" data-up>Subir foto nueva</button>' : ''}<input type="file" accept="image/*" hidden></div></div>`;
  const input = $('[data-k="bg"]', box), th = $('.thumb', box), file = $('input[type=file]', box);
  input.value = (BG_RE.exec(host.getAttribute('style')) || [])[2] || '';
  const paint = () => { th.style.backgroundImage = input.value ? `url("${input.value.replace(/"/g, '%22')}")` : ''; };
  paint();
  const apply = (v) => {
    const s = srcEl(hid); if (!s) return;
    if (E.lastField !== hid + 'bg') { pushUndo(); E.lastField = hid + 'bg'; }
    const st = s.getAttribute('style').replace(BG_RE, (m, q) => `url(${q || "'"}${v}${q || "'"})`);
    s.setAttribute('style', st);
    const l = liveEl(hid); if (l) l.setAttribute('style', st);
    markDirty(); paint();
  };
  input.addEventListener('input', () => apply(input.value.trim()));
  const up = $('[data-up]', box);
  if (up) {
    up.addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const f = file.files[0]; file.value = '';
      if (!f) return;
      busy(up, true, 'Subiendo');
      try {
        const url = applyTx(input.value, await FE.uploadImage(f, 'sitio'));
        input.value = url; E.lastField = null; apply(url);
        toast('Foto subida y puesta en la página.');
      } catch (err) { toast(err.message); }
      busy(up, false);
    });
  }
  return box;
}

function linkFields(el) {
  const out = document.createElement('div');
  const links = [];
  const own = el.closest('a');
  if (own) links.push(own);
  $$('a', el).forEach((a) => { if (!links.includes(a)) links.push(a); });
  links.filter((a) => a.hasAttribute('href')).forEach((a) => {
    const id = idOf(a);
    const txt = a.textContent.trim().replace(/\s+/g, ' ').slice(0, 30) || (a.querySelector('img') ? 'foto' : 'enlace');
    const lab = document.createElement('label');
    lab.innerHTML = `Enlace de «${esc(txt)}»<input data-k="href" placeholder="https://... o /#contacto">`;
    const inp = $('input', lab);
    inp.value = a.getAttribute('href') || '';
    inp.addEventListener('input', () => {
      const s = srcEl(id); if (!s) return;
      if (E.lastField !== id + 'href') { pushUndo(); E.lastField = id + 'href'; }
      s.setAttribute('href', inp.value.trim());
      const l = liveEl(id); if (l) l.setAttribute('href', inp.value.trim());
      markDirty();
    });
    out.appendChild(lab);
  });
  return out;
}

// ───────────── Pestaña Elemento ─────────────
function setTab(t) {
  E.tab = t;
  $$('.stabs button').forEach((b) => b.classList.toggle('on', b.dataset.st === t));
  ['el', 'sec', 'pg'].forEach((k) => { $(`#st-${k}`).hidden = k !== t; });
}

function renderInspector() {
  const host = $('#st-el');
  host.innerHTML = '';
  const it = E.sel;
  const el = it && srcEl(it.id);
  if (!el) {
    host.innerHTML = '<div class="shelp"><b>Haz clic en cualquier texto o foto</b> de la página para editarlo.<br><br>Los textos se escriben directo sobre la página. Para cambiar una foto, tócala y aparecerá aquí su dirección y su texto alternativo.<br><br>Para repetir un bloque (una reseña, un paquete, una pregunta), toca un texto de ese bloque, pulsa <b>↑ Contenedor</b> y luego <b>Duplicar</b>.</div>';
    return;
  }
  const kind = kindOf(el);
  const head = document.createElement('div');
  head.className = 'shead';
  const cls = (el.className || '').toString().split(/\s+/).filter(Boolean)[0];
  head.innerHTML = `<b>${esc(labelFor(el))}</b> <code>${esc(el.tagName.toLowerCase())}${cls ? '.' + esc(cls) : ''}</code>`;
  host.appendChild(head);
  if (kind === 'text') {
    const h = document.createElement('p');
    h.className = 'hint';
    h.textContent = 'Escribe directo en la página. Enter hace un salto de línea. Pegar siempre entra como texto simple.';
    host.appendChild(h);
  }
  if (kind === 'img') host.appendChild(imgField(it.id));
  const bg = findBg(el);
  if (bg) host.appendChild(bgField(bg));
  const lf = linkFields(el);
  if (lf.children.length) host.appendChild(lf);
  host.appendChild(actionsBar(it.id));
}

// ───────────── Pestaña Secciones ─────────────
const fieldIndex = new Map(); // id → { ce, links }

function walkFields(root, out) {
  for (const c of root.children) {
    if (!isHtmlEl(c) || SKIP.has(c.tagName)) continue;
    if (c.tagName === 'IMG') { out.push({ kind: 'img', el: c }); continue; }
    if (isTextBlock(c)) { out.push({ kind: 'text', el: c }); continue; }
    if (c.tagName === 'A' && c.hasAttribute('href') && !c.querySelector('img') && !c.textContent.trim()) { out.push({ kind: 'link', el: c }); continue; }
    const st = c.getAttribute('style');
    if (st && BG_RE.test(st)) out.push({ kind: 'bg', el: c });
    walkFields(c, out);
  }
}

function sectionTitle(el) {
  if (SECTION_NAMES[el.tagName]) return SECTION_NAMES[el.tagName];
  const h = el.querySelector('h1,h2,h3');
  const hx = h ? h.textContent.trim().replace(/\s+/g, ' ').slice(0, 46) : '';
  const cls = (el.className || '').toString().split(/\s+/).filter(Boolean)[0] || '';
  return hx || (el.id ? `#${el.id}` : cls || el.tagName.toLowerCase());
}

function repeatGroup(el, top) {
  let found = null;
  for (let cur = el; cur && cur !== top; cur = cur.parentElement) {
    const p = cur.parentElement;
    if (!p) break;
    const sibs = [...p.children].filter((c) => c.tagName === cur.tagName && c.className === cur.className);
    if (sibs.length < 2) continue;
    if (cur.tagName === 'LI') continue;
    if (isTextBlock(cur)) continue;
    found = { el: cur, i: sibs.indexOf(cur) + 1, n: sibs.length };
  }
  return found;
}

function textField(f) {
  const id = idOf(f.el);
  const wrap = document.createElement('div');
  wrap.className = 'fld';
  wrap.dataset.id = id;
  const lab = document.createElement('span');
  lab.className = 'fl';
  lab.textContent = LABELS[f.el.tagName] || 'Texto';
  wrap.appendChild(lab);
  if (f.el.tagName === 'LI') {
    const m = document.createElement('span');
    m.className = 'fmini';
    [['⧉', 'Duplicar', () => dup(id)], ['↑', 'Subir', () => mv(id, -1)], ['↓', 'Bajar', () => mv(id, 1)], ['✕', 'Eliminar', () => del(id)]].forEach(([t, ti, fn]) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.title = ti; b.addEventListener('click', fn); m.appendChild(b);
    });
    wrap.appendChild(m);
  }
  const ce = document.createElement('div');
  ce.className = 'ce';
  ce.contentEditable = 'true';
  ce.spellcheck = true;
  ce.innerHTML = f.el.innerHTML;
  ce.addEventListener('focus', () => {
    E.lastField = null;
    hilite(id);
    const l = liveEl(id);
    if (l && l.scrollIntoView) l.scrollIntoView({ block: 'center' });
  });
  ce.addEventListener('input', () => {
    const now = Date.now();
    if (now - E.lastInput > 1200) pushUndo();
    E.lastInput = now;
    const html = cleanInner(ce);
    const s = srcEl(id); if (s) s.innerHTML = html;
    const l = liveEl(id); if (l && l !== E.editing) l.innerHTML = html;
    markDirty();
  });
  ce.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); document.execCommand('insertLineBreak'); }
  });
  ce.addEventListener('paste', (e) => {
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
  });
  wrap.appendChild(ce);
  const lf = linkFields(f.el);
  if (lf.children.length) wrap.appendChild(lf);
  fieldIndex.set(id, ce);
  return wrap;
}

function renderSections() {
  const host = $('#st-sec');
  const focusedId = document.activeElement && document.activeElement.closest && document.activeElement.closest('.fld') ? document.activeElement.closest('.fld').dataset.id : null;
  const openKeys = new Set($$('#st-sec details[open]').map((d) => d.dataset.k));
  const q = ($('#secFilter') && $('#secFilter').value) || '';
  fieldIndex.clear();
  host.innerHTML = '<input id="secFilter" class="sfilter" type="search" placeholder="Buscar un texto en la página…">';
  $('#secFilter').value = q;
  const tops = [...E.src.body.children].filter((c) => isHtmlEl(c) && !SKIP.has(c.tagName));
  tops.forEach((top, ti) => {
    const fields = [];
    walkFields(top, fields);
    if (!fields.length) return;
    const det = document.createElement('details');
    det.className = 'ssec';
    det.dataset.k = idOf(top);
    if (openKeys.has(idOf(top)) || (!openKeys.size && ti < 0)) det.open = true;
    const sum = document.createElement('summary');
    sum.innerHTML = `${esc(sectionTitle(top))} <span class="cnt">${fields.length}</span>`;
    det.appendChild(sum);
    let curGroup = null, curBox = null;
    fields.forEach((f) => {
      const g = repeatGroup(f.el, top);
      if (!g) { curGroup = null; curBox = null; }
      else if (!curGroup || curGroup.el !== g.el) {
        curGroup = g;
        curBox = document.createElement('fieldset');
        curBox.className = 'sgrp';
        const lg = document.createElement('legend');
        lg.textContent = `Elemento ${g.i} de ${g.n}`;
        curBox.appendChild(lg);
        curBox.appendChild(actionsBar(idOf(g.el), { parent: false }));
        det.appendChild(curBox);
      }
      const parent = curBox || det;
      let node;
      if (f.kind === 'text') node = textField(f);
      else if (f.kind === 'img') { node = imgField(idOf(f.el)); }
      else if (f.kind === 'bg') node = bgField(f.el);
      else { node = linkFields(f.el); }
      node.dataset.q = (f.el.textContent || '').toLowerCase() + ' ' + (f.el.getAttribute('alt') || '').toLowerCase();
      node.classList.add('sitem');
      parent.appendChild(node);
    });
    host.appendChild(det);
  });
  $('#secFilter').addEventListener('input', applyFilter);
  applyFilter();
  if (focusedId && fieldIndex.get(focusedId)) { /* el foco se pierde al repintar; no se restaura para no mover el cursor */ }
}
function applyFilter() {
  const q = ($('#secFilter').value || '').trim().toLowerCase();
  $$('#st-sec .ssec').forEach((d) => {
    let any = false;
    $$('.sitem', d).forEach((n) => {
      const show = !q || (n.dataset.q || '').includes(q);
      n.hidden = !show; if (show) any = true;
    });
    $$('.sgrp', d).forEach((g) => { g.hidden = !!q && !$$('.sitem', g).some((n) => !n.hidden); });
    d.hidden = !!q && !any;
    if (q && any) d.open = true;
  });
}
// Cuando se escribe sobre la página, el campo del panel se actualiza solo.
function syncField(id) {
  const ce = fieldIndex.get(id);
  const s = srcEl(id);
  if (ce && s && document.activeElement !== ce) ce.innerHTML = s.innerHTML;
}

// ───────────── Pestaña Página (SEO) ─────────────
function renderPage() {
  const host = $('#st-pg');
  host.innerHTML = '<p class="hint" style="margin-top:0">Lo que ve Google y lo que aparece al compartir el enlace. Los datos estructurados de Google y el pixel de Meta se conservan sin cambios.</p>';
  SEO_FIELDS.forEach((f) => {
    const lab = document.createElement('label');
    lab.innerHTML = `${esc(f.label)}${f.area ? '<textarea rows="3"></textarea>' : '<input>'}<span class="hint"></span>`;
    const inp = $('input,textarea', lab), hint = $('.hint', lab);
    inp.value = seoGet(f);
    const upd = () => {
      const n = inp.value.length;
      hint.textContent = (f.hint || '') + (f.min ? ` Tienes ${n}.` : '');
      hint.style.color = f.min && (n < f.min || n > f.max) ? 'var(--aviso)' : '';
    };
    upd();
    inp.addEventListener('input', () => {
      if (E.lastField !== 'seo' + f.k) { pushUndo(); E.lastField = 'seo' + f.k; }
      seoSet(f, inp.value); markDirty(); upd();
    });
    inp.addEventListener('focus', () => { E.lastField = null; });
    host.appendChild(lab);
  });
  const r = robotsEl();
  if (r) {
    const lab = document.createElement('label');
    lab.innerHTML = 'Aparecer en Google<select><option value="index">Sí, que Google la muestre</option><option value="noindex">No, mantenerla oculta de Google</option></select>';
    const sel = $('select', lab);
    sel.value = /noindex/i.test(r.getAttribute('content') || '') ? 'noindex' : 'index';
    sel.addEventListener('change', () => {
      pushUndo();
      r.setAttribute('content', sel.value === 'noindex' ? 'noindex, nofollow' : 'index, follow');
      markDirty();
    });
    host.appendChild(lab);
  }
}

// ───────────── Guardar ─────────────
async function save() {
  if (!E.loaded || !E.dirty) return;
  endEdit();
  const html = serialize();
  if (html === E.raw) { E.dirty = false; state.dirty = false; updateBar(); toast('No hay cambios que guardar.'); return; }
  const btn = $('#sSave');
  busy(btn, true, 'Publicando');
  try {
    const r = await api('page-save', { method: 'POST', body: { path: E.path, html, baseHash: E.hash } });
    E.hash = r.hash; E.raw = html; E.dirty = false; state.dirty = false;
    $('#sMsg').innerHTML = r.commitUrl ? `Publicado. Se verá en tu sitio en cerca de un minuto. <a href="${esc(r.commitUrl)}" target="_blank" rel="noopener">Ver el cambio en GitHub</a>` : 'Sin cambios en el sitio.';
    toast('Cambios publicados.');
  } catch (e) {
    $('#sMsg').innerHTML = `<span class="serr">${esc(e.message)}</span>`;
  }
  busy(btn, false);
  updateBar();
}

// ───────────── Abrir una página ─────────────
async function open(path, label) {
  const stage = $('#siteStage');
  stage.classList.add('loading');
  FE.go('site');
  $('#sTitle').textContent = label || path;
  $('#sMsg').textContent = '';
  E.loaded = false;
  try {
    const d = await api('page-get', { query: { path } });
    Object.assign(E, { path, label: label || path, origin: d.origin, hash: d.hash, raw: d.html, undo: [], redo: [], sel: null, editing: null, dirty: false, lastInput: 0, lastField: null });
    parseSource(d.html);
    state.dirty = false;
    E.loaded = true;
    $('#sView').href = `${d.origin}/${path.replace(/index\.html$/, '')}`;
    setTab('el');
    renderPreview();
    renderSections();
    renderPage();
    renderInspector();
    updateBar();
    setDevice(E.device);
  } catch (e) {
    FE.go('sitelist');
    FE.flash('err', esc(e.message));
  }
  stage.classList.remove('loading');
}

function setDevice(d) {
  E.device = d;
  $$('#sDevice button').forEach((b) => b.classList.toggle('on', b.dataset.d === d));
  $('#siteFrame').classList.toggle('mobile', d === 'mobile');
}

// ───────────── Lista de páginas ─────────────
let pagesCache = null;
async function openList() {
  const host = $('#sitePages');
  host.innerHTML = '<div class="empty"><span class="spin"></span></div>';
  try {
    if (!pagesCache) pagesCache = await api('pages-list');
    const groups = {};
    pagesCache.pages.forEach((p) => { (groups[p.group] = groups[p.group] || []).push(p); });
    host.innerHTML = Object.keys(groups).map((g) => `
      <div class="card"><h2>${esc(g)}</h2>${groups[g].map((p) => `
        <div class="post"><div class="info"><div class="t">${esc(p.label)}</div>
          <div class="m">/${esc(p.path.replace(/index\.html$/, ''))}${p.note ? ' · ' + esc(p.note) : ''}</div></div>
          <div class="acts"><button class="btn small" data-open="${esc(p.path)}" data-label="${esc(p.label)}">Editar</button></div></div>`).join('')}
      </div>`).join('') + '<p class="hint">Los posts del blog se editan en la pestaña Blog. Las fotos del portafolio y las preguntas frecuentes de la home tienen su propia pestaña.</p>';
    $$('[data-open]', host).forEach((b) => b.addEventListener('click', () => open(b.dataset.open, b.dataset.label)));
  } catch (e) { host.innerHTML = `<div class="banner err">${esc(e.message)}</div>`; }
}

// ───────────── Conexión con el panel ─────────────
$('#sBack').addEventListener('click', () => {
  if (state.dirty && !confirm('Tienes cambios sin publicar. ¿Salir de todos modos?')) return;
  state.dirty = false; endEdit();
  FE.go('sitelist'); openList();
});
$('#sSave').addEventListener('click', save);
$('#sUndo').addEventListener('click', doUndo);
$('#sRedo').addEventListener('click', doRedo);
$$('#sDevice button').forEach((b) => b.addEventListener('click', () => setDevice(b.dataset.d)));
$$('.stabs button').forEach((b) => b.addEventListener('click', () => { endEdit(); setTab(b.dataset.st); }));

window.FEsite = { openList, open, _E: E, _serialize: serialize };
})();
