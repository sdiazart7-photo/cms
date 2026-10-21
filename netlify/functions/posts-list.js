const cfg = require('./lib/config');
const { endpoint, HttpError } = require('./lib/http');
const { getHead, getFile } = require('./lib/github');
const { parseCards, sortCards } = require('./lib/blog');

exports.handler = endpoint('GET', async () => {
  const head = await getHead();
  const index = await getFile(cfg.blogIndexPath, head);
  if (!index) throw new HttpError(404, `No encontré ${cfg.blogIndexPath} en ${cfg.owner}/${cfg.repo}.`);
  const posts = sortCards(parseCards(index));
  const categories = [...new Set([...cfg.categories, ...posts.map((p) => p.tag)])];
  return {
    posts,
    categories,
    origin: cfg.origin,
    siteName: cfg.siteName,
    relatedMax: cfg.relatedMax,
    cloud: {
      enabled: !!(process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET),
      name: cfg.cloudName,
    },
  };
});
