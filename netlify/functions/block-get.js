const cfg = require('./lib/config');
const { endpoint, HttpError } = require('./lib/http');
const { getHead, getFile } = require('./lib/github');
const { BLOCKS } = require('./lib/homeblocks');

exports.handler = endpoint('GET', async ({ query }) => {
  const block = BLOCKS[query.block];
  if (!block) throw new HttpError(404, 'Bloque desconocido.');
  const src = await getFile(cfg.homePath, await getHead());
  if (!src) throw new HttpError(404, `No encontré ${cfg.homePath}.`);
  return { items: block.read(src) };
});
