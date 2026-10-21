const cfg = require('./lib/config');
const { endpoint, HttpError } = require('./lib/http');
const { getHead, getFile } = require('./lib/github');
const { parseCards, parsePost, SLUG_RE } = require('./lib/blog');

exports.handler = endpoint('GET', async ({ query }) => {
  const slug = String(query.slug || '');
  if (!SLUG_RE.test(slug)) throw new HttpError(400, 'Dirección (slug) inválida.');
  const head = await getHead();
  const [index, html] = await Promise.all([getFile(cfg.blogIndexPath, head), getFile(cfg.postPath(slug), head)]);
  if (!html) throw new HttpError(404, 'Ese post no existe.');
  return { post: parsePost(html, slug, index ? parseCards(index) : []) };
});
