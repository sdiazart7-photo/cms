const { endpoint, HttpError } = require('./lib/http');
const { getHead, getFile, commit } = require('./lib/github');
const { isEditablePath, sha1, validateSave, META } = require('./lib/pages');

exports.handler = endpoint('POST', async ({ body }) => {
  const path = String(body.path || '');
  if (!isEditablePath(path)) throw new HttpError(400, 'Esa página no se puede editar desde el panel.');
  const head = await getHead();
  const current = await getFile(path, head);
  if (current == null) throw new HttpError(404, `No encontré ${path} en el sitio.`);
  if (body.baseHash && sha1(current) !== body.baseHash) {
    throw new HttpError(409, 'Esta página cambió en el sitio después de que la abriste (por ejemplo desde otra pestaña del panel). Recárgala para no pisar ese cambio.');
  }
  const html = body.html;
  validateSave(current, html);
  if (html === current) return { ok: true, sinCambios: true, hash: sha1(current) };
  const label = (META[path] && META[path].label) || path;
  const { commitUrl } = await commit({ files: [{ path, content: html }] }, `Edita ${label} desde el panel`, head);
  return { ok: true, commitUrl, hash: sha1(html) };
});
