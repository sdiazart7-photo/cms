// Lee y arma los posts del blog con la misma estructura que ya usa el sitio.
// No hace llamadas de red: recibe y devuelve texto, así se puede probar
// contra los archivos reales sin tocar GitHub.

const cfg = require('./config');
const { cld, TX } = require('./cloud');
const { sanitize, tidyBody } = require('./sanitize');
const { HttpError } = require('./http');

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESERVED_SLUGS = new Set(['index', 'assets']);

// ───────────────────────── utilidades de texto ─────────────────────────

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => esc(s).replace(/"/g, '&quot;');
const unesc = (s) => String(s == null ? '' : s)
  .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const plain = (html) => unesc(String(html).replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
const reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function fechaLarga(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return `${d} de ${MESES[m - 1]}, ${y}`;
}

function isoFromFecha(text) {
  const m = /(\d{1,2})\s+de\s+([a-záéíóú]+),?\s+(\d{4})/i.exec(String(text));
  if (!m) return '';
  const mi = MESES.indexOf(m[2].toLowerCase());
  if (mi === -1) return '';
  return `${m[3]}-${String(mi + 1).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
}

const isIso = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const isHttps = (s) => /^https:\/\//i.test(String(s || '').trim());

// ───────────────────────── bloques <div> ─────────────────────────

function findDivEnd(html, openIdx) {
  const re = /<(\/?)div\b[^>]*>/gi;
  re.lastIndex = openIdx;
  let depth = 0;
  let m;
  while ((m = re.exec(html))) {
    if (m[1]) depth--; else depth++;
    if (depth === 0) return re.lastIndex;
  }
  return -1;
}

function divBlock(html, openRe) {
  const m = openRe.exec(html);
  if (!m) return null;
  const end = findDivEnd(html, m.index);
  if (end === -1) return null;
  return { start: m.index, innerStart: m.index + m[0].length, innerEnd: end - '</div>'.length, end };
}

// ───────────────────────── tarjetas del índice ─────────────────────────

const CARD_RE = /<a href="\/blog\/([^"\/]+)\/" class="blog-card">\s*<img src="([^"]*)" alt="([^"]*)">\s*<span class="tag">([\s\S]*?)<\/span>\s*<h3>([\s\S]*?)<\/h3>\s*(?:<span class="date">([\s\S]*?)<\/span>\s*)?<\/a>/g;

function indexBlock(indexHtml) {
  const b = divBlock(indexHtml, /<div class="wrap blog-list">/);
  if (!b) throw new HttpError(500, 'No encontré <div class="wrap blog-list"> en blog/index.html. Revisa si cambió la estructura.');
  return b;
}

function parseCards(indexHtml) {
  const b = indexBlock(indexHtml);
  const inner = indexHtml.slice(b.innerStart, b.innerEnd);
  const cards = [];
  let m;
  CARD_RE.lastIndex = 0;
  while ((m = CARD_RE.exec(inner))) {
    cards.push({
      slug: m[1], img: unesc(m[2]), alt: unesc(m[3]), tag: unesc(plain(m[4])), title: unesc(m[5].trim()),
      date: isoFromFecha(m[6] || ''),
    });
  }
  const declared = (inner.match(/class="blog-card"/g) || []).length;
  if (declared !== cards.length) {
    throw new HttpError(500, `blog/index.html tiene ${declared} tarjetas pero solo pude leer ${cards.length}. Para no perder ninguna, el panel se detiene: revisa el formato de las tarjetas.`);
  }
  return cards;
}

function renderCard(c, { withDate }) {
  const lines = [
    `    <a href="/blog/${c.slug}/" class="blog-card">`,
    `      <img src="${escAttr(cld(c.img, TX.card))}" alt="${escAttr(c.alt)}">`,
    `      <span class="tag">${esc(c.tag)}</span>`,
    `      <h3>${esc(c.title)}</h3>`,
  ];
  if (withDate) lines.push(`      <span class="date">${fechaLarga(c.date)}</span>`);
  lines.push('    </a>');
  return lines.join('\n');
}

function sortCards(cards) {
  return cards.map((c, i) => ({ c, i })).sort((a, b) => (b.c.date || '').localeCompare(a.c.date || '') || a.i - b.i).map((x) => x.c);
}

function renderIndex(indexHtml, cards) {
  const b = indexBlock(indexHtml);
  const body = sortCards(cards).map((c) => renderCard(c, { withDate: true })).join('\n\n');
  return `${indexHtml.slice(0, b.innerStart)}\n\n${body}\n\n  ${indexHtml.slice(b.innerEnd)}`;
}

function cardFromPost(post) {
  return { slug: post.slug, img: post.coverImage, alt: post.coverAlt, tag: post.category, title: post.cardTitle || post.title, date: post.date };
}

// ───────────────────────── piezas comunes del sitio ─────────────────────────

// Se copian del propio blog/index.html: así los posts heredan cualquier cambio
// de menú, pie de página, hojas de estilo o pixel sin tocar el panel.
function extractShell(indexHtml) {
  const pick = (re, name) => {
    const m = re.exec(indexHtml);
    if (!m) throw new HttpError(500, `No encontré ${name} en blog/index.html. Revisa si cambió la estructura.`);
    return m[0];
  };
  return {
    favicon: pick(/<link rel="icon"[^>]*>/, 'el ícono (favicon)'),
    head: pick(/<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">[\s\S]*?(?=\s*<\/head>)/, 'las hojas de estilo y el pixel del <head>'),
    nav: pick(/<nav class="top-nav" id="nav">[\s\S]*?<\/nav>/, 'el menú superior'),
    footer: pick(/<footer class="site-footer">[\s\S]*?<\/body>/, 'el pie de página'),
  };
}

function ldScript(obj) {
  const json = JSON.stringify(obj, null, 2).replace(/</g, '\\u003c').split('\n').map((l) => `  ${l}`).join('\n');
  return `<script type="application/ld+json">\n${json}\n</script>`;
}

// ───────────────────────── armado de un post ─────────────────────────

function buildFaq(post) {
  if (!post.faqs.length) return '';
  const rows = post.faqs.map((f) => `      <h3>${esc(f.q)}</h3>\n      <p>${sanitize(f.a, { inline: true })}</p>`).join('\n');
  return `    <div class="article-faq">\n      <h2>${esc(post.faqTitle || 'Preguntas frecuentes')}</h2>\n${rows}\n    </div>`;
}

function buildRelated(post, cards) {
  const picked = post.related.map((s) => cards.find((c) => c.slug === s)).filter((c) => c && c.slug !== post.slug);
  if (!picked.length) return '';
  const items = picked.map((c) => renderCard(c, { withDate: false }).split('\n').map((l) => `    ${l}`).join('\n')).join('\n');
  return `<section class="section-suave related-posts">
  <div class="wrap">
    <div class="center-copy" style="margin-bottom:40px;">
      <span class="eyebrow">Sigue leyendo</span>
      <h2>Más artículos que te pueden interesar</h2>
    </div>
    <div class="blog-list">
${items}
    </div>
  </div>
</section>

`;
}

function buildPost(post, { shell, cards, preview = false, today }) {
  const url = `${cfg.origin}/blog/${post.slug}/`;
  const ogImage = cld(post.coverImage, TX.og);
  const ogDesc = post.ogDescription || post.metaDescription;

  const article = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.metaDescription,
    image: ogImage,
    datePublished: post.date,
    dateModified: today || post.date,
    author: { '@type': 'Person', name: cfg.authorName },
    publisher: { '@type': 'Organization', name: cfg.siteName },
    mainEntityOfPage: url,
  };
  const scripts = [ldScript(article)];
  if (post.faqs.length) {
    scripts.push(ldScript({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: post.faqs.map((f) => ({
        '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: plain(f.a) },
      })),
    }));
  }

  const grid = post.gridImages.length
    ? `  <div class="article-cover-grid">\n${post.gridImages.map((g) => `    <img src="${escAttr(cld(g.src, TX.grid))}" alt="${escAttr(g.alt)}">`).join('\n')}\n  </div>\n\n`
    : '';
  const faq = buildFaq(post);

  let html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(post.title)} | ${cfg.siteName}</title>
<meta name="description" content="${escAttr(post.metaDescription)}">
<link rel="canonical" href="${url}">
${shell.favicon}
<meta property="og:type" content="article">
<meta property="og:title" content="${escAttr(post.title)}">
<meta property="og:description" content="${escAttr(ogDesc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${escAttr(ogImage)}">
${shell.head}
${scripts.join('\n')}
</head>
<body data-page-type="blog-post">

${shell.nav}

<article>
  <div class="article-header section-crema">
    <span class="eyebrow">${esc(post.category)}</span>
    <h1>${esc(post.title)}</h1>
    <span class="date">${fechaLarga(post.date)}</span>
  </div>

${grid}  <div class="article-body section-crema">
${post.bodyHtml}${faq ? `\n\n${faq}` : ''}
  </div>
</article>

${buildRelated(post, cards)}${shell.footer}
</html>
`;

  if (preview) {
    // Vista previa: sin scripts ni pixel (para no contar visitas falsas) y con las rutas apuntando al sitio real.
    html = html
      .replace(/<script[\s\S]*?<\/script>/g, '')
      .replace(/<noscript>[\s\S]*?<\/noscript>/g, '')
      .replace('<head>', `<head>\n<base href="${cfg.origin}/" target="_blank">`);
  }
  return html;
}

// ───────────────────────── lectura de un post existente ─────────────────────────

function parsePost(html, slug, cards) {
  const get = (re) => { const m = re.exec(html); return m ? unesc(m[1]) : ''; };
  const header = /<div class="article-header[^"]*">([\s\S]*?)<\/div>/.exec(html);
  if (!header) throw new HttpError(500, `No pude leer el encabezado del post "${slug}".`);
  const title = unesc((/<h1>([\s\S]*?)<\/h1>/.exec(header[1]) || [])[1] || '');
  const category = plain((/<span class="eyebrow">([\s\S]*?)<\/span>/.exec(header[1]) || [])[1] || '');
  const date = get(/"datePublished":\s*"(\d{4}-\d{2}-\d{2})"/);

  const gridBlock = divBlock(html, /<div class="article-cover-grid">/);
  const gridImages = [];
  if (gridBlock) {
    const re = /<img src="([^"]*)" alt="([^"]*)">/g;
    const inner = html.slice(gridBlock.innerStart, gridBlock.innerEnd);
    let m;
    while ((m = re.exec(inner))) gridImages.push({ src: unesc(m[1]), alt: unesc(m[2]) });
  }

  const bodyBlock = divBlock(html, /<div class="article-body[^"]*">/);
  if (!bodyBlock) throw new HttpError(500, `No encontré el cuerpo del post "${slug}".`);
  let inner = html.slice(bodyBlock.innerStart, bodyBlock.innerEnd);

  let faqTitle = 'Preguntas frecuentes';
  const faqs = [];
  const faqBlock = divBlock(inner, /<div class="article-faq">/);
  if (faqBlock) {
    const f = inner.slice(faqBlock.innerStart, faqBlock.innerEnd);
    const t = /<h2>([\s\S]*?)<\/h2>/.exec(f);
    if (t) faqTitle = plain(t[1]);
    const re = /<h3>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>/g;
    let m;
    while ((m = re.exec(f))) faqs.push({ q: plain(m[1]), a: m[2].trim() });
    inner = inner.slice(0, faqBlock.start) + inner.slice(faqBlock.end);
  }
  const bodyHtml = inner.split('\n').map((l) => l.trim()).filter((l, i, a) => l || (a[i - 1] && a[i - 1] !== '')).join('\n').trim();

  const related = [];
  const rel = /<section class="section-suave related-posts">([\s\S]*?)<\/section>/.exec(html);
  if (rel) {
    const re = /href="\/blog\/([^"\/]+)\/"/g;
    let m;
    while ((m = re.exec(rel[1]))) if (!related.includes(m[1])) related.push(m[1]);
  }

  const card = (cards || []).find((c) => c.slug === slug);
  const coverImage = get(/<meta property="og:image" content="([^"]*)"/) || (gridImages[0] && gridImages[0].src) || (card && card.img) || '';
  return {
    slug,
    title,
    cardTitle: card && card.title && card.title !== title ? card.title : '',
    category,
    date,
    metaDescription: get(/<meta name="description" content="([^"]*)"/),
    ogDescription: get(/<meta property="og:description" content="([^"]*)"/),
    coverImage,
    coverAlt: (card && card.alt) || (gridImages[0] && gridImages[0].alt) || title,
    gridImages,
    bodyHtml,
    faqTitle,
    faqs,
    related,
  };
}

