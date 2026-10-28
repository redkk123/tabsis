import { expect, test, type Page } from '@playwright/test';

// Estes testes exercitam os controles campo a campo e as ferramentas da
// tabela, que no TabSis ficam em grupos recolhíveis ("Tabular por campos",
// "Quadro", "Operações", "Editar linhas e colunas"). O aplicativo lembra esses
// grupos abertos por navegador; aqui eles começam abertos, como para quem usa
// essas ferramentas sempre.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    for (const id of ['group-campos', 'tool-quadro', 'tool-operacoes', 'tool-editar']) {
      try { localStorage.setItem(`tabsis.aberto.${id}`, '1'); } catch { /* ignora */ }
    }
  });
});

/** Loads the CSV fixture and runs a UF tabulation, the shortest path to a result. */
async function tabulateFixture(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/microdados-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();
  await page.locator('#row-field').selectOption('UF');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#result-table tbody')).toBeVisible();
}


/**
 * Abre uma seção recolhível da barra lateral.
 *
 * As ações secundárias ficam agrupadas para a barra não ser oito botões de
 * peso igual. O teste faz o mesmo caminho de quem usa - clicar no cabeçalho -
 * em vez de forçar `open` por script, senão deixaria de exercitar a interface
 * que existe de verdade.
 */
async function openSidebarGroup(page: Page, group: 'export' | 'metadata' | 'saved'): Promise<void> {
  const details = page.locator(`#group-${group}`);
  if (await details.evaluate((element: HTMLDetailsElement) => element.open)) return;
  await details.locator('summary').click();
  await expect(details).toHaveAttribute('open', '');
}

/**
 * Abre "Opções avançadas".
 *
 * Limpeza assistida, regras cruzadas, combinações raras, transformação e
 * posições iniciais passaram a viver sob um grupo fechado por padrão: a
 * primeira tela não pode ser uma parede de controles desabilitados. O teste
 * abre pelo cabeçalho, o mesmo caminho de quem usa, em vez de forçar `open`
 * por script — senão deixaria de exercitar a interface que existe.
 */
async function openAdvanced(page: Page): Promise<void> {
  const details = page.locator('#group-advanced');
  if (await details.evaluate((element: HTMLDetailsElement) => element.open)) return;
  await details.locator('> summary').click();
  await expect(details).toHaveAttribute('open', '');
}

test('abre CSV local, passa pelo Worker e produz uma tabulação', async ({ page }) => {
  await tabulateFixture(page);
  const body = page.locator('#result-table tbody');
  await expect(body).toContainText('AC');
  await expect(body).toContainText('AM');
});

test('catálogo nacional envia BR explicitamente pela interface', async ({ page }) => {
  let catalogBody = '';
  await page.route('https://datasus.saude.gov.br/wp-content/ftp.php', async (route) => {
    catalogBody = route.request().postData() ?? '';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: '[]',
    });
  });

  await page.goto('/');
  await page.locator('#catalog-button').click();
  await page.locator('#catalog-system').selectOption('SINAN');
  await page.locator('#catalog-file-type').selectOption('DENG');
  await page.locator('#catalog-year').selectOption(['2024']);

  // SINAN/DENG is national, so the UF control is deliberately hidden: there is
  // nothing to choose. The point of this test is that "nothing to choose" still
  // has to travel as an explicit uf[]=BR, which is the bug the national-catalog
  // fix report was written about.
  await expect(page.locator('#catalog-uf-label')).toBeHidden();
  await expect(page.locator('#catalog-uf')).toHaveValue('BR');
  // Hiding the control on its own reads as a missing feature, so the panel
  // has to say why there is nothing to pick.
  await expect(page.locator('#catalog-national-note')).toBeVisible();
  await expect(page.locator('#catalog-national-note')).toContainText('Arquivo nacional');

  await page.locator('#catalog-form').evaluate((form: HTMLFormElement) => form.requestSubmit());

  await expect.poll(() => catalogBody).not.toBe('');
  const body = new URLSearchParams(catalogBody);
  expect(body.getAll('uf[]')).toEqual(['BR']);
  expect(body.getAll('fonte[]')).toEqual(['SINAN']);
  expect(body.getAll('tipo_arquivo[]')).toEqual(['DENG']);
  expect(body.getAll('ano[]')).toEqual(['2024']);
});

test('catálogo por UF mostra o seletor e manda a UF escolhida', async ({ page }) => {
  let catalogBody = '';
  await page.route('https://datasus.saude.gov.br/wp-content/ftp.php', async (route) => {
    catalogBody = route.request().postData() ?? '';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: '[]',
    });
  });

  await page.goto('/');
  await page.locator('#catalog-button').click();
  await page.locator('#catalog-system').selectOption('SIHSUS');
  await page.locator('#catalog-file-type').selectOption('RD');
  // The mirror image of the test above: a per-UF collection shows the control
  // and drops the national note.
  await expect(page.locator('#catalog-uf-label')).toBeVisible();
  await expect(page.locator('#catalog-national-note')).toBeHidden();
  await page.locator('#catalog-year').selectOption(['2024']);
  await page.locator('#catalog-month').selectOption(['01']);
  await page.locator('#catalog-uf').selectOption(['MA']);
  await page.locator('#catalog-form').evaluate((form: HTMLFormElement) => form.requestSubmit());

  await expect.poll(() => catalogBody).not.toBe('');
  const body = new URLSearchParams(catalogBody);
  expect(body.getAll('uf[]')).toEqual(['MA']);
  expect(body.getAll('fonte[]')).toEqual(['SIHSUS']);
});

test('o editor de gráficos redesenha o SVG sem refazer a tabulação', async ({ page }) => {
  await tabulateFixture(page);
  const tableText = await page.locator('#result-table tbody').innerText();
  await page.locator('[data-view="chart"]').click();

  const svg = page.locator('#chart svg');
  await expect(svg).toBeVisible();
  // AC has two records and AM one, so the ranked first bar is 2. What matters
  // is that a count prints as "2" and not "2,00": that padding is the
  // regression the 4.2 review found.
  await expect(svg.locator('.chart-value').first()).toHaveText('2');

  await page.locator('#chart-title').fill('Internações por UF');
  await expect(svg.locator('.chart-title')).toHaveText('Internações por UF');

  await page.locator('#chart-primary-color').evaluate((input: HTMLInputElement) => {
    input.value = '#8656a7';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(svg.locator('rect[fill="#8656a7"]').first()).toBeAttached();

  await page.locator('#chart-decimals').selectOption('2');
  await expect(svg.locator('.chart-value').first()).toHaveText('2,00');

  // Presentation only: going back to the table shows exactly what was there
  // before. innerText on the hidden panel would read as empty and prove
  // nothing, so the tab has to be switched back first.
  await page.locator('[data-view="table"]').click();
  expect(await page.locator('#result-table tbody').innerText()).toBe(tableText);
});

test('limites de eixo inválidos são recusados e o eixo volta aos dados', async ({ page }) => {
  await tabulateFixture(page);
  await page.locator('[data-view="chart"]').click();
  await page.locator('#chart-type').selectOption('vertical-bar');

  const ticks = page.locator('#chart svg .chart-tick');
  // SVG text nodes have no innerText - allInnerTexts would silently return
  // a row of undefined and the comparison below would pass on nothing.
  const automatic = await ticks.allTextContents();

  await page.locator('#chart-axis-y-min').fill('100');
  await page.locator('#chart-axis-y-max').fill('10');
  await expect(page.locator('#toast')).toContainText('maior que o mínimo');
  expect(await ticks.allTextContents()).toEqual(automatic);

  // The same pair the right way round is honoured.
  await page.locator('#chart-axis-y-min').fill('0');
  await page.locator('#chart-axis-y-max').fill('20');
  await page.locator('#chart-axis-ticks').selectOption('4');
  expect(await ticks.allTextContents()).toContain('20');
});

test('o zoom mexe no viewBox e o reenquadrar devolve o original', async ({ page }) => {
  await tabulateFixture(page);
  await page.locator('[data-view="chart"]').click();

  const svg = page.locator('#chart svg');
  await expect(svg).toHaveAttribute('viewBox', '0 0 1000 500');
  await expect(page.locator('#chart-zoom-reset')).toBeDisabled();

  await page.locator('#chart-zoom-in').click();
  await expect(svg).not.toHaveAttribute('viewBox', '0 0 1000 500');
  await expect(page.locator('#chart-zoom-reset')).toBeEnabled();

  await page.locator('#chart-zoom-reset').click();
  await expect(svg).toHaveAttribute('viewBox', '0 0 1000 500');
  await expect(page.locator('#chart-zoom-reset')).toBeDisabled();
});

test('zoomed in, the SVG export still carries the whole chart, and leaves the on-screen zoom untouched', async ({ page }) => {
  // The chart panel's own note promises this: "O zoom é só de visualização e
  // não entra na exportação nem na receita." A regression here means the
  // reader who zoomed in to read one bar gets a cropped file that only shows
  // that bar - the export is supposed to be independent of what the screen
  // happens to be showing.
  await tabulateFixture(page);
  await page.locator('[data-view="chart"]').click();

  const svg = page.locator('#chart svg');
  await page.locator('#chart-zoom-in').click();
  await page.locator('#chart-zoom-in').click();
  const zoomedViewBox = await svg.getAttribute('viewBox');
  expect(zoomedViewBox).not.toBe('0 0 1000 500');

  const download = page.waitForEvent('download');
  await page.locator('#chart-svg-button').click();
  const file = await (await download).path();
  const exported = await (await import('node:fs/promises')).readFile(file, 'utf8');
  expect(exported).toContain('viewBox="0 0 1000 500"');

  // Exporting must not have reset what the user was actually looking at.
  await expect(svg).toHaveAttribute('viewBox', zoomedViewBox!);
  await expect(page.locator('#chart-zoom-reset')).toBeEnabled();
});

test('zoomed in, printing the chart also uses the full frame and restores the zoom afterward', async ({ page }) => {
  await tabulateFixture(page);
  await page.locator('[data-view="chart"]').click();
  // A real print dialog would block the test; window.print is stubbed so
  // printChart runs to completion synchronously and its own 1s fallback timer
  // is what puts the viewBox back, exactly as it would for a browser that
  // never fires afterprint.
  await page.evaluate(() => { window.print = () => {}; });

  const svg = page.locator('#chart svg');
  await page.locator('#chart-zoom-in').click();
  await page.locator('#chart-zoom-in').click();
  const zoomedViewBox = await svg.getAttribute('viewBox');
  expect(zoomedViewBox).not.toBe('0 0 1000 500');

  await page.locator('#chart-print-button').click();
  await expect(svg).toHaveAttribute('viewBox', '0 0 1000 500');
  await expect(page.locator('body')).toHaveAttribute('data-print-target', 'chart');

  // The 1s fallback timer restores both the marker and the on-screen zoom.
  await expect(svg).toHaveAttribute('viewBox', zoomedViewBox!, { timeout: 2000 });
  await expect(page.locator('body')).not.toHaveAttribute('data-print-target', 'chart');
});

test('a receita leva o estilo do gráfico e o traz de volta', async ({ page }) => {
  await tabulateFixture(page);
  await page.locator('[data-view="chart"]').click();
  await page.locator('#chart-title').fill('Título salvo');
  await page.locator('#chart-decimals').selectOption('3');
  await page.locator('#chart-show-legend').selectOption('on');

  const download = page.waitForEvent('download');
  await openSidebarGroup(page, 'saved');
  await page.locator('#save-recipe-button').click();
  const file = await (await download).path();

  // Wipe the editor, then let the recipe put it back. Reloading the page
  // would also drop the dataset the recipe points at, which is a different
  // test than this one.
  await page.locator('#chart-title').fill('');
  await page.locator('#chart-decimals').selectOption('');
  await page.locator('#chart-show-legend').selectOption('off');

  await page.locator('#recipe-input').setInputFiles(file);
  await expect(page.locator('#chart-title')).toHaveValue('Título salvo');
  await expect(page.locator('#chart-decimals')).toHaveValue('3');
  await expect(page.locator('#chart-show-legend')).toHaveValue('on');
  await expect(page.locator('#chart svg .chart-title')).toHaveText('Título salvo');
});

test('fluxos origem-destino agregam pelos registros e prestam contas do descarte', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/fluxos-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();
  await page.locator('#row-field').selectOption('ORIGEM');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#result-table tbody')).toBeVisible();

  await page.locator('[data-view="map"]').click();
  await page.locator('#flow-panel summary').click();
  await page.locator('#flow-origin').selectOption('ORIGEM');
  await page.locator('#flow-destination').selectOption('DESTINO');
  await page.locator('#flow-weight').selectOption('PESO');
  await page.locator('#flow-run').click();

  const report = page.locator('#flow-report');
  await expect(report).toBeVisible();
  // Three pairs survive; the fifth record has no destination and is reported,
  // never quietly folded into a total.
  await expect(report.locator('.flow-summary')).toContainText('3 par(es)');
  await expect(report.locator('.flow-summary')).toContainText('4 de 5 registros');
  await expect(report.locator('.flow-diagnostics')).toContainText('destino ausente 1');
  // 12 + 8 on the heaviest edge, ranked first.
  const first = report.locator('.flow-table tbody tr').first();
  await expect(first).toContainText('3550308');
  await expect(first).toContainText('20');
});

test('a distância só aparece depois de escolher o modelo', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/fluxos-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();
  await page.locator('#row-field').selectOption('ORIGEM');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await page.locator('[data-view="map"]').click();
  await page.locator('#flow-panel summary').click();
  await page.locator('#flow-origin').selectOption('ORIGEM');
  await page.locator('#flow-destination').selectOption('DESTINO');
  await page.locator('#flow-run').click();
  await expect(page.locator('#flow-report')).toBeVisible();

  // Without a map there are no coordinates, so no distance column can exist -
  // and the default is "não calcular" anyway. Nothing invents a number here.
  const headers = await page.locator('#flow-report .flow-table th').allTextContents();
  expect(headers.some((text) => text.startsWith('Distância'))).toBe(false);
  await expect(page.locator('#flow-distance')).toHaveValue('');
});

test('o CSV do Microdatasus traz exatamente os registros aceitos pela tabulação', async ({ page }) => {
  await tabulateFixture(page);
  await openSidebarGroup(page, 'export');
  await expect(page.locator('#microdatasus-csv-button')).toBeEnabled();

  const download = page.waitForEvent('download');
  await openSidebarGroup(page, 'export');
  await page.locator('#microdatasus-csv-button').click();
  const file = await (await download).path();
  const csv = (await import('node:fs/promises')).readFile;
  const text = await csv(file, 'utf8');

  const lines = text.replace(/^﻿/, '').trim().split('\r\n');
  // Header plus one line per accepted record: the fixture has three rows and
  // no filter, so all three survive.
  expect(lines).toHaveLength(4);
  expect(lines[0]).toContain('UF');
  expect(lines[0]).toContain('SEXO');
  expect(lines[0]).toContain('VALOR');
  expect(lines.slice(1).join('\n')).toContain('AC');
  expect(lines.slice(1).join('\n')).toContain('AM');
});

test('um filtro na tabulação chega ao CSV do Microdatasus', async ({ page }) => {
  await tabulateFixture(page);
  const before = await page.locator('#result-table tbody').innerText();
  expect(before).toContain('AM');

  // The filter builder lives in a collapsed <details>; nothing inside it is
  // visible until the summary is opened.
  await page.locator('summary', { hasText: 'Filtros e seleções' }).click();
  await page.locator('#filter-field').selectOption('UF');
  await page.locator('#filter-value-search').fill('AC');
  await page.locator('#filter-values input[type="checkbox"]').first().check();
  await page.locator('#add-filter-button').click();
  await expect(page.locator('#result-table tbody')).not.toContainText('AM');

  const download = page.waitForEvent('download');
  await openSidebarGroup(page, 'export');
  await page.locator('#microdatasus-csv-button').click();
  const file = await (await download).path();
  const text = await (await import('node:fs/promises')).readFile(file, 'utf8');
  const lines = text.replace(/^﻿/, '').trim().split('\r\n');
  // Two AC records survive the filter; AM must not appear anywhere in the file.
  expect(lines).toHaveLength(3);
  expect(text).not.toContain('AM');
});

test('o histograma sobrepõe uma gaussiana ajustada, e sabe quando não pode ajustar uma', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/gaussian-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();
  await page.locator('#row-field').selectOption('VALOR');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#result-table tbody')).toBeVisible();

  await page.locator('[data-view="statistics"]').click();
  await page.locator('#statistics-operation').selectOption('histogram');
  await page.locator('#statistics-x').selectOption({ index: 0 });
  await expect(page.locator('#histogram-gaussian-label')).toBeVisible();

  // Five rows (frequencies 1,2,3,2,1) is a real, non-constant series: the fit
  // succeeds and draws one mark per histogram bar.
  await page.locator('#histogram-gaussian').check();
  const marks = page.locator('.histogram-gaussian-mark');
  await expect(marks.first()).toBeVisible();
  const markCount = await marks.count();
  expect(markCount).toBeGreaterThan(0);

  await page.locator('#histogram-gaussian').uncheck();
  await expect(marks).toHaveCount(0);

  // Re-tabulating by GRUPO leaves a single row (frequency 9): a fit needs at
  // least two distinct values, so the panel must say so instead of drawing
  // nothing silently.
  await page.locator('[data-view="table"]').click();
  await page.locator('#row-field').selectOption('GRUPO');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await page.locator('[data-view="statistics"]').click();
  await page.locator('#statistics-operation').selectOption('histogram');
  await page.locator('#histogram-gaussian').check();
  await expect(page.locator('#statistics-result')).toContainText('A gaussiana não pôde ser ajustada');
  await expect(marks).toHaveCount(0);
});

