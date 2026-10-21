const cfg = require('./lib/config');
const { endpoint, HttpError } = require('./lib/http');
const { getHead, getFile, commit } = require('./lib/github');
const blog = require('./lib/blog');

exports.handler = endpoint('POST', async ({ body }) => {
  const isNew = !!body.isNew;
  const post = blog.normalizePost(body.post || {}, { isNew });

  const head = await getHead();
  const [index, sitemap, existing] = await Promise.all([
    getFile(cfg.blogIndexPath, head),
    getFile(cfg.sitemapPath, head),
    getFile(cfg.postPath(post.slug), head),
  ]);
  if (!index || !sitemap) throw new HttpError(500, 'No pude leer blog/index.html o sitemap.xml del sitio.');

  const cards = blog.parseCards(index);
  const inIndex = cards.some((c) => c.slug === post.slug);
  if (isNew && (inIndex || existing)) throw new HttpError(409, 'Ya existe un post con esa dirección (slug). Cambia el slug o edita el que ya está publicado.');
  if (!isNew && !existing) throw new HttpError(404, 'El post que intentas editar ya no existe.');

  const nextCards = inIndex
    ? cards.map((c) => (c.slug === post.slug ? blog.cardFromPost(post) : c))
    : [...cards, blog.cardFromPost(post)];

  const today = new Date().toISOString().slice(0, 10);
  const html = blog.buildPost(post, { shell: blog.extractShell(index), cards: nextCards, today });

  const message = `${isNew ? 'Publica' : 'Edita'} post: ${post.title}`.slice(0, 120);
  const { commitUrl } = await commit({
    files: [
      { path: cfg.postPath(post.slug), content: html },
      { path: cfg.blogIndexPath, content: blog.renderIndex(index, nextCards) },
      { path: cfg.sitemapPath, content: blog.upsertSitemapEntry(sitemap, post.slug, today) },
    ],
  }, message, head);

  return { ok: true, url: `${cfg.origin}/blog/${post.slug}/`, commitUrl };
});
