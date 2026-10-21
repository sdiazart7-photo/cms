const cfg = require('./lib/config');
const { endpoint, HttpError } = require('./lib/http');
const { getHead, getFile, commit } = require('./lib/github');
const blog = require('./lib/blog');

// Despublica un post: borra su página, su tarjeta y su línea del sitemap, deja
// una redirección al blog (para que Google no encuentre un 404) y lo quita de
// la sección "Sigue leyendo" de los demás posts.
exports.handler = endpoint('POST', async ({ body }) => {
  const slug = String(body.slug || '');
  if (!blog.SLUG_RE.test(slug)) throw new HttpError(400, 'Dirección (slug) inválida.');

  const head = await getHead();
  const [index, sitemap, redirects, page] = await Promise.all([
    getFile(cfg.blogIndexPath, head),
    getFile(cfg.sitemapPath, head),
    getFile(cfg.redirectsPath, head),
    getFile(cfg.postPath(slug), head),
  ]);
  if (!index || !sitemap) throw new HttpError(500, 'No pude leer blog/index.html o sitemap.xml del sitio.');
  if (!page) throw new HttpError(404, 'Ese post no existe.');

  const cards = blog.parseCards(index);
  const remaining = cards.filter((c) => c.slug !== slug);

  const others = await Promise.all(remaining.map(async (c) => ({ slug: c.slug, html: await getFile(cfg.postPath(c.slug), head) })));
  const files = [
    { path: cfg.blogIndexPath, content: blog.renderIndex(index, remaining) },
    { path: cfg.sitemapPath, content: blog.removeSitemapEntry(sitemap, slug) },
    { path: cfg.redirectsPath, content: blog.addBlogRedirect(redirects, slug) },
  ];
  let touched = 0;
  for (const o of others) {
    if (!o.html) continue;
    const next = blog.removeFromRelated(o.html, slug);
    if (next !== o.html) { files.push({ path: cfg.postPath(o.slug), content: next }); touched++; }
  }

  const { commitUrl } = await commit({ files, deletes: [cfg.postPath(slug)] }, `Despublica post: ${slug}`, head);
  return { ok: true, commitUrl, postsActualizados: touched };
});
