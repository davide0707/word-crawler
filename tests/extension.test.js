/*
 * Test dell'estensione vera in Chromium (serve un display: su Linux senza schermo usa "xvfb-run -a").
 * Costruisce dist/extension, la carica in un profilo temporaneo e prova:
 * pannello laterale -> lettura di una pagina, frequenze della lingua, penna sulla pagina, esportazione Word,
 * salvataggio in archivio, segni ritrovati riaprendo la pagina, lettore dei documenti.
 * Uso: node tests/extension.test.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const EXT = path.join(ROOT, 'dist', 'extension');
require(path.join(ROOT, 'core', 'zip.js'));
const { WCZip } = globalThis;

execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-extension.js')], { stdio: 'inherit' });

const ARTICLE = fs.readFileSync(path.join(__dirname, 'fixtures', 'guerra-fredda.txt'), 'utf8').split(/\n\s*\n/);
const HTML = '<!doctype html><html lang="it"><head><meta charset="utf-8"><title>La guerra fredda</title></head><body style="background:#fff;font:18px/1.6 Georgia;max-width:720px;margin:40px auto">' +
  '<nav>Home · Storia · Contatti</nav><article><h1>' + ARTICLE[0] + '</h1>' + ARTICLE.slice(1).map((p) => '<p>' + p + '</p>').join('') + '</article><footer>© prova</footer></body></html>';

let failures = 0;
async function check(name, fn) {
  const t0 = Date.now();
  try { await fn(); console.log('ok   ' + name + ' (' + (Date.now() - t0) + ' ms)'); }
  catch (e) {
    failures++;
    console.log('FAIL ' + name + '\n     ' + (e && e.message || e));
    // su GitHub Actions l'errore compare anche tra le annotazioni dell'esecuzione
    if (process.env.GITHUB_ACTIONS) console.log('::error title=' + name.replace(/[:,\n]/g, ' ') + '::' + String(e && e.stack || e).slice(0, 1500).replace(/%/g, '%25').replace(/\r?\n/g, '%0A'));
  }
}
process.on('unhandledRejection', (e) => {
  console.log('ERRORE ' + (e && e.stack || e));
  if (process.env.GITHUB_ACTIONS) console.log('::error title=errore non gestito::' + String(e && e.stack || e).slice(0, 1500).replace(/%/g, '%25').replace(/\r?\n/g, '%0A'));
  process.exit(1);
});

(async () => {
  const server = await new Promise((resolve) => {
    const s = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(HTML); }).listen(0, '127.0.0.1', () => resolve(s));
  });
  const url = 'http://127.0.0.1:' + server.address().port + '/storia/guerra-fredda?utm_source=prova';
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-ext-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: false, viewport: { width: 1280, height: 860 }, acceptDownloads: true,
    args: ['--disable-extensions-except=' + EXT, '--load-extension=' + EXT]
  });
  const errs = [];
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20000 });
  const id = sw.url().split('/')[2];
  const tabOf = (u) => sw.evaluate(async (u) => (await chrome.tabs.query({})).filter((t) => t.url === u).map((t) => t.id).pop(), u);

  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push('pagina: ' + e.message));
  await page.goto(url);
  const tabId = await tabOf(url);
  const panel = await ctx.newPage();
  panel.on('pageerror', (e) => errs.push('pannello: ' + e.message));
  await panel.setViewportSize({ width: 420, height: 860 });
  await panel.goto('chrome-extension://' + id + '/sidepanel.html?tab=' + tabId);

  await check('pannello: legge la pagina (italiano, con le frequenze delle parole)', async () => {
    await panel.click('#run');
    await panel.waitForSelector('#finish:not([disabled])', { timeout: 15000 });
    await panel.click('#finish');
    // attese con i selettori: le pagine dell'estensione non permettono di valutare codice dall'esterno
    await panel.waitForSelector('.wc-status:has-text("Lettura completata")', { timeout: 15000 });
    await panel.click('#spr-tab-stats');
    const stats = await panel.locator('.wc-stats').textContent();
    assert.ok(/Italiano/.test(stats), stats);
    assert.ok(/usata \(frequenze della lingua\)/.test(stats), 'frequenze non caricate: ' + stats);
    await panel.click('#spr-tab-cards');
    assert.ok(await panel.locator('.wc-card').count() >= 4);
  });

  await check('penna dal pannello: evidenzia sulla pagina web', async () => {
    await panel.click('#pen [data-tool="hl"]');
    await page.bringToFront();
    const box = await page.evaluate(() => {
      const tw = document.createTreeWalker(document.querySelector('article'), NodeFilter.SHOW_TEXT);
      let n;
      while ((n = tw.nextNode())) {
        const i = n.nodeValue.indexOf('cortina di ferro');
        if (i < 0) continue;
        n.parentElement.scrollIntoView({ block: 'center' });
        const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 16);
        const rs = r.getClientRects();
        return { x1: rs[0].left + 2, y: rs[0].top + rs[0].height / 2, x2: rs[rs.length - 1].right - 2 };
      }
      return null;
    });
    await page.mouse.move(box.x1, box.y);
    await page.mouse.down();
    await page.mouse.move(box.x2, box.y, { steps: 5 });
    await page.mouse.up();
    await panel.click('#spr-tab-marks');
    await panel.waitForSelector('.wc-user:has-text("I tuoi segni (1)")', { timeout: 5000 });
    assert.strictEqual(await panel.locator('.wc-umarks .wc-item-text span').first().textContent(), 'cortina di ferro');
    await panel.click('#pen [data-tool="hl"]');
  });

  await check('esportazione Word dal pannello (documento della pagina con i segni)', async () => {
    const [dl] = await Promise.all([panel.waitForEvent('download', { timeout: 15000 }), panel.selectOption('#spr-export', 'docx')]);
    const file = await dl.path();
    const z = WCZip.open(new Uint8Array(fs.readFileSync(file)));
    const xml = await z.text('word/document.xml');
    assert.ok(xml.includes('cortina') && xml.includes('w:highlight w:val="yellow"'));
    assert.ok(!xml.includes('Home · Storia · Contatti'), 'il menu della pagina non è testo da leggere');
  });

  await check('salva in archivio: indice della pagina per ritrovare i segni', async () => {
    await panel.click('text=Salva in archivio');
    await panel.waitForSelector('.wc-results-foot .wc-note:has-text("Salvato")', { timeout: 5000 });
    const st = await sw.evaluate(() => chrome.storage.local.get('wcIndex'));
    const keys = Object.keys(st.wcIndex || {});
    assert.strictEqual(keys.length, 1);
    assert.ok(/\/storia\/guerra-fredda$/.test(keys[0]), 'indirizzo senza parametri di tracciamento: ' + keys[0]);
  });

  await check('pagina salvata riaperta: segni ritrovati senza animazione', async () => {
    const again = await ctx.newPage();
    again.on('pageerror', (e) => errs.push('pagina 2: ' + e.message));
    await again.goto(url.replace('utm_source=prova', 'utm_source=altro'));
    await again.waitForSelector('[data-word-crawler][role="status"]', { timeout: 15000 });
    assert.match(await again.locator('[data-word-crawler][role="status"]').textContent(), /segni ritrovati/);
    assert.strictEqual(await again.locator('canvas[data-word-crawler]').count(), 1);
    await again.screenshot({ path: path.join(__dirname, 'screenshots', 'estensione-segni-ritrovati.png') });
    // il pannello legato a questa scheda vede i segni (anche quello fatto a mano)
    const tab2 = await sw.evaluate(async () => (await chrome.tabs.query({})).filter((t) => /utm_source=altro/.test(t.url)).map((t) => t.id).pop());
    const p2 = await ctx.newPage();
    await p2.goto('chrome-extension://' + id + '/sidepanel.html?tab=' + tab2);
    await p2.waitForSelector('#msg:has-text("segni di una lettura salvata")', { timeout: 5000 });
    await p2.click('#spr-tab-marks');
    assert.match(await p2.locator('.wc-user').textContent(), /I tuoi segni \(1\)/);
    await p2.close();
    await again.locator('[data-word-crawler][role="status"] button').click();
    assert.strictEqual(await again.locator('canvas[data-word-crawler]').count(), 0, 'Nascondi non ha tolto i segni');
    await again.close();
  });

  await check('impostazione spenta: nessun segno ritrovato', async () => {
    await sw.evaluate(async () => { const r = await chrome.storage.local.get('wcSettings'); const s = r.wcSettings || {}; s.restoreMarks = false; await chrome.storage.local.set({ wcSettings: s }); });
    const p3 = await ctx.newPage();
    await p3.goto(url);
    await p3.waitForTimeout(2500);
    assert.strictEqual(await p3.locator('canvas[data-word-crawler]').count(), 0);
    await p3.close();
  });

  await check('lettore dell’estensione: documento Word, lingua e schede', async () => {
    const rd = await ctx.newPage();
    rd.on('pageerror', (e) => errs.push('lettore: ' + e.message));
    await rd.goto('chrome-extension://' + id + '/reader.html');
    await rd.setInputFiles('#wc-file', path.join(__dirname, 'fixtures', 'sample.docx'));
    await rd.waitForSelector('.wc-status:has-text("parole")', { timeout: 15000 });
    await rd.click('text=Completa ora');
    await rd.waitForSelector('.wc-status:has-text("Lettura completata")', { timeout: 15000 });
    await rd.click('#wcr-tab-stats');
    assert.ok(/usata/.test(await rd.locator('.wc-stats').textContent()), 'frequenze non caricate nel lettore');
    await rd.close();
  });

  await ctx.close();
  server.close();
  fs.rmSync(profile, { recursive: true, force: true });
  if (errs.length) { failures++; console.log('FAIL errori:\n     ' + errs.slice(0, 8).join('\n     ')); }
  if (errs.length && process.env.GITHUB_ACTIONS) console.log('::error title=errori nella pagina::' + errs.slice(0, 8).join('%0A').replace(/\r?\n/g, '%0A'));
  console.log(failures ? '\n' + failures + ' test falliti' : '\nTutti i test dell’estensione superati');
  process.exit(failures ? 1 : 0);
})();