test('a comparação de tabelas alinha por chave, reporta o que não casou e não inventa zero na divisão', async ({ page }) => {
  // Table B first: tabulated separately, saved as .twtable, then reopened
  // from inside the "Comparar" panel while A stays whatever the app already
  // has loaded - the two tables never share a session.
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/compare-b-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();
  await page.locator('#row-field').selectOption('UF');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#result-table tbody')).toBeVisible();

  const saveDownload = page.waitForEvent('download');
  await openSidebarGroup(page, 'saved');
  await page.locator('#save-table-button').click();
  const tableBFile = await (await saveDownload).path();

  // Now load table A - AC=2, AM=1 - into the live session. B (AC=3, SP=1)
  // only ever exists as the file just saved.
  await page.locator('#file-input').setInputFiles('e2e/fixtures/compare-a-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();
  await page.locator('#row-field').selectOption('UF');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  // Wait on a row only A has. Both fixtures contain AC, so asserting on that
  // is satisfied by B's still-displayed table and lets the comparison run
  // with A === B - which is exactly how this test used to fail intermittently.
  const bodyA = page.locator('#result-table tbody');
  await expect(bodyA).toContainText('AM');
  await expect(bodyA).not.toContainText('SP');

  await page.locator('[data-view="compare"]').click();
  await expect(page.locator('#compare-run-button')).toBeDisabled();
  await page.locator('#compare-open-b-button').click();
  await page.locator('#compare-b-input').setInputFiles(tableBFile!);
  await expect(page.locator('#compare-run-button')).toBeEnabled();

  await page.locator('#compare-run-button').click();
  const result = page.locator('#compare-result');
  // AC exists in both (matched); AM only in A; SP only in B.
  await expect(result).toContainText('2');
  await expect(result.locator('.compare-row-matched')).toContainText('AC');
  await expect(result.locator('.compare-row-left-only')).toContainText('AM');
  await expect(result.locator('.compare-row-right-only')).toContainText('SP');
  // AC: A=2, B=3, difference=1 - never a fabricated zero for the unmatched rows.
  const acRow = result.locator('.compare-row-matched');
  await expect(acRow).toContainText('3,00');
  await expect(acRow).toContainText('1,00');
  const unmatchedCells = result.locator('.compare-row-left-only td, .compare-row-right-only td');
  await expect(unmatchedCells.filter({ hasText: '—' }).first()).toBeVisible();

  const download = page.waitForEvent('download');
  await page.locator('#compare-export-button').click();
  const exported = await (await download).path();
  const text = await (await import('node:fs/promises')).readFile(exported!, 'utf8');
  expect(text.replace(/^﻿/, '')).toContain('AC');
  expect(text).toContain('AM');
  expect(text).toContain('SP');
});

test('a auditoria estatística encontra um sinal real, nunca vaza o rótulo interno e "Focar campo" abre a ferramenta certa', async ({ page }) => {
  // 40 reference records (adult ages, MUNIC spread over 8 codes) plus 20
  // group records (IDADE=8, 18/20 concentrated in MUNIC=M007, mostly
  // EVOLUCAO=ignorado, one DIAS=90 outlier) - the same shape of anomaly the
  // module was built to generalize from, not hardcoded to any one disease.
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/investigate-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();

  await page.locator('[data-view="investigate"]').click();
  await expect(page.locator('#investigate-run-button')).toBeDisabled();
  await expect(page.locator('#investigate-gate-message')).toContainText('filtro ativo');

  // Define the group under investigation: the 20 IDADE=8 records. The
  // filter builder lives in a collapsed <details>; open it first.
  await page.locator('summary', { hasText: 'Filtros e seleções' }).click();
  await page.locator('#filter-field').selectOption('IDADE');
  await page.locator('#filter-kind').selectOption('numeric-range');
  await page.locator('#filter-maximum').fill('10');
  await page.locator('#add-filter-button').click();
  await expect(page.locator('#investigate-gate-message')).toContainText('campo numérico ou categórico');

  await page.locator('#investigate-numeric-fields').selectOption('DIAS');
  await page.locator('#investigate-categorical-fields').selectOption(['MUNIC', 'EVOLUCAO']);
  await page.locator('#investigate-geography-fields').selectOption('MUNIC');
  await expect(page.locator('#investigate-run-button')).toBeEnabled();
  await expect(page.locator('#investigate-gate-message')).toHaveText('');

  await page.locator('#investigate-run-button').click();
  const result = page.locator('#investigate-result');
  await expect(result).toContainText('Grupo: 20 registro(s)');
  await expect(result).toContainText('Referência: 40 registro(s)');
  await expect(result.getByText('força da evidência, não probabilidade de erro').first()).toBeVisible();

  // The concentration signal must show the real category name (M007) -
  // never a raw internal sentinel, which is exactly what once leaked here
  // before the cardinality-overflow bucket's key was fixed and translated.
  const munCard = page.locator('.investigate-signal', { hasText: 'Concentração incomum de MUNIC' });
  await expect(munCard).toContainText('M007');
  await expect(munCard).not.toContainText('outras_categorias');

  // The seeded DIAS=90 outlier must also surface as its own signal.
  await expect(page.locator('.investigate-signal', { hasText: 'Valores extremos em DIAS' })).toBeVisible();

  await munCard.getByRole('button', { name: 'Focar campo' }).click();
  await expect(page.locator('#filter-field')).toHaveValue('MUNIC');

  // "Marcar como esperado" is session-local: it hides the card, offers a
  // restore, and a fresh run does not resurrect it on its own.
  await page.locator('[data-view="investigate"]').click();
  await munCard.getByRole('button', { name: 'Marcar como esperado' }).click();
  await expect(page.locator('.investigate-signal', { hasText: 'Concentração incomum de MUNIC' })).toHaveCount(0);
  const restoreButton = result.getByRole('button', { name: /Restaurar/ });
  await expect(restoreButton).toBeVisible();

  await page.locator('#investigate-run-button').click();
  await expect(page.locator('.investigate-signal', { hasText: 'Concentração incomum de MUNIC' })).toHaveCount(0);

  await restoreButton.click();
  await expect(page.locator('.investigate-signal', { hasText: 'Concentração incomum de MUNIC' })).toBeVisible();
});

test('the transform pipeline recodes, marks missing, filters, dedupes and drops columns - reproducibly, without touching the original file', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/investigate-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();
  await openAdvanced(page);
  await page.locator('summary', { hasText: 'Transformar dados' }).click();

  // Step 1: recode SEXO M/F into full words.
  await page.locator('#transform-step-kind').selectOption('recode');
  await page.locator('#transform-recode-field').selectOption('SEXO');
  const recodeInputs = page.locator('#transform-recode-rows input');
  await recodeInputs.nth(0).fill('M');
  await recodeInputs.nth(1).fill('Masculino');
  await page.locator('#transform-recode-add-row').click();
  await recodeInputs.nth(2).fill('F');
  await recodeInputs.nth(3).fill('Feminino');
  await page.locator('#transform-add-step').click();

  // Step 2: EVOLUCAO="ignorado" becomes analytically missing.
  await page.locator('#transform-step-kind').selectOption('missing-value-policy');
  await page.locator('#transform-missing-field').selectOption('EVOLUCAO');
  await page.locator('#transform-missing-values').fill('ignorado');
  await page.locator('#transform-add-step').click();

  // Step 3: keep only IDADE >= 10 - drops the 20 seeded group records.
  await page.locator('#transform-step-kind').selectOption('filter-rows');
  await page.locator('#transform-filter-field').selectOption('IDADE');
  await page.locator('#transform-filter-kind').selectOption('numeric-range');
  await page.locator('#transform-filter-minimum').fill('10');
  await page.locator('#transform-add-step').click();

  // Step 4: dedupe by the now-recoded SEXO + EVOLUCAO.
  await page.locator('#transform-step-kind').selectOption('dedupe');
  await page.locator('#transform-dedupe-fields').selectOption(['SEXO', 'EVOLUCAO']);
  await page.locator('#transform-add-step').click();

  // Step 5: drop every column except MUNIC/IDADE/SEXO.
  await page.locator('#transform-step-kind').selectOption('select-columns');
  await page.locator('#transform-select-fields').selectOption(['MUNIC', 'IDADE', 'SEXO']);
  await page.locator('#transform-add-step').click();

  await expect(page.locator('#transform-count')).toContainText('5 etapa');

  await page.locator('#transform-apply-button').click();
  const result = page.locator('#transform-result');
  await expect(result).toContainText('60 → 40');
  await expect(result).toContainText('registrosRemovidos: 20');
  await expect(result).toContainText('40 → 3');
  await expect(result).toContainText('3 → 3');

  // The schema everywhere else in the app reflects the transformed dataset.
  const rowFieldOptions = await page.locator('#row-field option').allTextContents();
  expect(rowFieldOptions.some((text) => text.includes('EVOLUCAO'))).toBe(false);
  expect(rowFieldOptions.some((text) => text.includes('UF'))).toBe(false);

  await page.locator('#row-field').selectOption('SEXO');
  await page.locator('#analysis-form').evaluate((form) => form.requestSubmit());
  await expect(page.locator('#result-table tbody')).toContainText('Feminino');
  await expect(page.locator('#result-table tbody')).toContainText('Masculino');
  await expect(page.locator('#result-table')).toContainText('3');

  // Re-running "Aplicar" is idempotent: it starts from the untransformed
  // original every time, never compounding onto its own previous output.
  await page.locator('#transform-apply-button').click();
  await expect(result).toContainText('40 → 3');
  const secondRunText = await result.textContent();
  await page.locator('#transform-apply-button').click();
  await expect(result).toContainText('40 → 3');
  await expect(result).toHaveText(secondRunText ?? '');

  // The original file itself was never touched: restoring brings every
  // column and the raw M/F values straight back.
  await page.locator('#transform-reset-button').click();
  // resetTransformPipelineData() is async - wait for the row-field dropdown
  // to actually reflect the restored schema instead of racing it.
  await expect(page.locator('#row-field')).toContainText('EVOLUCAO');
  await page.locator('#row-field').selectOption('SEXO');
  await page.locator('#analysis-form').evaluate((form) => form.requestSubmit());
  const restoredBody = page.locator('#result-table tbody');
  await expect(restoredBody).toContainText('F');
  await expect(restoredBody).not.toContainText('Feminino');
  await expect(page.locator('#result-table')).toContainText('60');
});

test('recipes save the applied pipeline, failures stop replay, and an empty transform clears the old table', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/investigate-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();
  await openAdvanced(page);
  await page.locator('summary', { hasText: 'Transformar dados' }).click();

  await page.locator('#transform-step-kind').selectOption('filter-rows');
  await page.locator('#transform-filter-field').selectOption('IDADE');
  await page.locator('#transform-filter-kind').selectOption('numeric-range');
  await page.locator('#transform-filter-minimum').fill('10');
  await page.locator('#transform-add-step').click();
  await page.locator('#transform-apply-button').click();
  await expect(page.locator('#transform-result')).toContainText('60 → 40');
  await expect(page.locator('#result-table')).toContainText('40');

  // Add a second draft step but do not apply it. The recipe must describe the
  // dataset that produced the visible table (one applied step), not this draft.
  await page.locator('#transform-filter-minimum').fill('1000');
  await page.locator('#transform-add-step').click();
  await expect(page.locator('#transform-count')).toContainText('2 etapa');
  const download = page.waitForEvent('download');
  await openSidebarGroup(page, 'saved');
  await page.locator('#save-recipe-button').click();
  const recipeFile = await (await download).path();
  if (!recipeFile) throw new Error('the browser did not expose the saved recipe path');

  // Applying both steps removes every record. The previous 40-row table must
  // disappear and, critically, may no longer be exported or saved as current.
  await page.locator('#transform-apply-button').click();
  await expect(page.locator('#transform-result')).toContainText('40 → 0');
  await expect(page.locator('#result-title')).toContainText('não contém registros');
  await expect(page.locator('#table-wrap')).toBeHidden();
  await expect(page.locator('#save-recipe-button')).toBeDisabled();

  await page.locator('#transform-reset-button').click();
  await expect(page.locator('#result-table tbody')).toBeVisible();
  await page.locator('#recipe-input').setInputFiles(recipeFile);
  await expect(page.locator('#transform-count')).toContainText('1 etapa');
  await expect(page.locator('#result-table')).toContainText('40');

  // A runtime-invalid pipeline must stop recipe replay instead of being caught
  // and followed by a misleading "reproduced" success over the raw dataset.
  await page.locator('#recipe-input').setInputFiles('e2e/fixtures/invalid-transform-e2e.twrecipe');
  await expect(page.locator('#toast')).toContainText('não puderam ser aplicadas');
  await expect(page.locator('#toast')).not.toContainText('reproduzida');
});

test('a DEF G directive weights frequency in the UI and the saved measure replays without the DEF', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles([
    'e2e/fixtures/grouped-frequency-e2e.def',
    'e2e/fixtures/grouped-frequency-e2e.csv',
  ]);
  const body = page.locator('#result-table tbody');
  await expect(body).toBeVisible();
  await expect(body.locator('tr', { hasText: 'AC' })).toContainText('7');
  await expect(body.locator('tr', { hasText: 'DF' })).toContainText('10');

  await page.reload();
  await page.locator('#file-input').setInputFiles('e2e/fixtures/grouped-frequency-e2e.csv');
  await expect(page.locator('#result-table tbody')).toBeVisible();
  await page.locator('#recipe-input').setInputFiles('e2e/fixtures/grouped-frequency-e2e.twrecipe');
  await expect(page.locator('#result-table tbody').locator('tr', { hasText: 'AC' })).toContainText('7');
});

test('Excel-style formulas compute a derived column, and the advertised function list comes from the engine itself', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/investigate-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();
  await page.locator('#row-field').selectOption('MUNIC');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#result-table tbody')).toContainText('M007');

  // The function reference only appears for the formula operation, and its
  // contents are rendered from the parser's own catalog - never a hand-kept
  // copy that could advertise something the engine would reject.
  await expect(page.locator('#formula-help')).toBeHidden();
  await page.locator('#table-operation-kind').selectOption('expression');
  await expect(page.locator('#formula-help')).toBeVisible();
  await expect(page.locator('#formula-function-count')).toContainText('funções');
  await expect(page.locator('.formula-function-group')).not.toHaveCount(0);

  // A pt-BR Excel user's reflexes: leading "=", Portuguese names, semicolon
  // separators, a comparison, and nesting - all in one formula.
  await page.locator('#table-operation-expression')
    .fill('=SE([Frequência] > 5; ARRED(TAXA([Frequência]; 1000; 1000); 1); 0)');
  await page.locator('#table-operation-label').fill('Taxa condicional');
  await page.locator('#table-operation-apply').click();

  const table = page.locator('#result-table');
  await expect(table).toContainText('Taxa condicional');
  // M007 has 23 records (> 5, so it keeps its rate); M003 has 5 (not > 5, so 0).
  const m007 = page.locator('#result-table tbody tr', { hasText: 'M007' });
  await expect(m007).toContainText('23');
  const m003 = page.locator('#result-table tbody tr', { hasText: 'M003' });
  await expect(m003).toContainText('0');

  // LAG reads the row above; without IFERROR the first row would have no
  // predecessor to read, which is an error rather than an invented zero.
  await page.locator('#table-operation-reset').click();
  await page.locator('#table-operation-kind').selectOption('expression');
  await page.locator('#table-operation-expression').fill('LAG([Frequência])');
  await page.locator('#table-operation-label').fill('Sem IFERROR');
  await page.locator('#table-operation-apply').click();
  await expect(page.locator('#toast')).toContainText('LAG');
  await expect(table).not.toContainText('Sem IFERROR');

  // Named the same way an Excel user would, the escape hatch works.
  await page.locator('#table-operation-expression').fill('IFERROR(LAG([Frequência]); 0)');
  await page.locator('#table-operation-label').fill('Anterior');
  await page.locator('#table-operation-apply').click();
  await expect(table).toContainText('Anterior');

  // A name outside the registry is refused by name - nothing is executed.
  await page.locator('#table-operation-expression').fill('eval(1)');
  await page.locator('#table-operation-label').fill('Proibida');
  await page.locator('#table-operation-apply').click();
  await expect(page.locator('#toast')).toContainText('unknown function eval');
  await expect(table).not.toContainText('Proibida');
});

test('como no TabWin: clique no título ordena, Seqüência segue a ordem, "…*100,00" fixa casas e o Tipo de total muda o total', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/investigate-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();
  await page.locator('#row-field').selectOption('MUNIC');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#result-table tbody')).toContainText('M007');

  const numero = (texto: string): number => Number(texto.replace(/\./g, '').replace(',', '.'));
  const coluna = async (indice: number): Promise<number[]> => (await page.locator(`#result-table tbody tr td:nth-of-type(${indice})`).allTextContents())
    .filter((texto) => texto.trim()).map(numero);
  const titulo = page.locator('#result-table thead th', { hasText: 'Frequência' });

  // Primeiro clique: do maior para o menor; segundo: do menor para o maior.
  await titulo.click();
  await expect(titulo).toHaveAttribute('aria-sort', 'descending');
  const desc = await coluna(1);
  expect(desc).toEqual([...desc].sort((a, b) => b - a));
  await titulo.click();
  await expect(titulo).toHaveAttribute('aria-sort', 'ascending');
  const asc = await coluna(1);
  expect(asc).toEqual([...asc].sort((a, b) => a - b));

  // Seqüência depois de ordenar: a primeira linha mostrada é a 1.
  await titulo.click();
  await page.locator('#table-operation-kind').selectOption('sequence');
  await page.locator('#table-operation-number').fill('1');
  await page.locator('#table-operation-apply').click();
  await expect(page.locator('#result-table thead')).toContainText('Seqüência');
  expect((await coluna(2))[0]).toBe(1);

  // "Título=conta" com ",00" no fim: duas casas decimais nessa coluna.
  await page.locator('#table-operation-kind').selectOption('expression');
  await page.locator('#table-operation-expression').fill('Percentagem=c1/c1*100,00');
  await page.locator('#table-operation-apply').click();
  await expect(page.locator('#result-table thead')).toContainText('Percentagem');
  await expect(page.locator('#result-table tbody tr').first().locator('td').nth(2)).toHaveText('100,00');

  // Tipo de total → Média; Recalcular total volta à soma.
  const total = page.locator('#result-table tfoot tr').first().locator('td').first();
  const soma = numero((await total.textContent()) ?? '');
  await page.locator('#table-edit-column').selectOption({ label: 'Frequência' });
  await page.locator('#table-column-total').selectOption('mean');
  await page.locator('#table-column-total-apply').click();
  await expect(total).not.toHaveText(String(soma));
  expect(numero((await total.textContent()) ?? '')).toBeCloseTo(soma / desc.length, 0);
  await page.locator('#table-column-recalculate').click();
  expect(numero((await total.textContent()) ?? '')).toBe(soma);
});

test('do Help do TabWin: Gerar DEF, Gerar CNV do campo, Numerar, igual freqüência e coluna estimada', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/investigate-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();
  await page.locator('#row-field').selectOption('MUNIC');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#result-table tbody')).toContainText('M007');

  // Gerar DEF: todos os campos marcados; UF vira X com UF.CNV.
  const metadados = page.locator('#group-metadata');
  if (!(await metadados.evaluate((element: HTMLDetailsElement) => element.open))) await metadados.locator('summary').click();
  await page.locator('#def-generate-button').click();
  const previa = page.locator('#def-generate-preview');
  await expect(previa).toContainText('XUF');
  await expect(previa).toContainText(',UF,1,UF.CNV');
  await page.locator('#def-generate-invert').click();
  await expect(previa).toContainText('marque ao menos um campo');
  await page.locator('#def-generate-fields input[value="SEXO"]').check();
  await expect(previa).toContainText(',SEXO,1,SEXO.CNV');
  await page.locator('#def-generate-use').click();
  await expect(page.locator('#toast')).toContainText('opções no painel');

  // Gerar CNV do campo SEXO: uma categoria por código (F, M).
  await page.locator('#cnv-editor-button').click();
  await page.locator('#cnv-editor-preview-field').selectOption('SEXO');
  await page.locator('#cnv-editor-generate').click();
  await expect(page.locator('#cnv-editor-filename')).toHaveValue('SEXO.cnv');
  await expect(page.locator('#cnv-editor-rows tr')).toHaveCount(2);
  await page.locator('#cnv-editor-add-category').click();
  await page.locator('#cnv-editor-rows tr').last().locator('input').first().fill('9');
  await page.locator('#cnv-editor-renumber').click();
  await expect(page.locator('#cnv-editor-rows tr').last().locator('input').first()).toHaveValue('3');
  await page.locator('#cnv-editor-close').click();

  // Coluna de estimados da regressão e histograma de igual freqüência.
  await page.locator('#table-operation-kind').selectOption('sequence');
  await page.locator('#table-operation-number').fill('1');
  await page.locator('#table-operation-apply').click();
  await page.locator('[data-view="statistics"]').click();
  await page.locator('#statistics-operation').selectOption('regression');
  await page.locator('#statistics-x').selectOption({ index: 0 });
  await page.locator('#statistics-y').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Inserir coluna com os valores estimados' }).click();
  await page.locator('[data-view="table"]').click();
  await expect(page.locator('#result-table thead')).toContainText('Estimado Seqüência');
  await page.locator('[data-view="statistics"]').click();
  await page.locator('#statistics-operation').selectOption('histogram');
  await page.locator('#histogram-mode').selectOption('frequency');
  await expect(page.locator('.histogram-row').first()).toBeVisible();
});

test('colar tabela, nota técnica com o botão direito e .TAB que o TabWin abre', async ({ page }) => {
  await page.goto('/');
  await openSidebarGroup(page, 'saved');
  await page.locator('#paste-table-button').click();
  await page.locator('#paste-table-text').fill('Sexo\tFreqüência\tValor Total\nMasculino\t1.761\t2.077.684,41\nFeminino\t2.554\t2.230.388,35\nTotal\t4.315\t4.308.072,76');
  await page.locator('#paste-table-open').click();
  const tabela = page.locator('#result-table');
  await expect(tabela.locator('tbody')).toContainText('Masculino');
  await expect(tabela.locator('tfoot')).toContainText('4.315');

  // Nota técnica na célula Feminino × Valor Total.
  const celula = tabela.locator('tbody tr', { hasText: 'Feminino' }).locator('td').nth(1);
  await celula.click({ button: 'right' });
  await expect(page.locator('#note-dialog')).toBeVisible();
  await page.locator('#note-text').fill('Valores de janeiro, sem as AIH rejeitadas');
  await page.locator('#note-form button[type=submit]').click();
  await expect(celula).toHaveClass(/has-note/);
  await expect(tabela.locator('tfoot')).toContainText('Nota técnica — Feminino × Valor Total: Valores de janeiro');

  // .TAB do TabWin: Windows-1252, ";" e vírgula decimal, linha Total no fim.
  const download = page.waitForEvent('download');
  await page.locator('#export-tab-button').click();
  const arquivo = await download;
  expect(arquivo.suggestedFilename()).toMatch(/\.tab$/);
  const bytes = await (await import('node:fs/promises')).readFile(await arquivo.path());
  const texto = new TextDecoder('windows-1252').decode(bytes);
  expect(texto.startsWith('NEW\r\n')).toBe(true);
  expect(texto).toContain('"Feminino";2554;2230388,35\r\n');
  expect(texto).toContain('"Total";4315;4308072,76\r\n');
});

test('the transform pipeline computes a new field with the same formula language, over records', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/investigate-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();
  await openAdvanced(page);
  await page.locator('summary', { hasText: 'Transformar dados' }).click();

  // mutate(): DIAS and IDADE are real fields of the record, not columns of a
  // tabulation - the same engine, addressed against the dataset's own schema.
  await page.locator('#transform-step-kind').selectOption('derive-column');
  await page.locator('#transform-derive-field').fill('DIAS_POR_ANO');
  await page.locator('#transform-derive-formula').fill('=ARRED(RAZÃO([DIAS]; [IDADE]); 3)');
  await page.locator('#transform-add-step').click();
  await expect(page.locator('#transform-count')).toContainText('1 etapa');

  await page.locator('#transform-apply-button').click();
  await expect(page.locator('#transform-result')).toContainText('registrosCalculados: 60');

  // The derived field is a real field of the transformed dataset now, so it
  // can be tabulated like any other.
  await expect(page.locator('#row-field')).toContainText('DIAS_POR_ANO');
  await page.locator('#row-field').selectOption('DIAS_POR_ANO');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#result-table tbody')).toBeVisible();

  // A formula whose name is outside the registry is refused here too, and
  // the dataset is left exactly as it was.
  await page.locator('#transform-step-kind').selectOption('derive-column');
  await page.locator('#transform-derive-field').fill('PROIBIDA');
  await page.locator('#transform-derive-formula').fill('eval(1)');
  await page.locator('#transform-add-step').click();
  await page.locator('#transform-apply-button').click();
  await expect(page.locator('#transform-result')).toContainText('unknown function eval');
  await expect(page.locator('#row-field')).not.toContainText('PROIBIDA');
});

test('the cleaning steps standardize an IBGE code and derive the epidemiological week', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/limpeza-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();
  await openAdvanced(page);
  await page.locator('summary', { hasText: 'Transformar dados' }).click();

  // The flagship example: 5300108 (7 digits, with check digit) and 11001
  // (5 digits, leading zero eaten) both have to land on the 6-digit form
  // every DATASUS municipality table keys on.
  await page.locator('#transform-step-kind').selectOption('text-normalize');
  await page.locator('#transform-text-field').selectOption('MUN');
  await page.locator('#transform-text-operations').selectOption(['ibge-municipality']);
  await page.locator('#transform-add-step').click();

  await page.locator('#transform-step-kind').selectOption('date-part');
  await page.locator('#transform-datepart-field').selectOption('DT');
  await page.locator('#transform-datepart-part').selectOption('epidemiological-week');
  await page.locator('#transform-datepart-target').fill('SE');
  await page.locator('#transform-add-step').click();

  await page.locator('#transform-step-kind').selectOption('date-part');
  await page.locator('#transform-datepart-part').selectOption('epidemiological-year');
  await page.locator('#transform-datepart-target').fill('ANO_SE');
  await page.locator('#transform-add-step').click();

  await page.locator('#transform-apply-button').click();
  const report = page.locator('#transform-result');
  await expect(report).toContainText('naoReconhecidos: 0');
  await expect(report).toContainText('semDataValida: 0');

  await page.locator('#row-field').selectOption('MUN');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  const body = page.locator('#result-table tbody');
  // 5300108 lost its check digit and joined the existing 530010 (so: 2),
  // and 11001 got its leading zero back.
  await expect(body).toContainText('011001');
  await expect(body.locator('tr', { hasText: '530010' })).toContainText('2');
  await expect(body).not.toContainText('5300108');

  // 31 Dec 2023 belongs to epidemiological week 1 of 2024, which is exactly
  // why the epidemiological year is its own column.
  await page.locator('#row-field').selectOption('ANO_SE');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(body).toContainText('2024');
  await expect(body).not.toContainText('2023');

  await page.locator('#row-field').selectOption('SE');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  // 31/12/2023 -> 1, 07/01 -> 2, 15/01 -> 3, 01/07 -> 27: four distinct
  // weeks, one record each. The row label is each row's first cell.
  await expect(body.locator('tr')).toHaveCount(4);
  expect(await body.locator('tr > :first-child').allTextContents()).toEqual(['1', '2', '3', '27']);
});

