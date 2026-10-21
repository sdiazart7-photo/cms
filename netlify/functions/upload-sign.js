const crypto = require('crypto');
const cfg = require('./lib/config');
const { endpoint, HttpError } = require('./lib/http');

// Firma una subida directa a Cloudinary. El API secret se queda en el servidor;
// el navegador recibe solo la firma, válida para esa carpeta y ese momento.
exports.handler = endpoint('POST', async ({ body }) => {
  const key = process.env.CLOUDINARY_API_KEY;
  const secret = process.env.CLOUDINARY_API_SECRET;
  if (!key || !secret) throw new HttpError(400, 'Falta configurar CLOUDINARY_API_KEY y CLOUDINARY_API_SECRET en Netlify para subir fotos desde el panel.');

  let folder;
  if (body.kind === 'portafolio') {
    folder = cfg.uploadFolders.portafolio;
  } else if (body.kind === 'blog') {
    const slug = String(body.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 100) || 'sin-clasificar';
    folder = `${cfg.uploadFolders.blog}/${slug}`;
  } else {
    throw new HttpError(400, 'Tipo de subida desconocido.');
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const params = { folder, timestamp, unique_filename: 'true', use_filename: 'true' };
  const toSign = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
  const signature = crypto.createHash('sha1').update(toSign + secret).digest('hex');

  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${cfg.cloudName}/image/upload`,
    apiKey: key,
    signature,
    fields: params,
  };
});
