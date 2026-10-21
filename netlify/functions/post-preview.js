const cfg = require('./lib/config');
const { endpoint, HttpError } = require('./lib/http');
const { getHead, getFile } = require('./lib/github');
const { parseCards, extractShell, buildPost, normalizePost, cardFromPost } = require('./lib/blog');

// Arma el post exactamente como se publicaría, pero sin guardar nada.
exports.handler = endpoint('POST', async ({ body }) => {
  const head = await getHead();
  const index = await getFile(cfg.blogIndexPath, head);
  if (!index) throw new HttpError(404, `No encontré ${cfg.blogIndexPath}.`);
  const input = { ...(body.post || {}) };
  if (!input.slug) input.slug = 'vista-previa';
  const post = normalizePost(input, { isNew: false });
  const cards = parseCards(index);
  if (!cards.some((c) => c.slug === post.slug)) cards.push(cardFromPost(post));
  return { html: buildPost(post, { shell: extractShell(index), cards, preview: true, today: post.date }) };
});
