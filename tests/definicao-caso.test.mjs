import assert from 'node:assert/strict';
import test from 'node:test';
import {
  casaDefinicao,
  descreverDefinicao,
  lerDefinicao,
  lerRegras,
  previaDeCaso,
} from '../dist/packages/core/src/definicao-caso.js';

test('Chagas: B57 entra inteiro, B56 (doença do sono) fica de fora', () => {
  const chagas = lerDefinicao('B57', '');
  for (const valor of ['B57', 'B570', 'B575', 'b57.2', ' B573 ']) assert.equal(casaDefinicao(chagas, valor), true, valor);
  for (const valor of ['B56', 'B560', 'B58', 'A57', '', 'B5']) assert.equal(casaDefinicao(chagas, valor), false, valor);
});

test('faixa compara o começo do código com cada ponta', () => {
  const dengue = lerDefinicao('A90-A91', '');
  for (const valor of ['A90', 'A900', 'A91X', 'A919']) assert.equal(casaDefinicao(dengue, valor), true, valor);
  for (const valor of ['A89', 'A92', 'A9']) assert.equal(casaDefinicao(dengue, valor), false, valor);
  assert.equal(casaDefinicao(lerDefinicao('B570 - B572', ''), 'B573'), false);
});

test('excluir vale por cima de incluir; sem incluir, só exclui', () => {
  const tripSemSono = lerDefinicao('B56-B57', 'B56');
  assert.equal(casaDefinicao(tripSemSono, 'B571'), true);
  assert.equal(casaDefinicao(tripSemSono, 'B561'), false);
  assert.equal(casaDefinicao(lerDefinicao('', 'R99'), 'I219'), true);
  assert.equal(casaDefinicao(lerDefinicao('', 'R99'), 'R99'), false);
});

test('entrada inválida é recusada com uma frase que diz o que fazer', () => {
  assert.throws(() => lerRegras('B57-B58-B59'), /Faixa inválida/);
  assert.throws(() => lerRegras('B575-B570'), /Faixa invertida/);
  assert.throws(() => lerRegras('B5#'), /caracteres/);
  assert.deepEqual(lerRegras('B57, A90;A91\nB55*').map((regra) => regra.inicio), ['B57', 'A90', 'A91', 'B55']);
});

test('a prévia conta o que entra, o que a exclusão tirou e regras que não acharam nada', () => {
  const contagens = [
    { valor: 'B570', registros: 2 },
    { valor: 'B572', registros: 10 },
    { valor: 'B560', registros: 4 },
    { valor: 'I219', registros: 100 },
  ];
  const previa = previaDeCaso(lerDefinicao('B56-B57, Z99', 'B56'), contagens);
  assert.deepEqual(previa.entram, [{ valor: 'B572', registros: 10 }, { valor: 'B570', registros: 2 }]);
  assert.equal(previa.registrosQueEntram, 12);
  assert.equal(previa.registrosQueFicamFora, 104);
  assert.deepEqual(previa.excluidos, [{ valor: 'B560', registros: 4 }]);
  assert.deepEqual(previa.regrasSemCasamento, ['Z99']);
  assert.equal(descreverDefinicao(lerDefinicao('B57', 'B56')), 'B57, sem B56');
});

test('a regra vira filtro do motor: guarda o texto e pega códigos que a lista não tinha', async () => {
  const { compileQueryPlan, executeInMemory } = await import('../dist/packages/core/src/index.js');
  const registros = ['B570', 'B574', 'B560', 'I219', 'b57.2'].map((CAUSABAS) => ({ CAUSABAS }));
  const plano = compileQueryPlan({
    compatibilityProfile: 'tabwin-4.15',
    rows: { field: 'CAUSABAS' },
    measure: { kind: 'count' },
    filters: [{ field: 'CAUSABAS', kind: 'code-rules', include: 'B56-B57', exclude: 'B56' }],
  });
  const resultado = executeInMemory(registros, plano, {});
  assert.equal(resultado.recordsAccepted, 3);
  assert.deepEqual(resultado.rows.map((linha) => linha.key).sort(), ['B570', 'B574', 'b57.2']);
  assert.ok(plano.warnings.some((aviso) => /code rules/.test(aviso)));
  assert.throws(() => compileQueryPlan({
    compatibilityProfile: 'tabwin-4.15', rows: { field: 'CAUSABAS' }, measure: { kind: 'count' },
    filters: [{ field: 'CAUSABAS', kind: 'code-rules', include: 'B575-B570', exclude: '' }],
  }), /code rules are invalid/);
});

