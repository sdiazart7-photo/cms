// Prueba las funciones completas (login, listar, guardar, borrar) con un
// GitHub simulado en memoria que parte de los archivos reales del sitio.
// Uso: SITE_DIR=/ruta/al/sitio node test/functions.js

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SITE = process.env.SITE_DIR || path.join(__dirname, '..', '..', 'finite-estudio-web');
process.env.ADMIN_PASSWORD = 'clave-de-prueba';
process.env.GITHUB_TOKEN = 'token-falso';
process.env.CLOUDINARY_API_KEY = '123';
process.env.CLOUDINARY_API_SECRET = 'secreto';

const { install } = require('./fake-github');
const gh = install(SITE);
const files = gh.files;
const commitsRef = gh;

const call = async (name, { method = 'GET', query, body, password = 'clave-de-prueba' } = {}) => {
  const fn = require(`../netlify/functions/${name}`).handler;
  const r = await fn({ httpMethod: method, headers: { 'x-admin-password': password }, queryStringParameters: query || {}, body: body ? JSON.stringify(body) : null });
  return { status: r.statusCode, data: JSON.parse(r.body) };
};

let failures = 0;
const test = async (name, fn) => {
  try { await fn(); console.log(`  ok   ${name}`); } catch (e) { failures++; console.log(`  FALLA ${name}\n       ${e.message}`); }
};

