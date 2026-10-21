// Bloques de la página de inicio que viven como arreglos de JavaScript dentro
// de index.html: las preguntas frecuentes y las fotos del portafolio.
// Se leen y se reescriben sin evaluar código: los arreglos solo contienen
// textos, así que un lector propio basta y no ejecuta nada del archivo.

const { sanitize } = require('./sanitize');
const { cld, TX } = require('./cloud');
const { HttpError } = require('./http');

// ───────────── lectura y escritura de arreglos de textos ─────────────

function findArray(src, decl) {
  const m = decl.exec(src);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  let depth = 0;
  let q = null;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '\\') { i++; continue; }
      if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { q = ch; continue; }
    if (ch === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (ch === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2); if (i === -1) return null; i++; continue; }
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return { start: m.index, end: i + 1 + (src[i + 1] === ';' ? 1 : 0), text: src.slice(open, i + 1) };
    }
  }
  return null;
}

const SIMPLE_ESC = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' };

function unescapeJs(raw) {
  return raw.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (m, e) => {
    if (e.length > 1 && e[0] === 'u') return String.fromCodePoint(parseInt(e.replace(/[u{}]/g, ''), 16));
    if (e.length === 3 && e[0] === 'x') return String.fromCharCode(parseInt(e.slice(1), 16));
    return Object.prototype.hasOwnProperty.call(SIMPLE_ESC, e) ? SIMPLE_ESC[e] : e;
  });
}

// Convierte "[ ['a','b'], ... ]" en arreglos anidados de textos.
function parseStringArray(text, label) {
  let i = 0;
  const fail = () => { throw new HttpError(500, `No pude leer ${label} en index.html: el formato cambió y el panel se detiene para no dañar la página.`); };
  const skip = () => {
    for (;;) {
      while (i < text.length && /\s/.test(text[i])) i++;
      if (text[i] === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
      if (text[i] === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i + 2) + 2; if (i < 2) fail(); continue; }
      return;
    }
  };
  const str = () => {
    const q = text[i++];
    let raw = '';
    while (i < text.length && text[i] !== q) {
      if (text[i] === '\\') { raw += text[i++]; }
      raw += text[i++];
    }
    if (text[i] !== q) fail();
    i++;
    return unescapeJs(raw);
  };
  const value = () => {
    skip();
    if (text[i] === '[') {
      i++;
      const arr = [];
      for (;;) {
        skip();
        if (text[i] === ']') { i++; return arr; }
        arr.push(value());
        skip();
        if (text[i] === ',') i++;
        else if (text[i] !== ']') fail();
      }
    }
    if (text[i] === '"' || text[i] === "'") return str();
    return fail();
  };
  const out = value();
  skip();
  if (i < text.length) fail();
  return out;
}

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const lit = (s) => JSON.stringify(String(s)).replace(/</g, '\\u003c').split(LS).join('\\u2028').split(PS).join('\\u2029');

function replaceArray(src, decl, label, rendered) {
  const f = findArray(src, decl);
  if (!f) throw new HttpError(500, `No encontré ${label} en index.html.`);
  return src.slice(0, f.start) + rendered + src.slice(f.end);
}

// ───────────── preguntas frecuentes ─────────────

const FAQ_DECL = /var faqs = \[/;

function readFaqs(src) {
  const f = findArray(src, FAQ_DECL);
  if (!f) throw new HttpError(500, 'No encontré "var faqs = [" en index.html.');
  const rows = parseStringArray(f.text, 'las preguntas frecuentes');
  return rows.map((r) => {
    if (!Array.isArray(r) || r.length < 2) throw new HttpError(500, 'Una pregunta frecuente tiene un formato inesperado.');
    return { q: r[0], a: r[1] };
  });
}

function writeFaqs(src, items) {
  const clean = (Array.isArray(items) ? items : []).map((x) => ({
    q: String((x && x.q) || '').replace(/\s+/g, ' ').trim(),
    a: sanitize(String((x && x.a) || '').trim(), { inline: true }).trim(),
  }));
  if (!clean.length) throw new HttpError(400, 'Deja al menos una pregunta frecuente.');
  clean.forEach((x, i) => {
    if (!x.q || !x.a) throw new HttpError(400, `La pregunta ${i + 1} está incompleta.`);
    if (x.q.length > 220) throw new HttpError(400, `La pregunta ${i + 1} es demasiado larga.`);
    if (x.a.length > 1800) throw new HttpError(400, `La respuesta ${i + 1} es demasiado larga.`);
  });
  const body = clean.map((x) => `    [${lit(x.q)},${lit(x.a)}]`).join(',\n');
  return replaceArray(src, FAQ_DECL, 'las preguntas frecuentes', `var faqs = [\n${body}\n  ];`);
}

// ───────────── fotos del portafolio ─────────────

const IMG_DECL = /var portfolioImages = \[/;
const ALT_DECL = /var portfolioAlts = \[/;

function readPortfolio(src) {
  const a = findArray(src, IMG_DECL);
  const b = findArray(src, ALT_DECL);
  if (!a || !b) throw new HttpError(500, 'No encontré las listas del portafolio en index.html.');
  const urls = parseStringArray(a.text, 'las fotos del portafolio');
  const alts = parseStringArray(b.text, 'los textos alternativos del portafolio');
  return urls.map((url, i) => ({ url, alt: alts[i] || '' }));
}

function writePortfolio(src, items) {
  const clean = (Array.isArray(items) ? items : []).map((x) => ({
    url: String((x && x.url) || '').trim(),
    alt: String((x && x.alt) || '').replace(/\s+/g, ' ').trim(),
  }));
  if (!clean.length) throw new HttpError(400, 'El portafolio necesita al menos una foto.');
  if (clean.length > 60) throw new HttpError(400, 'El portafolio admite hasta 60 fotos.');
  clean.forEach((x, i) => {
    if (!/^https:\/\//i.test(x.url)) throw new HttpError(400, `La foto ${i + 1} necesita una dirección https.`);
    if (!x.alt) throw new HttpError(400, `La foto ${i + 1} necesita texto alternativo (describe qué se ve).`);
    if (x.alt.length > 180) throw new HttpError(400, `El texto alternativo de la foto ${i + 1} es demasiado largo.`);
  });
  const urls = clean.map((x) => `    ${lit(cld(x.url, TX.portfolio))}`).join(',\n');
  const alts = clean.map((x) => `    ${lit(x.alt)}`).join(',\n');
  let out = replaceArray(src, IMG_DECL, 'las fotos del portafolio', `var portfolioImages = [\n${urls}\n  ];`);
  out = replaceArray(out, ALT_DECL, 'los textos alternativos del portafolio', `var portfolioAlts = [\n${alts}\n  ];`);
  return out;
}

const BLOCKS = {
  faqs: { label: 'preguntas frecuentes', read: readFaqs, write: writeFaqs },
  portafolio: { label: 'portafolio', read: readPortfolio, write: writePortfolio },
};

module.exports = { BLOCKS, findArray, parseStringArray };