test('group-summarize collapses the dataset to one row per key, with N and a sum', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/grupo-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();
  await openAdvanced(page);
  await page.locator('summary', { hasText: 'Transformar dados' }).click();

  // Keep only confirmed first, then N and total VALOR by UF - the shape of
  // the region-by-year summary the spec's own example ends on.
  await page.locator('#transform-step-kind').selectOption('filter-rows');
  await page.locator('#transform-filter-field').selectOption('CLASSI');
  await page.locator('#transform-filter-categories').fill('1');
  await page.locator('#transform-add-step').click();

  await page.locator('#transform-step-kind').selectOption('group-summarize');
  await page.locator('#transform-group-fields').selectOption(['UF']);
  // First aggregation row defaults to count/N; add a sum of VALOR.
  await page.locator('#transform-group-add-agg').click();
  const secondRow = page.locator('#transform-group-aggregations > div').nth(1);
  await secondRow.locator('select').first().selectOption('sum');
  await secondRow.locator('select').nth(1).selectOption('VALOR');
  await secondRow.locator('input').fill('TOTAL');
  await page.locator('#transform-add-step').click();

  await page.locator('#transform-apply-button').click();
  await expect(page.locator('#transform-result')).toContainText('gruposFormados: 2');

  // The dataset now has exactly the key and summary fields, and one row per UF.
  await expect(page.locator('#row-field')).toContainText('TOTAL');
  await page.locator('#row-field').selectOption('UF');
  // Sum the derived TOTAL column so the row values are checkable.
  await page.locator('#measure-kind').selectOption('sum');
  await page.locator('#measure-field').selectOption('TOTAL');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());

  const body = page.locator('#result-table tbody');
  await expect(body.locator('tr')).toHaveCount(2);
  // SP kept records 2 and 3 (20 + 30 = 50); the 40 was CLASSI=2, filtered out.
  await expect(body.locator('tr', { hasText: 'SP' })).toContainText('50');
  await expect(body.locator('tr', { hasText: 'DF' })).toContainText('10');
});

test('"Ver código equivalente" renders the pipeline as dplyr and pandas, without running anything', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/grupo-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();
  await openAdvanced(page);
  await page.locator('summary', { hasText: 'Transformar dados' }).click();

  // The button only means something once there is a pipeline to render.
  await expect(page.locator('#transform-code-toggle')).toBeDisabled();

  await page.locator('#transform-step-kind').selectOption('filter-rows');
  await page.locator('#transform-filter-field').selectOption('CLASSI');
  await page.locator('#transform-filter-categories').fill('1');
  await page.locator('#transform-add-step').click();
  await page.locator('#transform-step-kind').selectOption('group-summarize');
  await page.locator('#transform-group-fields').selectOption(['UF']);
  await page.locator('#transform-add-step').click();

  await expect(page.locator('#transform-code-toggle')).toBeEnabled();
  await page.locator('#transform-code-toggle').click();
  const code = page.locator('#transform-code-output');
  await expect(page.locator('#transform-code')).toBeVisible();
  // dplyr by default.
  await expect(code).toContainText('library(dplyr)');
  await expect(code).toContainText('dplyr::filter(CLASSI %in% c("1"))');
  await expect(code).toContainText('dplyr::group_by(UF)');

  await page.locator('#transform-code-target').selectOption('python');
  await expect(code).toContainText('import pandas as pd');
  await expect(code).toContainText('df.groupby(["UF"]');

  // It is a view, not an action: the dataset is untouched by opening it.
  await expect(page.locator('#transform-result')).toBeEmpty();

  await page.locator('#transform-code-toggle').click();
  await expect(page.locator('#transform-code')).toBeHidden();
});

test('bind-rows stacks a second base, unions columns, and marks each record\'s origin', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/bind-a-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();
  await openAdvanced(page);
  await page.locator('summary', { hasText: 'Transformar dados' }).click();

  await page.locator('#transform-step-kind').selectOption('bind-rows');
  // The second base is loaded through its own file input, not the main one.
  await page.locator('#transform-bind-file-input').setInputFiles('e2e/fixtures/bind-b-e2e.csv');
  await expect(page.locator('#transform-bind-status')).toContainText('bind-b');
  await page.locator('#transform-bind-origin-check').check();
  await page.locator('#transform-bind-current-label').fill('base_a');
  await page.locator('#transform-add-step').click();

  await page.locator('#transform-apply-button').click();
  const report = page.locator('#transform-result');
  await expect(report).toContainText('registrosAdicionados: 2');
  await expect(report).toContainText('colunasSoFonte: 1');

  // The union carries both bases' columns plus the origin marker.
  const rowField = page.locator('#row-field');
  await expect(rowField).toContainText('INTERNACOES');
  await expect(rowField).toContainText('FONTE_ORIGEM');

  // OBITOS exists only in base A, so summing it by origin gives 30 for base_a
  // and nothing for the other base - a null, never a fabricated zero row.
  await page.locator('#row-field').selectOption('FONTE_ORIGEM');
  await page.locator('#measure-kind').selectOption('sum');
  await page.locator('#measure-field').selectOption('OBITOS');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  const body = page.locator('#result-table tbody');
  await expect(body.locator('tr', { hasText: 'base_a' })).toContainText('30');
  await expect(body.locator('tr')).toHaveCount(1);
});

test('join brings a second base\'s column onto the records by key, keeping the left side', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/join-casos-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();
  await openAdvanced(page);
  await page.locator('summary', { hasText: 'Transformar dados' }).click();

  await page.locator('#transform-step-kind').selectOption('join');
  await page.locator('#transform-join-file-input').setInputFiles('e2e/fixtures/join-pop-e2e.csv');
  await expect(page.locator('#transform-join-status')).toContainText('join-pop');
  await page.locator('#transform-join-type').selectOption('left');
  await page.locator('#transform-join-key-current').selectOption('UF');
  await page.locator('#transform-join-key-source').selectOption('UF');
  await page.locator('#transform-add-step').click();

  await page.locator('#transform-apply-button').click();
  const report = page.locator('#transform-result');
  // AC and AM match; SP has no population row; RJ (source-only) is dropped by left.
  await expect(report).toContainText('registrosCorrespondentes: 2');
  await expect(report).toContainText('registrosSoFonte: 0');

  await expect(page.locator('#row-field')).toContainText('POPULACAO');
  await page.locator('#row-field').selectOption('UF');
  await page.locator('#measure-kind').selectOption('sum');
  await page.locator('#measure-field').selectOption('POPULACAO');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  const body = page.locator('#result-table tbody');
  // AC=900, AM=4200; SP joined to nothing so its population is null, not a
  // fabricated zero - its row is suppressed and the total is just 5.100.
  await expect(body.locator('tr', { hasText: 'AC' })).toContainText('900');
  await expect(body.locator('tr', { hasText: 'AM' })).toContainText('4.200');
  await expect(body.locator('tr', { hasText: 'SP' })).toHaveCount(0);
});

test('the epidemiology panel gives crude and age-standardized rates with confidence intervals', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/epi-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();

  // Build a table with age-group rows and events/population/standard columns.
  await page.locator('#row-field').selectOption('FAIXA');
  await page.locator('#measure-kind').selectOption('sum');
  await page.locator('#measure-field').selectOption('OBITOS');
  await openAdvanced(page);
  await page.locator('summary', { hasText: 'Medidas adicionais' }).click();
  for (const field of ['POP', 'PADRAO', 'TXREF']) {
    await page.locator('#extra-measure-field').selectOption(field);
    await page.locator('#extra-measure-add').click();
  }
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#result-table tbody')).toBeVisible();

  await page.locator('[data-view="statistics"]').click();
  await page.locator('#statistics-operation').selectOption('epidemiology');
  await page.locator('#statistics-x').selectOption('0'); // events (OBITOS)
  await page.locator('#statistics-y').selectOption('1'); // population (POP)
  await page.locator('#epi-standard').selectOption('2'); // standard weight (PADRAO)
  await page.locator('#epi-per').selectOption('1000');

  const result = page.locator('#statistics-result');
  // Crude 30/1500 = 20 per 1000; standardized with equal weights:
  // (6/1000 + 24/500)/2 = 0.027 -> 27 per 1000.
  await expect(result).toContainText('Taxa bruta');
  await expect(result).toContainText('20');
  await expect(result).toContainText('Taxa padronizada');
  await expect(result).toContainText('27');
  // The old stratum's own crude rate is 48 per 1000, with a Byar interval.
  await expect(result.locator('tr', { hasText: '60+' })).toContainText('48');
  await expect(result).toContainText('Byar');

  // Dropping the standard leaves only the crude rate - no standardized card.
  await page.locator('#epi-standard').selectOption('');
  await expect(result).toContainText('Taxa bruta');
  await expect(result).not.toContainText('Taxa padronizada');
});

test('the indirect method reports observed against expected as an SMR, and reads the interval out loud', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/epi-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();

  await page.locator('#row-field').selectOption('FAIXA');
  await page.locator('#measure-kind').selectOption('sum');
  await page.locator('#measure-field').selectOption('OBITOS');
  await openAdvanced(page);
  await page.locator('summary', { hasText: 'Medidas adicionais' }).click();
  for (const field of ['POP', 'PADRAO', 'TXREF']) {
    await page.locator('#extra-measure-field').selectOption(field);
    await page.locator('#extra-measure-add').click();
  }
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#result-table tbody')).toBeVisible();

  await page.locator('[data-view="statistics"]').click();
  await page.locator('#statistics-operation').selectOption('epidemiology');
  await page.locator('#epi-method').selectOption('indirect');
  // The standard-population picker is replaced by the reference-rate one.
  await expect(page.locator('#epi-standard-label')).toBeHidden();
  await expect(page.locator('#epi-reference-label')).toBeVisible();

  const result = page.locator('#statistics-result');
  // Nothing is computed until the reference column is named.
  await expect(result).toContainText('taxas de referência');

  await page.locator('#statistics-x').selectOption('0'); // events
  await page.locator('#statistics-y').selectOption('1'); // population
  await page.locator('#epi-reference').selectOption('3'); // TXREF, per person
  // Reference rates 0.005 and 0.04 over 1000 and 500 predict 5 + 20 = 25;
  // 30 were observed, so the SMR is 1.2 and its interval still contains 1.
  await expect(result).toContainText('Observados');
  await expect(result).toContainText('30');
  await expect(result).toContainText('Esperados');
  await expect(result).toContainText('25');
  await expect(result).toContainText('1,2');
  await expect(result).toContainText('intervalo contém 1');
});

test('the epidemiology panel refuses fractional events instead of rounding an invented count', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/epi-fractional-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();

  await page.locator('#row-field').selectOption('FAIXA');
  await page.locator('#measure-kind').selectOption('sum');
  await page.locator('#measure-field').selectOption('EVENTOS');
  await openAdvanced(page);
  await page.locator('summary', { hasText: 'Medidas adicionais' }).click();
  await page.locator('#extra-measure-field').selectOption('POP');
  await page.locator('#extra-measure-add').click();
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());

  await page.locator('[data-view="statistics"]').click();
  await page.locator('#statistics-operation').selectOption('epidemiology');
  await page.locator('#statistics-x').selectOption('0');
  await page.locator('#statistics-y').selectOption('1');
  await expect(page.locator('#statistics-result')).toContainText('valor fracionário');
  await expect(page.locator('#statistics-result')).toContainText('0-59');
  await expect(page.locator('#statistics-result')).not.toContainText('Taxa bruta');
});

test('an epidemiology recipe restores method, scale and column bindings by key', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/epi-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();

  await page.locator('#row-field').selectOption('FAIXA');
  await page.locator('#measure-kind').selectOption('sum');
  await page.locator('#measure-field').selectOption('OBITOS');
  await openAdvanced(page);
  await page.locator('summary', { hasText: 'Medidas adicionais' }).click();
  for (const field of ['POP', 'PADRAO', 'TXREF']) {
    await page.locator('#extra-measure-field').selectOption(field);
    await page.locator('#extra-measure-add').click();
  }
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#result-table tbody')).toBeVisible();

  await page.locator('[data-view="statistics"]').click();
  await page.locator('#statistics-operation').selectOption('epidemiology');
  await page.locator('#statistics-x').selectOption('0');
  await page.locator('#statistics-y').selectOption('1');
  await page.locator('#epi-standard').selectOption('2');
  await page.locator('#epi-per').selectOption('1000');
  await page.locator('#epi-method').selectOption('indirect');
  await page.locator('#epi-reference').selectOption('3');
  await expect(page.locator('#statistics-result')).toContainText('SMR');

  const download = page.waitForEvent('download');
  await openSidebarGroup(page, 'saved');
  await page.locator('#save-recipe-button').click();
  const recipeFile = await (await download).path();
  if (!recipeFile) throw new Error('the browser did not expose the saved recipe path');

  // Deliberately move every control away from the saved state. Reopening must
  // bind the semantic column keys again, not reuse these current indices.
  await page.locator('#epi-reference').selectOption('');
  await page.locator('#epi-method').selectOption('direct');
  await page.locator('#epi-per').selectOption('100000');
  await page.locator('#epi-standard').selectOption('');
  await page.locator('#statistics-operation').selectOption('descriptive');

  await page.locator('#recipe-input').setInputFiles(recipeFile);
  await expect(page.locator('#statistics-operation')).toHaveValue('epidemiology');
  await expect(page.locator('#statistics-x')).toHaveValue('0');
  await expect(page.locator('#statistics-y')).toHaveValue('1');
  await expect(page.locator('#epi-method')).toHaveValue('indirect');
  await expect(page.locator('#epi-per')).toHaveValue('1000');
  await expect(page.locator('#epi-standard')).toHaveValue('2');
  await expect(page.locator('#epi-reference')).toHaveValue('3');
  await expect(page.locator('#statistics-result')).toContainText('SMR');
  await expect(page.locator('#statistics-result')).toContainText('1,2');
});

test('statistical and epidemiological bindings follow column keys when columns move', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/epi-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();
  await page.locator('#row-field').selectOption('FAIXA');
  await page.locator('#measure-kind').selectOption('sum');
  await page.locator('#measure-field').selectOption('OBITOS');
  await openAdvanced(page);
  await page.locator('summary', { hasText: 'Medidas adicionais' }).click();
  for (const field of ['POP', 'PADRAO', 'TXREF']) {
    await page.locator('#extra-measure-field').selectOption(field);
    await page.locator('#extra-measure-add').click();
  }
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());

  await page.locator('[data-view="statistics"]').click();
  await page.locator('#statistics-operation').selectOption('epidemiology');
  await page.locator('#statistics-x').selectOption('0');
  await page.locator('#statistics-y').selectOption('1');
  await page.locator('#epi-standard').selectOption('2');
  await page.locator('#epi-method').selectOption('indirect');
  await page.locator('#epi-reference').selectOption('3');

  await page.locator('[data-view="table"]').click();
  const edit = page.locator('#table-edit-column');
  const columnKeys = await edit.locator('option').evaluateAll((options) =>
    options.map((option) => (option as HTMLOptionElement).value));
  const standardKey = columnKeys[2];
  if (!standardKey) throw new Error('PADRAO column was not available to move');
  await edit.selectOption(standardKey);
  await page.locator('#table-column-left').click();
  const referenceKey = columnKeys[3];
  if (!referenceKey) throw new Error('TXREF column was not available to move');
  await edit.selectOption(referenceKey);
  await page.locator('#table-column-left').click();

  // New order is OBITOS, PADRAO, TXREF, POP. Index preservation would silently
  // bind Y/standard/reference to the wrong series; key preservation moves them.
  await page.locator('[data-view="statistics"]').click();
  await expect(page.locator('#statistics-x')).toHaveValue('0');
  await expect(page.locator('#statistics-y')).toHaveValue('3');
  await expect(page.locator('#epi-standard')).toHaveValue('1');
  await expect(page.locator('#epi-reference')).toHaveValue('2');
  await expect(page.locator('#statistics-result')).toContainText('SMR');
});

test('a raw DATASUS file reads as prose, without hiding the technical field name', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/rotulos-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();

  // No DEF is loaded here: the labels come from the published DATASUS
  // dictionary, and the technical name stays beside each one.
  const rows = page.locator('#row-field');
  await expect(rows).toContainText('Tipo de notificação · TP_NOT');
  await expect(rows).toContainText('Agravo/doença (CID) · ID_AGRAVO');
  await expect(rows).toContainText('Gestante · CS_GESTANT');
  // A label that is only the field name in prettier case is not shown twice.
  await expect(rows).not.toContainText('Sexo · SEXO');

  // The label is presentation only: tabulating by the field still keys on the
  // raw values, and the row header is the technical name.
  await page.locator('#row-field').selectOption('CS_SEXO');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  const body = page.locator('#result-table tbody');
  await expect(body).toContainText('F');
  await expect(body).toContainText('M');

  // "Ano 1º Sintoma", which TabNet offers as a row, is derived here rather
  // than shipped: extracting the year from the date makes it a real field.
  await openAdvanced(page);
  await page.locator('summary', { hasText: 'Transformar dados' }).click();
  await page.locator('#transform-step-kind').selectOption('date-part');
  await page.locator('#transform-datepart-field').selectOption('DT_SIN_PRI');
  await page.locator('#transform-datepart-part').selectOption('year');
  await page.locator('#transform-datepart-target').fill('ANO_SIN_PRI');
  await page.locator('#transform-add-step').click();
  await page.locator('#transform-apply-button').click();
  await expect(rows).toContainText('ANO_SIN_PRI');

  await page.locator('#row-field').selectOption('ANO_SIN_PRI');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(body).toContainText('2024');
});

test('several DEFs can be loaded at once, and which one is in force is a visible choice', async ({ page }) => {
  await page.goto('/');
  // The tabulation panel (and its DEF picker) only exists once there is something to pick.
  await expect(page.locator('#painel')).toBeHidden();
  await openSidebarGroup(page, 'metadata');
  await expect(page.locator('#def-inspector-button')).toBeDisabled();

  await page.locator('#file-input').setInputFiles([
    'e2e/fixtures/def-dados-e2e.csv',
    'e2e/fixtures/casos-e2e.def',
    'e2e/fixtures/obitos-e2e.def',
  ]);
  // In TabSis the DEF choice sits at the top of the tabulation panel, next to
  // the Linhas/Colunas/Incremento/Seleções lists it governs, and each option
  // carries the DEF's own description so the user picks by meaning.
  const picker = page.locator('#painel-def');
  await expect(picker).toBeVisible();

  // Both DEFs are held; loading the second no longer overwrites the first.
  await expect(picker).toContainText('casos-e2e.def — Casos confirmados por local');
  await expect(picker).toContainText('obitos-e2e.def — Obitos por local');

  // The active DEF names the measure: this is the difference between TabNet's
  // "Casos confirmados" and the bare "Freqüência" a raw file gets.
  await picker.selectOption('casos-e2e.def');
  await expect(page.locator('#painel-incrementos')).toContainText('Casos confirmados');
  await expect(page.locator('#measure-field')).toContainText('Casos confirmados');

  // Switching DEF re-labels the same underlying field.
  await picker.selectOption('obitos-e2e.def');
  await expect(page.locator('#painel-incrementos')).toContainText('Obitos registrados');
  await expect(page.locator('#measure-field')).toContainText('Obitos registrados');

  // "Sem DEF" is a real choice, not just an absence: it puts the technical
  // names back and disables the inspector.
  await picker.selectOption('');
  await expect(picker).toHaveValue('');
  await expect(page.locator('#painel-incrementos')).not.toContainText('Obitos registrados');
  await openSidebarGroup(page, 'metadata');
  await expect(page.locator('#def-inspector-button')).toBeDisabled();
  await expect(page.locator('#measure-field')).not.toContainText('Casos confirmados');
  await expect(page.locator('#measure-field')).toContainText('CASOS');
});

test('a saved recipe replays its transform pipeline, so it rebuilds the same table it saved', async ({ page }) => {
  // The pipeline runs before the tabulation. A recipe that carried only the
  // plan would replay it over the untransformed file and rebuild a different
  // table - while its own source fingerprints asserted the file matched.
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/limpeza-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();

  await openAdvanced(page);
  await page.locator('summary', { hasText: 'Transformar dados' }).click();
  await page.locator('#transform-step-kind').selectOption('date-part');
  await page.locator('#transform-datepart-field').selectOption('DT');
  await page.locator('#transform-datepart-part').selectOption('year');
  await page.locator('#transform-datepart-target').fill('ANO');
  await page.locator('#transform-add-step').click();
  await page.locator('#transform-apply-button').click();

  // ANO exists only because the pipeline created it.
  await expect(page.locator('#row-field')).toContainText('ANO');
  await page.locator('#row-field').selectOption('ANO');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  const body = page.locator('#result-table tbody');
  await expect(body).toContainText('2024');
  const savedTable = await body.innerText();

  const download = page.waitForEvent('download');
  await openSidebarGroup(page, 'saved');
  await page.locator('#save-recipe-button').click();
  const recipeFile = await (await download).path();

  // Fresh session, same raw file: ANO does not exist yet.
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/limpeza-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();
  await expect(page.locator('#row-field')).not.toContainText('ANO');

  await page.locator('#recipe-input').setInputFiles(recipeFile!);
  // Opening the recipe replays the pipeline first, so the field it needs
  // exists and the rebuilt table is the one that was saved.
  await expect(page.locator('#transform-count')).toContainText('1 etapa');
  await expect(page.locator('#result-table tbody')).toContainText('2024');
  expect(await page.locator('#result-table tbody').innerText()).toBe(savedTable);
});

