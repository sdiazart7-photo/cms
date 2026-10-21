// Prueba el panel en un navegador real (Playwright) contra el servidor de prueba.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const assert = require('assert');
const BASE = process.env.BASE || 'http://localhost:8899';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts|cdn|favicon|ERR_|401/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  let n = 0;
  const step = async (name, fn) => { try { await fn(); console.log(`  ok   ${name}`); } catch (e) { n++; console.log(`  FALLA ${name}\n       ${e.message.split('\n')[0]}`); await page.screenshot({ path: `/tmp/fail-${n}.png` }).catch(() => {}); } };

  await page.goto(BASE);
  await step('muestra el acceso y rechaza una contraseña incorrecta', async () => {
    await page.waitForSelector('#loginForm');
    await page.fill('#pw', 'mala'); await page.click('#loginBtn');
    await page.waitForSelector('#loginErr:not([hidden])');
    assert.ok((await page.textContent('#loginErr')).includes('Contraseña incorrecta'));
  });
  await step('entra con la contraseña correcta y lista los 9 posts', async () => {
    await page.fill('#pw', 'clave-de-prueba'); await page.click('#loginBtn');
    await page.waitForSelector('.post');
    assert.strictEqual(await page.locator('.post').count(), 9);
    await page.screenshot({ path: '/tmp/shot-list.png' });
  });
  await step('abre un post existente y carga todos sus campos', async () => {
    await page.click('[data-edit="cuanto-cuesta-un-fotografo-de-bodas-en-tijuana"]');
    await page.waitForSelector('#v-editor:not([hidden])');
    assert.ok((await page.inputValue('#f-title')).startsWith('Cuánto cuesta'));
    assert.ok((await page.inputValue('#f-cardTitle')).length > 0);
    assert.ok(await page.locator('#faqs .qa').count() >= 3);
    assert.ok((await page.inputValue('#f-slug')).length > 0 && await page.isDisabled('#f-slug'));
    assert.ok((await page.innerHTML('#editor')).includes('<h2'));
    assert.ok(await page.locator('#seo li').count() === 9);
    await page.screenshot({ path: '/tmp/shot-editor.png', fullPage: true });
  });
  await step('la vista previa arma la página completa del post', async () => {
    await page.click('.etab[data-et="preview"]');
    const frame = page.frameLocator('#preview');
    await frame.locator('.article-header h1').waitFor({ timeout: 8000 });
    assert.ok((await frame.locator('.article-body h2').count()) > 3);
    assert.ok((await frame.locator('.related-posts .blog-card').count()) >= 3);
    await page.screenshot({ path: '/tmp/shot-preview.png' });
  });
  await step('guardar una edición hace un commit y vuelve al listado', async () => {
    await page.click('.etab[data-et="write"]');
    await page.fill('#f-og', 'Descripción para redes editada desde el panel.');
    await page.click('#btnSave');
    await page.waitForSelector('#flash .banner.ok', { timeout: 8000 });
    const st = await (await fetch(`${BASE}/__state`)).json();
    assert.ok(st.commits.some((m) => m.startsWith('Edita post:')));
  });
  await step('crea un post nuevo: slug automático, formato, foto y botón', async () => {
    await page.click('#newPost');
    await page.waitForSelector('#v-editor:not([hidden])');
    await page.fill('#f-title', 'Cómo elegir el vestido para una boda en Valle de Guadalupe');
    assert.strictEqual(await page.inputValue('#f-slug'), 'como-elegir-el-vestido-para-una-boda-en-valle-de-guadalupe');
    await page.fill('#f-category', 'Planeación');
    await page.fill('#f-meta', 'Guía práctica para elegir el vestido de novia pensando en el clima, el terreno y la luz del Valle de Guadalupe.');
    await page.fill('#cover input[data-k="src"]', 'https://res.cloudinary.com/drrhn6t1c/image/upload/v1/finite-estudio-web/portafolio/portafolio-25.jpg');
    await page.fill('#cover input[data-k="alt"]', 'Novia caminando entre viñedos');
    // escribir en el editor
    await page.click('#editor');
    await page.keyboard.press('Control+A'); await page.keyboard.press('Delete');
    await page.keyboard.type('Elegir el vestido para una boda en el Valle exige pensar en el viento, el polvo y el calor de la tarde. Aquí van las claves que conviene tener claras antes de la primera prueba.');
    await page.keyboard.press('Enter');
    await page.click('#toolbar [data-cmd="h2"]');
    await page.keyboard.type('Piensa en el clima');
    await page.keyboard.press('Enter');
    await page.click('#toolbar [data-cmd="p"]');
    await page.keyboard.type('Las telas ligeras se mueven bien y resisten el calor, aunque con viento pueden volverse un reto.');
    // botón CTA
    await page.click('#toolbar [data-cmd="cta"]');
    await page.fill('#ct-text', '¿Ya tienen fecha? Cuéntennos y les ayudamos a escoger.');
    await page.fill('#ct-label', 'Consultar disponibilidad');
    await page.click('#ct-ok');
    // foto con alt
    await page.click('#toolbar [data-cmd="image"]');
    await page.fill('#im-url', 'https://res.cloudinary.com/drrhn6t1c/image/upload/v1/finite-estudio-web/portafolio/portafolio-27.jpg');
    await page.fill('#im-alt', 'Novia con vestido ligero');
    await page.click('#im-ok');
    const html = await page.innerHTML('#editor');
    assert.ok(html.includes('<h2>Piensa en el clima</h2>'), html);
    assert.ok(html.includes('article-cta') && html.includes('<img'));
    // pregunta frecuente
    await page.click('#addFaq');
    await page.fill('#faqs [data-k="q"]', '¿Cuándo conviene la primera prueba?');
    await page.fill('#faqs [data-k="a"]', 'Entre seis y ocho meses antes de la boda.');
    assert.ok(await page.locator('#related input:checked').count() >= 1, 'relacionados sugeridos');
    await page.screenshot({ path: '/tmp/shot-new.png', fullPage: true });
  });
  await step('publica el post nuevo y aparece en el listado', async () => {
    await page.click('#btnSave');
    await page.waitForSelector('#flash .banner.ok', { timeout: 8000 });
    assert.ok(await page.locator('.post .t', { hasText: 'Cómo elegir el vestido' }).count() === 1);
    assert.strictEqual(await page.locator('.post').count(), 10);
  });
  await step('despublica el post nuevo', async () => {
    await page.click('[data-edit="como-elegir-el-vestido-para-una-boda-en-valle-de-guadalupe"]');
    await page.waitForSelector('#delPost:not([hidden])');
    await page.click('#delPost');
    await page.waitForSelector('#flash .banner.ok', { timeout: 8000 });
    assert.strictEqual(await page.locator('.post').count(), 9);
  });
  await step('preguntas frecuentes de la home: carga, agrega y guarda', async () => {
    await page.click('.tab[data-view="faqs"]');
    await page.waitForSelector('#homeFaqs .qa');
    assert.strictEqual(await page.locator('#homeFaqs .qa').count(), 8);
    await page.click('#addHomeFaq');
    await page.locator('#homeFaqs .qa').last().locator('[data-k="q"]').fill('¿Hacen sesión de compromiso?');
    await page.locator('#homeFaqs .qa').last().locator('[data-k="a"]').fill('Sí, se llama Save the Date.');
    await page.click('#saveFaqs');
    await page.waitForSelector('#flash .banner.ok', { timeout: 8000 });
  });
  await step('portafolio de la home: carga 12 fotos, quita una y guarda', async () => {
    await page.click('.tab[data-view="port"]');
    await page.waitForSelector('.pcard');
    assert.strictEqual(await page.locator('.pcard').count(), 12);
    await page.locator('.pcard [data-act="rm"]').first().click();
    assert.strictEqual(await page.locator('.pcard').count(), 11);
    await page.click('#savePort');
    await page.waitForSelector('#flash .banner.ok', { timeout: 8000 });
    await page.screenshot({ path: '/tmp/shot-port.png' });
  });
  await step('en pantalla de celular el panel no se desborda', async () => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.click('.tab[data-view="list"]');
    await page.waitForSelector('.post');
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(w <= 395, `ancho ${w}`);
    await page.screenshot({ path: '/tmp/shot-mobile.png' });
  });
  await step('sin errores de JavaScript en la consola', async () => { assert.deepStrictEqual(errors, [], JSON.stringify(errors)); });

  await browser.close();
  console.log(n ? `\n${n} prueba(s) con falla` : '\nTodo en orden');
  process.exit(n ? 1 : 0);
})();
