// Páginas editables del sitio: qué se puede tocar y cómo se valida un guardado.
// El panel arma el HTML en el navegador; acá se comprueba que lo que llega no
// rompa nada que el panel no debería tocar (scripts, pixel, controladores).

const crypto = require('crypto');
const { HttpError } = require('./http');

const PATH_RE = /^[a-z0-9_\-]+(\/[a-z0-9_\-]+)*\.html$/i;
const EXCLUDED = /^(blog\/|netlify\/|test\/|node_modules\/|\.)/;

// Nombres y grupos para la lista. Lo que no esté acá aparece en "Otras".
const META = {
  'index.html': { label: 'Inicio (home)', group: 'Principal' },
  'infoprecios/index.html': { label: 'Paquetes y precios', group: 'Páginas de venta' },
  'propuesta/index.html': { label: 'Propuesta', group: 'Páginas de venta' },
  'love-season/index.html': { label: 'Love Season', group: 'Páginas de venta' },
  'recursos/index.html': { label: 'Recursos gratuitos', group: 'Páginas de venta' },
  'gracias.html': { label: 'Gracias (después del formulario)', group: 'Páginas simples' },
  'privacidad.html': { label: 'Aviso de privacidad', group: 'Páginas simples' },
  '404.html': { label: 'Página no encontrada (404)', group: 'Páginas simples' },
  'herramientas/contrato.html': { label: 'Contrato', group: 'Herramientas', note: 'Tiene lógica propia: conviene editar solo textos.' },
  'herramientas/pago.html': { label: 'Pago', group: 'Herramientas', note: 'Tiene lógica propia: conviene editar solo textos.' },
  'herramientas/recibos.html': { label: 'Recibos', group: 'Herramientas', note: 'Tiene lógica propia: conviene editar solo textos.' },
};
const GROUP_ORDER = ['Principal', 'Páginas de venta', 'Páginas simples', 'Herramientas', 'Otras'];

function isEditablePath(p) {
  return typeof p === 'string' && PATH_RE.test(p) && !p.includes('..') && !EXCLUDED.test(p);
}

function describe(paths) {
  return paths.filter(isEditablePath).map((path) => {
    const m = META[path] || {};
    return { path, label: m.label || path.replace(/\/index\.html$/, '/').replace(/\.html$/, ''), group: m.group || 'Otras', note: m.note || '' };
  }).sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || (a.path === 'index.html' ? -1 : b.path === 'index.html' ? 1 : a.label.localeCompare(b.label)));
}

const sha1 = (s) => crypto.createHash('sha1').update(String(s)).digest('hex');

const BLOCKS_RE = /<script\b[\s\S]*?<\/script\s*>|<noscript\b[\s\S]*?<\/noscript\s*>/gi;
const HANDLER_RE = /\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const norm = (v) => v.replace(/^["']|["']$/g, '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const count = (re, s) => (s.match(re) || []).length;

// Lanza HttpError si el HTML nuevo toca algo que el panel no debe tocar.
function validateSave(oldHtml, newHtml) {
  if (typeof newHtml !== 'string' || !newHtml.trim()) throw new HttpError(400, 'La página llegó vacía.');
  if (newHtml.length > 3 * 1024 * 1024) throw new HttpError(400, 'La página pesa demasiado.');
  if (!/<body[\s>]/i.test(newHtml) || !/<\/html>\s*$/i.test(newHtml) || !/<head[\s>]/i.test(newHtml)) {
    throw new HttpError(400, 'El HTML recibido está incompleto (faltan head, body o el cierre de la página).');
  }
  const a = oldHtml.match(BLOCKS_RE) || [];
  const b = newHtml.match(BLOCKS_RE) || [];
  if (a.length !== b.length || a.some((x, i) => x !== b[i])) {
    throw new HttpError(400, 'El guardado modificaba scripts del sitio (pixel, carrusel o datos de Google). Eso no se edita desde el panel, así que no se guardó nada.');
  }
  // Fuera de los bloques de script, no pueden aparecer controladores nuevos ni enlaces javascript:.
  const strip = (s) => s.replace(BLOCKS_RE, '');
  const oldHandlers = new Set((strip(oldHtml).match(HANDLER_RE) || []).map(norm));
  for (const h of strip(newHtml).match(HANDLER_RE) || []) {
    if (!oldHandlers.has(norm(h))) throw new HttpError(400, 'El guardado agregaba un controlador de eventos (onclick y similares). No se permite.');
  }
  if (count(/javascript:/gi, strip(newHtml)) > count(/javascript:/gi, strip(oldHtml))) throw new HttpError(400, 'El guardado agregaba un enlace javascript:. No se permite.');
  for (const tag of ['iframe', 'object', 'embed', 'base']) {
    const re = new RegExp(`<${tag}[\\s>]`, 'gi');
    if (count(re, strip(newHtml)) > count(re, strip(oldHtml))) throw new HttpError(400, `El guardado agregaba un <${tag}>. No se permite.`);
  }
}

module.exports = { isEditablePath, describe, sha1, validateSave, META };