test('as ações em lote agem sobre a escolha, e "todos" continua a um clique', async ({ page }) => {
  // O catálogo é simulado: o objetivo aqui é a seleção, não a rede. Sem isso a
  // barra de lote só existiria em produção, onde ninguém a testa.
  await page.route('https://datasus.saude.gov.br/wp-content/ftp.php', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify([2021, 2022, 2023].map((year) => ({
        arquivo: `DENGBR${String(year).slice(2)}.dbc`,
        endereco: `ftp://ftp.datasus.gov.br/dissemin/publicos/SINAN/DADOS/FINAIS/DENGBR${String(year).slice(2)}.dbc`,
        fonte: 'SINAN',
        modalidade: 'Dados - Finais',
      }))),
    });
  });

  await page.goto('/');
  await page.locator('#catalog-button').click();
  await page.locator('#catalog-system').selectOption('SINAN');
  await page.locator('#catalog-file-type').selectOption('DENG');

  // "todos" nos anos: um clique cobre quem quer a série inteira.
  const years = page.locator('#catalog-year');
  const yearsAll = page.locator('#catalog-year-all');
  await expect(yearsAll).toHaveText('todos');
  await yearsAll.click();
  await expect(yearsAll).toHaveText('limpar');
  const selectedYears = await years.evaluate((el: HTMLSelectElement) => el.selectedOptions.length);
  expect(selectedYears).toBeGreaterThan(1);
  // O botão não pode mentir sobre o que o próximo clique faz.
  await yearsAll.click();
  await expect(yearsAll).toHaveText('todos');
  await years.selectOption(['2023', '2022', '2021']);

  await page.locator('#catalog-form').evaluate((form: HTMLFormElement) => form.requestSubmit());

  const bar = page.locator('.catalog-batch-bar');
  await expect(bar).toBeVisible();
  // Tudo marcado por padrão: quem quer o lote inteiro não precisa clicar em nada.
  await expect(bar).toContainText('3 de 3 selecionado(s)');
  await expect(page.locator('.catalog-batch-bar-actions button').first()).toContainText('(3)');
  await expect(page.locator('.catalog-batch-bar-actions button').nth(1)).toContainText('.zip (3)');

  // Desmarcar um arquivo tem que refletir nas duas ações, não só na contagem.
  await page.locator('.catalog-result-check').first().uncheck();
  await expect(bar).toContainText('2 de 3 selecionado(s)');
  await expect(page.locator('.catalog-batch-bar-actions button').first()).toContainText('(2)');
  await expect(page.locator('.catalog-batch-bar-actions button').nth(1)).toContainText('.zip (2)');

  // Sem nada escolhido, as ações em lote ficam indisponíveis em vez de rodar vazias.
  for (const box of await page.locator('.catalog-result-check').all()) await box.uncheck();
  await expect(bar).toContainText('0 de 3 selecionado(s)');
  await expect(page.locator('.catalog-batch-bar-actions button').first()).toBeDisabled();
  await expect(page.locator('.catalog-batch-bar-actions button').nth(1)).toBeDisabled();

  // E o "selecionar todos" da barra devolve o lote inteiro num clique.
  await bar.locator('.select-all-button').click();
  await expect(bar).toContainText('3 de 3 selecionado(s)');
  await expect(page.locator('.catalog-batch-bar-actions button').first()).toBeEnabled();
});

test('o downloader local é oferecido, nunca iniciado sozinho, e só depois de verificar', async ({ page }) => {
  // Uma página não pode executar programa na máquina de ninguém. O que se
  // prova aqui é justamente o que o aplicativo NÃO faz por conta própria.
  let probes = 0;
  await page.route('http://127.0.0.1:8787/health', async (route) => {
    probes++;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        service: 'tabwin-bridge',
        protocol: 1,
        allowlist: ['https://ftp.datasus.gov.br/dissemin/publicos/… — árvore pública'],
        directory: 'C:/Users/x/Downloads/TabWin',
      }),
    });
  });

  await page.goto('/');
  await page.locator('#catalog-button').click();

  // Abrir o catálogo não pode sondar a máquina: um site que varre portas ao
  // carregar é exatamente o que não queremos ser.
  await page.waitForTimeout(600);
  expect(probes).toBe(0);

  await page.locator('#bridge-panel summary').click();
  const verdict = page.locator('#bridge-verdict');
  await expect(verdict).toBeHidden();

  // Verificar sem token detecta o auxiliar, mas não o dá por pronto.
  await page.locator('#bridge-check').click();
  await expect(verdict).toBeVisible();
  await expect(verdict).toContainText('falta colar o token');
  expect(probes).toBe(1);

  // Com token, ele fica disponível e a allowlist aparece para o usuário ler.
  await page.locator('#bridge-token').fill('token-de-teste');
  await page.locator('#bridge-check').click();
  await expect(verdict).toContainText('Downloader local disponível');
  await expect(verdict).toContainText('ftp.datasus.gov.br');
  await expect(verdict).toHaveClass(/bridge-verdict-ok/);
});

test('auxiliar de versão incompatível é recusado em vez de tentar adivinhar', async ({ page }) => {
  await page.route('http://127.0.0.1:8787/health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ service: 'tabwin-bridge', protocol: 99, allowlist: [], directory: 'x' }),
    });
  });
  await page.goto('/');
  await page.locator('#catalog-button').click();
  await page.locator('#bridge-panel summary').click();
  await page.locator('#bridge-token').fill('token-de-teste');
  await page.locator('#bridge-check').click();
  const verdict = page.locator('#bridge-verdict');
  await expect(verdict).toContainText('incompatível');
  await expect(verdict).toHaveClass(/bridge-verdict-warn/);
});

test('o pacote para o Lab sai com os dados e a procedência junto', async ({ page }) => {
  await tabulateFixture(page);
  await openSidebarGroup(page, 'export');

  const download = page.waitForEvent('download');
  await page.locator('#lab-package-button').click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^tabwin-lab-tabela-\d{4}-\d{2}-\d{2}\.zip$/);

  // O ponto do pacote é não ser um CSV solto: sem procedência, meses depois
  // ninguém sabe qual arquivo gerou aquilo nem que filtros estavam ativos.
  const path = await file.path();
  const { readFileSync } = await import('node:fs');
  const { unzipSync, strFromU8 } = await import('fflate');
  const entries = unzipSync(new Uint8Array(readFileSync(path)));
  expect(Object.keys(entries).sort()).toEqual(['PROVENIENCIA.json', 'dados.csv']);

  const provenance = JSON.parse(strFromU8(entries['PROVENIENCIA.json']));
  expect(provenance.schema).toBe('tabwin-web.lab-package');
  expect(provenance.content).toBe('tabulation');
  expect(provenance.rowCount).toBeGreaterThan(0);
  expect(provenance.notes.join(' ')).toMatch(/Nenhum zero foi fabricado/);

  // O BOM se afere nos BYTES: o decodificador de texto o consome, então
  // checar a string sempre passaria por engano.
  expect([...entries['dados.csv'].slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const csv = strFromU8(entries['dados.csv']);
  expect(csv.split('\r\n').length - 1).toBe(provenance.rowCount + 1);
});

test('Abrir no Python leva os microdados da tabela e um caderno pronto ao Lab', async ({ page, context }) => {
  await tabulateFixture(page);
  await openSidebarGroup(page, 'export');
  await expect(page.locator('#open-python-button')).toBeEnabled();

  const popup = context.waitForEvent('page');
  await page.locator('#open-python-button').click();
  const lab = await popup;
  await lab.waitForLoadState();

  // Os dados entram como se o usuário os tivesse escolhido: em /data, na lista.
  await expect(lab.locator('#data-file-list')).toContainText('-microdados.csv');
  const codigos = await lab.locator('.cell-code').evaluateAll((areas) => areas.map((area) => (area as HTMLTextAreaElement).value));
  expect(codigos.length).toBeGreaterThanOrEqual(3);
  expect(codigos[0]).toMatch(/pd\.read_csv\("\/data\/[^"]+-microdados\.csv", sep=";"/);
  expect(codigos[1]).toMatch(/groupby\(/);
  // Recarregar não espera dados de novo: o ?origem=tabsis sai da barra.
  expect(new URL(lab.url()).search).toBe('');

  // O CSV montado tem os mesmos registros que a tabela aceitou.
  const linhas = await lab.evaluate(async () => {
    const arquivo = (document.querySelector('#data-files') as HTMLInputElement).files![0];
    return (await arquivo.text()).trim().split(/\r?\n/).length - 1;
  });
  // A fixture tem três registros e nenhum filtro: os três chegam ao Lab.
  expect(linhas).toBe(3);
});

test('Rodar no computador baixa um zip com os microdados, o caderno e um iniciador por sistema', async ({ page }) => {
  await tabulateFixture(page);
  await openSidebarGroup(page, 'export');
  const download = page.waitForEvent('download');
  await page.locator('#python-local-button').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('microdados-e2e-python.zip');

  const { readFileSync } = await import('node:fs');
  const bytes = new Uint8Array(readFileSync(await file.path()));
  const { unzipSync, strFromU8 } = await import('fflate');
  const entradas = unzipSync(bytes);
  const nomes = Object.keys(entradas).map((nome) => nome.replace(/^microdados-e2e-python\//, '')).sort();
  expect(nomes).toEqual([
    'LEIA-ME.txt', 'Rodar no Mac.command', 'Rodar no Windows.bat', 'analise.ipynb', 'analise.py',
    'dados/microdados-e2e-microdados.csv', 'preparar_e_rodar.py', 'requirements.txt', 'rodar-linux.sh',
  ]);
  const script = strFromU8(entradas['microdados-e2e-python/analise.py']!);
  expect(script).toContain('PASTA / "dados" / "microdados-e2e-microdados.csv"');
  expect(script).toContain('print(tabela.to_string())');
  // Os três registros da tabela, mais o cabeçalho.
  expect(strFromU8(entradas['microdados-e2e-python/dados/microdados-e2e-microdados.csv']!).trim().split(/\r?\n/)).toHaveLength(4);

  // Dois cliques no macOS e no Linux dependem do modo rwx gravado no zip
  // (16 bits altos dos atributos externos, no diretório central).
  const modos = new Map<string, number>();
  const visao = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i + 46 <= bytes.length; i++) {
    if (visao.getUint32(i, true) !== 0x02014b50) continue;
    const tamanhoNome = visao.getUint16(i + 28, true);
    const nome = new TextDecoder().decode(bytes.subarray(i + 46, i + 46 + tamanhoNome));
    modos.set(nome.replace(/^microdados-e2e-python\//, ''), visao.getUint32(i + 38, true) >>> 16);
  }
  expect(modos.get('rodar-linux.sh')).toBe(0o100755);
  expect(modos.get('Rodar no Mac.command')).toBe(0o100755);
  expect(modos.get('analise.py')).toBe(0o100644);
});

test('Microdados: definição de caso por códigos, com prévia, vira uma Seleção', async ({ page }) => {
  await tabulateFixture(page);
  await page.locator('[data-view="microdata"]').click();
  await expect(page.locator('#microdata-view')).toBeVisible();
  await page.locator('#case-field').selectOption('UF');

  // "A" é prefixo (AC e AM); "AM" sai por cima, como B56 sai de B56-B57.
  await page.locator('#case-include').fill('A');
  await page.locator('#case-exclude').fill('AM');
  await expect(page.locator('#case-apply')).toBeDisabled();
  await page.locator('#case-preview').click();
  await expect(page.locator('#case-status')).toContainText('2 de 3 registros entram');
  await expect(page.locator('#case-result')).toContainText('Entram');
  await expect(page.locator('#case-result')).toContainText('Tirados por "Excluir"');

  // Mudou a definição: a prévia velha não serve para aplicar.
  await page.locator('#case-exclude').fill('AM, ZZ');
  await expect(page.locator('#case-apply')).toBeDisabled();
  await page.locator('#case-exclude').fill('AM');
  await page.locator('#case-preview').click();
  await expect(page.locator('#case-apply')).toBeEnabled();
  await page.locator('#case-apply').click();

  await expect(page.locator('#case-status')).toContainText('Aplicado como Seleção: UF = A, sem AM');
  await page.locator('[data-view="table"]').click();
  await expect(page.locator('#result-table tbody')).toContainText('AC');
  await expect(page.locator('#result-table tbody')).not.toContainText('AM');

  // Aplicar de novo troca a Seleção desta aba, não empilha outra.
  await page.locator('[data-view="microdata"]').click();
  await page.locator('#case-exclude').fill('');
  await page.locator('#case-preview').click();
  await expect(page.locator('#case-status')).toContainText('3 de 3 registros entram');
  await page.locator('#case-apply').click();
  await page.locator('[data-view="table"]').click();
  await expect(page.locator('#result-table tbody')).toContainText('AM');
  await expect(page.locator('.active-filter')).toHaveCount(1);
  await expect(page.locator('.active-filter')).toContainText('Caso');
  await expect(page.locator('.active-filter')).toContainText('A');

  // Código que não existe no campo é apontado, em vez de dar zero calado.
  await page.locator('[data-view="microdata"]').click();
  await page.locator('#case-include').fill('B57');
  await page.locator('#case-preview').click();
  await expect(page.locator('#case-status')).toContainText('Nenhum registro com: B57');
  await expect(page.locator('#case-apply')).toBeDisabled();
});

test('Microdados: ver os valores do campo com o significado e marcar os que entram', async ({ page }) => {
  // LTA: cutânea e mucosa vêm no mesmo arquivo, separadas pela forma clínica.
  const { writeDbf } = await import('../dist/packages/export/src/dbf-writer.js');
  const campos = [
    { name: 'CLAS_FORMA', type: 'C', length: 1, decimalCount: 0 },
    { name: 'CS_SEXO', type: 'C', length: 1, decimalCount: 0 },
  ];
  const registros = [['1', 'M'], ['1', 'F'], ['1', 'M'], ['2', 'M'], ['2', 'F'], ['', 'F']]
    .map(([CLAS_FORMA, CS_SEXO]) => ({ CLAS_FORMA, CS_SEXO }));
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'LTANBR23.dbf', mimeType: 'application/octet-stream', buffer: Buffer.from(writeDbf(registros, campos)) });
  await expect(page.locator('#run-button')).toBeEnabled();
  await page.locator('#row-field').selectOption('CS_SEXO');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#result-table tbody')).toBeVisible();

  await page.locator('[data-view="microdata"]').click();
  // Sem campo de CID, a forma clínica já vem escolhida, com o que o dicionário diz dela.
  await expect(page.locator('#case-field')).toHaveValue('CLAS_FORMA');
  await expect(page.locator('#values-field-note')).toContainText('Forma clínica');
  const linhas = page.locator('#values-table tbody tr');
  await expect(linhas).toHaveCount(3);
  await expect(linhas.nth(0)).toContainText('Cutânea');
  await expect(linhas.nth(0)).toContainText('3');
  await expect(linhas.nth(1)).toContainText('Mucosa');
  await expect(linhas.nth(2)).toContainText('(em branco)');
  await expect(page.locator('#values-apply')).toBeDisabled();

  // Ver os registros de um valor, antes de decidir.
  await linhas.nth(1).getByRole('button', { name: 'ver registros' }).click();
  await expect(page.locator('#values-examples')).toContainText('CLAS_FORMA = 2 (Mucosa)');
  await expect(page.locator('#values-examples tbody tr')).toHaveCount(2);

  // Só a cutânea.
  await linhas.nth(0).getByRole('checkbox').check();
  await expect(page.locator('#values-status')).toContainText('3 de 6 registros entram');
  await page.locator('#values-apply').click();
  await expect(page.locator('#values-status')).toContainText('Aplicado como Seleção: CLAS_FORMA = 1 (Cutânea)');
  await expect(page.locator('.active-filter')).toHaveCount(1);
  await page.locator('[data-view="table"]').click();
  await expect(page.locator('#result-table tfoot tr').first().locator('td').first()).toHaveText('3');

  // Voltando, a lista mostra todos os valores e a cutânea marcada; trocar pela
  // mucosa + branco troca a Seleção, não empilha.
  await page.locator('[data-view="microdata"]').click();
  await expect(linhas.nth(0).getByRole('checkbox')).toBeChecked();
  await linhas.nth(0).getByRole('checkbox').uncheck();
  await linhas.nth(1).getByRole('checkbox').check();
  await linhas.nth(2).locator('td').nth(1).click();
  await expect(linhas.nth(2).getByRole('checkbox')).toBeChecked();
  await page.locator('#values-apply').click();
  await expect(page.locator('.active-filter')).toHaveCount(1);
  await page.locator('[data-view="table"]').click();
  await expect(page.locator('#result-table tfoot tr').first().locator('td').first()).toHaveText('3');
});

test('Microdados: receita visual com etapas prontas de LTA, contagem por etapa e etapa desligada', async ({ page }) => {
  const { writeDbf } = await import('../dist/packages/export/src/dbf-writer.js');
  const campo = (name: string, length: number) => ({ name, type: 'C', length, decimalCount: 0 });
  const linhas = [
    ['530010', '1', '1', '1'], ['520060', '1', '', '1'], ['520870', '1', '1', '1'],
    ['530010', '2', '1', '1'], ['530010', '1', '6', '1'], ['520060', '1', '1', '2'],
  ].map(([ID_MN_RESI, CLA_TIPO_N, EVOLUCAO, CLAS_FORMA]) => ({ ID_MN_RESI, CLA_TIPO_N, EVOLUCAO, CLAS_FORMA }));
  const dbf = writeDbf(linhas, [campo('ID_MN_RESI', 6), campo('CLA_TIPO_N', 1), campo('EVOLUCAO', 1), campo('CLAS_FORMA', 1)]);
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'LTANBR23.dbf', mimeType: 'application/octet-stream', buffer: Buffer.from(dbf) });
  await expect(page.locator('#run-button')).toBeEnabled();
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#result-table tbody')).toBeVisible();
  await page.locator('[data-view="microdata"]').click();

  // As etapas prontas citam a fonte; cada uma vira um cartão com o que sobra.
  const prontas = page.locator('#receita-prontas');
  await expect(prontas.getByRole('button', { name: /Caso novo \(LTA\)/ })).toHaveAttribute('title', /Caderno de Indicadores/);
  await prontas.getByRole('button', { name: /Caso novo \(LTA\)/ }).click();
  await prontas.getByRole('button', { name: /Forma cutânea/ }).click();
  await prontas.getByRole('button', { name: /DF e Entorno/ }).click();
  const etapas = page.locator('#receita-etapas li');
  await expect(etapas).toHaveCount(5);
  await expect(etapas.nth(0)).toContainText('6 registros');
  await expect(etapas.nth(1)).toContainText('5 registros · saem 1');   // tipo de entrada: sai a recidiva
  await expect(etapas.nth(2)).toContainText('4 registros · saem 1');   // evolução: sai a mudança de diagnóstico
  await expect(etapas.nth(3)).toContainText('3 registros · saem 1');   // forma: sai a mucosa
  await expect(etapas.nth(4)).toContainText('2 registros · saem 1');   // RIDE: sai Goiânia
  await expect(page.locator('#receita-status')).toContainText('ficam 2 de 6 registros');

  // Desligar a forma clínica: a etapa fica no cartão, fora da análise, e a mucosa volta.
  await etapas.nth(3).getByRole('button', { name: /^Desligar/ }).click();
  await expect(page.locator('#receita-etapas li.receita-desligada')).toContainText('fora da análise');
  await expect(page.locator('#receita-status')).toContainText('ficam 3 de 6 registros');
  await page.locator('[data-view="table"]').click();
  await expect(page.locator('#result-table tfoot tr').first().locator('td').first()).toHaveText('3');

  // Arrastar um cartão muda a ordem do caminho (o resultado é o mesmo).
  await page.locator('[data-view="microdata"]').click();
  await etapas.nth(3).dragTo(etapas.nth(1));
  await expect(etapas.nth(1)).toContainText('ID_MN_RESI');
  await expect(page.locator('#receita-status')).toContainText('ficam 3 de 6 registros');
});

test('Microdados: receita com idade, período, amostra por etapa e etapa desligada que volta na receita salva', async ({ page }) => {
  const { writeDbf } = await import('../dist/packages/export/src/dbf-writer.js');
  const linhas = [['4065', '2023-03-10'], ['4030', '2023-05-01'], ['4070', '2024-02-02'], ['4061', '2024-07-07']]
    .map(([NU_IDADE_N, data]) => ({ NU_IDADE_N, DT_NOTIFIC: new Date(`${data}T00:00:00Z`), ID_MN_RESI: '530010' }));
  const dbf = writeDbf(linhas, [
    { name: 'NU_IDADE_N', type: 'C', length: 4, decimalCount: 0 },
    { name: 'DT_NOTIFIC', type: 'D', length: 8, decimalCount: 0 },
    { name: 'ID_MN_RESI', type: 'C', length: 6, decimalCount: 0 },
  ]);
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'LTANBR23.dbf', mimeType: 'application/octet-stream', buffer: Buffer.from(dbf) });
  await expect(page.locator('#run-button')).toBeEnabled();
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#result-table tbody')).toBeVisible();
  await page.locator('[data-view="microdata"]').click();

  const configuraveis = page.locator('#receita-configuraveis');
  await configuraveis.getByLabel('Idade mínima').fill('60');
  await configuraveis.getByRole('button', { name: 'Acrescentar a etapa de idade' }).click();
  await expect(page.locator('#receita-status')).toContainText('ficam 3 de 4 registros');
  await expect(configuraveis.getByLabel('Data usada no período')).toContainText('Ano de');
  await configuraveis.getByLabel('Primeiro ano').fill('2023');
  await configuraveis.getByLabel('Último ano').fill('2023');
  await configuraveis.getByRole('button', { name: 'Acrescentar a etapa de período' }).click();
  await expect(page.locator('#receita-status')).toContainText('ficam 1 de 4 registros');

  // A amostra de uma etapa mostra os registros que passam até ela, com o campo dela em destaque.
  const etapas = page.locator('#receita-etapas li');
  await etapas.nth(1).getByRole('button', { name: /^Ver registros/ }).click();
  await expect(page.locator('#receita-amostra tbody tr')).toHaveCount(3);
  await expect(page.locator('#receita-amostra th.values-chosen')).toHaveText('NU_IDADE_N');

  // Desligada, a etapa do período sai da tabela, mas vai na receita salva e volta desligada.
  await etapas.nth(2).getByRole('button', { name: /^Desligar/ }).click();
  await expect(page.locator('#receita-status')).toContainText('ficam 3 de 4 registros');
  const download = page.waitForEvent('download');
  await openSidebarGroup(page, 'saved');
  await page.locator('#save-recipe-button').click();
  const arquivo = await (await download).path();
  await page.locator('[data-view="microdata"]').click();
  await etapas.nth(2).getByRole('button', { name: /^Remover/ }).click();
  await expect(page.locator('#receita-etapas li.receita-desligada')).toHaveCount(0);
  await page.locator('#recipe-input').setInputFiles(arquivo);
  await page.locator('[data-view="microdata"]').click();
  await expect(page.locator('#receita-etapas li.receita-desligada')).toHaveCount(1);
  await expect(page.locator('#receita-etapas li.receita-desligada')).toContainText('fora da análise');
});