(async () => {
  console.log('Login');
  await test('sin contraseña correcta responde 401', async () => {
    const r = await call('posts-list', { password: 'mala' });
    assert.strictEqual(r.status, 401);
  });
  await test('el método equivocado responde 405', async () => {
    const r = await call('post-save', { method: 'GET' });
    assert.strictEqual(r.status, 405);
  });

  console.log('Listado y lectura');
  await test('lista los 9 posts, categorías y estado de Cloudinary', async () => {
    const r = await call('posts-list');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.data.posts.length, 9);
    assert.ok(r.data.categories.includes('Lugares') && r.data.cloud.enabled);
  });
  await test('lee un post completo para editarlo', async () => {
    const r = await call('post-get', { query: { slug: 'cuanto-cuesta-un-fotografo-de-bodas-en-tijuana' } });
    assert.strictEqual(r.status, 200);
    assert.ok(r.data.post.faqs.length >= 3 && r.data.post.bodyHtml.includes('<h2>'));
    assert.ok(r.data.post.cardTitle);
  });
  await test('un slug inexistente responde 404 y uno inválido 400', async () => {
    assert.strictEqual((await call('post-get', { query: { slug: 'no-existe' } })).status, 404);
    assert.strictEqual((await call('post-get', { query: { slug: '../etc' } })).status, 400);
  });

  console.log('Publicar y editar');
  const nuevo = {
    slug: 'consejos-para-el-dia-de-la-boda', title: 'Consejos para el día de tu boda', category: 'Planeación', date: '2026-10-20',
    metaDescription: 'Consejos prácticos para organizar el día de tu boda en Tijuana sin correr.',
    coverImage: 'https://res.cloudinary.com/drrhn6t1c/image/upload/v1/finite-estudio-web/portafolio/portafolio-25.jpg', coverAlt: 'Novios en su boda',
    gridImages: [], faqs: [{ q: '¿Cuándo empiezo a planear?', a: 'Entre 12 y 18 meses antes.' }],
    related: ['jardin-boda-pettite-casa-baga-rosarito', 'cuando-contratar-fotografo-de-bodas-en-tijuana'],
    bodyHtml: `<p>${'Un párrafo con contenido suficiente para pasar la validación. '.repeat(3)}</p><h2>Primer consejo</h2><p>Texto del consejo.</p>`,
  };
  await test('publicar crea página, tarjeta y sitemap en un solo commit', async () => {
    const before = commitsRef.commits.length;
    const r = await call('post-save', { method: 'POST', body: { isNew: true, post: nuevo } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.data));
    assert.strictEqual(commitsRef.commits.length, before + 1);
    assert.ok(files.has('blog/consejos-para-el-dia-de-la-boda/index.html'));
    assert.ok(files.get('blog/index.html').includes('/blog/consejos-para-el-dia-de-la-boda/'));
    assert.ok(files.get('sitemap.xml').includes('/blog/consejos-para-el-dia-de-la-boda/'));
    assert.ok(files.get('blog/consejos-para-el-dia-de-la-boda/index.html').includes('"@type": "FAQPage"'));
  });
  await test('publicar con un slug repetido responde 409', async () => {
    const r = await call('post-save', { method: 'POST', body: { isNew: true, post: nuevo } });
    assert.strictEqual(r.status, 409);
  });
  await test('editar cambia el título sin duplicar tarjeta ni sitemap', async () => {
    const r = await call('post-save', { method: 'POST', body: { isNew: false, post: { ...nuevo, title: 'Consejos para tu boda (actualizado)' } } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.data));
    assert.strictEqual((files.get('blog/index.html').match(/consejos-para-el-dia-de-la-boda/g) || []).length, 1);
    assert.strictEqual((files.get('sitemap.xml').match(/consejos-para-el-dia-de-la-boda/g) || []).length, 1);
    assert.ok(files.get('blog/index.html').includes('Consejos para tu boda (actualizado)'));
  });
  await test('editar un post que no existe responde 404', async () => {
    const r = await call('post-save', { method: 'POST', body: { isNew: false, post: { ...nuevo, slug: 'fantasma' } } });
    assert.strictEqual(r.status, 404);
  });
  await test('datos inválidos responden 400 con un mensaje claro', async () => {
    const r = await call('post-save', { method: 'POST', body: { isNew: true, post: { ...nuevo, slug: 'otro', coverAlt: '' } } });
    assert.strictEqual(r.status, 400);
    assert.ok(/texto alternativo/i.test(r.data.error));
  });
  await test('la vista previa devuelve HTML sin guardar nada', async () => {
    const before = commitsRef.commits.length;
    const r = await call('post-preview', { method: 'POST', body: { post: { ...nuevo, slug: '' } } });
    assert.strictEqual(r.status, 200);
    assert.ok(r.data.html.includes('<base href="https://finiteestudio.com/"') && !r.data.html.includes('<script'));
    assert.strictEqual(commitsRef.commits.length, before);
  });

  console.log('Despublicar');
  await test('borrar quita página, tarjeta, sitemap, deja redirección y limpia "Sigue leyendo"', async () => {
    const slug = 'jardin-boda-pettite-casa-baga-rosarito';
    const r = await call('post-delete', { method: 'POST', body: { slug } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.data));
    assert.ok(!files.has(`blog/${slug}/index.html`));
    assert.ok(!files.get('blog/index.html').includes(`href="/blog/${slug}/"`));
    assert.ok(!files.get('sitemap.xml').includes(slug));
    assert.ok(files.get('_redirects').includes(`/blog/${slug}/ /blog/ 301`));
    assert.ok(r.data.postsActualizados >= 1);
    const other = files.get('blog/lugares-para-sesion-save-the-date-tijuana-rosarito/index.html');
    const rel = /<section class="section-suave related-posts">([\s\S]*?)<\/section>/.exec(other)[1];
    assert.ok(!rel.includes(slug));
  });

  console.log('Preguntas frecuentes y portafolio');
  await test('lee y guarda las preguntas frecuentes de la home', async () => {
    const g = await call('block-get', { query: { block: 'faqs' } });
    assert.strictEqual(g.data.items.length, 8);
    const items = [{ q: '¿Entregan rápido?', a: 'Sí, en 30 días.' }, ...g.data.items];
    const s = await call('block-save', { method: 'POST', body: { block: 'faqs', items } });
    assert.strictEqual(s.status, 200, JSON.stringify(s.data));
    const g2 = await call('block-get', { query: { block: 'faqs' } });
    assert.strictEqual(g2.data.items.length, 9);
    assert.strictEqual(g2.data.items[0].q, '¿Entregan rápido?');
  });
  await test('lee y guarda el portafolio', async () => {
    const g = await call('block-get', { query: { block: 'portafolio' } });
    assert.strictEqual(g.data.items.length, 12);
    const s = await call('block-save', { method: 'POST', body: { block: 'portafolio', items: g.data.items.slice(0, 9) } });
    assert.strictEqual(s.status, 200, JSON.stringify(s.data));
    assert.strictEqual((await call('block-get', { query: { block: 'portafolio' } })).data.items.length, 9);
  });
  await test('un bloque desconocido responde 404', async () => {
    assert.strictEqual((await call('block-get', { query: { block: 'otro' } })).status, 404);
  });

  console.log('Subida de fotos');
  await test('firma una subida para la carpeta del post y rechaza tipos desconocidos', async () => {
    const r = await call('upload-sign', { method: 'POST', body: { kind: 'blog', slug: 'mi-post' } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.data.fields.folder, 'finite-estudio-web/blog/mi-post');
    assert.ok(/^[0-9a-f]{40}$/.test(r.data.signature));
    assert.ok(!JSON.stringify(r.data).includes('secreto'));
    assert.strictEqual((await call('upload-sign', { method: 'POST', body: { kind: 'otra' } })).status, 400);
  });

  console.log('Páginas del sitio');
  await test('lista las páginas editables y deja fuera el blog y las carpetas internas', async () => {
    const r = await call('pages-list');
    assert.strictEqual(r.status, 200);
    const paths = r.data.pages.map((p) => p.path);
    assert.strictEqual(paths[0], 'index.html');
    assert.ok(paths.includes('infoprecios/index.html') && paths.includes('privacidad.html') && paths.includes('herramientas/pago.html'));
    assert.ok(!paths.some((p) => p.startsWith('blog/') || p.startsWith('netlify/') || p.startsWith('test/')));
  });
  await test('lee una página y rechaza rutas peligrosas o del blog', async () => {
    const r = await call('page-get', { query: { path: 'privacidad.html' } });
    assert.strictEqual(r.status, 200);
    assert.ok(r.data.html.includes('<body') && /^[0-9a-f]{40}$/.test(r.data.hash));
    for (const bad of ['../secret.html', 'blog/index.html', 'netlify/x.html', 'index.js', '/etc/passwd', 'noexiste.html']) {
      const x = await call('page-get', { query: { path: bad } });
      assert.ok(x.status === 400 || x.status === 404, `${bad} → ${x.status}`);
    }
  });
  await test('guarda un cambio de texto en un solo commit y devuelve el hash nuevo', async () => {
    const g = await call('page-get', { query: { path: 'gracias.html' } });
    const html = g.data.html.replace('Gracias', 'Gracias de verdad');
    const n = commitsRef.commits.length;
    const s = await call('page-save', { method: 'POST', body: { path: 'gracias.html', html, baseHash: g.data.hash } });
    assert.strictEqual(s.status, 200, JSON.stringify(s.data));
    assert.strictEqual(commitsRef.commits.length, n + 1);
    assert.strictEqual(commitsRef.commits[n].tree.length, 1);
    assert.ok(files.get('gracias.html').includes('Gracias de verdad'));
    assert.strictEqual(s.data.hash, require('crypto').createHash('sha1').update(html).digest('hex'));
  });
  await test('avisa con 409 si la página cambió desde que se abrió', async () => {
    const g = await call('page-get', { query: { path: '404.html' } });
    files.set('404.html', g.data.html.replace('<body', '<body data-x="1"'));
    const s = await call('page-save', { method: 'POST', body: { path: '404.html', html: g.data.html + ' ', baseHash: g.data.hash } });
    assert.strictEqual(s.status, 409);
  });
  await test('rechaza guardados que tocan scripts, agregan controladores o dejan la página rota', async () => {
    const g = await call('page-get', { query: { path: 'recursos/index.html' } });
    const save = (html) => call('page-save', { method: 'POST', body: { path: 'recursos/index.html', html, baseHash: g.data.hash } });
    const scriptEdit = g.data.html.replace(/<script>/, '<script>alert(1);');
    assert.ok(/<script>/.test(g.data.html) ? (await save(scriptEdit)).status === 400 : true);
    assert.strictEqual((await save(g.data.html.replace('<body', '<body onload="x()"'))).status, 400);
    assert.strictEqual((await save(g.data.html.replace('</body>', '<script>x()</script></body>'))).status, 400);
    assert.strictEqual((await save(g.data.html.replace('</body>', '<a href="javascript:x()">x</a></body>'))).status, 400);
    assert.strictEqual((await save(g.data.html.replace('</body>', '<iframe src="https://x.com"></iframe></body>'))).status, 400);
    assert.strictEqual((await save('<p>hola</p>')).status, 400);
    assert.strictEqual((await save('')).status, 400);
  });
  await test('sin contraseña no deja leer ni guardar páginas', async () => {
    assert.strictEqual((await call('page-get', { query: { path: 'index.html' }, password: 'x' })).status, 401);
    assert.strictEqual((await call('page-save', { method: 'POST', body: { path: 'index.html', html: 'x' }, password: 'x' })).status, 401);
  });
  await test('firma subidas para la carpeta del sitio', async () => {
    const r = await call('upload-sign', { method: 'POST', body: { kind: 'sitio' } });
    assert.strictEqual(r.data.fields.folder, 'finite-estudio-web/sitio');
  });

  console.log(failures ? `\n${failures} prueba(s) con falla` : '\nTodo en orden');
  process.exit(failures ? 1 : 0);
})();
