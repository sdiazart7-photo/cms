// Prueba el editor del sitio en un navegador real contra el servidor de prueba.
// Uso: SITE_DIR=... PORT=8899 node test/devserver.js   y luego   node test/editor.js
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const assert=require('assert');
const BASE = process.env.BASE || 'http://localhost:8899';
const SITE = process.env.SITE_DIR || '/home/claude/finite-estudio-web';
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1500, height: 900 } });
  const errs=[]; page.on('pageerror', e=>errs.push('PAGEERR '+e.message));
  page.on('dialog', d=>d.accept());
  await page.goto(BASE);
  await page.fill('#pw','clave-de-prueba'); await page.click('#loginBtn'); await page.waitForSelector('.post');
  await page.click('.tab[data-view="sitelist"]'); await page.waitForSelector('[data-open]');
  await page.click('[data-open="index.html"]');
  await page.waitForFunction(()=>window.FEsite._E.loaded); await page.waitForTimeout(1500);
  const fr = page.frameLocator('#siteFrame');
  // 1) editar un titular escribiendo sobre la página
  const h2 = fr.locator('h2', {hasText:/Revive/});
  await h2.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' EDITADO');
  assert.ok((await h2.textContent()).includes('EDITADO'));
  console.log('1 ok escribir en la página; tab:', await page.textContent('#st-el .shead'));
  // 2) Secciones: el campo refleja el cambio
  await page.click('.stabs [data-st="sec"]');
  await page.fill('#secFilter','revive');
  await page.waitForTimeout(200);
  const txt = await page.locator('#st-sec .ce:visible').first().textContent();
  console.log('2 campo:', txt);
  assert.ok(txt.includes('EDITADO'));
  // 3) editar desde el formulario y verlo en la página
  await page.locator('#st-sec .ce:visible').first().click();
  await page.keyboard.press('End'); await page.keyboard.type(' DESDE FORM');
  await page.waitForTimeout(200);
  assert.ok((await h2.textContent()).includes('DESDE FORM'));
  console.log('3 ok formulario -> página');
  // 4) duplicar un testimonio
  await page.fill('#secFilter','');
  const before = await fr.locator('.test-card').count();
  await fr.locator('.test-card img').first().click();
  await page.waitForTimeout(300);
  console.log('   seleccionado:', await page.textContent('#st-el .shead'));
  await page.getByRole('button',{name:'↑ Contenedor'}).click();
  await page.waitForTimeout(300);
  console.log('   contenedor:', await page.textContent('#st-el .shead'));
  await page.getByRole('button',{name:'Duplicar'}).click();
  await page.waitForTimeout(1500);
  const after = await fr.locator('.test-card').count();
  console.log('4 test-card', before,'->',after);
  assert.strictEqual(after, before+1);
  // 5) cambiar alt de una foto
  await fr.locator('.sobre-photo img').click();
  await page.waitForTimeout(300);
  await page.fill('#st-el [data-k="alt"]','Retrato de Saúl editado');
  // 6) SEO
  await page.click('.stabs [data-st="pg"]');
  await page.locator('#st-pg input').first().fill('Título SEO de prueba para la home de Finite Estudio');
  // 7) deshacer / rehacer
  await page.click('#sUndo'); await page.waitForTimeout(800);
  console.log('7 undo ok; undo stack', await page.evaluate(()=>window.FEsite._E.undo.length));
  await page.click('#sRedo'); await page.waitForTimeout(800);
  // 8) guardar
  await page.click('#sSave');
  await page.waitForFunction(()=>!window.FEsite._E.dirty, null, {timeout:8000});
  console.log('8 mensaje:', (await page.textContent('#sMsg')).slice(0,100));
  const saved = await (await fetch(BASE + '/__file?path=index.html')).text();
  const raw = require('fs').readFileSync(SITE + '/index.html','utf8');
  const blocks = s=>(s.match(/<script\b[\s\S]*?<\/script\s*>|<noscript\b[\s\S]*?<\/noscript\s*>/gi)||[]);
  assert.deepStrictEqual(blocks(saved), blocks(raw));
  console.log('scripts intactos:', blocks(saved).length, 'bloques');
  assert.ok(saved.includes('EDITADO DESDE FORM') || saved.includes('EDITADO'));
  assert.ok(!saved.includes('data-fe'));
  assert.ok(saved.includes('Retrato de Saúl editado'));
  assert.ok(saved.includes('Título SEO de prueba'));
  assert.strictEqual((saved.match(/class="test-card/g)||[]).length, (raw.match(/class="test-card/g)||[]).length+1);
  console.log('guardado verificado; commits:', await (await fetch(BASE + '/__state')).text());
  await page.screenshot({path:'/tmp/s-after.png'});
  console.log('errores:', errs);
  await b.close();
})().catch(e=>{console.error('FALLA', e.message); process.exit(1)});