test('Caderno em R: a receita vira definição de caso e região, e o Laboratório recebe os três CSV e as células em R', async ({ page, context }) => {
  // IBGE simulado (mesmo formato da API real): dois municípios do DF e Entorno e um de fora.
  await page.route('https://servicodados.ibge.gov.br/**', async (route) => {
    const url = route.request().url();
    const ano = /periodos\/(\d{4})\//.exec(url)?.[1] ?? '';
    const corpo = url.endsWith('/6579/periodos') ? [{ id: '2023' }, { id: '2024' }]
      : ano ? [{ id: '9324', resultados: [{ classificacoes: [], series: [
        { localidade: { id: '5300108' }, serie: { [ano]: '3000000' } },
        { localidade: { id: '5200605' }, serie: { [ano]: '10000' } },
        { localidade: { id: '5208707' }, serie: { [ano]: '1500000' } },
        // O leitor exige o país inteiro: o resto dos municípios, com 1.000 habitantes.
        ...Array.from({ length: 5600 }, (_, i) => ({ localidade: { id: String(1100000 + i * 10 + 5) }, serie: { [ano]: '1000' } })),
      ] }] }] : null;
    await route.fulfill(corpo ? { json: corpo, headers: { 'Access-Control-Allow-Origin': '*' } } : { status: 404 });
  });
  const { writeDbf } = await import('../dist/packages/export/src/dbf-writer.js');
  const campo = (name: string, length: number) => ({ name, type: 'C', length, decimalCount: 0 });
  const arquivo = (linhas: string[][]) => Buffer.from(writeDbf(
    linhas.map(([ID_MN_RESI, CS_SEXO]) => ({ ID_MN_RESI, CS_SEXO, CLA_TIPO_N: '1', EVOLUCAO: '1' })),
    [campo('ID_MN_RESI', 6), campo('CS_SEXO', 1), campo('CLA_TIPO_N', 1), campo('EVOLUCAO', 1)],
  ));
  await page.goto('/');
  await page.locator('#file-input').setInputFiles([
    { name: 'LTANBR23.dbf', mimeType: 'application/octet-stream', buffer: arquivo([['530010', 'M'], ['520060', 'F'], ['520870', 'M']]) },
    { name: 'LTANBR24.dbf', mimeType: 'application/octet-stream', buffer: arquivo([['530010', 'F'], ['', 'M']]) },
  ]);
  await expect(page.locator('#dataset-files-summary')).toContainText('2 juntos', { timeout: 20000 });
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#result-table tbody')).toBeVisible();
  await page.locator('[data-view="microdata"]').click();
  await page.locator('#receita-prontas').getByRole('button', { name: /Caso novo \(LTA\)/ }).click();
  await page.locator('#receita-prontas').getByRole('button', { name: /DF e Entorno/ }).click();
  await expect(page.locator('#receita-status')).toContainText('ficam 3 de 5 registros');

  const popup = context.waitForEvent('page');
  await page.locator('#receita-caderno-r').click();
  const lab = await popup;
  await expect(lab.locator('#save-status')).toContainText('Dados do TabSis em /data: casos.csv, populacao.csv, perfil.csv', { timeout: 30000 });
  const runtimes = await lab.locator('.cell-runtime').evaluateAll((selects) => selects.map((select) => (select as HTMLSelectElement).value));
  expect(runtimes).toEqual(['r', 'r', 'r', 'r', 'r', 'r']);
  // A região é a etapa de residência; o caso sem município conta só no Brasil.
  const primeira = await lab.locator('.cell textarea, .cell .cell-code').first().inputValue().catch(async () => lab.locator('.cell').first().innerText());
  expect(primeira).toContain('NOME_REGIAO <- "DF e Entorno"');
  expect(primeira).toContain('"530010", "520060"');
});

test('Microdados: atalhos de RIDE-DF e idade, com uma regra por campo', async ({ page }) => {
  // Residência em Brasília, Alto Paraíso (RIDE), Goiânia (fora) e Unaí (RIDE, MG).
  const csv = [
    'ID_MN_RESI;NU_IDADE_N;CS_SEXO',
    '530010;4065;M', '520060;4030;F', '520870;4070;M', '317040;3005;F', '530010;4005;F',
  ].join('\n');
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'sinan-e2e.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.locator('#run-button')).toBeEnabled();
  await page.locator('#row-field').selectOption('CS_SEXO');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#result-table tbody')).toBeVisible();
  await page.locator('[data-view="microdata"]').click();

  await page.locator('#case-shortcut-ride').click();
  await expect(page.locator('#case-field')).toHaveValue('ID_MN_RESI');
  await expect(page.locator('#case-status')).toContainText('4 de 5 registros entram');
  await page.locator('#case-apply').click();

  // Idade de 60 anos ou mais, em outro campo: soma com a região, não troca.
  await page.locator('#case-age-min').fill('60');
  await page.locator('#case-shortcut-age').click();
  await expect(page.locator('#case-field')).toHaveValue('NU_IDADE_N');
  // A prévia já respeita a região: dos 4 da RIDE, 1 tem 60+.
  await expect(page.locator('#case-status')).toContainText('1 de 4 registros entram');
  await page.locator('#case-apply').click();
  await expect(page.locator('.active-filter')).toHaveCount(2);
  await page.locator('[data-view="table"]').click();
  await expect(page.locator('#result-table tbody')).toContainText('M');
  await expect(page.locator('#result-table tbody')).not.toContainText('F');
});

test('a página de licenças existe e diz a licença certa do TabSis', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('a[href="./licencas.html"]')).toHaveCount(1);
  await page.goto('/licencas.html');
  await expect(page.locator('h1')).toHaveText('Licenças');
  await expect(page.locator('main')).toContainText('AGPL-3.0-or-later');
  for (const peca of ['datasus-dbc', 'fflate', 'hyparquet', 'DuckDB-WASM', 'Pyodide', 'webR', 'AndroidX', 'PyInstaller']) {
    await expect(page.locator('main')).toContainText(peca);
  }
  // A janela Sobre dizia "Licença MIT" depois da troca para AGPL.
  await page.goto('/');
  expect(await page.locator('body').innerHTML()).not.toMatch(/licença MIT/i);
});

test('o arquivo guardado pode ser baixado sem precisar abrir a análise', async ({ page }) => {
  // Querer o arquivo é diferente de querer analisá-lo aqui. Antes, a única
  // forma de tirá-lo do aparelho era abrir a análise primeiro.
  await page.route('https://datasus.saude.gov.br/wp-content/ftp.php', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: '[]',
    });
  });
  await page.goto('/');

  // O zip é montado aqui e entregue como bytes: o navegador de teste não tem
  // como importar fflate da árvore de node_modules.
  const { zipSync, strToU8 } = await import('fflate');
  const archive = [...zipSync({ 'GUARDADO01.dbc': strToU8('conteudo-de-teste') })];

  await page.evaluate(async (bytes) => {
    // Sem versão: abre o banco como estiver. Se o aplicativo ainda não o
    // criou, nasce na versão 1 (a de quem já usava antes) e a atualização do
    // aplicativo migra o pacote para a store de metadados — que é justamente
    // o que este teste passa a exercitar também.
    const open = indexedDB.open('tabwin-web');
    const database: IDBDatabase = await new Promise((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains('official-archives')) {
          // O indice tem que existir aqui tambem: o aplicativo o cria e a
          // eviction depende dele. Uma store de teste sem indice fabricava um
          // estado que nenhum usuario tem.
          const store = open.result.createObjectStore('official-archives', { keyPath: 'key' });
          store.createIndex('savedAt', 'savedAt');
        }
      };
    });
    const entry = {
      key: 'official-v1:teste',
      savedAt: Date.now(),
      bytes: new Uint8Array(bytes).buffer,
      sha256: 'a'.repeat(64),
      role: 'data',
      sources: [{ name: 'GUARDADO01.dbc', address: 'ftp://ftp.datasus.gov.br/x', source: 'SINAN', modality: 'Dados' }],
    };
    const stores = ['official-archives', ...(database.objectStoreNames.contains('archive-meta') ? ['archive-meta'] : [])];
    const transaction = database.transaction(stores, 'readwrite');
    transaction.objectStore('official-archives').put(entry);
    if (stores.includes('archive-meta')) {
      const { bytes: conteudo, ...resumo } = entry;
      transaction.objectStore('archive-meta').put({ ...resumo, size: conteudo.byteLength });
    }
    await new Promise((resolve) => { transaction.oncomplete = () => resolve(null); });
    database.close();
  }, archive);

  await page.locator('#catalog-button').click();
  const row = page.locator('.catalog-recent-item').filter({ hasText: 'GUARDADO01.dbc' });
  await expect(row).toBeVisible();

  const download = page.waitForEvent('download');
  await row.getByRole('button', { name: 'Baixar' }).click();
  const file = await download;
  // Sai o DBC que a pessoa reconhece, não o .zip como veio da rede.
  expect(file.suggestedFilename()).toBe('GUARDADO01.dbc');
});

test('downloads guardados: marcar dois anos e abrir juntos, depois juntar mais um ao que está aberto', async ({ page }) => {
  const { zipSync } = await import('fflate');
  const { readFileSync } = await import('node:fs');
  await page.goto('/');
  const pacotes = ['DENGBR23', 'DENGBR24', 'DENGBR25'].map((nome) => ({
    nome, bytes: [...zipSync({ [`${nome}.dbf`]: new Uint8Array(readFileSync(`e2e/fixtures/${nome}.dbf`)) })],
  }));
  await page.evaluate(async (lista) => {
    const mod = await import('/src/archive-cache.ts');
    for (const { nome, bytes } of lista) {
      await mod.writeCachedArchive(`official-v1:${nome}`, new Uint8Array(bytes), {
        sha256: nome.slice(-2).repeat(32), role: 'data',
        sources: [{ name: `${nome}.dbf`, address: `ftp://ftp.datasus.gov.br/dissemin/publicos/SINAN/DADOS/FINAIS/${nome}.dbc`, source: 'SINAN', modality: 'Dados' }],
      });
      await new Promise((r) => setTimeout(r, 4));
    }
  }, pacotes);

  await page.locator('#catalog-button').click();
  const abrirJuntos = page.locator('#catalog-recent-open-together');
  await expect(abrirJuntos).toBeDisabled();
  for (const nome of ['DENGBR23', 'DENGBR24']) {
    await page.locator('.catalog-recent-item').filter({ hasText: `${nome}.dbf` }).locator('.catalog-result-check').check();
  }
  await expect(abrirJuntos).toHaveText('Abrir os 2 juntos');
  await abrirJuntos.click();
  await expect(page.locator('#dataset-files-list li')).toHaveCount(2);
  await expect(page.locator('#dataset-files-summary')).toContainText('2 juntos · 2023 a 2024');

  await page.locator('#catalog-button').click();
  await page.locator('.catalog-recent-item').filter({ hasText: 'DENGBR25.dbf' }).locator('.catalog-result-check').check();
  await page.locator('#catalog-recent-join-open').click();
  await expect(page.locator('#dataset-files-list li')).toHaveCount(3);
  await expect(page.locator('#dataset-files-summary')).toHaveText('3 juntos · 2023 a 2025 · 24 registros');
});

test('juntar anos com campos acrescentados: o campo novo entra e fica em branco no ano que não o tem', async ({ page }) => {
  // O DATASUS acrescenta campos com os anos (LEIVBR25 tem 11 a mais que LEIVBR24).
  const { writeDbf } = await import('../dist/packages/export/src/dbf-writer.js');
  const sexo = { name: 'CS_SEXO', type: 'C', length: 1, decimalCount: 0 };
  const novo = { name: 'NU_LOTE_V', type: 'C', length: 7, decimalCount: 0 };
  const antigo = writeDbf([{ CS_SEXO: 'M' }, { CS_SEXO: 'F' }], [sexo]);
  const recente = writeDbf([{ CS_SEXO: 'M', NU_LOTE_V: 'L1' }, { CS_SEXO: 'M', NU_LOTE_V: 'L1' }, { CS_SEXO: 'F', NU_LOTE_V: 'L2' }], [sexo, novo]);
  const divergente = writeDbf([{ CS_SEXO: 'MM' }], [{ ...sexo, length: 2 }]);
  await page.goto('/');
  await page.locator('#file-input').setInputFiles([
    { name: 'LEIVBR24.dbf', mimeType: 'application/octet-stream', buffer: Buffer.from(antigo) },
    { name: 'LEIVBR25.dbf', mimeType: 'application/octet-stream', buffer: Buffer.from(recente) },
  ]);
  await expect(page.locator('#dataset-files-summary')).toContainText('2 juntos · 2024 a 2025 · 5 registros');
  await page.locator('#row-field').selectOption('NU_LOTE_V');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  const corpo = page.locator('#result-table tbody');
  await expect(corpo.locator('tr', { hasText: 'L1' })).toContainText('2');
  await expect(corpo.locator('tr', { hasText: 'L2' })).toContainText('1');
  // Campo em comum que mudou de tamanho (o LTANBR25 do DATASUS mudou o tipo
  // de quatro campos): o ano entra, o campo vira texto e a tela diz qual.
  await page.locator('#dataset-add-input').setInputFiles({ name: 'LEIVBR26.dbf', mimeType: 'application/octet-stream', buffer: Buffer.from(divergente) });
  await expect(page.locator('.toast').last()).toContainText('CS_SEXO (C1 × C2');
  await expect(page.locator('#dataset-files-list li')).toHaveCount(3);
  await page.locator('#row-field').selectOption('CS_SEXO');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(corpo.locator('tr', { hasText: 'MM' })).toContainText('1');
});

test('dentro do app Android, salvar vai pela ponte nativa (o WebView não baixa blob:) e imprimir também', async ({ page }) => {
  // Ponte falsa com a mesma forma da PonteAndroid.java.
  await page.addInitScript(() => {
    const registro = { partes: [] as string[], concluido: null as null | { nome: string; tipo: string; abrir: boolean }, impressoes: 0 };
    (window as unknown as { __ponte: typeof registro }).__ponte = registro;
    (window as unknown as { TabSisAndroid: unknown }).TabSisAndroid = {
      iniciarArquivo: () => '00000000-0000-0000-0000-000000000000',
      escreverParte: (_id: string, base64: string) => { registro.partes.push(base64); },
      concluirArquivo: (_id: string, nome: string, tipo: string, abrir: boolean) => { registro.concluido = { nome, tipo, abrir }; return `${nome} salvo em Downloads/TabSis`; },
      descartarArquivo: () => {},
      imprimir: () => { registro.impressoes += 1; },
    };
  });
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/DENGBR23.dbf');
  await expect(page.locator('#result-table tbody tr').first()).toBeVisible();
  await page.locator('#export-csv-button').click();
  await expect(page.locator('#toast')).toContainText('salvo em Downloads/TabSis');
  const ponte = await page.evaluate(() => (window as unknown as { __ponte: { partes: string[]; concluido: { nome: string; tipo: string; abrir: boolean } } }).__ponte);
  expect(ponte.concluido.nome).toMatch(/\.csv$/);
  expect(ponte.concluido.abrir).toBe(false);
  const csv = Buffer.from(ponte.partes.join(''), 'base64').toString('utf8');
  expect(csv.split('\n').length).toBeGreaterThan(2);
  await page.evaluate(() => window.print());
  expect(await page.evaluate(() => (window as unknown as { __ponte: { impressoes: number } }).__ponte.impressoes)).toBe(1);
  // No app, a área de abrir ensina a marcar vários arquivos no seletor do Android.
  await expect(page.locator('.drop-zone-dica')).toContainText('toque e segure');
});

test('TabSis Local: o link do app conecta sozinho, os guardados vão para a pasta e reabrem dela', async ({ page }) => {
  test.setTimeout(90_000);
  const { spawn } = await import('node:child_process');
  const { mkdtempSync, readFileSync, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { zipSync } = await import('fflate');
  const pasta = mkdtempSync(join(tmpdir(), 'tabsis-local-'));
  const app = spawn('python3', ['apps/desktop/tabsis_local.py', '--sem-janela', '--porta', '0', '--pasta', pasta]);
  try {
    const ligacao = await new Promise<string>((resolve, reject) => {
      let saida = '';
      app.stdout.on('data', (pedaco) => {
        saida += String(pedaco);
        const achado = /#local=(\S+:\d+)/.exec(saida);
        if (achado) resolve(achado[1]!);
      });
      app.on('exit', (codigo) => reject(new Error(`o app saiu (${codigo}): ${saida}`)));
    });
    await page.goto('/');
    await page.evaluate(async (bytes) => {
      const mod = await import('/src/archive-cache.ts');
      await mod.writeCachedArchive('official-v1:DENGBR24', new Uint8Array(bytes), {
        sha256: '24'.repeat(32), role: 'data',
        sources: [{ name: 'DENGBR24.dbf', address: 'ftp://ftp.datasus.gov.br/dissemin/publicos/SINAN/DADOS/FINAIS/DENGBR24.dbc', source: 'SINAN', modality: 'Dados' }],
      });
    }, [...zipSync({ 'DENGBR24.dbf': new Uint8Array(readFileSync('e2e/fixtures/DENGBR24.dbf')) })]);
    // Como o botão "Abrir o TabSis conectado" do app abre a página.
    await page.goto(`/#local=${ligacao}`);
    await expect(page.locator('#toast')).toContainText('Conectado ao TabSis Local');
    expect(new URL(page.url()).hash).toBe('');
    await page.locator('#catalog-button').click();
    await page.locator('#catalog-recent-send-local').click();
    await expect(page.locator('#catalog-status')).toContainText('1 arquivo(s) copiados');
    expect(existsSync(join(pasta, 'Guardados do navegador', 'DENGBR24.dbf'))).toBe(true);
    const item = page.locator('#catalog-local-list .catalog-recent-item').filter({ hasText: 'DENGBR24.dbf' });
    await expect(item).toBeVisible();
    await item.getByRole('button', { name: 'Abrir', exact: true }).click();
    await expect(page.locator('#result-table tbody tr').first()).toBeVisible();
    await expect(page.locator('#result-kicker')).toContainText('DENGBR24.dbf');
  } finally {
    app.kill();
  }
});

test('TabSis Local do app Android: liga sozinho pela ponte, guarda em Downloads/TabSis e reabre de lá', async ({ page }) => {
  const { readFileSync } = await import('node:fs');
  const { zipSync } = await import('fflate');
  // A ponte do app (LocalAndroid.java), simulada: a pasta é um objeto na página.
  await page.addInitScript(() => {
    const pasta: Record<string, number> = {};
    const partes: Record<string, string[]> = {};
    (window as unknown as { TabSisAndroid: unknown }).TabSisAndroid = {
      localSaude: () => JSON.stringify({ service: 'tabwin-bridge', protocol: 1, app: 'tabsis-android', version: '1.0.5', features: ['ftp', 'guardados', 'arquivos'], directory: 'Downloads/TabSis', allowlist: [] }),
      localPedido: (metodo: string, rota: string) => JSON.stringify(rota === '/arquivos' && metodo === 'GET'
        ? { status: 200, corpo: JSON.stringify({ directory: 'Downloads/TabSis', files: Object.entries(pasta).map(([nome, bytes]) => ({ nome, pasta: 'guardados', bytes, modificado: 1, caminho: `Downloads/TabSis/Guardados do navegador/${nome}` })) }) }
        : { status: 404, corpo: JSON.stringify({ error: 'rota desconhecida' }) }),
      iniciarArquivo: () => { const id = crypto.randomUUID(); partes[id] = []; return id; },
      escreverParte: (id: string, base64: string) => { partes[id]!.push(base64); },
      descartarArquivo: (id: string) => { delete partes[id]; },
      localGuardado: (id: string, nome: string) => {
        pasta[nome] = partes[id]!.reduce((soma, parte) => soma + atob(parte).length, 0);
        return JSON.stringify({ status: 201, corpo: JSON.stringify({ path: `Downloads/TabSis/Guardados do navegador/${nome}`, bytes: pasta[nome], sha256: '0'.repeat(64) }) });
      },
      iniciarArquivoSalvo: () => '', imprimir: () => {},
    };
  });
  const dbf = readFileSync('e2e/fixtures/DENGBR24.dbf');
  await page.route('**/__local/arquivo**', (route) => route.fulfill({ contentType: 'application/octet-stream', body: dbf }));
  await page.goto('/');
  await page.evaluate(async (bytes) => {
    const mod = await import('/src/archive-cache.ts');
    await mod.writeCachedArchive('official-v1:DENGBR24', new Uint8Array(bytes), {
      sha256: '24'.repeat(32), role: 'data',
      sources: [{ name: 'DENGBR24.dbf', address: 'ftp://ftp.datasus.gov.br/dissemin/publicos/SINAN/DADOS/FINAIS/DENGBR24.dbc', source: 'SINAN', modality: 'Dados' }],
    });
  }, [...zipSync({ 'DENGBR24.dbf': new Uint8Array(dbf) })]);
  await page.reload();
  await page.locator('#catalog-button').click();
  // Sem token para colar: o app se apresenta, e as frases falam do aparelho.
  await expect(page.locator('#bridge-verdict')).toContainText('conectado');
  await expect(page.locator('#catalog-recent-send-local')).toContainText('para o aparelho');
  await page.locator('#catalog-recent-send-local').click();
  await expect(page.locator('#catalog-status')).toContainText('1 arquivo(s) copiados para Downloads/TabSis');
  await expect(page.locator('#catalog-local .eyebrow')).toHaveText('No aparelho · TabSis Local');
  const item = page.locator('#catalog-local-list .catalog-recent-item').filter({ hasText: 'DENGBR24.dbf' });
  await expect(item).toBeVisible();
  await item.getByRole('button', { name: 'Abrir', exact: true }).click();
  await expect(page.locator('#result-table tbody tr').first()).toBeVisible();
  await expect(page.locator('#result-kicker')).toContainText('DENGBR24.dbf');
});

test('um .TAB salvo pelo TabWin 4.15 abre aqui, somente para leitura', async ({ page }) => {
  // O leitor era provado contra o golden G023 e não estava ligado: a
  // biblioteca lia o formato, o aplicativo não abria o arquivo. Esta fixture é
  // o próprio golden — o .TAB que o TabWin gravou.
  await page.goto('/');
  await openSidebarGroup(page, 'saved');
  await page.locator('#table-input').setInputFiles('e2e/fixtures/tabwin-legado.tab');

  const body = page.locator('#result-table tbody');
  await expect(body).toContainText('Média complexidade');
  await expect(body).toContainText('1.968');
  await expect(body).toContainText('Alta complexidade');

  // O título vem do próprio arquivo, não é inventado.
  await expect(page.locator('#result-title')).toContainText('Complexidade do Procedimento');
  // E a procedência que o arquivo declara é mostrada sem tradução.
  const origin = page.locator('#legacy-tab-origin');
  await expect(origin).toBeVisible();
  await expect(origin).toContainText('RD2008.DEF');
  await expect(origin).toContainText('Não_Classificados');

  // É leitura, não reexecução: sem microdados, não há o que salvar como receita.
  await expect(page.locator('#save-recipe-button')).toBeDisabled();
  await expect(page.locator('#save-table-button')).toBeEnabled();
});


test('a busca mostra o que já achou, sem esperar o lote inteiro', async ({ page }) => {
  // O defeito relatado: com muitas combinações num servidor lento, os arquivos
  // "só apareciam quando você cancelava" — porque cancelar era a única forma de
  // o lote devolver o parcial. Quem via isso concluía que a busca não
  // funcionava, e desistia.
  let respondidas = 0;
  // O padrão precisa casar com os ENDPOINTS, não com qualquer URL que contenha
  // "catalog". Em desenvolvimento o Vite serve cada módulo pelo caminho, e um
  // regex solto passou a interceptar `src/catalog-memory-store.ts` — a busca
  // recebia JSON no lugar de JavaScript e o app nem carregava.
  await page.route(/\/catalog(\?|$)|wp-content\/ftp\.php/, async (route) => {
    respondidas++;
    // A primeira responde na hora; as seguintes demoram, como o DATASUS ruim.
    if (respondidas > 1) await new Promise((resolve) => setTimeout(resolve, 4000));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify([{
        arquivo: `ACHADO${respondidas}.dbc`,
        endereco: 'ftp://ftp.datasus.gov.br/dissemin/publicos/SINAN/DADOS/FINAIS/X.dbc',
        fonte: 'SINAN',
        modalidade: 'Dados - Finais',
      }]),
    });
  });

  await page.goto('/');
  await page.locator('#catalog-button').click();
  await page.locator('#catalog-system').selectOption('SINAN');
  await page.locator('#catalog-file-type').selectOption('DENG');
  await page.locator('#catalog-year').selectOption(['2024', '2023', '2022', '2021']);
  await page.locator('#catalog-form').evaluate((form: HTMLFormElement) => form.requestSubmit());

  // Enquanto o lote ainda roda, a tela já diz o que encontrou até agora.
  const parcial = page.locator('#catalog-results').getByText(/encontrado\(s\) até agora/);
  await expect(parcial).toBeVisible({ timeout: 8000 });
  await expect(parcial).toContainText('de 4');

  // E ninguém precisou cancelar para ver.
  await expect(page.locator('#catalog-cancel-button')).toBeEnabled();
});

