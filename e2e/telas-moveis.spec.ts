// Celular e tablet: nada pode sair da tela nem obrigar rolagem lateral, e nas
// larguras de celular/tablet em pé os botões têm tamanho de dedo.
import { expect, test, type Page } from '@playwright/test';
const TAMANHOS = [
  { nome: 'android-360', width: 360, height: 780, mobile: true },
  { nome: 'android-412', width: 412, height: 915, mobile: true },
  { nome: 'tablet-768', width: 768, height: 1024, mobile: true },
  { nome: 'tablet-1024', width: 1024, height: 768, mobile: true },
];
async function problemas(page: Page, onde: string) {
  return page.evaluate((onde) => {
    const vw = document.documentElement.clientWidth;
    const saida: string[] = [];
    if (document.documentElement.scrollWidth > vw + 1) saida.push(`${onde}: página com rolagem lateral (${document.documentElement.scrollWidth} > ${vw})`);
    const dentroDeRolagem = (el: Element) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const st = getComputedStyle(p);
        if (/(auto|scroll)/.test(st.overflowX) && p.scrollWidth > p.clientWidth) return true;
        if (p.tagName === 'TABLE' || p.tagName === 'svg' || p.tagName === 'CANVAS') return true;
      }
      return false;
    };
    const desc = (el: Element) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').filter(Boolean).slice(0, 2).join('.') : ''} "${(el.textContent ?? '').trim().slice(0, 30)}"`;
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const st = getComputedStyle(el);
      if (st.visibility === 'hidden' || st.display === 'none') continue;
      if ((r.right > vw + 1 || r.left < -1) && !dentroDeRolagem(el) && st.position !== 'fixed') saida.push(`${onde}: sai da tela ${Math.round(r.left)}–${Math.round(r.right)} ${desc(el)}`);
      // Texto cortado em botão/rótulo/opção sem rolagem.
      if (/^(BUTTON|LABEL|SPAN|B|STRONG|SMALL|SUMMARY|A|H2|H3|P)$/.test(el.tagName) && el.children.length === 0
        && el.scrollWidth > el.clientWidth + 2 && st.overflow !== 'visible' && !dentroDeRolagem(el)) saida.push(`${onde}: texto cortado ${desc(el)}`);
    }
    // Botões pequenos demais para o dedo (só os visíveis).
    for (const el of document.querySelectorAll('button, select, input[type=checkbox], summary')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.bottom < 0) continue;
      if (getComputedStyle(el).visibility === 'hidden') continue;
      if ((r.height < 28 || r.width < 28) && el.tagName !== 'INPUT') saida.push(`${onde}: alvo pequeno ${Math.round(r.width)}×${Math.round(r.height)} ${desc(el)}`);
    }
    return [...new Set(saida)];
  }, onde);
}
for (const t of TAMANHOS) {
  test(`telas ${t.nome}`, async ({ browser }) => {
    test.setTimeout(240_000);
    const ctx = await browser.newContext({ viewport: { width: t.width, height: t.height }, isMobile: t.mobile, hasTouch: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const tudo: string[] = [];
    await page.goto('/');
    tudo.push(...await problemas(page, 'início'));
    // Painel do DEF (Linhas, Colunas, Incremento, Seleções) e a tabela.
    await page.locator('#file-input').setInputFiles([
      'e2e/fixtures/painel-e2e.def', 'e2e/fixtures/uf-e2e.cnv', 'e2e/fixtures/sexo-e2e.cnv',
      'e2e/fixtures/raca-e2e.cnv', 'e2e/fixtures/painel-e2e.csv',
    ]);
    await expect(page.locator('#painel')).toBeVisible();
    await page.locator('#painel-executar').click();
    await expect(page.locator('#result-table tbody tr').first()).toBeVisible({ timeout: 60_000 });
    tudo.push(...await problemas(page, 'painel+tabela'));
    await page.evaluate(() => window.scrollTo(0, 0));
    tudo.push(...await problemas(page, 'painel no topo'));
    // Três anos juntos: mapa com faixa de período, cartão e gráfico de evolução.
    await page.goto('/');
    await page.locator('#file-input').setInputFiles([
      'e2e/fixtures/DENGBR23.dbf', 'e2e/fixtures/DENGBR24.dbf', 'e2e/fixtures/DENGBR25.dbf',
    ]);
    await expect(page.locator('#run-button')).toBeEnabled();
    await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
    await expect(page.locator('#result-table tbody tr').first()).toBeVisible({ timeout: 60_000 });
    tudo.push(...await problemas(page, 'três anos'));
    for (const aba of ['chart', 'map', 'statistics', 'compare', 'investigate', 'query', 'audit']) {
      const botao = page.locator(`[data-view="${aba}"]`);
      if (!(await botao.count())) continue;
      await botao.scrollIntoViewIfNeeded();
      await botao.click();
      await page.waitForTimeout(aba === 'map' ? 3500 : 800);
      tudo.push(...await problemas(page, `aba ${aba}`));
    }
    await page.locator('[data-view="map"]').click();
    await page.locator('#map-opcoes summary').click();
    await page.waitForTimeout(500);
    tudo.push(...await problemas(page, 'mapa com opções abertas'));
    await page.locator('#catalog-button').scrollIntoViewIfNeeded();
    await page.locator('#catalog-button').click();
    await page.waitForTimeout(1000);
    tudo.push(...await problemas(page, 'busca DATASUS'));
    // Alvo pequeno só vale onde o navegador emulado aplica as regras de toque.
    const graves = tudo.filter((p) => !p.includes('alvo pequeno') || t.width <= 820);
    expect(graves, graves.join('\n')).toEqual([]);
    await ctx.close();
  });
}
