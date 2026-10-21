const crypto = require('crypto');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

// Una sola contraseña compartida. Se comparan los hashes con timingSafeEqual
// para que el tiempo de respuesta no delate cuántas letras coinciden.
function checkAuth(event) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return { ok: false, status: 500, error: 'Falta la variable ADMIN_PASSWORD en Netlify' };
  const provided = String((event.headers && event.headers['x-admin-password']) || '');
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  if (!crypto.timingSafeEqual(a, b)) return { ok: false, status: 401, error: 'Contraseña incorrecta' };
  return { ok: true };
}

// Envuelve cada función: método, contraseña, errores y formato de respuesta.
function endpoint(method, fn) {
  return async (event) => {
    if (event.httpMethod !== method) return json(405, { error: 'Método no permitido' });
    const auth = checkAuth(event);
    if (!auth.ok) return json(auth.status, { error: auth.error });
    try {
      let body = {};
      if (method === 'POST') {
        try { body = JSON.parse(event.body || '{}'); } catch (e) { throw new HttpError(400, 'El cuerpo de la petición no es JSON válido'); }
      }
      return json(200, await fn({ body, query: event.queryStringParameters || {} }));
    } catch (e) {
      return json(e.status || 500, { error: e.message || 'Error inesperado' });
    }
  };
}

module.exports = { HttpError, json, checkAuth, endpoint };