test('aconselha o arquivo nacional quando várias UFs foram marcadas', async ({ page }) => {
  // O caso que custou vinte minutos de espera: no SINASC, "todas as UFs" em
  // vários anos são centenas de downloads quando o arquivo nacional do mesmo
  // ano já traz as 27 — e a UF vira um filtro depois de abrir. A dica já
  // existia na tela, mas só aparecia para quem já tinha escolhido o nacional.
  await page.goto('/');
  await page.locator('#catalog-button').click();
  await page.locator('#catalog-system').selectOption('SINASC');
  await page.locator('#catalog-file-type').selectOption('DN');

  const conselho = page.locator('#catalog-national-advice');
  await page.locator('#catalog-year').selectOption(['2022', '2021']);

  // Duas UFs ainda podem ser deliberadas e baratas: aviso que aparece sempre
  // vira ruído e some da atenção junto com os que importam.
  await page.locator('#catalog-uf').selectOption(['SP', 'RJ']);
  await expect(conselho).toBeHidden();

  await page.locator('#catalog-uf').selectOption(['SP', 'RJ', 'MG', 'BA']);
  await expect(conselho).toBeVisible();
  await expect(conselho).toContainText('4 UFs');
  await expect(conselho).toContainText('2 download(s) em vez de 8');

  // E resolver o conselho é um clique, não uma lição de casa.
  await page.locator('#catalog-use-national').click();
  await expect(page.locator('#catalog-uf')).toHaveValue('BR');
  await expect(conselho).toBeHidden();
  // Os anos escolhidos continuam de pé: o botão troca a geografia, nada mais.
  const anos = await page.locator('#catalog-year').evaluate(
    (el: HTMLSelectElement) => [...el.selectedOptions].map((option) => option.value));
  expect(anos).toEqual(['2022', '2021']);
});

test('uma seleção enorme pede confirmação antes de começar a espera', async ({ page }) => {
  // Uma busca de centenas de combinações pode ser exatamente o que a pessoa
  // quer. O que não pode é a espera começar sem ela ter visto o tamanho.
  let consultas = 0;
  await page.route('**/wp-content/ftp.php', async (route) => {
    consultas += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: '[]',
    });
  });

  await page.goto('/');
  await page.locator('#catalog-button').click();
  await page.locator('#catalog-system').selectOption('SINASC');
  await page.locator('#catalog-file-type').selectOption('DN');
  // Oito anos por 28 opções de geografia passam do limite de 200 sem precisar
  // de mil requisições falsas para provar o ponto.
  await page.locator('#catalog-year').selectOption(
    ['2024', '2023', '2022', '2021', '2020', '2019', '2018', '2017']);
  await page.locator('#catalog-uf-all').click();

  // O resumo diz o tamanho antes mesmo de clicar em procurar.
  await expect(page.locator('#catalog-capabilities')).toContainText('só para consultar');

  const perguntas: string[] = [];
  // Registrar um ouvinte desliga a recusa automática do Playwright: quem escuta
  // precisa responder, senão o diálogo fica aberto e trava a página.
  page.on('dialog', (dialog) => { perguntas.push(dialog.message()); void dialog.dismiss(); });
  await page.locator('#catalog-form').evaluate((form: HTMLFormElement) => form.requestSubmit());

  await expect(page.locator('#catalog-status')).toContainText('Busca não iniciada');
  expect(perguntas.join('\n')).toMatch(/combinação\(ões\)/);
  // E recusar significa recusar: nenhuma ida ao servidor foi disparada.
  expect(consultas).toBe(0);

  // Confirmar também precisa funcionar: a seleção grande pode ser exatamente a
  // série que a pessoa quer, e o aviso não pode virar um bloqueio.
  //
  // A seleção muda de propósito. Repetir a anterior seria servido da memória
  // do catálogo, e o teste passaria a medir o cache em vez da confirmação.
  await page.locator('#catalog-year').selectOption(
    ['2016', '2015', '2014', '2013', '2012', '2011', '2010', '2009']);
  page.removeAllListeners('dialog');
  page.on('dialog', (dialog) => { void dialog.accept(); });
  await page.locator('#catalog-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  // Espera ativa: a submissão passa por uma leitura assíncrona da memória
  // antes de tocar a rede, e conferir na hora media a corrida, não o efeito.
  await expect.poll(() => consultas, { timeout: 60_000 }).toBeGreaterThan(0);
});

test('preparo demorado dá sinal de vida, em vez de parecer travado', async ({ page }) => {
  // O DATASUS leva 11 a 13 segundos montando o pacote, e com retentativa passa
  // de 90 — que é o prazo do vigia de parada. O vigia mede tempo SEM sinal de
  // atividade, então o preparo silencioso era indistinguível de uma travada:
  // ele matava um download em pé, e a pessoa pagava 105 MB de novo.
  const { zipSync, strToU8 } = await import('fflate');
  const pacote = Buffer.from(zipSync({ 'DNBR1997.dbc': strToU8('microdado-de-teste') }, { level: 0 }));

  await page.route('**/wp-content/ftp.php', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify([{
      arquivo: 'DNBR1997.dbc',
      endereco: 'ftp://ftp.datasus.gov.br/dissemin/publicos/SINASC/NOV/DNRES/DNBR1997.dbc',
      fonte: 'SINASC',
      modalidade: 'Dados',
    }]),
  }));

  // O preparo demora, como o de verdade demora.
  await page.route('**/wp-content/download.php', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3500));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(['https://datasus.saude.gov.br/wp-content/zipupload/Arq_1/arquivo.zip']),
    });
  });
  await page.route('**/zipupload/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/zip',
    headers: { 'access-control-allow-origin': '*', 'accept-ranges': 'none' },
    body: pacote,
  }));

  await page.goto('/');
  await page.locator('#catalog-button').click();
  await page.locator('#catalog-system').selectOption('SINASC');
  await page.locator('#catalog-file-type').selectOption('DN');
  await page.locator('#catalog-year').selectOption(['1997']);
  await page.locator('#catalog-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await page.locator('.catalog-result').first().waitFor();

  // O pedido do pacote é evidência durável de que o preparo deu lugar ao
  // download. O texto "Baixando" some rápido demais numa máquina veloz, e
  // asserir sobre ele seria uma corrida, não um teste.
  const pacotePedido = page.waitForRequest(/zipupload/, { timeout: 25_000 });
  await page.locator('.catalog-result button', { hasText: 'Baixar e abrir' }).click();

  // Enquanto o preparo corre, a tela precisa dizer que ele corre — e o
  // contador é o que prova que a operação está viva, não só "demorando".
  const status = page.locator('#catalog-status');
  await expect(status).toContainText('preparando o pacote', { timeout: 3000 });
  const primeiro = await status.textContent();
  await expect(status).not.toHaveText(primeiro ?? '', { timeout: 3000 });

  // E o preparo dá lugar ao download, sem falso alarme de travamento. O
  // conteúdo aqui não é um DBC de verdade e não vai abrir — o que este teste
  // prova é que a espera não é confundida com travamento.
  await pacotePedido;
  await expect(status).not.toContainText('parou de progredir');
});

test('auxiliares fora do ar não derrubam o download: o arquivo abre e o aviso diz por quê', async ({ page }) => {
  // 2026-10-27, no app Android: com "Carregar auxiliares" marcada, a lista de
  // pacotes auxiliares vem do portal, que respondia 520 — e isso derrubava
  // "Baixar e combinar" inteiro, mesmo com os dados disponíveis.
  const { zipSync } = await import('fflate');
  const { readFileSync } = await import('node:fs');
  const pacote = Buffer.from(zipSync({ 'BOTUBR24.dbf': new Uint8Array(readFileSync('e2e/fixtures/DENGBR24.dbf')) }, { level: 0 }));
  await page.route('**/wp-content/ftp.php', async (route) => {
    const corpo = route.request().postData() ?? '';
    if (corpo.includes('AUX')) {
      await route.fulfill({ status: 520, headers: { 'access-control-allow-origin': '*' }, body: '' });
      return;
    }
    await route.fulfill({
      status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify([{ arquivo: 'BOTUBR24.dbc', endereco: 'ftp://ftp.datasus.gov.br/dissemin/publicos/SINAN/DADOS/FINAIS/BOTUBR24.dbc', fonte: 'SINAN', modalidade: 'Dados' }]),
    });
  });
  await page.route('**/wp-content/download.php', (route) => route.fulfill({
    status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(['https://datasus.saude.gov.br/wp-content/zipupload/Arq_1/arquivo.zip']),
  }));
  await page.route('**/zipupload/**', (route) => route.fulfill({
    status: 200, contentType: 'application/zip', headers: { 'access-control-allow-origin': '*', 'accept-ranges': 'none' }, body: pacote,
  }));
  await page.goto('/');
  await page.locator('#catalog-button').click();
  await page.locator('#catalog-system').selectOption('SINAN');
  await page.locator('#catalog-file-type').selectOption('BOTU');
  await page.locator('#catalog-year').selectOption(['2024']);
  await expect(page.locator('#catalog-auxiliary')).toBeChecked();
  await page.locator('#catalog-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await page.locator('.catalog-result button', { hasText: 'Baixar e abrir' }).click();
  await expect(page.locator('#result-table tbody tr').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#result-kicker')).toContainText('BOTUBR24');
  await expect(page.locator('.catalog-result', { hasText: 'falhou no navegador' })).toHaveCount(0);
});

test('o .dbc pode ser salvo direto do resultado da busca, sem abrir', async ({ page }) => {
  // "Baixar e abrir" serve para tabular aqui. Quem vai levar o arquivo para o
  // R, para o Python ou para outra máquina não precisa que o navegador monte
  // uma tabulação antes — e num arquivo de 120 MB essa etapa é a que pesa.
  const { zipSync, strToU8 } = await import('fflate');
  const pacote = Buffer.from(zipSync({ 'DNBR1997.dbc': strToU8('microdado-de-teste') }, { level: 0 }));

  await page.route('**/wp-content/ftp.php', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify([{
      arquivo: 'DNBR1997.dbc',
      endereco: 'ftp://ftp.datasus.gov.br/dissemin/publicos/SINASC/NOV/DNRES/DNBR1997.dbc',
      fonte: 'SINASC',
      modalidade: 'Dados',
    }]),
  }));
  await page.route('**/wp-content/download.php', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    // A resposta real é um ARRAY de strings; um objeto passa despercebido pelo
    // coletor e o download nem chega a começar.
    body: JSON.stringify(['https://datasus.saude.gov.br/wp-content/zipupload/Arq_1/arquivo.zip']),
  }));
  await page.route('**/zipupload/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/zip',
    headers: { 'access-control-allow-origin': '*', 'accept-ranges': 'none' },
    body: pacote,
  }));

  await page.goto('/');
  await page.locator('#catalog-button').click();
  await page.locator('#catalog-system').selectOption('SINASC');
  await page.locator('#catalog-file-type').selectOption('DN');
  await page.locator('#catalog-year').selectOption(['1997']);
  await page.locator('#catalog-form').evaluate((form: HTMLFormElement) => form.requestSubmit());

  const salvar = page.getByRole('button', { name: 'Salvar .dbc' });
  await expect(salvar).toBeVisible();
  const baixando = page.waitForEvent('download');
  await salvar.click();
  const arquivo = await baixando;
  // Sai o .dbc de dentro do pacote, não o .zip como veio da rede.
  expect(arquivo.suggestedFilename()).toBe('DNBR1997.dbc');

  // E nenhuma tabulação foi montada: salvar não é abrir.
  await expect(page.locator('#result-table tbody tr')).toHaveCount(0);
});

test('a segunda busca não repete as viagens que já foram respondidas', async ({ page }) => {
  // No caso real, 48 combinações para trazer 30 arquivos: 17 viagens completas
  // ao servidor existiram só para descobrir que um arquivo de 1981 não foi
  // publicado. E na busca seguinte tudo se repetia.
  let consultas = 0;
  await page.route('**/wp-content/ftp.php', async (route) => {
    consultas += 1;
    const corpo = route.request().postData() ?? '';
    // Só 1996 existe; os demais anos respondem vazio, como o DATASUS faz.
    const existe = corpo.includes('1996');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: existe
        ? JSON.stringify([{
          arquivo: 'DNBR1996.dbc',
          endereco: 'ftp://ftp.datasus.gov.br/dissemin/publicos/SINASC/NOV/DNRES/DNBR1996.dbc',
          fonte: 'SINASC',
          modalidade: 'Dados',
        }])
        : '[]',
    });
  });

  await page.goto('/');
  await page.locator('#catalog-button').click();
  await page.locator('#catalog-system').selectOption('SINASC');
  await page.locator('#catalog-file-type').selectOption('DN');
  const anos = ['1996', '1997', '1998', '1999'];
  await page.locator('#catalog-year').selectOption(anos);
  await page.locator('#catalog-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#catalog-results')).toContainText('DNBR1996.dbc');

  const primeira = consultas;
  expect(primeira).toBe(anos.length);

  // Segunda busca idêntica: nada precisa ir ao servidor de novo.
  await page.locator('#catalog-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#catalog-results')).toContainText('vieram de consultas anteriores');
  expect(consultas).toBe(primeira);
  // O arquivo encontrado continua listado, vindo da memória.
  await expect(page.locator('#catalog-results')).toContainText('DNBR1996.dbc');

  // E "Consultar de novo" ignora o que está guardado, como promete.
  await page.getByRole('button', { name: 'Consultar de novo' }).click();
  await expect(page.locator('#catalog-results')).toContainText('DNBR1996.dbc');
  expect(consultas).toBe(primeira * 2);
});

test('a lista de combinações aparece antes das respostas, e cada linha se resolve', async ({ page }) => {
  // Quem quer o arquivo de 1996 não deveria esperar 2026, 2025 e 2024
  // responderem para saber que ele existe.
  let liberar;
  const segura = new Promise((resolve) => { liberar = resolve; });
  await page.route(/\/catalog(\?|$)|wp-content\/ftp\.php/, async (route) => {
    const corpo = route.request().postData() ?? '';
    // 1996 responde na hora; os demais só depois que o teste mandar.
    if (!corpo.includes('1996')) await segura;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: corpo.includes('1996')
        ? JSON.stringify([{
          arquivo: 'DNBR1996.dbc',
          endereco: 'ftp://ftp.datasus.gov.br/x/DNBR1996.dbc',
          fonte: 'SINASC',
          modalidade: 'Dados',
        }])
        : '[]',
    });
  });

  await page.goto('/');
  await page.locator('#catalog-button').click();
  await page.locator('#catalog-system').selectOption('SINASC');
  await page.locator('#catalog-file-type').selectOption('DN');
  await page.locator('#catalog-year').selectOption(['1996', '1997', '1998', '1999']);
  await page.locator('#catalog-form').evaluate((form: HTMLFormElement) => form.requestSubmit());

  // As quatro linhas existem antes de qualquer resposta.
  const linhas = page.locator('.catalog-pending-row');
  await expect(linhas).toHaveCount(4);
  // E a de 1996 já se resolveu, com as outras ainda pendentes.
  await expect(page.locator('.catalog-pending-row.achou')).toContainText('DNBR1996.dbc');
  await expect(page.locator('.catalog-pending-row').filter({ hasText: 'verificando' }))
    .toHaveCount(3);

  liberar();
  await expect(page.locator('#catalog-results')).toContainText('DNBR1996.dbc');
  // A lista provisória sai quando o resultado definitivo entra.
  await expect(linhas).toHaveCount(0);
});

test('o cache guarda os mais recentes e descarta os antigos sem carregá-los', async ({ page }) => {
  // A eviction nunca teve teste, e o código que ela substitui usava `getAll()`
  // — trazia os BYTES de todo pacote em cache só para ordenar por data, logo
  // depois de o navegador já ter na memória o arquivo recém-baixado.
  //
  // Desde o TabSis o limite principal é em BYTES (cota do navegador, ver
  // packages/acquisition/src/cache-policy.ts); pacotes minúsculos como estes
  // só esbarram no teto de quantidade, que é doze.
  const { zipSync, strToU8 } = await import('fflate');
  await page.route('**/wp-content/ftp.php', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' }, body: '[]',
  }));
  await page.goto('/');

  const pacote = [...zipSync({ 'X.dbc': strToU8('conteudo') })];
  const resultado = await page.evaluate(async (bytes) => {
    const mod = await import('/src/archive-cache.ts');
    for (let i = 1; i <= 14; i++) {
      await mod.writeCachedArchive(`official-v1:pacote-${String(i).padStart(2, '0')}`, new Uint8Array(bytes), {
        sha256: String(i % 10).repeat(64),
        role: 'data',
        sources: [{ name: `P${i}.dbc`, address: 'ftp://x', source: 'SINAN', modality: 'Dados' }],
      });
      // Datas distintas: escritos no mesmo milissegundo empatariam a ordenação.
      await new Promise((r) => setTimeout(r, 4));
    }
    const guardados = await mod.listCachedArchives();
    return guardados.map((s) => s.key);
  }, pacote);

  expect(resultado).toHaveLength(12);
  // Os dois mais antigos saíram; os doze mais novos ficaram, do novo para o velho.
  expect(resultado).toEqual(Array.from({ length: 12 }, (_, i) => `official-v1:pacote-${String(14 - i).padStart(2, '0')}`));
});

test('a consulta SQL responde sobre os dados abertos, sem tocar no motor de tabulação', async ({ page }) => {
  // O DuckDB é superfície de ANÁLISE. A tabela do TabWin continua saindo do
  // executor de referência; aqui é para perguntas que o plano não expressa.
  test.setTimeout(180_000);
  const erros: string[] = [];
  page.on('pageerror', (e) => erros.push(String(e)));
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/microdados-e2e.csv');
  await expect(page.locator('#result-table tbody tr').first()).toBeVisible();

  await page.getByRole('button', { name: 'Consulta' }).click();
  // Ao abrir um arquivo a aba já diz quais campos existem e se cabem, antes de
  // qualquer carga. Um limite descoberto depois de materializar centenas de
  // milhares de linhas seria descoberto tarde demais.
  await expect(page.locator('#query-status')).toContainText('campo(s) disponíveis');
  await expect(page.locator('#query-fields option')).toHaveCount(3);
  await expect(page.locator('#query-fields option:checked')).toHaveCount(3);
  // Executar tem que estar desligado enquanto não há tabela.
  await expect(page.locator('#query-run')).toBeDisabled();

  await page.getByRole('button', { name: 'Carregar os dados abertos' }).click();
  // O motor são ~7 MB de WebAssembly; a primeira carga leva tempo de verdade.
  await expect(page.locator('#query-status')).toContainText('pronta com', { timeout: 150_000 });
  await expect(page.locator('#query-run')).toBeEnabled();

  // O nome da tabela sai do nome do arquivo normalizado; ler do status evita
  // o teste adivinhar e falhar por um hifen virar sublinhado.
  const status = await page.locator('#query-status').textContent();
  // Segunda palavra do status: "Tabela <nome> pronta com …". Sem regex de
  // propósito — o nome do arquivo é normalizado (hífen vira sublinhado) e
  // adivinhá-lo no teste já falhou uma vez.
  const tabela = (status ?? '').split(' ')[1];
  expect(tabela).toBeTruthy();
  await page.locator('#query-sql').fill(`SELECT COUNT(*) AS total FROM "${tabela}"`);
  await page.locator('#query-run').click();
  await expect(page.locator('#query-result')).toContainText('total');
  await expect(page.locator('#query-status')).toContainText('linha(s) em');
  expect(erros.join(' | ')).toBe('');
});

test('o topo leva ao manual, e ao Lab só quando ele está publicado', async ({ page }) => {
  await page.goto('/');

  const manual = page.locator('.topbar-links a[href="./manual.html"]');
  await expect(manual).toBeVisible();
  await expect(manual).toHaveText('Manual');

  // O Lab está publicado em `/lab/`, então o link aparece.
  const lab = page.locator('#lab-link');
  await expect(lab).toBeVisible();
  await expect(lab).toHaveAttribute('href', './lab/');

  // Sem o Lab publicado, o link some. Não basta o 404: um servidor com rota de
  // fallback devolve o index.html com status 200 para qualquer caminho, e quem
  // checar só o status oferece um link para lugar nenhum. Os dois casos.
  for (const resposta of [
    { status: 404, contentType: 'text/plain', body: 'nao encontrado' },
    { status: 200, contentType: 'text/html', body: '<!doctype html><html></html>' },
  ]) {
    await page.route('**/lab/ORIGEM.json', (route) => route.fulfill(resposta));
    await page.reload();
    await expect(page.locator('#lab-link'), `resposta ${resposta.status} ${resposta.contentType}`).toBeHidden();
    await page.unroute('**/lab/ORIGEM.json');
  }
});

