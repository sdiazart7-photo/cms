const cfg = require('./lib/config');
const { endpoint, HttpError } = require('./lib/http');
const { getHead, getFile, commit } = require('./lib/github');
const { BLOCKS } = require('./lib/homeblocks');

exports.handler = endpoint('POST', async ({ body }) => {
  const block = BLOCKS[body.block];
  if (!block) throw new HttpError(404, 'Bloque desconocido.');
  const head = await getHead();
  const src = await getFile(cfg.homePath, head);
  if (!src) throw new HttpError(404, `No encontré ${cfg.homePath}.`);
  const next = block.write(src, body.items);
  if (next === src) return { ok: true, sinCambios: true };
  const { commitUrl } = await commit({ files: [{ path: cfg.homePath, content: next }] }, `Actualiza ${block.label}`, head);
  return { ok: true, commitUrl };
});
