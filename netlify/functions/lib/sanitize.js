// Limpia el HTML que escribe el panel antes de guardarlo en el sitio.
// Lista blanca de etiquetas y atributos: lo demás se descarta, así un pegado
// raro (estilos de Word, scripts, divs sueltos) nunca rompe el diseño.

const BLOCK = new Set(['p', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'div']);
const VOID = new Set(['br', 'img', 'hr']);
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'svg', 'form', 'textarea', 'select']);
const ALLOWED_CLASSES = new Set(['article-cta', 'btn', 'btn-oro']);
const RENAME = { b: 'strong', i: 'em', h1: 'h2', h5: 'h4', h6: 'h4' };

const FULL = {
  p: [], h2: [], h3: [], h4: [], strong: [], em: [], br: [], hr: [], ul: [], ol: [], li: [], blockquote: [],
  a: ['href', 'target', 'rel', 'data-track', 'class'],
  img: ['src', 'alt', 'loading'],
  div: ['class'],
};
const INLINE = { strong: [], em: [], br: [], a: ['href', 'target', 'rel'] };

const TOKEN = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>|[^<]+|</g;
const ATTR = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function parseAttrs(raw) {
  const out = {};
  let m;
  ATTR.lastIndex = 0;
  while ((m = ATTR.exec(raw))) {
    const name = m[1].toLowerCase();
    out[name] = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : '';
  }
  return out;
}

const escAttr = (v) => String(v).replace(/"/g, '&quot;').replace(/</g, '&lt;');
const safeUrl = (v) => /^(https?:\/\/|mailto:|tel:|\/|#)/i.test(String(v).trim());
const safeSrc = (v) => /^(https?:\/\/|\/)/i.test(String(v).trim());

function sanitize(html, { inline = false } = {}) {
  const allowed = inline ? INLINE : FULL;
  const out = [];
  const stack = [];
  const divs = []; // por cada <div> abierto: 'div' (se conserva), 'p' (se vuelve párrafo) o null (se descarta)
  let skipTag = null;
  let skipDepth = 0;
  let m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(String(html || '')))) {
    const tok = m[0];
    if (tok.startsWith('<!--')) continue;
    if (!m[1]) {
      if (skipTag) continue;
      out.push(tok === '<' ? '&lt;' : tok);
      continue;
    }
    const closing = tok[1] === '/';
    let tag = m[1].toLowerCase();

    if (skipTag) {
      if (tag === skipTag) {
        if (closing) { skipDepth--; if (skipDepth === 0) skipTag = null; } else skipDepth++;
      }
      continue;
    }
    if (DROP_WITH_CONTENT.has(tag)) {
      if (!closing && !VOID.has(tag)) { skipTag = tag; skipDepth = 1; }
      continue;
    }
    if (RENAME[tag]) tag = RENAME[tag];
    if (!Object.prototype.hasOwnProperty.call(allowed, tag)) continue; // se quita la etiqueta, queda el texto

    if (closing) {
      if (VOID.has(tag)) continue;
      if (tag === 'div') {
        const kind = divs.pop();
        if (kind === 'div' || kind === 'p') {
          const i = stack.lastIndexOf(kind);
          if (i !== -1) while (stack.length > i) out.push(`</${stack.pop()}>`);
        }
        continue;
      }
      const i = stack.lastIndexOf(tag);
      if (i === -1) continue;
      while (stack.length > i) out.push(`</${stack.pop()}>`);
      continue;
    }

    const attrs = parseAttrs(m[2]);
    const keep = [];
    for (const name of allowed[tag]) {
      if (attrs[name] === undefined) continue;
      let v = attrs[name];
      if (name === 'href') { if (!safeUrl(v)) continue; }
      else if (name === 'src') { if (!safeSrc(v)) continue; }
      else if (name === 'class') {
        v = v.split(/\s+/).filter((c) => ALLOWED_CLASSES.has(c)).join(' ');
        if (!v) continue;
      } else if (name === 'target') { if (v !== '_blank') continue; }
      else if (name === 'loading') { if (v !== 'lazy' && v !== 'eager') continue; }
      keep.push(` ${name}="${escAttr(v)}"`);
    }
    if (tag === 'a' && attrs.target === '_blank' && attrs.rel === undefined) keep.push(' rel="noopener"');
    if (tag === 'img' && !keep.some((k) => k.startsWith(' src='))) continue;
    if (tag === 'img' && !keep.some((k) => k.startsWith(' alt='))) keep.push(' alt=""');
    if (tag === 'img' && !keep.some((k) => k.startsWith(' loading='))) keep.push(' loading="lazy"');

    // Un div sin clase permitida no aporta nada: si contiene texto suelto se vuelve párrafo.
    if (tag === 'div') {
      if (keep.some((k) => k.startsWith(' class='))) {
        divs.push('div');
      } else if (!stack.some((t) => ['p', 'li', 'blockquote', 'h2', 'h3', 'h4'].includes(t))) {
        divs.push('p');
        out.push('<p>');
        stack.push('p');
        continue;
      } else {
        divs.push(null);
        continue;
      }
    }

    out.push(`<${tag}${keep.join('')}>`);
    if (!VOID.has(tag)) stack.push(tag);
  }
  while (stack.length) out.push(`</${stack.pop()}>`);
  return out.join('');
}

// Ordena el HTML del cuerpo: un bloque por línea, sin párrafos vacíos.
function tidyBody(html) {
  let s = sanitize(html);
  s = s.replace(/<p>(?:\s|&nbsp;|<br>)*<\/p>/g, '');
  s = s.replace(/ /g, ' ');
  s = s.replace(/(<\/(?:p|h2|h3|h4|ul|ol|blockquote|div)>|<img [^>]*>|<hr>)\s*/g, '$1\n');
  s = s.replace(/\n(<h2>)/g, '\n\n$1');
  s = s.replace(/<(ul|ol)>\s*/g, '<$1>\n  ').replace(/<\/li>\s*(?=<li>)/g, '</li>\n  ').replace(/<\/li>\s*<\/(ul|ol)>/g, '</li>\n</$1>');
  s = s.replace(/<div class="article-cta">\s*/g, '<div class="article-cta">\n').replace(/\s*<\/div>/g, '\n</div>');
  let inCta = false;
  return s.trim().split('\n').map((l) => {
    const t = l.trim();
    if (!t) return '';
    if (t.startsWith('<div class="article-cta">')) { inCta = true; return `    ${t}`; }
    if (t === '</div>') { inCta = false; return '    </div>'; }
    return `    ${inCta ? '  ' : ''}${t}`;
  }).join('\n');
}

module.exports = { sanitize, tidyBody };