test('o manual publicado abre com as figuras que ele cita', async ({ page }) => {
  // `vite dev` serve `public/`, mas o manual é gerado no build. O teste checa o
  // artefato construído, que é o que a pessoa realmente abre.
  const html = await import('node:fs').then((fs) => fs.promises.readFile('dist-web/manual.html', 'utf8'))
    .catch(() => null);
  test.skip(html === null, 'manual.html só existe depois de npm run web:build');

  const citadas = [...html!.matchAll(/<img src="\.\/manual\/([^"]+)"/g)].map((m) => m[1]);
  expect(citadas.length).toBeGreaterThan(0);

  const fs2 = await import('node:fs');
  for (const nome of new Set(citadas)) {
    expect(fs2.existsSync(`dist-web/manual/${nome}`), `falta dist-web/manual/${nome}`).toBe(true);
  }

  // Toda figura precisa de alt: quem usa leitor de tela recebe a descrição, e
  // quem está com a imagem quebrada ao menos sabe o que deveria estar ali.
  const semAlt = [...html!.matchAll(/<img src="\.\/manual\/[^"]+" alt="(.*?)"/g)]
    .filter((m) => !m[1].trim()).length;
  expect(semAlt, 'há figura sem texto alternativo').toBe(0);
});

test('o painel de tabulação monta a tabela como o TabWin: Linhas, Colunas, Incremento e Seleções', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles([
    'e2e/fixtures/painel-e2e.def',
    'e2e/fixtures/uf-e2e.cnv',
    'e2e/fixtures/sexo-e2e.cnv',
    'e2e/fixtures/raca-e2e.cnv',
    'e2e/fixtures/painel-e2e.csv',
  ]);
  const painel = page.locator('#painel');
  await expect(painel).toBeVisible();

  // As listas vêm do DEF, na ordem do arquivo; X entra nas três.
  const textos = (id: string) => page.locator(`#${id} option`).allTextContents();
  await expect.poll(() => textos('painel-linhas')).toEqual(['UF de residência', 'Sexo', 'Raça']);
  expect(await textos('painel-colunas')).toEqual(['Não ativa', 'UF de residência', 'Sexo']);
  expect(await textos('painel-selecoes-disponiveis')).toEqual(['UF de residência', 'Sexo']);

  // A tabela que abre sozinha é a do TabWin: primeira Linha, Frequência.
  await expect(page.locator('#result-title')).toContainText('segundo UF de residência');
  const corpo = page.locator('#result-table tbody');
  await expect(corpo).toContainText('Acre');

  // Sexo × UF.
  await page.locator('#painel-linhas').selectOption({ label: 'Sexo' });
  await page.locator('#painel-colunas').selectOption({ label: 'UF de residência' });
  await expect(page.locator('#painel-resumo')).toContainText('por UF de residência segundo Sexo');
  await page.locator('#painel-executar').click();
  await expect(page.locator('#result-table thead')).toContainText('Total');
  await expect(corpo.locator('tr').first()).toContainText('Masculino');
  await expect(corpo.locator('tr').first()).toContainText('3');

  // Coluna com dois incrementos: o TabWin recusa, com estas palavras.
  await page.locator('#painel-incrementos input[value^="inc:"]').check();
  await page.locator('#painel-executar').click();
  await expect(page.locator('#painel-erro')).toHaveText('Múltiplas colunas é incompatível com múltiplos incrementos');

  // Só Casos, sem coluna, e só o Acre.
  await page.locator('#painel-incrementos input[value="freq"]').uncheck();
  await page.locator('#painel-colunas').selectOption({ label: 'Não ativa' });
  await page.locator('#painel-selecoes-disponiveis').selectOption({ label: 'UF de residência' });
  await page.locator('#painel-incluir').click();
  await page.locator('#painel-executar').click();
  await expect(page.locator('#painel-erro')).toHaveText('Nenhuma categoria selecionada em UF de residência');
  await page.locator('#painel-categorias label', { hasText: 'Acre' }).locator('input').check();
  await page.locator('#painel-executar').click();
  await expect(page.locator('#painel-erro')).toBeHidden();
  await expect(corpo.locator('tr', { hasText: 'Masculino' })).toContainText('2');
  await expect(corpo.locator('tr', { hasText: 'Feminino' })).toContainText('6');

  // O log sai no formato do TabWin.
  await page.locator('#painel-log-detalhes > summary').click();
  const log = page.locator('#painel-log');
  await expect(log).toHaveValue(/Linha=Sexo/);
  await expect(log).toHaveValue(/Incremento=Casos/);
  await expect(log).toHaveValue(/UF de residência: Acre/);

  // Discriminar em CNV literal: um código por linha, na ordem em que aparecem.
  await page.locator('#painel-selecoes-ativas').selectOption({ label: 'UF de residência (1)' });
  await page.locator('#painel-excluir').click();
  await page.locator('#painel-incrementos input[value="freq"]').check();
  await page.locator('#painel-incrementos input[value^="inc:"]').uncheck();
  await page.locator('#painel-linhas').selectOption({ label: 'Raça' });
  await page.locator('#painel-nc-discriminar').check();
  await page.locator('#painel-executar').click();
  await expect.poll(() => corpo.locator('tr th').allTextContents()).toEqual(['Branca', 'Parda', '04', '99']);

  // Restaurar consulta a partir de um log colado.
  await log.fill([
    '[Opções]', 'Linha=Sexo', 'Coluna=UF de residência', 'Incremento=Freqüência',
    'Suprime_Linhas_Zeradas=true', 'Suprime_Colunas_Zeradas=true', 'Não_Classificados=0',
  ].join('\n'));
  await page.locator('#painel-restaurar').click();
  await expect(page.locator('#painel-linhas')).toHaveValue(/def:/);
  expect(await page.locator('#painel-linhas option:checked').textContent()).toBe('Sexo');
  expect(await page.locator('#painel-colunas option:checked').textContent()).toBe('UF de residência');
});

test('painel: Seleções que não deixam nenhuma coluna com valor dão a coluna DUMMY do TabWin e um aviso', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles([
    'e2e/fixtures/painel-e2e.def', 'e2e/fixtures/uf-e2e.cnv', 'e2e/fixtures/sexo-e2e.cnv',
    'e2e/fixtures/raca-e2e.cnv', 'e2e/fixtures/painel-e2e.csv',
  ]);
  await expect(page.locator('#painel')).toBeVisible();
  await page.locator('#painel-linhas').selectOption({ label: 'Raça' });
  await page.locator('#painel-colunas').selectOption({ label: 'UF de residência' });
  // Amazonas só tem Masculino: Feminino no Amazonas não pega nenhum registro.
  for (const [eixo, categoria] of [['UF de residência', 'Amazonas'], ['Sexo', 'Feminino']]) {
    await page.locator('#painel-selecoes-disponiveis').selectOption({ label: eixo });
    await page.locator('#painel-incluir').click();
    await page.locator('#painel-categorias label', { hasText: categoria }).locator('input').check();
  }
  await page.locator('#painel-executar').click();
  await expect(page.locator('#painel-erro')).toBeHidden();
  await expect(page.locator('#result-table thead')).toContainText('DUMMY');
  await expect(page.locator('#table-headline')).toContainText('nenhum registro selecionado');
});

test('o mapa abre no Brasil, o clique desce ao estado e o botão volta', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/mapa-foco-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();
  // A variável de linha é SEXO, que não é geográfica: o mapa acha o município sozinho.
  await page.locator('#row-field').selectOption('SEXO');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#result-table tbody')).toBeVisible();

  await page.locator('[data-view="map"]').click();
  await expect(page.locator('#map-focus-trail')).toHaveText('Brasil');
  await expect(page.locator('#map-focus-hint')).toContainText('Clique num estado');
  await expect(page.locator('#map-uf')).toHaveValue('');

  await expect(page.locator('#map-legend')).toBeVisible();
  // São Paulo é o estado com 7 registros (o do arquivo): acha-o varrendo o canvas pelo mesmo teste de ponto que o clique usa.
  const alvo = await page.evaluate(async () => {
    const canvas = document.querySelector<HTMLCanvasElement>('#map-canvas')!;
    const tooltip = document.querySelector<HTMLElement>('#map-tooltip')!;
    const box = canvas.getBoundingClientRect();
    for (let y = 0; y < box.height; y += 6) {
      for (let x = 0; x < box.width; x += 6) {
        canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: box.left + x, clientY: box.top + y, bubbles: true }));
        if (!tooltip.hidden && tooltip.textContent?.includes(' · 7 · clique')) return { x, y };
      }
    }
    return null;
  });
  expect(alvo).not.toBeNull();
  await expect(page.locator('#map-tooltip')).toContainText('clique para ver os municípios');

  await page.locator('#map-canvas').click({ position: alvo! });
  await expect(page.locator('#map-focus-trail')).toHaveText('Brasil › São Paulo');
  await expect(page.locator('#map-uf')).toHaveValue('35');
  await expect(page.locator('#map-focus-back')).toBeVisible();

  await page.locator('#map-focus-back').click();
  await expect(page.locator('#map-focus-trail')).toHaveText('Brasil');
  await expect(page.locator('#map-uf')).toHaveValue('');
  await expect(page.locator('#map-focus-back')).toBeHidden();
});

test('vários anos abertos: o mapa troca de ano com a mesma escala e a tabela mostra os nomes dos municípios', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles([
    'e2e/fixtures/DENGBR23.dbf', 'e2e/fixtures/DENGBR24.dbf', 'e2e/fixtures/DENGBR25.dbf',
  ]);
  await expect(page.locator('#run-button')).toBeEnabled();

  // O código do IBGE vira nome do lugar; a chave segue sendo o código.
  await page.locator('#row-field').selectOption('CODMUNRES');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#result-table tbody')).toContainText('Belém (150140)');
  await expect(page.locator('#result-table tbody')).toContainText('São Paulo (355030)');

  await page.locator('[data-view="map"]').click();
  await expect(page.locator('#map-period')).toBeVisible();
  await expect(page.locator('#map-period-status')).toContainText('Mostrando todos os arquivos juntos', { timeout: 20000 });
  // Uma barra por ano, em ordem.
  await expect(page.locator('.map-period-bar')).toHaveCount(3);
  await expect(page.locator('.map-period-bar span')).toHaveText(['2023', '2024', '2025']);

  // Em 2023 o maior valor é 2 (SP), mas a escala é a de todos os anos (máximo 6).
  await page.locator('#map-period-select').selectOption({ label: '2023' });
  await expect(page.locator('#map-period-status')).toContainText('Mostrando 2023');
  await expect(page.locator('.map-period-bar[aria-pressed="true"] span')).toHaveText('2023');
  await expect(page.locator('#map-legend .legend-range')).toContainText('6');

  // O controle deslizante passa de ano em ano.
  await page.locator('#map-period-slider').fill('2');
  await expect(page.locator('#map-period-status')).toContainText('Mostrando 2025');
  await expect(page.locator('.map-period-bar[aria-pressed="true"] span')).toHaveText('2025');

  // Clicar na barra também escolhe o ano.
  await page.locator('.map-period-bar').nth(1).click();
  await expect(page.locator('#map-period-status')).toContainText('Mostrando 2024');
  await expect(page.locator('#map-period-select')).toHaveValue('DENGBR24.dbf');
});

test('variação entre anos: cores divergentes, mesma escala, e o primeiro ano avisa que não tem anterior', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('tabsis.aberto.group-campos', '1'); } catch { /* ignora */ } });
  await page.goto('/');
  await page.locator('#file-input').setInputFiles([
    'e2e/fixtures/DENGBR23.dbf', 'e2e/fixtures/DENGBR24.dbf', 'e2e/fixtures/DENGBR25.dbf',
  ]);
  await expect(page.locator('#run-button')).toBeEnabled();
  await page.locator('#row-field').selectOption('SEXO');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await page.locator('[data-view="map"]').click();
  await expect(page.locator('#map-period-status')).toContainText('Mostrando todos os arquivos juntos', { timeout: 20000 });

  // Sem ano escolhido, pedir variação leva ao último ano.
  await page.locator('#map-variation').selectOption('abs');
  await expect(page.locator('#map-period-select')).toHaveValue('DENGBR25.dbf');
  await expect(page.locator('#map-period-status')).toContainText('diferença de 2024 para 2025');
  await expect(page.locator('#map-legend')).toContainText('Variação em relação a 2024');
  // Maior mudança entre anos consecutivos: SP 2023→2024, +4. A escala é simétrica e igual em todos os anos.
  await expect(page.locator('#map-legend .legend-range')).toContainText('+4');
  await expect(page.locator('#map-legend .legend-range')).toContainText('−4');

  await page.locator('#map-period-slider').fill('1');
  await expect(page.locator('#map-period-status')).toContainText('diferença de 2023 para 2024');
  await expect(page.locator('#map-legend .legend-range')).toContainText('+4');

  // O primeiro ano não tem anterior: o mapa volta aos valores e a faixa explica.
  await page.locator('#map-period-slider').fill('0');
  await expect(page.locator('#map-period-status')).toContainText('primeiro ano');
  await expect(page.locator('#map-legend')).not.toContainText('Variação');

  await page.locator('#map-variation').selectOption('pct');
  await page.locator('#map-period-slider').fill('2');
  await expect(page.locator('#map-period-status')).toContainText('variação percentual de 2024 para 2025');
  await expect(page.locator('#map-legend .legend-range')).toContainText('%');
});

test('modo foco: o clique no município abre o cartão com a posição e a série por ano', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => { try { localStorage.setItem('tabsis.aberto.group-campos', '1'); } catch { /* ignora */ } });
  await page.goto('/');
  await page.locator('#file-input').setInputFiles([
    'e2e/fixtures/DENGBR23.dbf', 'e2e/fixtures/DENGBR24.dbf', 'e2e/fixtures/DENGBR25.dbf',
  ]);
  await expect(page.locator('#run-button')).toBeEnabled();
  await page.locator('#row-field').selectOption('SEXO');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await page.locator('[data-view="map"]').click();
  await expect(page.locator('#map-period-status')).toContainText('Mostrando todos os arquivos juntos', { timeout: 20000 });

  // O mapa conta os três arquivos (e não só o primeiro, lido antes de os outros chegarem).
  await expect(page.locator('#map-uf option[value="35"]')).toHaveText('São Paulo · 12 por município');
  await page.locator('#map-uf').selectOption('35');
  await expect(page.locator('#map-focus-trail')).toHaveText('Brasil › São Paulo');
  // O mapa do estado só existe depois de carregar os municípios dele.
  await expect(page.locator('#map-message')).toContainText('em São Paulo');

  // O município do arquivo em SP é a capital, com 12 registros nos três anos.
  const alvo = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#map-canvas')!;
    const tooltip = document.querySelector<HTMLElement>('#map-tooltip')!;
    const box = canvas.getBoundingClientRect();
    // A capital fica a leste e abaixo do centro do estado; varrer o canvas
    // inteiro, ponto a ponto, custa segundos por causa dos 645 municípios.
    const cx = box.width * 0.62;
    const cy = box.height * 0.62;
    for (let y = Math.max(0, cy - 130); y < Math.min(box.height, cy + 130); y += 3) {
      for (let x = Math.max(0, cx - 160); x < Math.min(box.width, cx + 160); x += 3) {
        canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: box.left + x, clientY: box.top + y, bubbles: true }));
        if (!tooltip.hidden && tooltip.textContent?.includes(' · 12')) return { x, y };
      }
    }
    return null;
  });
  expect(alvo).not.toBeNull();
  await page.locator('#map-canvas').click({ position: alvo! });

  const cartao = page.locator('#map-card');
  await expect(cartao).toBeVisible();
  await expect(cartao).toContainText('São Paulo · São Paulo');
  await expect(cartao).toContainText('12');
  await expect(cartao).toContainText('1º entre 1 áreas com dado');
  // A série tem uma coluna por ano, com o valor do município em cada um.
  await expect(cartao.locator('.map-card-series .map-period-bar span')).toHaveText(['2023 · 2', '2024 · 6', '2025 · 4']);

  // Clicar de novo, ou no ✕, fecha o cartão.
  await cartao.getByRole('button', { name: 'Fechar o cartão' }).click();
  await expect(cartao).toBeHidden();
});

test('tabela por UF_ZI (nome de UF, código de município): o mapa desce do Brasil ao estado mesmo assim', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('tabsis.aberto.group-campos', '1'); } catch { /* ignora */ } });
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/uf-zi-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();
  await page.locator('#row-field').selectOption('UF_ZI');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#result-table tbody')).toContainText('São Paulo (355030)');

  await page.locator('[data-view="map"]').click();
  // Pelo conteúdo (códigos de município), e não pelo nome do campo: o mapa tem dado e a trilha de foco aparece.
  await expect(page.locator('#map-focus-trail')).toHaveText('Brasil');
  await expect(page.locator('#map-legend')).toContainText('3 áreas associadas');
  await expect(page.locator('#map-uf option[value="35"]')).toHaveText('São Paulo · 3 por município');

  await page.locator('#map-uf').selectOption('35');
  await expect(page.locator('#map-focus-trail')).toHaveText('Brasil › São Paulo');
  // No estado, o mapa é municipal: só a capital tem dado.
  await expect(page.locator('#map-legend')).toContainText('1 áreas associadas', { timeout: 15000 });
  await page.locator('#map-focus-back').click();
  await expect(page.locator('#map-focus-trail')).toHaveText('Brasil');
});

test('os fluxos ficam recolhidos e explicam o que são, em português', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/fluxos-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();
  await page.locator('[data-view="map"]').click();
  await expect(page.locator('#flow-panel')).not.toHaveAttribute('open', '');
  await expect(page.locator('#flow-origin')).toBeHidden();
  await page.locator('#flow-panel summary').click();
  await expect(page.locator('.flow-intro')).toContainText('de um lugar a outro');
  await expect(page.locator('#flow-origin')).toBeVisible();
});

test('no estado só aparecem os municípios dele, e o modo clássico mostra todos de uma vez', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('tabsis.aberto.group-campos', '1'); } catch { /* ignora */ } });
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/uf-zi-e2e.csv');
  await expect(page.locator('#run-button')).toBeEnabled();
  await page.locator('#row-field').selectOption('UF_ZI');
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await page.locator('[data-view="map"]').click();
  await expect(page.locator('#map-legend')).toContainText('3 áreas associadas');

  await page.locator('#map-uf').selectOption('35');
  await expect(page.locator('#map-legend')).toContainText('1 áreas associadas', { timeout: 15000 });
  // Fora do estado nada é desenhado: os cantos do canvas ficam só com o fundo (transparente).
  const cantos = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('#map-canvas')!;
    const g = c.getContext('2d')!;
    const w = c.width, h = c.height;
    const alfa = (x: number, y: number) => g.getImageData(x, y, 1, 1).data[3]!;
    return [alfa(4, 4), alfa(w - 5, 4), alfa(4, h - 5), alfa(w - 5, h - 5)];
  });
  expect(cantos).toEqual([0, 0, 0, 0]);

  // Clássico: todos os municípios do Brasil num mapa só, sem descer por estado.
  await page.locator('#map-mode').selectOption('classic');
  await expect(page.locator('#map-legend')).toContainText('3 áreas associadas', { timeout: 15000 });
  await expect(page.locator('#map-uf')).toBeHidden();
  await expect(page.locator('#map-focus-trail')).toBeHidden();
  await page.locator('#map-mode').selectOption('focus');
  await expect(page.locator('#map-focus-trail')).toHaveText('Brasil');
});

test('vários anos de uma vez: selecionar junta, a lista mostra cada ano, o ✕ tira um e o + junta de novo', async ({ page }) => {
  await page.goto('/');
  // Um gesto só, sem caixa nenhuma para marcar antes.
  await page.locator('#file-input').setInputFiles([
    'e2e/fixtures/DENGBR23.dbf', 'e2e/fixtures/DENGBR24.dbf', 'e2e/fixtures/DENGBR25.dbf',
  ]);
  const conjunto = page.locator('#dataset-files');
  await expect(conjunto).toBeVisible();
  await expect(page.locator('#dataset-files-summary')).toHaveText('3 juntos · 2023 a 2025 · 24 registros');
  await expect(page.locator('#dataset-files-list li')).toHaveCount(3);
  await expect(page.locator('#dataset-files-list .dataset-file-periodo')).toHaveText(['2023', '2024', '2025']);

  // Tirar 2024 (9 registros): ficam 2023 e 2025, sem reabrir nada à mão.
  await page.locator('#dataset-files-list li', { hasText: 'DENGBR24.dbf' }).getByRole('button').click();
  await expect(page.locator('#dataset-files-summary')).toHaveText('2 juntos · 2023 a 2025 · 15 registros');
  await expect(page.locator('#dataset-files-list li')).toHaveCount(2);
  await expect(page.locator('#result-table tfoot, #result-table tbody').last()).toContainText('15');

  // Juntar de volta pelo botão.
  await page.locator('#dataset-add-input').setInputFiles('e2e/fixtures/DENGBR24.dbf');
  await expect(page.locator('#dataset-files-summary')).toHaveText('3 juntos · 2023 a 2025 · 24 registros');

  // Com um arquivo só, não há ✕ (não se tira o último).
  await page.locator('#file-input').setInputFiles('e2e/fixtures/DENGBR23.dbf');
  await expect(page.locator('#dataset-files-summary')).toHaveText('1 arquivo · 2023 · 4 registros');
  await expect(page.locator('#dataset-files-list button')).toHaveCount(0);
});

test('Ano em Linhas ou em Colunas: cada arquivo é um período, com série e anos lado a lado', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles([
    'e2e/fixtures/DENGBR23.dbf', 'e2e/fixtures/DENGBR24.dbf', 'e2e/fixtures/DENGBR25.dbf',
  ]);
  await expect(page.locator('#dataset-files-summary')).toContainText('24 registros');

  const linhas = page.locator('#painel-linhas');
  await expect(linhas.locator('option').first()).toHaveText('Ano (um por arquivo aberto)');
  // O Ano não é o começo da tabela: a primeira linha continua sendo um campo do arquivo.
  await expect(linhas).not.toHaveValue('periodo:arquivo');

  // Linhas = Ano: a série ano a ano (4, 9, 11 registros).
  await linhas.selectOption('periodo:arquivo');
  await expect(page.locator('.painel-previa').first()).toContainText('3 linhas: 2023 · 2024 · 2025');
  await page.locator('.painel-executar').click();
  const corpo = page.locator('#result-table tbody');
  await expect(corpo.locator('tr')).toHaveCount(3);
  await expect(corpo.locator('tr').nth(0)).toContainText('2023');
  await expect(corpo.locator('tr').nth(0)).toContainText('4');
  await expect(corpo.locator('tr').nth(1)).toContainText('9');
  await expect(corpo.locator('tr').nth(2)).toContainText('11');
  // O gráfico vira linhas ao longo dos anos.
  await expect(page.locator('#chart-type')).toHaveValue('line');

  // Linhas = município, Colunas = Ano: os anos lado a lado.
  await linhas.selectOption('campo:CODMUNRES');
  await page.locator('#painel-colunas').selectOption('periodo:arquivo');
  await page.locator('.painel-executar').click();
  await expect(page.locator('#result-table thead')).toContainText('2023');
  await expect(page.locator('#result-table thead')).toContainText('2025');
  const sp = corpo.locator('tr', { hasText: 'São Paulo (355030)' });
  await expect(sp).toContainText('2');
  await expect(sp.locator('td')).toHaveText(['2', '6', '4', '12'].map((n) => new RegExp(`^\\s*${n}\\s*$`)));
  // Com os anos em colunas: barras verticais, um ano ao lado do outro.
  await expect(page.locator('#chart-type')).toHaveValue('vertical-bar');
});