// ───────────────────────── validación de lo que manda el panel ─────────────────────────

function bad(msg) { throw new HttpError(400, msg); }

function normalizePost(input, { isNew }) {
  const t = (v) => String(v == null ? '' : v).trim();
  const post = {
    slug: t(input.slug),
    title: t(input.title),
    cardTitle: t(input.cardTitle),
    category: t(input.category),
    date: t(input.date),
    metaDescription: t(input.metaDescription).replace(/\s+/g, ' '),
    ogDescription: t(input.ogDescription).replace(/\s+/g, ' '),
    coverImage: t(input.coverImage),
    coverAlt: t(input.coverAlt),
    gridImages: (Array.isArray(input.gridImages) ? input.gridImages : [])
      .map((g) => ({ src: t(g && g.src), alt: t(g && g.alt) })).filter((g) => g.src || g.alt),
    faqTitle: t(input.faqTitle) || 'Preguntas frecuentes',
    faqs: (Array.isArray(input.faqs) ? input.faqs : [])
      .map((f) => ({ q: t(f && f.q).replace(/\s+/g, ' '), a: sanitize(t(f && f.a), { inline: true }).trim() })).filter((f) => f.q || f.a),
    related: (Array.isArray(input.related) ? input.related : []).map(t).filter(Boolean),
  };

  if (!post.title) bad('Falta el título.');
  if (post.title.length > 140) bad('El título es demasiado largo (máximo 140 caracteres).');
  if (post.cardTitle.length > 140) bad('El título de la tarjeta es demasiado largo (máximo 140 caracteres).');
  if (post.cardTitle === post.title) post.cardTitle = '';
  if (!SLUG_RE.test(post.slug) || post.slug.length > 100 || RESERVED_SLUGS.has(post.slug)) {
    bad('La dirección (slug) solo puede tener minúsculas sin tildes, números y guiones, por ejemplo: mi-post-nuevo.');
  }
  if (!post.category) bad('Falta la categoría.');
  if (!isIso(post.date)) bad('La fecha no es válida.');
  if (!post.metaDescription) bad('Falta la descripción para Google.');
  if (post.metaDescription.length > 300) bad('La descripción para Google es demasiado larga (máximo 300 caracteres).');
  if (!isHttps(post.coverImage)) bad('Falta la foto principal (debe ser una dirección https).');
  if (!post.coverAlt) bad('Falta el texto alternativo de la foto principal.');
  if (post.gridImages.length > 4) bad('La cuadrícula de portada admite hasta 4 fotos.');
  post.gridImages.forEach((g, i) => {
    if (!isHttps(g.src)) bad(`La foto ${i + 1} de la cuadrícula necesita una dirección https.`);
    if (!g.alt) bad(`La foto ${i + 1} de la cuadrícula necesita texto alternativo.`);
  });
  post.faqs.forEach((f, i) => {
    if (!f.q || !f.a) bad(`La pregunta frecuente ${i + 1} está incompleta.`);
  });
  if (post.related.length > cfg.relatedMax) bad(`Máximo ${cfg.relatedMax} artículos relacionados.`);
  post.related.forEach((s) => { if (!SLUG_RE.test(s)) bad('Un artículo relacionado tiene una dirección inválida.'); });

  let body = tidyBody(input.bodyHtml);
  body = body.replace(/<img src="([^"]+)"/g, (m, u) => `<img src="${cld(u, TX.body)}"`);
  if (plain(body).length < 80) bad('El cuerpo del artículo está vacío o es demasiado corto.');
  post.bodyHtml = body;
  post.isNew = !!isNew;
  return post;
}

