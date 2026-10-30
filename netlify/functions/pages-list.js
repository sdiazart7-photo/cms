const { endpoint } = require('./lib/http');
const { getHead, listFiles } = require('./lib/github');
const { describe } = require('./lib/pages');
const cfg = require('./lib/config');

exports.handler = endpoint('GET', async () => {
  const head = await getHead();
  const pages = describe(await listFiles(head));
  return { pages, origin: cfg.origin };
});
