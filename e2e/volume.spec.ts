import { expect, test } from '@playwright/test';
import { execSync } from 'node:child_process';
// Medição manual de volume: gere os arquivos com scripts/gerar-dbf-sintetico.py e
// rode com TABSIS_VOLUME_DIR=<pasta> npx playwright test e2e/volume.spec.ts
const S = process.env.TABSIS_VOLUME_DIR ?? '';
const rss = () => {
  try {
    const linhas = execSync("ps -eo rss,args | grep 'ms-playwright' | grep -v grep", { encoding: 'utf8' }).trim().split('\n');
    return Math.round(linhas.reduce((t, l) => t + Number(l.trim().split(/\s+/)[0] || 0), 0) / 1024);
  } catch { return -1; }
};
test('volume: 5 anos × 1,5 milhão de registros', async ({ page }) => {
  test.skip(!S, 'só roda com TABSIS_VOLUME_DIR');
  test.setTimeout(30 * 60_000);
  const marcas: string[] = [];
  let t0 = Date.now();
  const marca = (nome: string) => { const s = ((Date.now() - t0) / 1000).toFixed(1); marcas.push(nome + ': ' + s + ' s, RAM ' + rss() + ' MB'); console.log('MARCA', marcas.at(-1)); t0 = Date.now(); };
  await page.goto('/');
  marca('página aberta');
  await page.locator('#file-input').setInputFiles([20, 21, 22, 23, 24].map((a) => S + '/DENGBR' + a + '.dbf'));
  await expect(page.locator('#dataset-files-summary')).toContainText('7.500.000 registros', { timeout: 20 * 60_000 });
  await expect(page.locator('#result-table tbody tr').first()).toBeVisible({ timeout: 20 * 60_000 });
  marca('5 arquivos abertos e juntados + 1ª tabela');
  await page.locator('#painel-linhas').selectOption('periodo:arquivo');
  await page.locator('.painel-executar').click();
  await expect(page.locator('#result-table tbody tr')).toHaveCount(5, { timeout: 20 * 60_000 });
  marca('tabela Linhas = Ano (5 leituras)');
  await page.locator('#painel-linhas').selectOption('campo:CS_SEXO');
  await page.locator('#painel-colunas').selectOption('data:mes:DT_NOTIFIC');
  await page.locator('.painel-executar').click();
  await expect(page.locator('#result-table thead')).toContainText('Janeiro', { timeout: 20 * 60_000 });
  marca('tabela Sexo x Mês de notificação');
  await page.locator('[data-view="map"]').click();
  await expect(page.locator('#map-legend')).toBeVisible({ timeout: 20 * 60_000 });
  marca('mapa do Brasil por estado');
  await expect(page.locator('#map-period-status')).toContainText('Mostrando todos', { timeout: 20 * 60_000 });
  marca('mapa: 5 anos lidos para o controle');
  await page.locator('#map-time-scale').selectOption('data:mes:DT_NOTIFIC');
  await expect(page.locator('#map-period-select option')).toHaveCount(13, { timeout: 20 * 60_000 });
  marca('mapa: meses de notificação');
  await page.locator('#map-uf').selectOption('35');
  await expect(page.locator('#map-focus-trail')).toHaveText('Brasil › São Paulo');
  await expect(page.locator('#map-legend')).toContainText('áreas associadas', { timeout: 20 * 60_000 });
  marca('mapa: foco em São Paulo');
  console.log('RESUMO\n' + marcas.join('\n'));
});
