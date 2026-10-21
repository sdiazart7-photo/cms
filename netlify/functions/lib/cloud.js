// Utilidades para URLs de Cloudinary: el mismo archivo se sirve con distinto
// tamaño según dónde se use (tarjeta, portada, cuerpo del artículo).

const TX_TOKEN = /^(?:f|q|w|h|c|g|e|ar|dpr|b|r|a|x|y|l|o|t|z|fl)_[^/]+$/;
const BASE = /^(https?:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.+)$/;

function split(url) {
  const m = BASE.exec(String(url || ''));
  if (!m) return null;
  const segs = m[2].split('/');
  // Quita el tramo de transformaciones (f_auto,q_auto,w_600) si existe.
  if (segs.length > 1 && segs[0].split(',').every((t) => TX_TOKEN.test(t))) segs.shift();
  return { base: m[1], rest: segs.join('/') };
}

function isCloudinary(url) {
  return !!split(url);
}

// Devuelve la misma imagen con otras transformaciones. URLs que no son de Cloudinary pasan igual.
function cld(url, tx) {
  const s = split(url);
  if (!s) return url;
  return `${s.base}${tx}/${s.rest}`;
}

const TX = {
  card: 'f_auto,q_auto,w_600',
  grid: 'f_auto,q_auto,w_500',
  body: 'f_auto,q_auto,w_1200',
  og: 'f_auto,q_auto,w_1200,h_630,c_fill',
  portfolio: 'f_auto,q_auto,w_1400',
  thumb: 'f_auto,q_auto,w_240',
};

module.exports = { cld, isCloudinary, TX };