// ───────────────────────── sitemap, redirecciones y relacionados ─────────────────────────

const host = reEsc(new URL(cfg.origin).hostname.replace(/^www\./, ''));

function removeSitemapEntry(xml, slug) {
  const re = new RegExp(`[ \\t]*<url>\\s*<loc>https?://(?:www\\.)?${host}/blog/${reEsc(slug)}/</loc>[\\s\\S]*?</url>[ \\t]*\\r?\\n?`, 'g');
  return xml.replace(re, '');
}

function upsertSitemapEntry(xml, slug, lastmod) {
  const cleaned = removeSitemapEntry(xml, slug);
  const i = cleaned.lastIndexOf('</urlset>');
  if (i === -1) throw new HttpError(500, 'No encontré </urlset> en sitemap.xml.');
  const entry = `    <url><loc>${cfg.origin}/blog/${slug}/</loc><lastmod>${lastmod}</lastmod><changefreq>yearly</changefreq><priority>0.6</priority></url>\n`;
  return cleaned.slice(0, i) + entry + cleaned.slice(i);
}

function addBlogRedirect(text, slug) {
  const base = String(text || '');
  const lines = [`/blog/${slug} /blog/ 301`, `/blog/${slug}/ /blog/ 301`].filter((l) => !base.includes(l));
  if (!lines.length) return base;
  return `${base}${base.endsWith('\n') || !base ? '' : '\n'}${lines.join('\n')}\n`;
}

function removeFromRelated(html, slug) {
  return html.replace(/(<section class="section-suave related-posts">)([\s\S]*?)(<\/section>)/, (m, open, inner, close) => {
    const re = new RegExp(`\\s*<a href="/blog/${reEsc(slug)}/" class="blog-card">[\\s\\S]*?</a>`, 'g');
    return open + inner.replace(re, '') + close;
  });
}

// Sugerencia inicial de relacionados: misma categoría primero, luego los más recientes.
function suggestRelated(cards, post) {
  const others = sortCards(cards).filter((c) => c.slug !== post.slug);
  const same = others.filter((c) => c.tag === post.category);
  const rest = others.filter((c) => c.tag !== post.category);
  return [...same, ...rest].slice(0, cfg.relatedMax).map((c) => c.slug);
}

module.exports = {
  fechaLarga, isoFromFecha, esc, unesc, plain,
  parseCards, renderIndex, cardFromPost, extractShell, buildPost, parsePost, normalizePost,
  removeSitemapEntry, upsertSitemapEntry, addBlogRedirect, removeFromRelated, suggestRelated, sortCards,
  SLUG_RE,
};
