import assert from 'node:assert/strict';
import test from 'node:test';
import { relatorioEpidemiologico, vpaMinimosQuadrados, vpaPraisWinsten } from '../dist/packages/analysis/src/relatorio-epidemiologico.js';

// Leishmaniose tegumentar, forma cutânea, casos novos, 2016–2025 (os números do resumo-leishmaniose).
const BR = {
  id: 'BR', nome: 'Brasil',
  casos: [11928, 16709, 15632, 14659, 15732, 14260, 12091, 12137, 9173, 9260],
  populacao: [206081432, 207660929, 208494900, 210147125, 211755692, 213317639, 203080756, 203080756, 212583750, 213421037],
};
const DF = {
  id: 'NUC', nome: 'DF',
  casos: [24, 27, 21, 19, 41, 33, 29, 31, 17, 23],
  populacao: [2977216, 3039444, 2974703, 3015268, 3055149, 3094325, 2817381, 2817381, 2982818, 2996899],
};
const taxas = (g) => g.casos.map((c, i) => (c / g.populacao[i]) * 1e5);
const umaCasa = (t) => [t.vpa, t.inferior, t.superior].map((v) => Math.round(v * 10) / 10);

test('a variação anual bate com o resumo da leishmaniose (log-linear, t de 8 gl) e com o caderno em R (Prais-Winsten)', () => {
  assert.deepEqual(umaCasa(vpaMinimosQuadrados(taxas(BR))), [-5.1, -8.8, -1.3]);
  assert.deepEqual(umaCasa(vpaMinimosQuadrados(taxas(DF))), [-0.1, -7.1, 7.5]);
  assert.equal(Math.round(vpaPraisWinsten(taxas(BR)).vpa * 10) / 10, -5);
  assert.equal(vpaMinimosQuadrados([1, 0, 2]), null);
});

const quadrado = (x, y) => [[[x, y], [x + 0.5, y], [x + 0.5, y + 0.5], [x, y + 0.5], [x, y]]];
const dados = {
  titulo: 'Casos novos de leishmaniose tegumentar (forma cutânea) em DF e Entorno, 2016–2025',
  subtitulo: 'Coeficiente de detecção.', agravo: 'casos novos', anos: [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025],
  fontePopulacao: [], grupos: [BR, { ...DF, id: 'REG', nome: 'DF e Entorno' }, DF],
  municipios: [
    { codigo: '530010', nome: 'Brasília', casos: 265, populacaoSoma: 29770583, infeccoes: 26, partes: quadrado(-48, -16) },
    { codigo: '520060', nome: 'Alto Paraíso de <Goiás>', casos: 148, populacaoSoma: 88320, infeccoes: 172, partes: quadrado(-47.5, -14) },
  ],
  contexto: [quadrado(-60, -30)], estados: [quadrado(-48.2, -16.2)],
  gruposDoPerfil: ['BR', 'NUC'],
  perfil: [{ titulo: 'Sexo', linhas: [{ rotulo: 'Masculino', porGrupo: { BR: 3, NUC: 1 } }, { rotulo: 'Feminino', porGrupo: { BR: 1, NUC: 1 } }] }],
  autoctonia: { NUC: { autoctones: 20, total: 265 } },
  definicaoDeCaso: ['Tipo de entrada = 1 (Caso novo)'], regiao: 'DF e Entorno: 34 municípios',
  arquivos: ['LTANBR16.dbf'], geradoEm: '28/10/2026',
};

test('o relatório é um HTML único com números, mapa, tabelas, perfil e como foi feito', () => {
  const html = relatorioEpidemiologico(dados);
  assert.match(html, /^<!doctype html>/);
  assert.ok(!/<script src|<link /.test(html), 'nada vem de fora: abre sem internet');
  assert.match(html, /131\.581<\/b><span>casos no Brasil · média de 6,3 por 100 mil/);
  assert.match(html, /só 7,5% dos casos se infectaram no próprio município/);
  assert.match(html, /<td>2016–2025<\/td><td>131\.581<\/td><td>6,30<\/td>/);
  assert.match(html, /-5,1% \(-8,8 a -1,3\)/);
  assert.match(html, /Brasil<\/b>: tendência de queda/);
  assert.equal((html.match(/class="mun /g) ?? []).length, 2);
  assert.equal((html.match(/class="ctx"/g) ?? []).length, 0, 'município longe da região não entra no fundo do mapa');
  assert.match(html, /Alto Paraíso de &lt;Goiás&gt;/);
  assert.ok(!html.includes('<Goiás>'));
  assert.match(html, /<td>Masculino<\/td><td>75,0%<\/td><td>50,0%<\/td>/);
  assert.match(html, /Região:<\/b> DF e Entorno: 34 municípios/);
  assert.match(html, /100,0%<\/b> das 198 infecções adquiridas na região ocorreram em Alto Paraíso de &lt;Goiás&gt; \(172\), Brasília \(26\)/);
});

test('sem região, o relatório traz só o Brasil e avisa sobre o mapa', () => {
  const html = relatorioEpidemiologico({ ...dados, grupos: [BR], municipios: [], gruposDoPerfil: ['BR'], autoctonia: undefined, regiao: undefined });
  assert.match(html, /Sem região na receita/);
  assert.ok(!html.includes('<h2>Municípios</h2>'));
});
