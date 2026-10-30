const cfg = require('./lib/config');
const { endpoint, HttpError } = require('./lib/http');
const { getHead, getFile } = require('./lib/github');
const { isEditablePath, sha1 } = require('./lib/pages');

exports.handler = endpoint('GET', async ({ query }) => {
  const path = String(query.path || '');
  if (!isEditablePath(path)) throw new HttpError(400, 'Esa página no se puede editar desde el panel.');
  const head = await getHead();
  const html = await getFile(path, head);
  if (html == null) throw new HttpError(404, `No encontré ${path} en el sitio.`);
  return { path, html, hash: sha1(html), origin: cfg.origin };
});