test('o código R e Python gerado aplica a mesma regra', async () => {
  const { transformPipelineToCode } = await import('../dist/packages/analysis/src/transform-pipeline-code.js');
  const etapa = [{ kind: 'filter-rows', filters: [{ field: 'CAUSABAS', kind: 'code-rules', include: 'B56-B57', exclude: 'B56' }] }];
  const python = transformPipelineToCode(etapa, 'python', 'df');
  const r = transformPipelineToCode(etapa, 'r', 'df');
  assert.match(python, /str\.startswith\('B56'\)|str\.startswith\("B56"\)/);
  assert.match(python, /~\(/);
  assert.match(r, /startsWith\(/);
  assert.match(r, /substr\(/);
});

test('a receita salva guarda a regra e reabre igual', async () => {
  const { parseRecipe, serializeRecipe } = await import('../dist/packages/core/src/recipe.js');
  const filtro = { field: 'CAUSABAS', mode: 'include', kind: 'code-rules', include: 'B57', exclude: 'B56' };
  const receita = {
    schema: 'tabwin-web.recipe', version: 1, conversions: [], sourceHints: [],
    spec: { compatibilityProfile: 'tabwin-4.15', rows: { field: 'CAUSABAS' }, measure: { kind: 'count' }, filters: [filtro] },
  };
  assert.deepEqual(parseRecipe(serializeRecipe(receita)).spec.filters, [filtro]);
  const quebrada = serializeRecipe({ ...receita, spec: { ...receita.spec, filters: [{ ...filtro, include: 'B5#' }] } });
  assert.throws(() => parseRecipe(quebrada), /code rules are invalid/);
});

test('atalhos: RIDE-DF com 34 municípios e faixa etária no código do SINAN', async () => {
  const { RIDE_DF_LC_163_2018, faixaEtariaSinan } = await import('../dist/packages/core/src/definicao-caso.js');
  assert.equal(new Set(RIDE_DF_LC_163_2018).size, 34);
  const ride = lerDefinicao(RIDE_DF_LC_163_2018.join(', '), '');
  assert.equal(casaDefinicao(ride, '520060'), true);
  assert.equal(casaDefinicao(ride, '520870'), false);
  const idosos = lerDefinicao(faixaEtariaSinan(60, 999), '');
  for (const idade of ['4060', '4075', '4105']) assert.equal(casaDefinicao(idosos, idade), true, idade);
  for (const idade of ['4059', '3011', '2030']) assert.equal(casaDefinicao(idosos, idade), false, idade);
  const criancas = lerDefinicao(faixaEtariaSinan(0, 9), '');
  for (const idade of ['1012', '2030', '3011', '4000', '4009']) assert.equal(casaDefinicao(criancas, idade), true, idade);
  assert.equal(casaDefinicao(criancas, '4010'), false);
  assert.throws(() => faixaEtariaSinan(10, 5), /inválida/);
});

test('a receita salva guarda as etapas desligadas e as confere como as ligadas', async () => {
  const { parseRecipe, serializeRecipe } = await import('../dist/packages/core/src/recipe.js');
  const desligada = { field: 'CAUSABAS', mode: 'include', kind: 'code-rules', include: 'B57', exclude: '' };
  const receita = {
    schema: 'tabwin-web.recipe', version: 1, conversions: [], sourceHints: [],
    spec: { compatibilityProfile: 'tabwin-4.15', rows: { field: 'CAUSABAS' }, measure: { kind: 'count' }, filters: [] },
    disabledFilters: [desligada],
  };
  assert.deepEqual(parseRecipe(serializeRecipe(receita)).disabledFilters, [desligada]);
  assert.throws(() => parseRecipe(serializeRecipe({ ...receita, disabledFilters: [{ ...desligada, include: 'B5#' }] })), /code rules are invalid/);
});

test('faixa etária no código de idade do SIM (unidade + quantidade, 5 = mais de 100 anos)', async () => {
  const { faixaEtariaSim } = await import('../dist/packages/core/src/definicao-caso.js');
  assert.equal(faixaEtariaSim(60, 999), '460-499, 500-599');
  assert.equal(faixaEtariaSim(0, 9), '100-399, 400-409');
  const idosos = lerDefinicao(faixaEtariaSim(60, 999), '');
  for (const idade of ['460', '499', '501']) assert.equal(casaDefinicao(idosos, idade), true, idade);
  for (const idade of ['459', '311', '230']) assert.equal(casaDefinicao(idosos, idade), false, idade);
  assert.throws(() => faixaEtariaSim(10, 5), /inválida/);
});
