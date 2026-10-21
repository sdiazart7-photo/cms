// Prueba el motor contra los archivos reales del sitio: lee cada post, lo
// vuelve a armar con la plantilla del panel y verifica que no se pierda nada.
// Uso: SITE_DIR=/ruta/al/sitio node test/roundtrip.js

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const blog = require('../netlify/functions/lib/blog');
const { sanitize } = require('../netlify/functions/lib/sanitize');

const SITE = process.env.SITE_DIR || path.join(__dirname, '..', '..', 'finite-estudio-web');
const read = (p) => fs.readFileSync(path.join(SITE, p), 'utf8');

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok   ${name}`); } catch (e) { failures++; console.log(`  FALLA ${name}\n       ${e.message.split('\n')[0]}`); }
};

const indexHtml = read('blog/index.html');
const cards = blog.parseCards(indexHtml);
const shell = blog.extractShell(indexHtml);

console.log(`Índice: ${cards.length} tarjetas`);
check('las 9 tarjetas se leen con fecha ISO', () => {
  assert.strictEqual(cards.length, 9);
  cards.forEach((c) => assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(c.date), `${c.slug}: fecha "${c.date}"`));
});
check('el índice se regenera y vuelve a leerse igual', () => {
  const out = blog.renderIndex(indexHtml, cards);
  const again = blog.parseCards(out);
  assert.deepStrictEqual(again.map((c) => c.slug).sort(), cards.map((c) => c.slug).sort());
  const byDate = again.map((c) => c.date);
  assert.deepStrictEqual(byDate, [...byDate].sort().reverse(), 'orden por fecha descendente');
  assert.ok(out.includes('<footer class="site-footer">') && out.includes('</html>'));
});

for (const card of cards) {
  console.log(`Post ${card.slug}`);
  const html = read(`blog/${card.slug}/index.html`);
  const a = blog.parsePost(html, card.slug, cards);

  check('se leen título, fecha, categoría y descripción', () => {
    assert.ok(a.title && a.date && a.category && a.metaDescription && a.coverImage);
    assert.strictEqual(a.cardTitle, card.title === a.title ? '' : card.title);
  });

  const input = { ...a, related: a.related };
  let post;
  check('pasa la validación del panel', () => { post = blog.normalizePost(input, { isNew: false }); });
  if (!post) continue;

  const out = blog.buildPost(post, { shell, cards, today: '2026-10-20' });
  const b = blog.parsePost(out, card.slug, cards);

  check('título, categoría, fecha, descripciones y portada se conservan', () => {
    ['title', 'cardTitle', 'category', 'date', 'metaDescription', 'ogDescription'].forEach((k) => assert.strictEqual(b[k], a[k], k));
    assert.ok(b.coverImage.includes(a.coverImage.split('/upload/').pop().split('/').pop()), 'portada');
  });
  check('la cuadrícula de fotos se conserva', () => {
    assert.strictEqual(b.gridImages.length, a.gridImages.length);
    b.gridImages.forEach((g, i) => assert.strictEqual(g.alt, a.gridImages[i].alt));
  });
  check('las preguntas frecuentes se conservan', () => {
    assert.strictEqual(b.faqs.length, a.faqs.length);
    b.faqs.forEach((f, i) => { assert.strictEqual(f.q, a.faqs[i].q); assert.strictEqual(f.a, a.faqs[i].a); });
    assert.strictEqual(b.faqTitle, a.faqTitle);
  });
  check('los artículos relacionados se conservan', () => {
    assert.deepStrictEqual(b.related, a.related.filter((s) => cards.some((c) => c.slug === s)));
  });
  check('el cuerpo conserva texto, enlaces, imágenes y encabezados', () => {
    const text = (h) => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    assert.strictEqual(text(b.bodyHtml), text(a.bodyHtml), 'texto');
    const count = (h, re) => (h.match(re) || []).length;
    for (const re of [/<a /g, /<img /g, /<h2/g, /<h3/g, /<li>/g, /<blockquote/g, /class="article-cta"/g]) {
      assert.strictEqual(count(b.bodyHtml, re), count(a.bodyHtml, re), String(re));
    }
    const hrefs = (h) => (h.match(/href="[^"]*"/g) || []).join('|');
    assert.strictEqual(hrefs(b.bodyHtml), hrefs(a.bodyHtml), 'enlaces');
  });
  check('el HTML final trae menú, pixel, JSON-LD y pie de página del sitio', () => {
    assert.ok(out.includes('<nav class="top-nav" id="nav">'));
    assert.ok(out.includes('tracking.js'));
    assert.ok(out.includes('facebook-domain-verification'));
    assert.ok(out.includes('"@type": "Article"'));
    assert.strictEqual(out.includes('"@type": "FAQPage"'), a.faqs.length > 0);
    assert.ok(out.trim().endsWith('</html>'));
    assert.strictEqual((out.match(/<h1>/g) || []).length, 1, 'un solo h1');
    assert.strictEqual((out.match(/<\/?div/g) || []).length % 2, 0, 'divs balanceados');
  });
  check('volver a guardar el resultado no cambia nada (idempotente)', () => {
    const p2 = blog.normalizePost({ ...b }, { isNew: false });
    const out2 = blog.buildPost(p2, { shell, cards, today: '2026-10-20' });
    assert.strictEqual(out2, out);
  });
}

console.log('Índice después de editar un post');
check('editar un post conserva el título corto de su tarjeta y el de las demás', () => {
  const slug = 'cuanto-cuesta-un-fotografo-de-bodas-en-tijuana';
  const a = blog.parsePost(read(`blog/${slug}/index.html`), slug, cards);
  const post = blog.normalizePost(a, { isNew: false });
  const next = cards.map((c) => (c.slug === slug ? blog.cardFromPost(post) : c));
  const again = blog.parseCards(blog.renderIndex(indexHtml, next));
  cards.forEach((c) => assert.strictEqual(again.find((x) => x.slug === c.slug).title, c.title, c.slug));
});

console.log('Sitemap, redirecciones y relacionados');
check('sitemap: agrega, reemplaza y quita sin duplicar', () => {
  const xml = read('sitemap.xml');
  const added = blog.upsertSitemapEntry(xml, 'post-nuevo', '2026-10-20');
  assert.strictEqual((added.match(/post-nuevo/g) || []).length, 1);
  const twice = blog.upsertSitemapEntry(added, 'post-nuevo', '2026-10-21');
  assert.strictEqual((twice.match(/post-nuevo/g) || []).length, 1);
  assert.ok(twice.includes('2026-10-21') && !twice.includes('2026-10-20'));
  const removed = blog.removeSitemapEntry(twice, 'post-nuevo');
  assert.strictEqual(removed, xml);
  const sinWww = blog.removeSitemapEntry(xml, 'cuando-contratar-fotografo-de-bodas-en-tijuana');
  assert.strictEqual((sinWww.match(/<url>/g) || []).length, (xml.match(/<url>/g) || []).length - 1);
});
check('redirecciones: agrega las dos variantes una sola vez', () => {
  const r = read('_redirects');
  const a = blog.addBlogRedirect(r, 'viejo');
  assert.ok(a.includes('/blog/viejo /blog/ 301') && a.includes('/blog/viejo/ /blog/ 301'));
  assert.strictEqual(blog.addBlogRedirect(a, 'viejo'), a);
});
check('relacionados: quitar un post lo borra de otros posts', () => {
  const html = read('blog/lugares-para-sesion-save-the-date-tijuana-rosarito/index.html');
  const out = blog.removeFromRelated(html, 'jardin-boda-pettite-casa-baga-rosarito');
  const rel = /<section class="section-suave related-posts">([\s\S]*?)<\/section>/.exec(out)[1];
  assert.ok(!rel.includes('jardin-boda-pettite-casa-baga-rosarito'));
  assert.ok(out.includes('/blog/jardin-boda-pettite-casa-baga-rosarito/'), 'el enlace del cuerpo se queda');
});
check('post nuevo desde cero se arma y se lee de vuelta', () => {
  const post = blog.normalizePost({
    slug: 'prueba-de-post', title: 'Un post de prueba: "comillas" & más', category: 'Planeación', date: '2026-10-20',
    metaDescription: 'Descripción de prueba para Google.', coverImage: 'https://res.cloudinary.com/drrhn6t1c/image/upload/v1/finite-estudio-web/portafolio/portafolio-25.jpg',
    coverAlt: 'Novios', gridImages: [], faqs: [{ q: '¿Pregunta?', a: 'Respuesta con <a href="/blog/">enlace</a> y <script>x()</script>' }],
    related: ['jardin-boda-pettite-casa-baga-rosarito'],
    bodyHtml: '<p>' + 'Texto de ejemplo para el cuerpo del artículo. '.repeat(4) + '</p><h2>Subtítulo</h2><p>Más texto <b>importante</b>.</p><script>alert(1)</script>',
  }, { isNew: true });
  const out = blog.buildPost(post, { shell, cards, today: '2026-10-20' });
  assert.ok(!out.includes('alert(1)') && !out.includes('x()'));
  assert.ok(out.includes('<title>Un post de prueba: "comillas" &amp; más | Finite Estudio</title>'));
  const back = blog.parsePost(out, 'prueba-de-post', cards);
  assert.strictEqual(back.title, 'Un post de prueba: "comillas" & más');
  assert.strictEqual(back.faqs.length, 1);
  assert.ok(out.includes('w_1200,h_630,c_fill'));
  const preview = blog.buildPost(post, { shell, cards, preview: true });
  assert.ok(!preview.includes('<script') && preview.includes('<base href="https://finiteestudio.com/"'));
});
check('validación rechaza datos incompletos', () => {
  assert.throws(() => blog.normalizePost({ slug: 'Mal Slug', title: 'x' }, { isNew: true }));
  assert.throws(() => blog.normalizePost({ slug: 'ok', title: '' }, { isNew: true }));
});

console.log('Preguntas frecuentes y portafolio de la home');
const { BLOCKS } = require('../netlify/functions/lib/homeblocks');
const home = read('index.html');
check('se leen las 8 preguntas y las 12 fotos con su texto alternativo', () => {
  const faqs = BLOCKS.faqs.read(home);
  assert.strictEqual(faqs.length, 8);
  assert.ok(faqs[0].q.startsWith('¿Cuántas bodas cubren al año?'));
  const port = BLOCKS.portafolio.read(home);
  assert.strictEqual(port.length, 12);
  assert.ok(port.every((x) => x.url.startsWith('https://') && x.alt));
  assert.ok(port[0].url.includes('%C3%B1') || port[0].url.includes('kasandra'));
});
check('guardar sin cambios deja index.html idéntico salvo el formato de los arreglos', () => {
  const faqs = BLOCKS.faqs.read(home);
  const out = BLOCKS.faqs.write(home, faqs);
  assert.deepStrictEqual(BLOCKS.faqs.read(out), faqs);
  const strip = (h) => h.replace(/var faqs = \[[\s\S]*?\n  \];/, 'FAQS');
  assert.strictEqual(strip(out), strip(home));
  const port = BLOCKS.portafolio.read(home);
  const out2 = BLOCKS.portafolio.write(home, port);
  assert.deepStrictEqual(BLOCKS.portafolio.read(out2).map((x) => x.alt), port.map((x) => x.alt));
  const strip2 = (h) => h.replace(/var portfolioImages = \[[\s\S]*?\n  \];/, 'A').replace(/var portfolioAlts = \[[\s\S]*?\n  \];/, 'B');
  assert.strictEqual(strip2(out2), strip2(home));
});
check('agregar, editar y reordenar preguntas funciona y el JavaScript sigue siendo válido', () => {
  const faqs = BLOCKS.faqs.read(home);
  const next = [{ q: '¿Pregunta nueva con "comillas" y \\ barra?', a: 'Respuesta con <b>negrita</b>, <a href="/blog/">enlace</a> y </script> raro' }, ...faqs.slice(1)];
  const out = BLOCKS.faqs.write(home, next);
  const back = BLOCKS.faqs.read(out);
  assert.strictEqual(back.length, 8);
  assert.strictEqual(back[0].q, next[0].q);
  assert.ok(!back[0].a.includes('</script>'));
  assert.ok(back[0].a.includes('<strong>negrita</strong>'));
  const scripts = [...out.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  scripts.forEach((code) => new Function(code));
});
check('quitar fotos mantiene los dos arreglos del mismo largo', () => {
  const port = BLOCKS.portafolio.read(home).slice(0, 7);
  const out = BLOCKS.portafolio.write(home, port);
  assert.strictEqual(BLOCKS.portafolio.read(out).length, 7);
});
check('rechaza fotos sin texto alternativo, sin https o listas vacías', () => {
  assert.throws(() => BLOCKS.portafolio.write(home, [{ url: 'https://a.com/x.jpg', alt: '' }]));
  assert.throws(() => BLOCKS.portafolio.write(home, [{ url: 'http://a.com/x.jpg', alt: 'x' }]));
  assert.throws(() => BLOCKS.portafolio.write(home, []));
  assert.throws(() => BLOCKS.faqs.write(home, []));
  assert.throws(() => BLOCKS.faqs.write(home, [{ q: 'x', a: '' }]));
});

console.log(failures ? `\n${failures} prueba(s) con falla` : '\nTodo en orden');
process.exit(failures ? 1 : 0);