test('as datas do arquivo viram Mês, Ano e Semana no painel, conferidas nos valores', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/datas-e2e.dbf');
  const linhas = page.locator('#painel-linhas');
  // AAAAMMDD (DT_NOTIFIC), DDMMAAAA (DTOBITO) e AAAASS (SEM_NOT): cada um lido da posição certa.
  await expect(linhas.locator('option[value="data:mes:DT_NOTIFIC"]')).toHaveCount(1);
  await expect(linhas.locator('option[value="data:mes:DTOBITO"]')).toHaveCount(1);
  await expect(linhas.locator('option[value="data:semana:SEM_NOT"]')).toHaveCount(1);
  // O começo da tabela continua sendo um campo de verdade.
  await expect(linhas).not.toHaveValue(/^data:/);

  await linhas.selectOption('data:mes:DT_NOTIFIC');
  await page.locator('.painel-executar').click();
  const corpo = page.locator('#result-table tbody');
  await expect(corpo.locator('tr', { hasText: 'Janeiro' })).toContainText('2');
  await expect(corpo.locator('tr', { hasText: 'Março' })).toContainText('3');
  await expect(corpo.locator('tr', { hasText: 'Dezembro' })).toContainText('1');

  // O mesmo mês, lido de um campo DDMMAAAA.
  await linhas.selectOption('data:mes:DTOBITO');
  await page.locator('.painel-executar').click();
  await expect(corpo.locator('tr', { hasText: 'Março' })).toContainText('3');

  await linhas.selectOption('data:semana:SEM_NOT');
  await page.locator('.painel-executar').click();
  await expect(corpo.locator('tr', { hasText: 'Semana 03' })).toContainText('2');
});

test('mapa com um arquivo só: o controle passa pelos meses da data de notificação e mostra a evolução', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('tabsis.aberto.group-campos', '1'); } catch { /* ignora */ } });
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/DENGSP24.dbf');
  await expect(page.locator('#run-button')).toBeEnabled();
  await page.locator('[data-view="map"]').click();

  const faixa = page.locator('#map-period');
  await expect(faixa).toBeVisible({ timeout: 15000 });
  // Três meses com registros: janeiro (3), março (5), junho (1).
  await expect(page.locator('#map-period-select option')).toHaveText(['Todos os meses juntos', 'Janeiro', 'Março', 'Junho']);
  await expect(page.locator('#map-period-chart svg.map-evolucao circle')).toHaveCount(3);

  await page.locator('#map-period-slider').fill('1');
  await expect(page.locator('#map-period-status')).toContainText('Mostrando Março');
  await expect(page.locator('#map-period-chart .evo-valor')).toHaveText('5');
  await expect(page.locator('#map-legend')).toBeVisible();

  // Em variação, março comparado a janeiro.
  await page.locator('#map-variation').selectOption('abs');
  await expect(page.locator('#map-period-status')).toContainText('de Janeiro para Março');
});

test('qualquer campo de município ganha UF, Região e UF, Região de saúde e Macrorregião', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/DENGSP24.dbf');
  const linhas = page.locator('#painel-linhas');
  await expect(linhas.locator('option[value="regiao:saude:ID_MN_RESI"]')).toHaveCount(1, { timeout: 15000 });
  await expect(linhas.locator('option[value="regiao:macro:ID_MN_RESI"]')).toHaveCount(1);
  // Também como filtro, em Seleções.
  await expect(page.locator('#painel-selecoes-disponiveis option[value="regiao:saude:ID_MN_RESI"]')).toHaveCount(1);

  await linhas.selectOption('regiao:saude:ID_MN_RESI');
  // São 474 regiões de saúde no país: só as que têm registro.
  await page.getByLabel('Suprimir linhas zeradas').check();
  await page.locator('.painel-executar').click();
  const corpo = page.locator('#result-table tbody');
  // 6 registros na capital paulista (região de saúde 35016 São Paulo).
  await expect(corpo.locator('tr', { hasText: '35016 São Paulo' }).locator('td').last()).toHaveText(/^\s*5\s*$/);

  await linhas.selectOption('regiao:macro:ID_MN_RESI');
  await page.locator('.painel-executar').click();
  await expect(corpo.locator('tr', { hasText: 'RRAS6' }).locator('td').last()).toHaveText(/^\s*5\s*$/);

  await linhas.selectOption('regiao:uf:ID_MN_RESI');
  await page.locator('.painel-executar').click();
  await expect(corpo.locator('tr', { hasText: 'Pará' }).locator('td').last()).toHaveText(/^\s*3\s*$/);
});

test('cartão do município: comparar dois lugares lado a lado, com as duas linhas de evolução', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/COMPSP24.dbf');
  await page.locator('[data-view="map"]').click();
  await expect(page.locator('#map-uf option[value="35"]')).toHaveCount(1, { timeout: 15000 });
  await page.locator('#map-uf').selectOption('35');
  await expect(page.locator('#map-focus-trail')).toHaveText('Brasil › São Paulo');
  await expect(page.locator('#map-legend')).toContainText('2 áreas associadas', { timeout: 15000 });
  await expect(page.locator('#map-period-chart svg')).toHaveCount(1, { timeout: 15000 });

  const acharPorDica = (trecho: string) => page.evaluate((procura) => {
    const canvas = document.querySelector<HTMLCanvasElement>('#map-canvas')!;
    const tooltip = document.querySelector<HTMLElement>('#map-tooltip')!;
    const box = canvas.getBoundingClientRect();
    const cx = box.width * 0.6;
    const cy = box.height * 0.62;
    for (let y = Math.max(0, cy - 140); y < Math.min(box.height, cy + 140); y += 3) {
      for (let x = Math.max(0, cx - 180); x < Math.min(box.width, cx + 180); x += 3) {
        canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: box.left + x, clientY: box.top + y, bubbles: true }));
        if (!tooltip.hidden && tooltip.textContent?.startsWith(procura)) return { x, y };
      }
    }
    return null;
  }, trecho);

  const capital = await acharPorDica('São Paulo ·');
  expect(capital).not.toBeNull();
  await page.locator('#map-canvas').click({ position: capital! });
  const cartao = page.locator('#map-card');
  await expect(cartao).toContainText('São Paulo · São Paulo');

  await cartao.getByRole('button', { name: /Comparar/ }).click();
  await expect(cartao).toContainText('Toque em outro município');
  const campinas = await acharPorDica('Campinas ·');
  expect(campinas).not.toBeNull();
  await page.locator('#map-canvas').click({ position: campinas! });

  await expect(cartao.locator('.map-card-col--b')).toContainText('Campinas');
  await expect(cartao.locator('.map-card-col--a')).toContainText('6');
  await expect(cartao.locator('.map-card-col--b')).toContainText('4');
  // Duas linhas: janeiro/março de cada um.
  await expect(cartao.locator('svg polyline.evo-linha-b')).toHaveCount(1);
  await expect(cartao.locator('.map-card-series .map-period-bar span')).toHaveText(['Janeiro · 4', 'Março · 2']);
  await expect(cartao.locator('.map-card-series-b .map-period-bar span')).toHaveText(['Janeiro · 1', 'Março · 3']);

  await cartao.getByRole('button', { name: 'Tirar a comparação' }).click();
  await expect(cartao.locator('.map-card-col--b')).toHaveCount(0);
});

test('mapa: lugar de infecção, separar por uma variável e pintar a porcentagem de um valor', async ({ page }) => {
  // LTA 2023: 3 mucosas em 8 casos (um em branco). 2024: 1 em 2.
  const { writeDbf } = await import('../dist/packages/export/src/dbf-writer.js');
  const campo = (name: string, length: number) => ({ name, type: 'C', length, decimalCount: 0 });
  const arquivo = (linhas: string[][]) => Buffer.from(writeDbf(
    linhas.map(([ID_MN_RESI, CLAS_FORMA]) => ({ ID_MN_RESI, COMUNINF: '520060', CLAS_FORMA })),
    [campo('ID_MN_RESI', 6), campo('COMUNINF', 6), campo('CLAS_FORMA', 1)],
  ));
  await page.goto('/');
  await page.locator('#file-input').setInputFiles([
    { name: 'LTANBR23.dbf', mimeType: 'application/octet-stream', buffer: arquivo([
      ['520060', '1'], ['520060', '1'], ['520060', '1'], ['520060', '2'],
      ['520530', '2'], ['520530', '2'], ['530010', '1'], ['530010', ''],
    ]) },
    { name: 'LTANBR24.dbf', mimeType: 'application/octet-stream', buffer: arquivo([['520060', '2'], ['530010', '1']]) },
  ]);
  await page.locator('[data-view="map"]').click();
  await expect(page.locator('#map-period-status')).toContainText('Mostrando todos', { timeout: 20000 });

  // O local provável de infecção aparece como Lugar, com o nome.
  await expect(page.locator('#map-geo-field option')).toContainText(['município de residência · ID_MN_RESI', 'município provável de infecção · COMUNINF']);

  // Separar pela forma clínica: o Valor oferece cada forma, o total e a porcentagem.
  await page.locator('#map-cross-field').selectOption('CLAS_FORMA');
  await expect(page.locator('#map-value-column option')).toContainText(['1 · Cutânea', '2 · Mucosa', 'Em branco', 'Total (todas as colunas)', '% 1 · Cutânea', '% 2 · Mucosa', '% Em branco']);
  await page.locator('#map-value-column').selectOption({ label: '% 2 · Mucosa' });
  await expect(page.locator('#map-legend')).toContainText('% 2 · Mucosa no total do lugar');
  // A evolução é a porcentagem do recorte inteiro, não a soma das porcentagens:
  // 2023 = 3 em 8 (o branco conta no total); 2024 = 1 em 2.
  await page.locator('#map-period-select').selectOption({ label: '2023' });
  await expect(page.locator('#map-period-chart .evo-valor')).toHaveText('37,5');
  await page.locator('#map-period-select').selectOption({ label: '2024' });
  await expect(page.locator('#map-period-chart .evo-valor')).toHaveText('50');
  await page.locator('#map-value-column').selectOption({ label: 'Total (todas as colunas)' });
  await expect(page.locator('#map-period-chart .evo-valor')).toHaveText('2');

  // Trocar o lugar para o de infecção refaz o mapa e diz o que pinta.
  await page.locator('#map-cross-field').selectOption('');
  await page.locator('#map-geo-field').selectOption('COMUNINF');
  await expect(page.locator('#map-message')).toContainText('município provável de infecção');
});

test('CNES: nome do estabelecimento na Microdados e um ponto por estabelecimento no mapa', async ({ page }) => {
  // O cadastro vem do espelho, conferido pelo hash do manifesto do site; aqui os dois são simulados.
  const { createHash } = await import('node:crypto');
  const cadastro = JSON.stringify([
    ['0010456', 'HOSPITAL TESTE A', '530010', -15.79, -47.88],
    ['2649527', 'UBS TESTE B', '530010', -15.83, -48.05],
    ['3000001', 'SEM COORDENADA', '530010', null, null],
  ]);
  const sha256 = createHash('sha256').update(cadastro).digest('hex');
  await page.route('**/cnes.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    schema: 'tabsis.cnes', version: 1, baseUrl: 'https://pub-41df939070d7465a8513416a16be8f88.r2.dev', fonte: 'CNES (teste)', dataDaFonte: '2025-06-11',
    campos: ['cnes', 'nome', 'municipio', 'latitude', 'longitude'], ufs: { 53: { registros: 3, bytes: cadastro.length, bytesComprimidos: 0, sha256 } },
  }) }));
  await page.route('https://pub-41df939070d7465a8513416a16be8f88.r2.dev/cnes/53.json', (route) => route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: cadastro }));

  const { writeDbf } = await import('../dist/packages/export/src/dbf-writer.js');
  const campo = (name: string, length: number) => ({ name, type: 'C', length, decimalCount: 0 });
  const linhas = [['0010456', 'M'], ['0010456', 'F'], ['0010456', 'M'], ['2649527', 'F'], ['3000001', 'M']]
    .map(([ID_UNIDADE, CS_SEXO]) => ({ ID_MN_RESI: '530010', ID_UNIDADE, CS_SEXO }));
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'LTANBR23.dbf', mimeType: 'application/octet-stream', buffer: Buffer.from(writeDbf(linhas, [campo('ID_MN_RESI', 6), campo('ID_UNIDADE', 7), campo('CS_SEXO', 1)])) });
  await expect(page.locator('#run-button')).toBeEnabled();
  await page.locator('#analysis-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#result-table tbody')).toBeVisible();

  // Microdados: o código ganha o nome, e a busca acha pelo nome.
  await page.locator('[data-view="microdata"]').click();
  await page.locator('#case-field').selectOption('ID_UNIDADE');
  await expect(page.locator('#values-table tbody tr').first()).toContainText('HOSPITAL TESTE A');
  await page.locator('#values-filter').fill('teste b');
  await expect(page.locator('#values-table tbody tr')).toHaveCount(1);
  await expect(page.locator('#values-table tbody tr')).toContainText('2649527');

  // Mapa: um ponto por estabelecimento com coordenada; o que fica de fora é dito.
  await page.locator('[data-view="map"]').click();
  await expect(page.locator('#map-cnes-label')).toBeVisible({ timeout: 20000 });
  await page.locator('#map-cnes-check').check();
  await expect(page.locator('#map-message')).toContainText('2 estabelecimentos (ID_UNIDADE) com 4 de 5 registros; 1 sem coordenada');
});

test('relatório para imprimir: título, tabela, mapa e um mapa por ano, só na impressão', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles([
    'e2e/fixtures/DENGBR23.dbf', 'e2e/fixtures/DENGBR24.dbf', 'e2e/fixtures/DENGBR25.dbf',
  ]);
  await expect(page.locator('#report-button')).toBeEnabled({ timeout: 20000 });
  await page.evaluate(() => { (window as unknown as { __impressoes: number }).__impressoes = 0; window.print = () => { (window as unknown as { __impressoes: number }).__impressoes += 1; }; });
  await page.locator('#report-button').click();
  await expect(page.locator('#report-dialog')).toBeVisible();
  await page.locator('#report-title').fill('Dengue no teste');
  // Foco num estado só para o relatório: a lista sai dos estados com dado.
  await expect.poll(() => page.locator('#report-focus option').count(), { timeout: 20000 }).toBeGreaterThan(2);
  const estado = await page.locator('#report-focus option').nth(2).getAttribute('value');
  await page.locator('#report-focus').selectOption(estado!);
  await page.locator('#report-print').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __impressoes: number }).__impressoes), { timeout: 60000 }).toBe(1);
  const relatorio = page.locator('#relatorio-impressao');
  await expect(relatorio.locator('h1')).toHaveText('Dengue no teste');
  await expect(relatorio.locator('table tbody tr').first()).toBeAttached();
  await expect(relatorio.locator('img.rel-mapa')).toHaveCount(1);
  // Três arquivos, três anos: um mapa para cada.
  await expect(relatorio.locator('.rel-anos figure')).toHaveCount(3);
  await expect(relatorio.locator('.rel-anos figcaption')).toHaveText(['2023', '2024', '2025']);
  await expect(page.locator('body')).toHaveAttribute('data-print-target', 'relatorio');
  // O mapa da tela volta ao Brasil depois do relatório.
  await expect(page.locator('#map-uf')).toHaveValue('');
  // Na tela nada muda; imprimir a tabela depois volta a imprimir a tabela.
  await expect(relatorio).toBeHidden();
  await page.locator('[data-view="table"]').click();
  await page.locator('#table-print').click();
  await expect(page.locator('body')).not.toHaveAttribute('data-print-target', 'relatorio');
});

test('taxa por 100 mil: a população aberta no mapa troca contagem por taxa, e desliga de volta', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles([
    'e2e/fixtures/DENGBR23.dbf', 'e2e/fixtures/DENGBR24.dbf', 'e2e/fixtures/DENGBR25.dbf',
  ]);
  await page.locator('[data-view="map"]').click();
  await expect(page.locator('#map-period-status')).toContainText('Mostrando todos', { timeout: 20000 });
  await expect(page.locator('#map-taxa-check')).not.toBeChecked();

  await page.locator('#map-populacao-input').setInputFiles('e2e/fixtures/populacao-e2e.csv');
  await expect(page.locator('#map-populacao-status')).toContainText('3 municípios · 2023 a 2024');
  await expect(page.locator('#map-populacao-status')).toContainText('MUNIC_RES e POPULACAO');
  await expect(page.locator('#map-taxa-check')).toBeChecked();
  await expect(page.locator('#map-legend')).toContainText('Por 100 mil hab.');

  // 2024: 9 casos em 19,03 milhões de habitantes = 0,05 por 100 mil.
  await page.locator('#map-period-select').selectOption({ label: '2024' });
  await expect(page.locator('#map-period-chart .evo-valor')).toHaveText('0,05');

  await page.locator('#map-taxa-check').uncheck();
  await expect(page.locator('#map-legend')).not.toContainText('Por 100 mil');
  await expect(page.locator('#map-period-chart .evo-valor')).toHaveText('9');
});

test('taxa por 100 mil com a população da API do IBGE: cada ano usa a sua série, ou a mais próxima', async ({ page }) => {
  // A API do IBGE fica simulada: o teste não depende da internet. Mesmo
  // formato da resposta real (tabela 6579, variável 9324; Censo 2022 na 4709).
  const pedidos: string[] = [];
  const municipios = (ano: string, sp: number, belem: number, rio: number) => [{
    id: '9324', resultados: [{ classificacoes: [], series: [
      { localidade: { id: '3550308' }, serie: { [ano]: String(sp) } },
      { localidade: { id: '1501402' }, serie: { [ano]: String(belem) } },
      { localidade: { id: '3304557' }, serie: { [ano]: String(rio) } },
      ...Array.from({ length: 5600 }, (_, i) => ({ localidade: { id: String(1100000 + i * 10 + 5) }, serie: { [ano]: '1000' } })),
    ] }],
  }];
  await page.route('https://servicodados.ibge.gov.br/**', async (route) => {
    const url = route.request().url();
    pedidos.push(url);
    const corpo = url.endsWith('/6579/periodos') ? [{ id: '2021' }, { id: '2024' }, { id: '2025' }]
      : url.includes('/4709/periodos/2022/') ? municipios('2022', 11451999, 1303403, 6211223)
        : url.includes('/6579/periodos/2024/') ? municipios('2024', 11500000, 1310000, 6220000)
          : url.includes('/6579/periodos/2025/') ? municipios('2025', 11600000, 1320000, 6230000) : null;
    await route.fulfill(corpo ? { json: corpo, headers: { 'Access-Control-Allow-Origin': '*' } } : { status: 404 });
  });
  await page.goto('/');
  await page.locator('#file-input').setInputFiles([
    'e2e/fixtures/DENGBR23.dbf', 'e2e/fixtures/DENGBR24.dbf', 'e2e/fixtures/DENGBR25.dbf',
  ]);
  await page.locator('[data-view="map"]').click();
  await expect(page.locator('#map-period-status')).toContainText('Mostrando todos', { timeout: 20000 });
  // Marcar a taxa sem população já busca no IBGE.
  await page.locator('#map-taxa-check').click();
  const status = page.locator('#map-populacao-status');
  await expect(status).toContainText('API do IBGE');
  await expect(status).toContainText('2023 usa Censo 2022');
  await expect(status).toContainText('2024 (Estimativa 2024)');
  await expect(page.locator('#map-legend')).toContainText('Por 100 mil hab.');
  await page.locator('#map-period-select').selectOption({ label: '2024' });
  await expect(page.locator('#map-period-chart .evo-valor')).toHaveText('0,05');
  // Só o ano e a tabela foram para o IBGE: nenhum dado do arquivo na URL.
  expect(pedidos.every((url) => /\/agregados\/(6579|4709)\/periodos(\/\d{4}\/variaveis\/\d+\?localidades=N6%5Ball%5D)?$/.test(url))).toBe(true);
});

test('a primeira tabela começa pela residência, não pelo município do hospital, e o mapa diz o que pinta', async ({ page }) => {
  await page.goto('/');
  // No SINAN, MUNICIPIO é o município do hospital; ele vem antes no arquivo.
  await page.locator('#file-input').setInputFiles('e2e/fixtures/HOSPBR24.dbf');
  await expect(page.locator('#result-table tbody')).toContainText('Belém (150140)');
  await page.locator('[data-view="map"]').click();
  await expect(page.locator('#map-message')).toContainText('Mapa da tabela:');
  await expect(page.locator('#map-message')).toContainText('(ID_MN_RESI)');
});

test('mapa: opções recolhidas, pintar por região de saúde no estado e imagem com título e legenda', async ({ page }) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles('e2e/fixtures/COMPSP24.dbf');
  await page.locator('[data-view="map"]').click();
  // As opções de cor e camadas ficam recolhidas: o mapa aparece logo.
  await expect(page.locator('#map-opcoes')).not.toHaveAttribute('open', '');
  await expect(page.locator('#map-classification')).toBeHidden();
  await page.locator('#map-opcoes summary').click();
  await expect(page.locator('#map-classification')).toBeVisible();

  await expect(page.locator('#map-uf option[value="35"]')).toHaveCount(1, { timeout: 15000 });
  await expect(page.locator('#map-area-label')).toBeHidden();
  await page.locator('#map-uf').selectOption('35');
  await expect(page.locator('#map-legend')).toContainText('2 áreas associadas', { timeout: 15000 });
  await expect(page.locator('#map-area-label')).toBeVisible();

  // Por região de saúde: a capital é uma região só; Campinas pinta os 19 municípios da região dela.
  await page.locator('#map-area-level').selectOption('BR_REGSAUD.CNV');
  await expect(page.locator('#map-legend')).toContainText('Região de saúde (CIR)');
  await expect(page.locator('#map-legend')).toContainText('20 áreas associadas');

  // A imagem leva título, período e legenda: é mais alta que o desenho.
  const download = page.waitForEvent('download');
  await page.locator('#map-png-button').click();
  const arquivo = await (await download).path();
  const bytes = (await import('node:fs')).readFileSync(arquivo);
  expect(bytes.subarray(1, 4).toString()).toBe('PNG');
  const alturaImagem = bytes.readUInt32BE(20);
  const alturaDesenho = await page.locator('#map-canvas').evaluate((c: HTMLCanvasElement) => c.height);
  expect(alturaImagem).toBeGreaterThan(alturaDesenho + 100);
});
